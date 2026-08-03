# 第 1.5 阶段变更备案：方向、幽灵检测、性能与 Track 稳定性

- 备案日期：2026-08-03
- 变更性质：第一阶段仪表化后的根因修复与复测准备
- 前置记录：`docs/2026-08-03-body-scale-probe-phase-1-change-record-zh.md`
- 备案时点：业务代码实施前

## 一、数据依据与问题判断

第一阶段已经采集并分析 7 段单人 CSV。本阶段不是凭经验猜测，而是针对数据暴露出的四个根因逐项处理：

1. 区域方向异常：`static_far` 的 scale 约 140.9、foot_y 约 0.6595，却被记录为 Z2；`static_near` 的 scale 约 145.1、foot_y 约 0.6962，却被记录为 Z1。物理上 `foot_y_norm` 越大，脚点越靠画面底部，人越近，应越接近 Z2。
2. 幽灵检测污染 track：`static_far` 约 27 秒出现 7 个 raw track ID、87 次切换，`active_count` 在 1 和 2 之间跳变；肩宽仅 1.1 px、躯干约 55.5 px 的伪检测仍通过了原 `minConf=0.3`。
3. 性能不足：实测 FPS 中位约 4～7，inference 中位约 94～182 ms，P95 达 272 ms。
4. 弯腰伪信号：`sit_squat` 中 body-scale P95/P5 达 1.87，躯干从约 130 塌到 74，而真实前进信号仅约 10%。

对照数据表明：没有幽灵时，`static_near` 和 `raise_arm` 的 raw track ID 可保持零切换，`foot_y_norm` 标准差约 0.0014；`bodyScale` 本身的举手鲁棒性已通过，本阶段不改变其核心定义。

## 二、本阶段目标和硬边界

目标是修复方向、幽灵检测、性能和 track 稳定性，并增加弯腰检测记录，然后只重录 `v2_static_far` 与 `v2_step_forward` 两段验证数据。

硬边界：

- 不把 `bodyScale` 接入任何 zone 或状态决策。
- 不修改状态机。
- 不修改第二阶段的 `enterZ2Growth` / `exitZ2Growth` 占位阈值。
- 不实现泄漏积分器、死区或多人中位数聚合。
- 不改变 halo 的视觉绘制和 instruction 文案。
- `postureValid` 只检测、显示、写 CSV，不参与 baseline、zone 或状态决策。
- 除区域方向修正与经过确认的稳定 track 输入外，其余交互语义保持不变。
- 不修改任何现有测试文件，只新增测试文件并扩展测试执行脚本。

## 三、区域方向排查与验证思路

必须从坐标链路根因开始排查，而不是先改比较符号：确认关键点 Y 原点、ROI 反变换、镜像处理轴、阈值比较方向和归一化分母。正确关系固定为：

```text
foot_y_norm 递增 → 画面脚点下移 → 人更近 → Z0 / Z1 / Z2 递增
```

增加仅 debug 可见的同帧方向一致性检查：当同帧中一人的 `rawScale` 明显更大时，其 `foot_y_norm` 原则上也应更大；频繁违反时记录 warning，但不参与决策。

## 四、幽灵过滤方案

配置将集中加入：关键点置信阈值提升为 0.5；新增 MoveNet 整体 pose score 阈值 0.35；新增 sanity、tracking、posture 和 ROI 输入尺寸配置。

MoveNet 整体 pose score 在 tracker 之前门控。随后新增 `PoseSanityFilter`，依据肩宽/画面宽、躯干/画面高、肩宽/躯干比例、有效关键点数、四个核心肩髋点和人体框中心是否位于 interaction ROI 内进行整 pose 拒绝。拒绝原因统一为 `too_small`、`too_large`、`bad_aspect`、`few_keypoints`、`missing_core` 或 `out_of_roi`。

过滤原则是优先保护真人：实测真人条件（torso≈145、shoulderWidth≈105、1440×1080、核心置信度 0.72～0.86）必须通过；若参数误杀真人，应放宽几何参数，不为追求拦截率牺牲体验。

Debug 显示最近 10 秒 accepted/rejected 计数及原因；CSV 增加 `rejected_count` 与 JSON `reject_reasons`。

## 五、稳定 Track 方案

为 raw 模型 ID 外再维护稳定 ID：

```text
rawTrackId：模型提供，可能跳变
stableTrackId：应用维护，确认后供下游使用，并可跨短暂丢失续接
```

新 track 连续通过 sanity 5 帧后才确认。未确认对象不建立 body-scale baseline，不送入 zone、active group、initiator 或 halo，也不写 CSV 主人物行。

已确认 track 消失后进入 500 ms pending grace。新 raw ID 若在归一化中心距离 0.15 内，且有效 bodyScale 与 pending 的最后尺度差异小于 20%，则继承稳定 ID、baseline、中值窗口和 One Euro 状态；超时、距离过大或尺度差异过大时创建新稳定 track。真正销毁时显式 reset 滤波器。

所有现有下游人物对象将只接收“已确认且已替换为 stableTrackId”的 observations；raw ID 只保留在旁路调试数据和 CSV 对照列中。

## 六、性能排查与改动顺序

目标是 inference 中位小于 60 ms、FPS 中位至少 15。按以下顺序处理：

1. 暴露并确认 TensorFlow backend，预期为 WebGL。
2. 暴露 `tf.memory().numTensors`，观察是否持续增长。
3. 将 interaction ROI 先缩放到配置的 256×256 左右，再送入 MoveNet MultiPose Lightning。
4. 保持 `maxPoses` 配置化；初始遵照本阶段汇总配置。
5. 核对 halo 已由独立 `requestAnimationFrame` 绘制，不把渲染塞进推理同步链。
6. `targetFps` 配置为 20，给渲染保留余量。

