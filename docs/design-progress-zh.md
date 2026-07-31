# AI Photo Booth：设计决策与进度

**更新时间：** 2026-07-31  
**当前阶段：** 先完成交互与感知架构设计，测试方案暂缓执行。  
**第一版目标：** 纯浏览器、本地视觉识别、支持 1–5 名有效参与者。

这是一份持续更新的项目决策记录。长篇研究和证据来源见
[`research/exhibition-photo-interaction-research-zh.md`](research/exhibition-photo-interaction-research-zh.md)；
当两份文档发生冲突时，以本文件中标为“已决定”的内容为准。

从当前代码逐步实现第一版的顺序、模块和完成标准见
[`v1-implementation-roadmap-zh.md`](v1-implementation-roadmap-zh.md)。

## 1. 当前进度

| 主题 | 状态 | 当前结论 |
|---|---|---|
| 交互空间 | 已决定 | 使用三段空间：路过区、发现与参与区、拍摄区 |
| 开始方式 | 已决定 | 不设置必须点击的 Begin/Consent；通过向前进入拍摄区表达拍摄意图 |
| 取消方式 | 已决定 | 倒计时结束前退回发现与参与区，即取消本次拍摄 |
| 有效参与人数 | 已决定 | 每次拍摄支持 1–5 人 |
| 超员处理 | 已决定 | 拍摄区超过 5 人时不开始倒计时，并提示分组；不得随机忽略某个人 |
| 运行架构 | 已决定 | 第一版保持纯浏览器运行，连续视频不上传 |
| 姿势模型方向 | Demo 已接入 | MoveNet MultiPose Lightning 模型、本地 runtime 和 tracking 已接入；模型缺失时仍会明确使用 MediaPipe fallback |
| 空间距离预设 | Demo 已实现 | 屏幕提示从 Z1 向前约 0.5 米跨入 Z2；这是待现场标定的交互预设，不声称摄像头正在做真实米制测距 |
| Experience Surface | Demo 已实现 | 使用 Full-screen AI Mirror；实时摄像头画面即主要交互界面，不采用传统网页式卡片和控制面板 |
| AI Presence | Demo 已实现 | 使用 Ambient AI Host；默认以贴近人体外围的点状 perception halo 表达 AI 感知，关键时刻再强化关键点和动作反馈 |
| AI attribution | 已决定 | 必须让用户准确知道 AI 用在了哪里 |
| Experience value | 暂缓 | 不作为当前设计阶段的硬指标，待体验成形后再决定测量方法 |
| 生成式图像 AI | 待决定 | 不阻塞当前交互设计；实际使用什么就如实标注什么 |
| 用户测试 | 暂缓 | 先完成设计和浏览器原型，再确定测试变量和阈值 |

## 2. 三段空间模型

### Z0：路过区

- 人在通道中经过，不被加入拍摄 session。
- 屏幕可以做低风险的环境响应，例如光场、粒子或轮廓感应。
- 不显示“已选择你”，不进入姿势教学，不启动倒计时。
- 该区的目标是让人发现装置会响应，而不是判断拍摄意图。

### Z1：发现与参与区

- 合并原方案中的“发现区”和“参与区”，避免状态过细。
- 用户停下、面向屏幕或开始模仿后，系统显示即时身体反馈和站位提示。
- 系统可以说明：“向前一步进入拍摄区。”
- 在该区内不会拍照；用户可以自由观察、尝试和离开。

### Z2：拍摄区

- 使用清晰的地面标记和屏幕取景框表示边界。
- 用户主动向前进入该区，并稳定停留后，系统把他加入本轮 active group。
- 进入该区不是法律意义上的通用 consent；它是本产品用于判断 capture intent 的交互信号。
- 屏幕必须在倒计时前明确说明即将拍照，并始终允许用户后退取消。
- 具体米数不硬编码。区域边界按照镜头、安装高度和现场空间校准。

推荐状态流：

