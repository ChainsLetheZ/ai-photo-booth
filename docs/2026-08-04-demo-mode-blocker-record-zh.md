# Demo Mode 与拍照阻塞诊断改造备案

日期：2026-08-04

## 用户命令

当前最高优先级是尽快拍出第一张照片。先在 debug overlay 顶部增加红色
`BLOCKED BY:`，按拍照门禁顺序实时显示第一个不满足的条件和具体原因，避免静默
卡住。随后新增可整体关闭的 `demoMode`，展会标定前使用宽松参数；关闭时恢复所有
原始数值和行为。

Demo Mode 要求：track 确认从 5 帧降到 2 帧、最低人物尺度从 0.10 降到 0.06、
active group 与手势前后纯延迟归零、in-frame 只要求鼻和双肩、举手阈值降到
0.55 并保持 500ms、挥手幅度降到 0.22。倒计时期间允许 tracking ID 变化，人数
不变即可继续；短暂丢失容忍 800ms。

## 不可放松项

- sanity filter 原样保留。
- 1–5 人有效、6 人 overflow 的规则原样保留。
- 原始逻辑和原始数值不删除；`demoMode.enabled=false` 时完整恢复。
- Phase 2b 的 Raise Arm 与 Wave 均继续有效。
- MediaPipe Gesture Recognizer（第 3 节）本次不实施。

## 实施判断

- `BLOCKED BY` 由控制器生成结构化的首个失败门禁，不从 UI 文案反推状态。
- in-frame 判定与阻塞原因共用同一组有效关键点配置，避免显示与决策不一致。
- countdown 的 ID 容错只放松身份一致性，不放松人数、overflow、sanity 或人物存在。
- 自动化验证和真实页面读数完成后，在本文补充最终结果。

## 验证结果

- `npm run test:rules`：通过，包含全部既有规则测试及新增 Demo Mode 测试。
- `tsc --noEmit`：通过。
- `npm run build`：通过。
- 真实 `?debug=true` 页面：`DEMO MODE: ON`、`minScale=0.06`、MoveNet running、
  摄像头 ready。
- 当前镜头画面没有人物，因此第一道实时阻塞为：
  `BLOCKED BY: personDetection (no pose detected in the current frame)`。
- 下一步需要测试人员站进画面；系统会在同一位置自动切换并显示下一道实际失败
  门禁，或在所有门通过后显示 `BLOCKED BY: NONE` 并进入倒计时。
