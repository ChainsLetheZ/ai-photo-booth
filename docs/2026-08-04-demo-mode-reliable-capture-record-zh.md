# Demo Mode 连续可靠拍照改造备案

日期：2026-08-04

## 用户命令

当前唯一目标是让参与者每次站上去都能拍到照片，体验流畅优先于严格判定。新增
独立 `config/demoMode.ts`；`enabled=true` 时启用展会宽松路径，`false` 时完整恢复
原逻辑和原数值，既有实现不删除。

具体要求：Demo 下移除 `allSubjectsInFrame` 门禁；倒计时开始后停止所有人员、ID、
区域和姿态验证，三秒后必定拍照；进入手势模式 12 秒仍无手势时静默自动倒计时；
增加空格键人工快门；手势指令以 `RAISE YOUR HAND` / `OR JUST WAVE` 每三秒单条
轮播；手刚抬起就给视觉反馈，不等待最终确认。

## 设计边界

- sanity filter 与 1–5 人 overflow 规则在进入倒计时前继续保留。
- 严格模式的 in-frame、ID 一致性、区域、延迟、阈值和取消逻辑全部保留。
- 自动兜底不显示错误或失败提示，只从手势引导自然进入倒计时。
- 空格键不依赖手势判定，但仍复用同一 `COUNTDOWN → CAPTURE → CREATE → RESULT`
  链路，不另写拍照流程。
- MediaPipe Gesture Recognizer 第 3 节仍不在本轮范围内。

## 验证结果

- `npm run test:rules`：通过，包含新增 Demo Mode 行为测试。
- `tsc --noEmit`：通过。
- `npm run build`：通过；仅保留既有 MediaPipe `eval` 与大 chunk 警告。
- 浏览器实测：即使当前无人体、`IN FRAME=false`，按空格仍进入三秒倒计时，倒计时期间
  `BLOCKED BY: NONE`，随后成功到达结果页。
- 连续完整链路验证：人工快门 `COUNTDOWN → CAPTURE → CREATE → RESULT` 共 5 次，成功 5 次，
  结果为 **5/5**。
- 12 秒无手势兜底已通过状态机测试和计时器接线检查；真实参与者连续站位测试仍需现场人员完成。