```text
PASSERBY
  └─ 环境响应，不锁定人物
ENGAGED
  └─ 发现 + 参与；即时反馈并提示“向前一步”
CAPTURE_ZONE
  └─ 进入拍摄区并稳定停留；建立 1–5 人 active group
DIRECT
  └─ 显示一个容易模仿的身体动作
POSE_READY
  └─ 动作连续稳定达到阈值
COUNTDOWN
  └─ 3–2–1；继续检查人数、站位和在场状态；后退即可取消
CAPTURE
  └─ 快门反馈
CREATE
  └─ 给出真实、可理解的处理进度
RESULT
  └─ 查看结果、重拍，以及单独决定是否保存或上墙
RESET
  └─ 离场或超时后自动复位
```

## 3. 人数规则

必须区分：

- **Camera-visible people：** 摄像头画面中出现的人，可能包括路人；
- **Engaged people：** 位于发现与参与区、正在关注装置的人；
- **Active group：** 已进入拍摄区、本轮会被拍摄的人。

产品人数上限只作用于 active group。

- 有效范围：1–5 人。
- 第 6 人进入拍摄区后，状态保持在 `CAPTURE_ZONE`，不进入姿势确认或倒计时。
- 提示应直接说明：“本轮最多支持 5 人，请分成两组。”
- 人数重新稳定为 1–5 后，流程自动继续。
- 路过区和发现与参与区的人不应让当前拍摄人数跳变。
- 倒计时期间 active group 的人数或身份发生变化时，应取消并回到站位确认。

五人上限不是说模型只能看见五个人，而是为构图、遮挡、反馈可读性和触发可靠性预留余量。

## 4. 纯浏览器模型决定

### 目标模型

第一版采用 **MoveNet MultiPose Lightning**：

- 浏览器内运行；
- 最多输出 6 个姿势，产品主动限制为 5 名参与者；
- 输出 17 个身体关键点，足够判断头、肩、肘、腕、髋、膝和踝等大动作；
- 使用其多人 tracking ID，减少人物顺序交换；
- 不依赖网络完成实时识别。

产品上限设为 5，可以给模型留出一个检测余量，但不能假设第六个结果永远属于路人。因此实现时还需要：

- 将模型输入或候选筛选聚焦到互动空间，而不是把整个展会通道都当作拍摄区；
- 根据人物脚点、人体框底边或髋部位置判断所在区域；
- 先按区域筛选，再建立 active group；
- 不用模型的近似深度值直接代表真实米数。

### 当前实现与迁移状态

当前代码默认使用：

```text
central interaction ROI
  → MoveNet MultiPose Lightning
  → stable person tracks
  → zone classification
  → active group selection (1–5)
  → body gesture rules
  → deterministic state machine
```

模型或 MoveNet runtime 不可用时，开发环境明确回退为：

```text
central interaction ROI
  → MediaPipe Pose fallback
  → the same normalized tracks, zones and interaction rules
```

两种路径的连续视频都留在浏览器内。当前电脑已完成 MoveNet 运行 smoke check；正式 1–5 人性能基线仍需在目标展会硬件和真实站位上完成。

### 手势范围

- 多人主触发使用身体和手臂的大动作，不依赖手指形状。
- 不要求五个人的手同时被精确识别，也不要求所有人同时完成完全一致的手势。
- 建议由 active group 中任意一名明确发起者完成触发动作；其他人只需保持在框、面向镜头并处于 ready 状态。
- 如果以后必须使用精细手势，应只对一名发起者运行手部识别，不能把五人手部识别作为拍摄前提。

## 5. 无点击触发的安全规则

取消 Begin 按钮不等于“检测到人就拍”。

一次有效触发至少需要：

1. 用户从 Z1 主动跨入 Z2；
2. 人物在 Z2 内稳定停留，而不是瞬间经过；
3. 屏幕明确提示系统已经进入拍摄流程；
4. 人数稳定在 1–5；
5. 指定身体动作达到阈值并保持；
6. 进入可见的 3–2–1 倒计时；
7. 倒计时期间持续验证人物仍在场；
8. 任意参与者明显后退离开 Z2 时取消拍摄。

