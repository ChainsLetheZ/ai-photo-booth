# AI Photo Booth：V1 逐步实施路线

**更新时间：** 2026-07-31  
**目标：** 从当前 MediaPipe 网页原型，逐步得到一个可运行的纯浏览器 V1。  
**产品决策来源：** [`design-progress-zh.md`](design-progress-zh.md)

这份文件回答的是“怎么一步一步做到”，不是另一份体验概念说明。每个阶段都应保持项目可以启动、可以调试，并在达到完成标准后再进入下一阶段。

## 1. V1 完成后的样子

用户面对一个全屏实时镜像：

```text
路过
  → 镜像和环境反馈让用户发现装置
停留
  → AI perception halo 跟随人物
向前一步
  → 进入拍摄区，建立 1–5 人 active group
站位稳定
  → 显示当前唯一指令
任意一人举起一只手
  → halo 响应，手臂关键点出现
保持约 800 ms
  → 动作确认
3–2–1
  → 持续验证人数、身份和站位
拍摄
  → 显示结果
用户选择
  → 保存、重拍或主动上墙
```

V1 必须满足：

- 摄像头和视觉模型均在浏览器本地运行；
- 连续视频不上传；
- 支持 1–5 名 active participants；
- 第 6 人进入拍摄区时不会开始倒计时；
- 拍摄前不需要点击 Begin；
- 退出拍摄区可以取消；
- 多人不需要同时做相同动作；
- 默认动作是任意一人举起一只手；
- 画面是 Full-screen AI Mirror，不是传统网页控制面板；
- AI 反馈展示“系统理解了什么”，而不是展示模型术语；
- 拍照不会自动等于保存、分享或上墙。

## 2. 当前代码与目标之间的差距

| 层级 | 当前代码 | V1 目标 |
|---|---|---|
| 姿势模型 | MediaPipe Pose Lite + Hand | MoveNet MultiPose Lightning |
| 人体点位 | MediaPipe 33 点数组 | MoveNet 17 点，通过语义化关节名称访问 |
| 人物身份 | 自定义中心点最近邻 ID | 优先使用 MoveNet tracking ID，并做短暂丢失保护 |
| 人数 | 整个画面中的人数 | visible / engaged / active 三种人数 |
| 距离状态 | 未建立三区 | PASSERBY / ENGAGED / CAPTURE_ZONE |
| 开始方式 | 点击 Begin | 进入拍摄区并稳定停留 |
| 默认动作 | 单人张开手臂，多人聚手 | 任意一人举起一只手 |
| 多人动作 | 依赖群体手部关系 | 锁定一名 initiator，其他人保持在框 |
| 倒计时 | 页面定时器自动推进 | 控制器持续验证，失效即取消 |
| 主界面 | 卡片、面板和按钮 | Full-screen AI Mirror + 单一指令 |
| 感知视觉 | SignalField / 调试骨架 | 每人独立 halo + 关键动作局部关节点 |
| 上墙 | 结果生成后自动发布 | 用户在结果页主动决定 |

### 一个不能跳过的迁移风险

MediaPipe 和 MoveNet 的关键点编号不同。例如，MediaPipe 的肩、肘、腕使用
`11–16`，而 MoveNet 的肩、肘、腕使用 `5–10`。如果只替换模型并继续读取原数组下标，
程序可能正常运行却把髋、膝、踝当成手臂。

因此第一步不是删除 MediaPipe，而是先建立模型无关、使用关节名称的数据契约。

## 3. 实施总览

