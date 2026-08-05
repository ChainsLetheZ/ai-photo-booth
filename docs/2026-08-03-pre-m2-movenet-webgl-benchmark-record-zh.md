# 更换 M2 前的 MoveNet / WebGL / 纯推理检查备案

日期：2026-08-03

## 用户命令

在更换 M2 机器前完成三个约 15 分钟的检查，排除会随代码迁移的性能 bug：

1. 确认实际模型是 `MULTIPOSE_LIGHTNING`，不是 Thunder；
2. 确认 `WEBGL_PACK`、`WEBGL_FORCE_F16_TEXTURES`、`WEBGL_VERSION` 和 backend；
3. 不接摄像头，对固定 256×256 空白输入连续运行 100 次纯 `estimatePoses()`，取中位数。

## 范围约束

- 只做性能诊断和基准；
- 不接入 bodyScale 区域决策；
- 不修改 zone、baseline、dwell、状态机、halo 视觉或 instruction；
- 当前机器已经运行过模型，因此本轮自动测量必须标记为“热机”；真正冷机值需要重启后首先打开基准页取得，不能把热机结果冒充冷机结果。

## 执行思路

- 复用与 Booth 相同的本地 TF.js、pose-detection 和 MoveNet model 文件；
- 在 debug 中补齐实际 `WEBGL_VERSION`；
- 新增完全独立的 benchmark 页面，不初始化 CameraService，也不启动 InteractionController；
- detector 创建后使用同一个 256×256 空白 tensor，调用 `estimatePoses()` 100 次；
- 报告 median、P95、min、max、backend、model type、WebGL flags 和 tensor 起止数；
- 输入 tensor 与 detector 在结束时显式 dispose，验证 benchmark 自身不制造泄漏。

## 实施后记录

- 实际模型：`MULTIPOSE_LIGHTNING`。
- backend：`webgl`；`WEBGL_PACK=true`；`WEBGL_VERSION=2`。
- 热机纯推理 100 次，F16 关闭：median 42.5 ms，P95 50.1 ms。
- 热机纯推理 100 次，F16 开启：median 35.9 ms，P95 56.8 ms，中位数改善约
  15.5%。两次测试 100 次后 tensor 数均保持稳定，dispose 后回落。
- 用户确认按 Intel Iris Xe 低压集显热降频的硬件限制豁免性能门禁，不再继续优化
  推理；生产路径保留 `WEBGL_FORCE_F16_TEXTURES=true`。
- 这两组是热机数据，不冒充重启后的冷机数据。