停留时间、姿势保持时间和区域迟滞暂不写死，等原型和现场标定后确定。状态机必须支持不同阈值配置。

拍照前不设置强制点击，但以下信息不能省略：

- Z2 地面或屏幕上清楚写明“进入此区域将开始拍照”；
- 倒计时必须清晰可见；
- 退出拍摄区可以取消；
- 保存、分享或上墙属于拍照之后的另一个决定，不自动等同于进入拍摄区。

## 6. Experience Surface & AI Presence

### Full-screen AI Mirror

第一版不采用传统网页式界面，而采用 **Full-screen AI Mirror**。

- 实时摄像头画面本身就是主要交互界面；
- 用户站到装置前时，首先看到自己，而不是网页标题、卡片、控制面板或大量按钮；
- 人数、站位、动作提示、AI 反馈和倒计时都直接叠加在实时画面之上；
- 界面尽量弱化浏览器或 kiosk software 的感觉，让用户感受到自己面对的是一个能够观察、理解并回应人的 AI 装置。

核心原则：

> **Camera is the interface.**

### Ambient AI Host

V1 不设置一个持续占据屏幕空间的数字人或 AI 主持人视频。

AI Host 以一种 **ambient presence** 存在，通过以下元素共同表达：

- 实时视觉感知反馈；
- 贴近人体外围的点状感知效果；
- 简短语音引导；
- 身体关键点 / 动作反馈；
- 当前唯一需要执行的 instruction。

AI Host 不是屏幕里的另一个角色；**整个 Photo Booth 本身就是 AI Host。**

### 默认视觉：Close Perception Halo

正常待机和普通识别状态下，不持续显示完整人体骨架，也不把点状效果分散到整个屏幕。

默认使用一层 **贴近人体外围、具有包围感的点状 perception halo**：

- 点主要围绕人物轮廓外侧分布，而不是铺满全屏；
- 与身体保持一定间距，形成“AI 正在包围并读取我”的未来感；
- 人物移动时，点场随人体平滑跟随，而不是独立漂浮；
- 人数增加时，每个人形成各自可辨识的感知 halo，避免不同人的反馈混在一起；
- 点场可以产生轻微的 pulse、ripple、directional flow 或密度变化，但不能喧宾夺主。

点状效果必须对应真实 perception state，而不是纯装饰动画。

例如：

```text
未识别到人
→ 只有非常弱的环境待机效果

识别到人物
→ 点状 halo 在人物外围收拢并稳定跟随

动作开始
→ 与动作方向相关的一侧 halo 被拉动 / 点亮

动作确认
→ halo 短暂收紧或 sweep，随后进入下一状态
```

目标是在用户尚未阅读任何文字之前，就产生：

> **“这个东西正在感知我，而且它知道我在哪里。”**

的直觉。

### Stylized Body Perception

人体骨架 / 关键点仍然保留，但不作为长期默认视觉。

它主要在三个关键 moment 强化出现：

1. **First recognition**：AI 第一次明确识别用户时，身体关键点短暂亮起；
2. **Action interpretation**：用户开始执行动作时，只强化与该动作相关的关节和肢体路径；
3. **Action confirmed**：动作达到识别阈值后，相关关键点产生一次明确完成反馈，例如 `lock → glow → sweep`，随后进入下一状态。

视觉因果链为：

```text
Close perception halo
  → AI notices you

Keypoints / contour
  → AI understands your body

Motion feedback
  → AI understands your action

Confirmation animation
  → AI acts on that understanding
```

### AI Perception First

本产品的 AI presence 不依赖不断显示 `Running AI...`、`Detecting pose...` 或模型名称。

核心设计原则：

> **The experience should expose AI perception, not AI implementation.**

界面优先展示 AI 已经理解到什么，例如：

- `1 PERSON`
- `2 PEOPLE`
- `BOTH IN FRAME`
- `MOVE CLOSER`
- `ARM DETECTED`
- `THAT'S IT`
- `HOLD`

AI presence 应通过连续因果链建立：

