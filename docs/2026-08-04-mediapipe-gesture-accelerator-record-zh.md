# MediaPipe 手势加速器接入备案

日期：2026-08-04

## 用户命令

在 Simple Mode 中接入 MediaPipe Gesture Recognizer，作为挥手与举手之外的第三种加速手势。
只识别 `Thumb_Up` 和 `Victory`；识别成功将进度环直接冲满，识别失败、模型缺失或未抬手均不得
阻塞、取消或重置拍照流程。

## 本地资源核验

- 运行库：`@mediapipe/tasks-vision@0.10.3`
- WASM：`public/mediapipe/wasm/`，SIMD 与 no-SIMD 的四个文件均已存在
- 模型实际路径：`public/mediapipe/models/gesture_recognizer.task`

模型并不位于最初规格举例的 `public/models/gesture/`。本次以仓库中的实际本地文件为准，初始化
路径固定为 `/mediapipe/models/gesture_recognizer.task`；禁止 CDN 或网络回退。

## 实施逻辑

- 只有 MoveNet 检测到 `wrist.y < shoulder.y` 时才允许调用 MediaPipe；未抬手时推理次数保持不变。
- 以抬起的腕点为中心，使用 `shoulderWidth × 1.2` 的正方形原图裁剪，缩放为 `192×192` 输入。
- MediaPipe 独立限制为 4Hz，不跟随 MoveNet 帧率；同一时刻只处理一个候选腕点，降低峰值开销。
- `Thumb_Up` / `Victory` 置信度至少 0.6，连续三次同分类才确认。
- 确认只作为 Simple Mode 进度环的加速信号；基础五秒自动进度始终继续，失败无负面反馈。
- 模型缺失或初始化失败时运行时自动禁用，debug 显示 `HAND MODEL NOT INSTALLED`，MoveNet 举手与挥手保持可用。
- debug 显示分类、置信度、稳定次数、裁剪坐标、输入大小和独立推理耗时，并在画面 overlay 绘制裁剪框。

## 验收数据

- `npm ls @mediapipe/tasks-vision --depth=0`：确认版本为 `0.10.3`。
- `npm run test:rules`：通过；新增门控、裁剪、4Hz 节流、本地路径、0.6 阈值和连续三次确认测试。
- `tsc --noEmit`：通过。
- `npm run build`：通过；仅保留既有 MediaPipe `eval` 与大 chunk 警告。
- 浏览器初始化：本地 Gesture Recognizer 成功进入 ready，没有访问 CDN 或远程模型。
- 未抬手门控：模型 ready 后连续观察 10 秒，debug 始终显示
  `gated off · INF — · runs 0/4Hz`，MediaPipe 推理次数保持 0。
- 回归拍照：手模型加载后，人工快门仍正常完成倒计时、拍照、生成并进入结果页。
- `Thumb_Up` / `Victory` 实际分类、裁剪框目视效果及抬手后的增量耗时，需要现场人员在镜头前完成；
  验收目标仍为连续三次确认且独立手势推理增量低于 30ms。