| 阶段 | 结果 | 状态 |
|---|---|---|
| M0 | 固定当前基线与文档入口 | 文档已完成，代码基线待确认 |
| M1 | 建立模型无关的人体数据层 | 待实现 |
| M2 | 接入 MoveNet 并替换 MediaPipe 主路径 | 待实现 |
| M3 | 实现稳定人物轨迹与三段区域 | 待实现 |
| M4 | 建立 1–5 人 active group | 待实现 |
| M5 | 改造无点击状态机 | 待实现 |
| M6 | 实现 Raise One Arm 与 initiator lock | 待实现 |
| M7 | 改造成 Full-screen AI Mirror | 待实现 |
| M8 | 实现 halo 和局部关键点反馈 | 待实现 |
| M9 | 加固倒计时、取消和恢复 | 待实现 |
| M10 | 完成结果选择、AI attribution 和 V1 收口 | 待实现 |

## 4. M0：固定基线

### 要做什么

1. 运行当前规则测试和生产构建；
2. 用 `/booth?debug=true` 记录当前摄像头权限、FPS、推理时间和已知错误；
3. 保存一个 1 人和一个 2 人的短基准场景；
4. 确认所有阈值仍集中在 `config/interactionConfig.ts`；
5. 后续每个 milestone 完成后重复规则测试和构建。

### 为什么先做

模型、状态机和界面会连续变化。没有基线时，很难判断问题来自 MoveNet、区域判断还是视觉渲染。

### 完成标准

- 当前版本可以启动；
- `npm run test:rules` 通过；
- `npm run build` 通过；
- debug 页面能够显示当前 perception frame；
- 已记录迁移前的 FPS 和 inference time。

## 5. M1：建立模型无关的人体数据层

### 主要改动

在 `perception/` 中建立统一接口，例如：

```text
PoseEstimator
  initialize()
  estimate(video, timestamp)
  close()
```

将 `PersonObservation` 从依赖数组编号，升级为至少包含：

```text
id
keypoints by semantic joint name
bounds
center
footPoint
confidence
source
```

关节名称使用：

```text
nose
leftShoulder / rightShoulder
leftElbow / rightElbow
leftWrist / rightWrist
leftHip / rightHip
leftKnee / rightKnee
leftAnkle / rightAnkle
```

### 涉及模块

- `perception/types.ts`
- 新增 `perception/PoseEstimator.ts`
- `perception/MediaPipePoseService.ts`
- `perception/PerceptionManager.ts`
- `behavior/BehaviorFeatureExtractor.ts`
- `debug/PerceptionDebugOverlay.tsx`

### 实施方式

- 先给现有 MediaPipe 输出加 adapter；
- 业务逻辑只读取关节名称，不再读取裸数组下标；
- 保持当前 MediaPipe 路径仍然能运行；
- 为 17 点和 33 点输入分别写映射测试。

### 完成标准

- 现有体验行为没有改变；
- 行为层不再出现 `poseLandmarks[11]` 这类模型相关读取；
- MediaPipe adapter 测试通过；
- debug overlay 仍能正确绘制肩、肘和腕。

## 6. M2：接入 MoveNet MultiPose

### 主要改动

引入浏览器端 MoveNet 依赖和 `MoveNetPoseService`：

```text
@tensorflow-models/pose-detection
TensorFlow.js WebGL backend
MoveNet MultiPose Lightning
tracking enabled
```

在配置中增加 perception engine 选择：

```text
engine: movenet | mediapipe
maxDetectedPoses: 6
maxActiveParticipants: 5
targetFps
scoreThreshold
```

### 实施顺序

1. MoveNet 在独立 debug 路径输出统一 `PersonObservation`；
2. 验证左右镜像和关键点映射；
3. 验证 1–5 人时 ID、边界框和置信度；
4. 将 MoveNet 设为默认；
5. 暂时保留 MediaPipe adapter 作为开发回退；
6. 移除多人主流程对 MediaPipe Hand 的依赖。

### 完成标准

- 默认启动 MoveNet MultiPose；
- 1–5 人都能输出独立人物；
- 同一个人小范围移动时 ID 不持续跳变；
- 连续视频没有被发送到服务器；
- 模型失败时进入可恢复错误状态，不会误拍；
- debug overlay 显示实际 engine、FPS、inference time 和 track ID。