```text
AI sees
  → AI understands
  → AI responds
```

### Single-instruction Principle

任何时刻只允许存在 **一个主要行为指令**。

例如不同时显示“站好、看镜头、举手、保持、不要出框”等多个要求，而是由状态机依次给出：

```text
STEP FORWARD
  ↓
COME TOGETHER
  ↓
RAISE YOUR ARM
  ↓
THAT'S IT — HOLD
  ↓
3 · 2 · 1
```

辅助信息，例如人数状态，可以弱化显示，但不能与主要 instruction 竞争视觉注意力。

这一原则用于降低第一次使用者和非技术用户的 cognitive load。


### Default Gesture Feedback：Raise One Arm

第一版先采用一个简单、稳定、容易观察 AI perception 的默认动作反馈，用于跑通并评估完整 interaction loop：

> **Raise One Arm → Halo reacts → Arm keypoints appear → Recognition lock → 3–2–1**

选择举起一只手作为默认动作，原因是：

- MoveNet 对肩、肘、腕的大尺度动作识别相对稳定；
- 单人到多人场景都容易理解；
- 不依赖精细手指识别；
- 视觉上容易把“AI 看见动作 → 理解动作 → 确认动作”表现出来。

#### 1. Normal state

- 保持 Full-screen AI Mirror；
- 不显示完整 debug skeleton；
- 每名 active participant 周围显示贴近人体外围的 dotted perception halo；
- halo 随 tracked person 平滑跟随。

#### 2. Gesture prompt

单人：

```text
RAISE ONE ARM
```

多人：

```text
SOMEONE RAISE ONE ARM
```

多人场景中，第一版只需要 active group 中任意一名参与者完成动作即可触发。

#### 3. Action in progress

当某位参与者开始举手时：

- 对应身体一侧的 halo 随手臂方向产生轻微 directional flow；
- 只显示与动作相关的 `shoulder → elbow → wrist` 关键点和连接；
- 不显示完整人体骨架；
- feedback 必须是 stylized / futuristic，而不是 computer-vision debug overlay。

一旦某位参与者开始形成明显动作，应使用其 tracking ID 暂时锁定 initiator，避免反馈在人之间跳动。

#### 4. Gesture confirmed

当 raise-arm rule 达到配置阈值后：

- `shoulder → elbow → wrist` 依次强化；
- 沿手臂播放一次短暂 sweep；
- 该人物的 dotted halo 短暂收紧或 pulse；
- 主 instruction 变为：

```text
GOT IT — HOLD
```

可同时播放简短语音：

```text
Got it. Hold.
```

#### 5. Hold

动作需要继续保持约 **800 ms** 才视为成功。

该时间只是第一版默认值，必须保持可配置，不硬编码为最终产品阈值。

#### 6. Success

保持成功后：

- 手臂 keypoints 淡出；
- 返回较轻的 perception halo；
- 自动进入现有的可见 `3–2–1` countdown；
- countdown 继续沿用人数、身份、站位和退出取消规则；
- countdown 完成后拍照。

#### 7. Incomplete / failed gesture

如果用户没有做到位，或在确认前把手放下：

- 不出现红色错误态；
- 不显示叉号；
- 不显示 `Gesture not detected` 或连续 `Try again`；
- 已出现的 arm keypoints 平滑淡出；
- halo 返回正常状态；
- 主 instruction 继续保持原来的 `RAISE ONE ARM` / `SOMEONE RAISE ONE ARM`。

这样即使动作尚未达到触发阈值，用户仍然能通过 halo 和局部 keypoints 感觉到系统正在感知自己的运动，而不是面对一个“识别失败”的报错界面。

#### 8. Group rule

第一版多人规则：

- active group 中任意一名参与者都可以成为 gesture initiator；
- 其他参与者只需要保持可见、有效并位于 capture zone；
- 一旦某位参与者开始形成动作，用 tracking ID 锁定 initiator；
- 不要求 2–5 人同时做相同动作；
- 成功后整组一起进入 `3–2–1`。

