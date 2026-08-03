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

待完成后补充。