## 7. M3：实现稳定轨迹与三段区域

### 新增概念

每条人物轨迹需要包含：

```text
trackId
currentZone
stableZone
zoneEnteredAt
lastSeenAt
missingDuration
```

新增区域分类器，输出：

- `PASSERBY`
- `ENGAGED`
- `CAPTURE_ZONE`

### 区域判断

- 主要使用脚点、人体框底边以及摄像机画面中的校准边界；
- 只有脚点不可用时，才使用髋部和人体框估算；
- 不把 MoveNet 的 2D 关键点解释成真实公制深度；
- Z1→Z2 和 Z2→Z1 使用不同边界，形成迟滞；
- 人必须在新区停留一段可配置时间后，`stableZone` 才改变。

### 涉及模块

- 新增 `interaction/ZoneClassifier.ts`
- 新增 `interaction/PersonTrackStore.ts`
- `config/interactionConfig.ts`
- `perception/types.ts`
- `debug/PerceptionDebugOverlay.tsx`

### 完成标准

- 在 debug 画面中能看到三段边界和每个人的 stable zone；
- 在边界附近晃动不会导致状态每帧跳变；
- 从 Z2 后退到 Z1 能稳定识别；
- 路过区人物不会被当成 active participant。

## 8. M4：建立 1–5 人 active group

### 规则

- 只有 `stableZone === CAPTURE_ZONE` 的人可以加入 active group；
- active group 使用 tracking ID，不使用数组顺序；
- 人数有效范围为 1–5；
- 进入第 6 人后设置 `overflow = true`；
- overflow 时不进入动作引导或倒计时；
- 回到 1–5 人并稳定后可以继续；
- 倒计时开始后，active group 成员发生变化即取消。

引擎 snapshot 应分别暴露：

```text
visiblePeople
engagedPeople
activePeople
activePersonIds
overflow
```

### 涉及模块

- 新增 `interaction/ActiveGroupManager.ts`
- `interaction/InteractionController.ts`
- `behavior/types.ts`
- `debug/PerceptionDebugOverlay.tsx`

### 完成标准

- Z0/Z1 的路人不会改变 active count；
- 1–5 人能够建立 active group；
- 第 6 人进入时显示分组提示且绝不拍照；
- 人数恢复后不需要重新点击任何按钮；
- 任何被拍摄的人都可以在 active IDs 中找到。

## 9. M5：改造无点击状态机

### 目标状态

```text
PASSERBY
ENGAGED
CAPTURE_ZONE
DIRECT
POSE_READY
COUNTDOWN
CAPTURE
CREATE
RESULT
RESET
ERROR
```

`PRIMARY_SELECTION`、`AWAITING_START` 和必须点击 `START` 的公共流程不再作为 V1 用户路径。

旧的 behavior reading、Primary/Secondary 计算如果仍为成片所需，可以在后台进行，但不能阻挡
“向前一步 → 动作 → 倒计时”的主路径。V1 开发过程中可以使用确定性默认值跑通成片；
最终如何选择 Primary Energy 需要另行确认，不能悄悄重新加入一组选择卡片。

### 状态转换重点

- 没有人：`PASSERBY`；
- 有人在 Z1 稳定停留：`ENGAGED`；
- 1–5 人进入 Z2 并稳定：`CAPTURE_ZONE`；
- 站位有效：`DIRECT`；
- 动作保持成功：`POSE_READY`；
- readiness 短反馈后：`COUNTDOWN`；
- 后退、超员、人物改变或 tracking loss：退回对应安全状态；
- 所有转换由 controller 驱动，React 页面只渲染状态。

### 完成标准

- 没有 Begin 按钮也能完成一次拍摄；
- 单纯路过不会进入倒计时；
- 状态机测试覆盖正常路径和所有取消路径；
- 页面定时器不能绕过 controller 强行进入下一状态；
- 单帧检测永远不能直接触发拍照。

