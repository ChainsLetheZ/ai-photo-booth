# 实时预览、抓帧与结果预览坐标统一备案

日期：2026-08-04

## 用户命令

修复实时预览、刚拍结果预览与最终成片范围不一致的问题。禁止分别微调三处裁剪，必须建立唯一的
`utils/viewportTransform.ts`，统一 `object-fit: cover` 的源视频可见区域、视频与屏幕坐标互转、
镜像和 devicePixelRatio 规则。

## 设计原则

- 实时预览、halo、关键点 overlay、拍照抓帧和结果页均调用同一个坐标变换模块。
- `displayW/displayH` 一律来自视频元素的 `getBoundingClientRect()` 实际渲染尺寸。
- 实时预览镜像；抓取的成片和结果页不镜像。
- Canvas 缓冲区可按 DPR 放大，但所有绘制坐标保持 CSS 像素，统一通过 `setTransform(dpr, …)` 处理。
- `?debug=true` 时在实时画面显示红色成片边界框，作为现场机位与裁剪的直接校验工具。
- 保存链接继续直接使用结果页当前展示的同一张成片数据，不另做第二次裁剪。

## 全局审计与改动文件

- `utils/viewportTransform.ts`：新增唯一的 cover source rect 与视频/屏幕坐标互转实现。
- `camera/CameraService.ts`：抓帧改为使用实际视频元素尺寸和统一 source rect；成片不镜像。
- `components/PerceptionHaloLayer.tsx`：halo、关键点和手部裁剪框统一走坐标模块；debug 下绘制红色 `CAPTURE BOUNDARY`。
- `debug/PerceptionDebugOverlay.tsx`：骨架 overlay 删除独立镜像/缩放公式，改用统一变换。
- `pages/BoothPage.tsx`：向 debug overlay 传入同一个 `videoRef`。
- `services/portraitRenderer.ts`：删除最终成片镜像；照片区域沿用抓帧宽高比，不再二次裁剪。
- `index.css`：实时视频保留 CSS 镜像；删除 landmark canvas 的第二次镜像；结果主图完整 `contain` 展示且不强制 3:2。
- `tests/viewportTransform.test.ts`：覆盖横屏、竖屏、镜像/非镜像往返和可见边界映射。
- `package.json`：将新测试加入 `test:rules`。

全局搜索同时审计了 MoveNet、MediaPipe Pose 与 MediaPipe Gesture 的 `drawImage`。这些位置只负责模型输入 ROI，
不是实时预览/成片/结果页取景，因此保留其独立推理裁剪，不纳入 viewport 变换。

## 验收数据

- `tsc --noEmit`：通过。
- `npm run test:rules`：通过，含新增 viewport transform 测试；没有修改原有测试断言。
- `npm run build`：通过。
- 浏览器 `?debug=true`：红色 `CAPTURE BOUNDARY` 可见，并与视频实际渲染边界一致。
- 空格快门：可完成 3-2-1、抓帧并进入结果页。
- 结果主图 `src` 与 `SAVE PORTRAIT` 的 `href`：完全相同（同一份 data URL，测试样本长度 240343）。
- 多尺寸数学验收：16:9、4:3 与竖屏组合均由单元测试覆盖。
- 需要真人现场完成：左右半身边缘、头顶间距、举右手镜像方向，以及手动拖动真实浏览器窗口后的视觉复核。
