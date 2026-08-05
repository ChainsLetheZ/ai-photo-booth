# Phase 2b 区域绕过与挥手手势改造备案

日期：2026-08-03

## 用户命令

当前机位下 Z1/Z2 标定成本过高，临时启用配置化区域绕过：通过 sanity 且 track
确认、并满足最低躯干尺度的人直接作为 active participant。同时保留完整
`BodyScaleZoneDecision`、baseline、credit、探针和 CSV 数据，现场完成标定后能够
一键恢复。

新增 MoveNet 身体级挥手识别，并与现有 Raise One Arm 以 OR 关系并存。第 1、2 节
必须优先完成并跑通完整链路；MediaPipe 手指级手势识别属于第 3 节，可后续实施。

## 实施边界

- 不删除或弱化 bodyScale、sanity、track 稳定、halo、`/wall` 代码。
- `zoneBypass.enabled=true` 时，bodyScale 仍持续计算、记录和显示，只不参与 zone
  决策；`enabled=false` 完整恢复现有 bodyScale 判定。
- bypass 的唯一远端过滤条件为躯干/画面高不低于 0.10，人数上限与 overflow 规则
  保持不变。
- 状态机允许 PASSERBY 直接进入 CAPTURE_ZONE；bypass 下不显示“向前一步”提示。
- Wave 复用现有 stableTrackId 和 initiator lock，不重写 countdown 锁存或结果流程。
- Raise One Arm 保持可用；Wave 与 Raise 任一确认即可触发。
- 不修改任何既有测试文件，只新增 wave 测试并扩展测试脚本。

## 临时开关与恢复方式

- 开关位置：`config/interactionConfig.ts` 的 `zoneBypass.enabled`。
- 当前临时值：`true`。
- 现场完成机位和地面标记标定后，将其改为 `false`，即可恢复 bodyScale 的
  baseline/g/credit/Z1/Z2 决策链，无需恢复或重写其他代码。

## 实施结果

- 自动化门禁：`npm run test:rules`、`tsc --noEmit`、`npm run build` 已通过。
- 既有测试文件未修改；新增 `zoneBypass.test.ts` 与 `waveGesture.test.ts`。
- 本地 `?debug=true` 页面确认：摄像头 ready、MoveNet running、
  `MULTIPOSE_LIGHTNING`、WebGL 2/F16，以及橙色 `ZONE BYPASS: ON` 均正常。
- 真实摄像头验收尚待镜头前出现测试人员；当前画面无人物，状态保持
  `PASSERBY / CAPTURE 0/0`，因此尚未声称已跑通结果页。

## 2026-08-04 继续执行确认

用户确认第 3 节沿用旧项目的 `@mediapipe/tasks-vision@0.10.3` 与匹配的 WASM，
并要求将 `.task` 模型最终本地化到 `public/models/gesture/`。本次继续执行仍严格
限定在第 1 节与第 2 节：先完成区域绕过和 MoveNet 挥手链路，按第 5 节验收并
跑通结果页；第 3 节及其依赖、模型和推理代码本次不改。

本轮核对与实现判断：

- 复用中断前已写入工作区、但尚未提交的 Phase 2b 草稿，不覆盖此前修改。
- 远端人物过滤使用肩中点到髋中点的二维欧氏距离/画面高，避免身体倾斜时只取
  垂直差造成误判。
- Wave 仍按 stable track 分别维护窗口；首次 crossing 锁 initiator，确认后复用
  现有 `POSE_READY → COUNTDOWN → CAPTURE → CREATE → RESULT` 状态链。
- Debug 和 CSV 只新增 Wave 字段，不删除既有采集字段。