## 10. M6：实现 Raise One Arm

### 检测逻辑

动作检测按人物分别计算：

```text
left arm score
right arm score
best candidate person
initiatorId
hold progress
confirmed
```

第一版至少检查：

- 肩、肘、腕关键点可信；
- 腕相对肩明显抬高；
- 动作幅度按肩宽或躯干长度归一化；
- 人物仍属于 active group；
- 动作连续保持约 800 ms，具体值来自配置。

### Initiator lock

- active group 中任何人都可以开始动作；
- 某人的动作分数越过进入阈值后，临时锁定其 tracking ID；
- 锁定期间不因另一个人瞬间得分更高而切换反馈；
- initiator 消失、离开 Z2 或持续低于释放阈值时才解除；
- 其他成员只需仍在框、仍有效并处于 Z2。

### 涉及模块

- 重写 `gestures/GestureRules.ts`
- 扩展 `gestures/GestureStabilityTracker.ts`
- `interaction/InteractionController.ts`
- `config/interactionConfig.ts`
- 更新 `tests/interactionEngine.test.ts`

### 完成标准

- 1–5 人时任意一人可以触发；
- 不要求五个人同步；
- 动作发起后反馈不在人之间跳动；
- 举手不足时平滑回退，不显示错误态；
- 保持完成后只进入一次 `POSE_READY`。

## 11. M7：改造成 Full-screen AI Mirror

### 页面分层

将 `BoothPage` 拆为：

```text
MirrorViewport
  ├─ CameraLayer
  ├─ PerceptionHaloLayer
  ├─ ActionKeypointLayer
  ├─ InstructionOverlay
  ├─ StatusOverlay
  ├─ CountdownOverlay
  └─ DebugOverlay
```

### 关键要求

- 视频占据完整体验区域；
- 主流程不显示网页卡片、侧栏和能量选择网格；
- 任何时刻只有一个主要 instruction；
- 人数等辅助状态弱化显示；
- 摄像头镜像、`object-fit: cover` 裁切与 overlay 必须共用同一坐标变换；
- 正式效果与 debug overlay 分开。

### 完成标准

- 用户首先看到自己；
- 从 Z0 到拍摄，页面不出现需要操作的控制面板；
- 在不同屏幕比例下，关键点仍与人物身体对齐；
- instruction 不会同时出现两个互相竞争的动作要求；
- 摄像头权限或模型失败时，有清晰但不破坏 kiosk 感的恢复界面。

## 12. M8：实现 perception halo 与局部关键点

### 推荐实施顺序

1. 先画每个人的稳定边界轮廓；
2. 沿轮廓外围生成少量点；
3. 对 tracking 位置做时间平滑；
4. 加入 recognition pulse；
5. 加入举手方向的 directional flow；
6. 最后加入动作确认的 `lock → glow → sweep`。

第一版优先使用一个全屏 Canvas 渲染层，避免为每个粒子创建 DOM 元素。

### 状态到视觉的映射

| 状态 | Halo | Keypoints |
|---|---|---|
| 无人 | 极弱环境效果 | 不显示 |
| ENGAGED | 每人独立、平滑跟随 | 首次识别时短暂出现 |
| CAPTURE_ZONE | 稍稳定、提示已加入 | 不持续显示完整骨架 |
| DIRECT | 正常 halo | 发起动作的一侧出现 shoulder–elbow–wrist |
| POSE_READY | 收紧或 pulse | 手臂 sweep |
| COUNTDOWN | 变轻，避免干扰表情 | 淡出 |

### 完成标准

- 1–5 人各自拥有可辨识 halo；
- halo 不跨人物错误合并；
- 正常状态不显示调试骨架；
- 反馈与真实 tracking/gesture state 对应；
- 渲染不会让姿势推理明显掉帧；
- `prefers-reduced-motion` 下提供减弱动画模式。

