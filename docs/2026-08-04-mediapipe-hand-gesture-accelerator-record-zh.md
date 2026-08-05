# MediaPipe 手势加速器实施备案

日期：2026-08-04

## 用户命令

在 Simple Mode 中接入本地 `@mediapipe/tasks-vision@0.10.3` Gesture Recognizer，接受
`Thumb_Up` 与 `Victory`，作为挥手、举手之外的第三种加速手势。确认后只负责把进度环冲满，
任何识别失败、模型缺失或低置信度都不得阻塞、重置或取消拍照流程。

## 核心性能约束

- 只在 MoveNet 判断手腕高于肩时启动手部识别；手未抬起时完全不调用 recognizer。
- 只处理以手腕为中心、边长为肩宽 `1.2` 倍的方形裁剪，并缩放到 `192×192`。
- MediaPipe 使用独立 `4 Hz` 节流，不跟随 MoveNet 帧率。
- 连续三次得到同一分类且置信度不低于 `0.6` 才确认。
- 全部运行时、WASM 和模型路径固定为本地，不允许 CDN 回退。

## 降级策略

模型、WASM 或初始化不可用时，只将手部手势加速器标记为 disabled；Simple Mode 的五秒自动
推进、MoveNet 举手、MoveNet 挥手及人工快门继续工作。Debug 明确显示
`HAND MODEL NOT INSTALLED`，不向参与者显示失败提示。

## 验收数据

待实现和本机实测后补充。
