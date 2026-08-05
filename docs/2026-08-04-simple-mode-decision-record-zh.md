# Simple Mode 决策与实施备案

日期：2026-08-04

## 用户命令

按照《Simple Mode 实施规格：手势降级为加速器》实施。当前唯一目标是保证参与者每次站到摄像头前都能顺畅拍到照片：手势不再作为门禁，而是加速进度；完全不做手势也会在五秒内进入倒计时；流程一旦启动只能向前，除 Escape 外不允许因人数、关键点、track ID 或检测丢失而回退。

## 采用原因与核心逻辑

MoveNet 的关键点检测和推理链路已经被数据证明工作正常，失败来自上层多道门禁互相重置。继续放宽阈值不能消除结构性回退，因此新增独立 Simple Mode，把流程改成严格单向：

`IDLE → PERCEIVING → LOCKED → COUNTDOWN → CAPTURE → RESULT → IDLE`

- 人体检测只负责从 `IDLE` 启动流程；进入 `PERCEIVING` 后不再参与放行或取消。
- 进度环基础五秒走满；抬手提高填充速度；现有挥手或举手确认后直接冲满。
- `COUNTDOWN` 开始后不进行任何人员、ID、区域或姿态验证，三秒后必定拍照。
- 空格键可从任意非拍摄终态直接进入倒计时；Escape 统一重置。
- `PoseSanityFilter`、track 稳定性、BodyScale 区域判定、原有手势和全部严格模式门禁代码保持原样，只在 Simple Mode 下不参与决策。

## 开关与恢复方式

开关位于 `config/simpleMode.ts` 的 `simpleMode.enabled`。

- `true`：启用本次单向可靠拍照流程。
- `false`：不创建 Simple Flow，完整走现有 `InteractionController` 严格流程及其原配置。

## 范围边界

- 不修改 `/wall`。
- 不删除或更改 CSV 字段。
- 不修改 MoveNet、ROI、WebGL/F16 推理路径。
- 结果页 Save / Add to wall / Retake 仍为三个独立动作。
- MediaPipe 手势未实现时跳过，现有 MoveNet 举手和挥手继续作为加速器。

## 验收数据

- `npm run test:rules`：通过；新增 `tests/simpleFlow.test.ts`，覆盖无手势五秒走满、连续
  100 帧无人体不回退、抬手加速、手势冲满、倒计时忽略人员变化、人工快门、结果冷却和
  全量重置。
- `tsc --noEmit`：通过。
- `npm run build`：通过；仅保留既有 MediaPipe `eval` 与大 chunk 警告。
- 浏览器人工快门完整链路：连续执行 10 次 `IDLE → COUNTDOWN → CAPTURE → RESULT → IDLE`，
  成功 **10/10**；每轮结果页均成功生成，Escape 均能统一重置。
- 首轮倒计时实测：大数字 `3` 正常出现，debug 为 `BLOCKED BY: NONE`，倒计时期间没有人员、
  track ID、区域或 in-frame 验证。
- 结果页保持约五秒后自动回到 `IDLE`，冷却状态生效；`IDLE` 下空格仍可作为工作人员快门。
- 无手势自动拍照和抬手即时反馈的控制逻辑已通过确定性测试；真实人体 halo 方向流动的最终
  目视验收需要现场人员在摄像头前完成。