## 13. M9：加固倒计时、取消和恢复

当前代码只在 `ACTION_TRACKING` 评估动作，进入 `POSE_READY` 后会自动启动页面倒计时。
V1 必须在 controller 中持续验证。

### COUNTDOWN 每帧验证

- active count 仍为 1–5；
- active IDs 与进入倒计时时一致；
- 没有人退出 Z2；
- 所有人仍满足最低可见条件；
- 没有 overflow；
- tracking loss 未超过 grace period。

动作是否必须保持到快门前，由配置控制；第一版可以在动作确认后允许自然放下手，但不能允许人物离场。

### 取消路径

- 任意参与者后退：取消；
- 第 6 人进入：取消并提示分组；
- 人物替换或身份不确定：取消；
- 长时间 tracking loss：取消；
- 摄像头或模型错误：进入恢复状态；
- 最后短暂快门锁定窗口只用于避免临界帧抖动，不能掩盖明显离场。

### 完成标准

- 空镜头不会被拍摄；
- 人数变化不会继续倒计时；
- 后退能在界面上得到立即、非错误式反馈；
- 重复取消和重新进入不会留下旧 initiator、旧 timers 或旧 active IDs；
- 工作人员始终有隐藏或受控的 reset 路径。

## 14. M10：结果、AI attribution 与 V1 收口

### 结果行为

- 拍摄完成后显示结果；
- `Save portrait` 只负责保存；
- `Add to wall` 必须是单独主动操作；
- `Retake` 回到安全的拍摄准备状态；
- 禁止在结果生成后自动调用 `publishPortrait`；
- 超时后清理上一组的影像和状态。

### AI attribution

正式界面表达：

```text
AI sees
  → AI understands the raised arm
  → AI responds
  → portrait is created
```

- 不把模型名作为主要用户文案；
- 程序化合成使用 `AI-assisted`；
- 只有真实生成式图像处理才使用 `AI-generated`；
- 当前没有接生成式图像模型时，不制作虚假的生成进度。

### 语音

- 语音与 single instruction 使用同一份状态映射；
- 状态未改变时不重复播报；
- 多条语音不能重叠；
- 第一版只需要关键提示：向前一步、举手、保持、倒计时取消。

### 完成标准

- 完整主路径可以连续运行多轮；
- 上一组数据不会出现在下一组；
- 未主动选择时不会上墙；
- AI 文案与实际实现一致；
- 规则测试和 production build 通过；
- debug mode 可以解释一次失败发生在哪一层。

## 15. 建议的提交顺序

为了让每一步容易检查和回退，建议按以下边界提交：

1. `refactor(perception): add semantic pose contract`
2. `feat(perception): add MoveNet multipose adapter`
3. `feat(interaction): add tracked zones`
4. `feat(interaction): add active group capacity`
5. `refactor(flow): remove mandatory start interaction`
6. `feat(gesture): add raise-arm initiator flow`
7. `feat(ui): add full-screen AI mirror`
8. `feat(ui): add tracked perception halo`
9. `fix(flow): continuously validate countdown`
10. `fix(result): make collective wall opt-in`
11. `docs(copy): align AI attribution`

每个提交都应同时包含相关测试，避免最后才补一整套无法定位失败原因的测试。

## 16. 开始实现前只需要再确认的产品点

以下决定不会阻止 M0–M4，但会影响后面的公开体验：

1. 没有能量选择卡片后，Primary Energy 如何产生；
2. 动作确认后，用户是否必须持续举手到快门，还是可以自然放下；
3. 五人中其他四人的最低 ready 条件；
4. 结果页是否默认只显示 Save 和 Retake，再单独显示 Add to wall；
5. 摄像机预计分辨率、屏幕比例和最低硬件。

其余未定的物理距离和阈值都应保持配置化，通过原型标定，而不是在设计文档中假装已经确定。