Debug overlay 增加 `backend`、`numTensors`、`roiInputSize`、`maxPoses`。

## 七、姿态检测（只旁路记录）

新增 `postureValid` 和 `postureReason`。优先采用躯干中线相对竖直方向的夹角、torso/shoulderWidth 相对该 track 历史中位数的变化，以及肩髋置信度组合判断 `ok`、`bent`、`occluded`、`unknown`。配置初值为最大倾角 35°、历史中位比例 0.75。

CSV 增加 `posture_valid`、`posture_reason`。本阶段该标志不改变 baseline，也不改变 zone。

## 八、配置初值备案

```text
perception: minKeypointConfidence 0.5, minPoseScore 0.35,
            maxPoses 6, roiInputSize 256, targetFps 20
sanity:     minShoulderWidthRatio 0.03, minTorsoRatio 0.06,
            maxTorsoRatio 0.60, minAspect 0.15, maxAspect 3.0,
            minValidKeypoints 6, requireCoreKeypoints true
tracking:   trackConfirmFrames 5, stableTrackReassociateRadius 0.15,
            stableTrackGracePeriodMs 500
posture:    maxTorsoTiltDeg 35, minTorsoRatioOfMedian 0.75
```

## 九、测试与完成定义

新增 `tests/poseSanityFilter.test.ts` 和 `tests/trackStability.test.ts`。覆盖正常/幽灵/过小躯干/少关键点/缺核心点/ROI 外/实测真人条件，以及 5 帧确认、300 ms 续接、800 ms 不续接、距离过大、尺度差异过大和滤波状态继承。

自动完成条件：TypeScript、所有规则测试和生产构建通过；现有测试文件无改动；debug 字段和 CSV 字段完整；区域、状态机、halo 和 instruction 的边界审计通过。

现场完成条件需要同机位重录两段 30 秒 CSV：

- `v2_static_far`：stable ID 零切换、foot_y σ < 0.005、`too_small` 有拒绝计数。
- `v2_step_forward`：stable ID 零切换、raw scale P95/P5 ≥ 1.08、近处 existing zone 为 Z2。

现场测量需要真实相机和参与者；自动化实施不能代替这两段物理复测，也不会伪造对应指标。

## 十、实施后记录（2026-08-03）

已按上述边界完成实现：sanity 在 stable track 之前执行；新人物连续通过 5 帧后才进入现有 zone/active group/initiator/halo 链路；短暂 raw ID 跳变可在 500 ms 内按位置和尺度续接 stable ID，并继承 body-scale baseline、MedianWindow 与 OneEuroFilter。区域状态仍完全由原有 `ZoneTracker` 的脚点 Y 判定驱动，bodyScale 与 posture 只记录、显示和导出，不参与区域或状态机决策。

性能路径已将 interaction ROI 预缩放为 256×256 后送入 MoveNet，目标推理频率集中配置为 20 FPS；debug overlay 暴露 backend、tensor 数、ROI 输入尺寸和 max poses。CSV 已补充 stable/raw ID、sanity 拒绝统计与 posture 字段。

### 旧 CSV 回放校准

用第一阶段的真实 CSV 回放几何门控，发现原计划的 `minShoulderWidthRatio = 0.03` 会误杀 `static_near` 中 2 个真人帧（最窄肩宽约 40.76 px，画面宽 1440 px）。按照“优先保护真人”的原则，将该项放宽为 `0.027`：

- `static_near`：168 个有效尺度帧，几何/核心点回放误杀 0 帧；
- `raise_arm`：235 个有效尺度帧，几何/核心点回放误杀 0 帧；
- `static_far`：123 个有效尺度帧中，9 帧命中 `too_small`，说明门控仍能拦截明显小型幽灵。

旧 CSV 没有完整 pose 的全部关键点和 ROI 中心字段，因此这次回放只能校准肩宽、躯干和四个核心点，不能代替新版本对 `few_keypoints`、`out_of_roi` 的现场验证。

### 方向根因结论

没有翻转任何 Y 比较符号。代码与单元测试确认：较大的 `foot_y_norm` 仍代表脚点更靠画面下方、更接近相机，并进入更近区域。旧数据表现为：

- `static_far`：`foot_y_norm` 均值约 0.716、范围约 0.446～0.926，且大量记录成 Z2；这个异常宽范围与幽灵/错误脚点污染一致；
- `step_forward`：均值约 0.673，但数据范围约 0.438～0.699，仍被异常脚点和旧 track 不稳定污染；
- `static_near`：均值约 0.696、最大约 0.7001，基本稳定，却略低于现有 `captureEnter = 0.700`，无法持续满足原有 550 ms dwell，因此保持 Z1。

因此旧数据不能支持“坐标方向写反”的判断；更符合证据的根因是幽灵检测/track 污染，以及近处标记恰好落在被冻结的现有门槛下方。本阶段遵守约束，不调整 `captureEnter`、dwell 或任何 zone 比较逻辑。新版本必须用同机位重录，才能确认过滤后的脚点是否自然稳定在阈值正确一侧；若仍稳定在约 0.696，则应把门槛校准留到允许修改决策逻辑的后续阶段。

### 自动验证结果

- `tsc --noEmit`：通过；
- `interactionEngine`、`bodyScaleProbe`、`poseSanityFilter`、`trackStability`：全部通过；
- Vite 客户端与 esbuild 服务端生产构建：通过；
- `InteractionStateMachine.ts`、`PerceptionHaloLayer.tsx`、`tests/interactionEngine.test.ts`：本阶段无差异。

仍待真实相机完成 `v2_static_far` 与 `v2_step_forward` 两段 30 秒录制，才能签收 stable ID、现场 FPS/inference、tensor 稳定性和最终区域结果。