动作检测逻辑和视觉 rendering 必须分离，所有动作阈值、保持时间和动画时长均应可配置。


## 7. AI attribution 决定

当前目标不是证明用户能分辨“真正生成式 AI”和程序化效果，而是准确建立 AI attribution。

界面需要呈现真实因果链：

```text
AI vision sees the group
  → body movement is interpreted
  → the detected action changes the portrait
```

规则：

- 可以明确说本地 AI 识别了人体姿势和群体动作；
- 可以显示与身体动作同步的即时反馈，让用户感到系统确实在回应自己；
- 如果最终图片只是程序化合成，应写 `AI-assisted`、`AI vision interpreted your movement` 等准确表述；
- 只有真正调用生成式图像模型修改或生成画面时，才能称为 `AI-generated` 或 `generative AI`;
- Experience value 的测量方法暂不进入本轮实现范围。

## 8. 当前不做的事情

- 暂不接入本地 GPU 服务或云端姿势服务；
- 暂不采用 RTMO、RTMPose 或 YOLO Pose；
- 暂不为超过 5 人的群体设计自动拍摄；
- 暂不以精细手指姿势作为多人触发条件；
- 暂不执行 A/B 测试和现场压力测试；
- 暂不因为 AI attribution 目标而虚构生成过程；
- 暂不决定最终是否接入生成式图像模型。

## 9. 实现清单与当前状态

完整的时间顺序和验证记录见
[`implementation-log-zh.md`](implementation-log-zh.md)。

- [x] 放入 MoveNet MultiPose Lightning 模型，并确认当前电脑可以使用本地 WebGL runtime 运行；
- [x] 将 MoveNet 与 MediaPipe fallback 的模型输入裁到中央互动空间，降低通道路人占用六个检测位的风险；
- [x] 建立“从 Z1 向前约 0.5 米进入 Z2”的 Demo 空间预设和可见提示；
- [x] 把人物数据结构从模型数组编号改为语义化关节和稳定 tracking ID；
- [x] 实现三段区域分类和区域迟滞；
- [x] 实现 1–5 人 active group 建立、锁定和变更规则；
- [x] 实现第 6 人进入时的阻断和分组提示；
- [x] 移除必须点击 Begin 才能继续的状态；
- [x] 实现“进入拍摄区并稳定停留”的开始条件；
- [x] 将多人触发改为任意一名参与者举起一只手；
- [x] 在 `POSE_READY` 和 `COUNTDOWN` 中持续验证人数、身份和站位；
- [x] 实现后退取消、结果超时复位和工作人员 Escape 恢复入口；
- [x] 将主界面改为 Full-screen AI Mirror；
- [x] 实现与人物 tracking 和 perception state 联动的 point-based halo；
- [x] 实现举手过程中的局部 stylized keypoints；
- [x] 将默认 halo 从人体框椭圆改为关键点凸包外扩轮廓，并补齐 Z0 弱响应、first recognition、directional flow 和确认 sweep/fade；
- [x] 实现 single-instruction 和对应的浏览器语音引导；
- [x] 实现 initiator tracking lock、可配置 800 ms hold 和 countdown；
- [x] 实现未完成动作的无报错回退；
- [x] 更新 AI attribution 文案；
- [x] 将 Save、Add to wall 和 Retake 改为独立结果动作；
- [ ] 在目标电脑完成 1–5 人性能、ID switch、遮挡和超员测试矩阵，并据此确定最终阈值。

## 10. 尚未决定

- Z0、Z1、Z2 的最终实际距离和地面尺寸；当前约 0.5 米前进一步仅为 Demo 预设；
- 进入 Z2 后需要稳定停留多久；
- Raise One Arm 是否继续作为正式活动的唯一动作，或只是 V1 默认动作；
- 五人模式中，除“在 Z2、可见、入框”之外是否还需要更严格的 ready 条件；
- 分享方式和上墙后的撤回方式；
- 最终图像是程序化合成、生成式编辑还是混合模式；
- 目标展会电脑和浏览器的最低性能配置。
