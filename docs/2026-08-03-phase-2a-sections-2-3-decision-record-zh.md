# Phase 2a 第 2、3 节改造备案

日期：2026-08-03

## 用户命令

第 1 节已经完成。CAP、POST、RENDER 合计约 2.5 ms，性能瓶颈唯一位于
`estimatePoses()`。256×256 空白输入的纯推理中位数为 42.5 ms；启用 F16 纹理后为
35.9 ms。模型为 `MULTIPOSE_LIGHTNING`，backend 为 WebGL，`WEBGL_PACK=true`，
`WEBGL_VERSION=2`。据此将当前性能门禁按 Intel Iris Xe 低压集显的硬件限制豁免，
不再继续优化推理性能；保留 `WEBGL_FORCE_F16_TEXTURES=true`。

现在执行 phase-2a 规格的第 2 节（bodyScale 接入区域判定）和第 3 节（测试）。

## 实施边界

- 默认区域代理改为 `bodyScale`，保留 `footY` 配置开关和 CSV/debug 对照数据。
- 采用当前机位标定阈值：进入 1.045，退出 1.020；现场换机位后必须重新标定。
- baseline 使用 5 帧中位数初始化、0.005 慢跟随、漂移/速度双门控、Z2 冻结和
  回到 Z1 稳定 1 秒后解冻。
- 以按真实时间累计的泄漏积分器替换连续帧 dwell；死区内 credit 保持。
- posture 无效时不投票、不更新 baseline、不改变 credit；连续 1500 ms 后仅允许
  既有 tracking-loss 路径处理，本阶段不改变 tracking-loss 语义。
- 新增独立 `zoneDecision.test.ts`，不修改已有测试文件；真实 CSV 回放若仓库缺少
  原始 `v2_step_forward.csv`，先定位已有采集文件，找到后复制为 fixture。
- 不修改 COUNTDOWN 锁存、halo 视觉、instruction、结果页、AI attribution，也不做
  多人中位数聚合或单应标定。

## 验证要求

- 所有既有规则测试继续通过。
- 新增 9 类 zone 决策回归测试，含真实 CSV 序列回放。
- `tsc --noEmit` 与生产构建通过。
- 明确核对生产初始化路径实际设置 `WEBGL_FORCE_F16_TEXTURES=true`。

## 实施结果

- 新增每 track 独立的 `BodyScaleZoneDecision`，生产决策链为：
  `filtScale → 5 帧中位 baseline → g → posture 门控 → credit → Z1/Z2`。
- `zoneProxy` 默认 `bodyScale`；生产传入 scale 决策读数时脚点完全不参与区域判定，
  `footY` 仍可通过配置切换，并继续保留在 debug 曲线和 CSV。
- baseline 仅在漂移与速度同时稳定时以 0.005 跟随；进入 Z2 当帧冻结，退出后稳定
  1 秒再解冻。track 确认前已连续通过 sanity 的 4 帧与确认帧共同组成 5 帧初始化
  窗口，避免单帧初始化并保持既有 track 回归测试兼容。
- 泄漏积分器使用真实帧间 `dt`，进入 0.7 秒、退出 0.3 秒；1.020～1.045 死区内
  credit 保持。Z2 内的“留在近端”证据不会预充值额外退出延迟。
- posture 无效帧不投票、不更新 baseline、不改变 credit，并记录连续无效时长。
- debug 面板显示实时 g、credit、环形进度、代理类型、进入/退出阈值和 dwell；曲线
  增加两条阈值线；CSV 增加 credit、g 速度、代理、初始化计数和 posture 无效时长。
- 生产 MoveNet 初始化显式读取 `forceF16Textures: true`。本地 debug 页面实测显示
  `FORCE_F16_TEXTURES:true`、`PACK:true`、`VERSION:2`、模型为
  `MULTIPOSE_LIGHTNING`。
- 新增 `tests/zoneDecision.test.ts` 与真实 fixture。原始 CSV 产生 5 次进入、4 次退出、
  0 次额外翻转；文件在第 5 次近端停留时结束，缺少最后退回。测试明确验证这一
  事实，并用同文件同机位的真实远端平台样本补齐尾段后验证第 5 次退出。
- 未修改任何既有测试文件。五个规则测试文件全部通过，`tsc --noEmit` 通过，Vite
  与 server 生产构建通过（仅保留既有 MediaPipe eval/大 chunk 警告）。
