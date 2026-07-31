# AI Photo Booth：实施日志

**开始时间：** 2026-07-31  
**目标：** 在今天下午形成符合新版设计方向的纯浏览器演示版本。  
**记录规则：** 按时间顺序追加；保留决定、完成项、验证结果、已知问题和待用户动作，不覆盖历史记录。

## 状态图例

- `DONE`：已经完成并验证；
- `IN PROGRESS`：正在实现；
- `BLOCKED`：存在外部依赖，当前无法完成；
- `TODO`：尚未开始；
- `DECISION`：实现过程中确认的设计或技术决定。

---

## 2026-07-31

### 记录 01 — IN PROGRESS：开始 V1 demo 实施

- 已读取最新 [`design-progress-zh.md`](design-progress-zh.md)。
- 已建立 [`v1-implementation-roadmap-zh.md`](v1-implementation-roadmap-zh.md)。
- 本轮实施范围：
  - 模型无关的人体数据层；
  - MoveNet 浏览器接口与本地模型占位；
  - 三段区域；
  - 1–5 人 active group；
  - 无 Begin 的距离触发；
  - Raise One Arm；
  - 倒计时持续验证与后退取消；
  - Full-screen AI Mirror；
  - perception halo 和局部手臂关键点；
  - 上墙改为主动选择；
  - AI attribution 文案。
- 用户明确保留的动作：MoveNet 模型文件由用户最后自行下载。
- 当前代码仍使用 MediaPipe Pose Lite + Hand；不能将这件事误记为 MoveNet 已完成。

### 记录 02 — DECISION：先建立语义化关节层

- MediaPipe 与 MoveNet 的关键点编号不同。
- 直接替换推理服务会让现有行为层把 MoveNet 的髋、膝、踝误读为肩、肘、腕。
- 因此先建立按 `leftShoulder`、`leftElbow`、`leftWrist` 等名称访问的统一数据结构，再接 MoveNet。

### 记录 03 — DECISION：模型缺失时保留 demo fallback

- V1 默认目标仍是 MoveNet MultiPose。
- 在用户尚未放入 MoveNet 模型文件时，页面必须明确显示模型未就绪，不能声称 MoveNet 正在运行。
- 为保证今天能检查界面和流程，保留现有 MediaPipe 作为开发 fallback；正式 demo 是否允许 fallback 由启动配置决定。

### 记录 04 — DONE：现有规则基线

- 当前 `tests/interactionEngine.test.ts` 全部通过。
- 生产构建首次执行被当前沙箱阻止启动构建子进程，属于验证环境限制，不是已确认的代码错误。
- 在全部改动完成后，将用允许构建子进程的方式重新验证并记录最终结果。

### 记录 05 — DONE：模型无关的人体数据层

- 新增 `PoseEstimator` 统一接口。
- `PersonObservation` 现在同时包含：
  - 语义化关节名称；
  - 人体边界；
  - 脚点；
  - 人体中心；
  - 来源模型；
  - tracking ID。
- MediaPipe 输出已经通过 adapter 转成统一结构。
- 行为层不再依赖 MediaPipe 的裸关键点编号。
- TypeScript 类型检查通过。

### 记录 06 — DONE：MoveNet 浏览器接口与本地占位

- 新增 `MoveNetPoseService`。
- 目标模型路径固定为 `public/models/movenet/model.json`。
- 模型目录只保留说明文件，模型 graph 和 weight shards 未下载，符合用户要求。
- MoveNet 缺失时页面显示明确的 `DEMO FALLBACK`，并回退到现有本地 MediaPipe；不会声称 MoveNet 已运行。
- 公司网络拦截了 jsDelivr CDN，已改从官方 npm registry 取得并固定以下浏览器运行库：
  - TensorFlow.js Core 4.22.0；
  - TensorFlow.js Converter 4.22.0；
  - TensorFlow.js WebGL backend 4.22.0；
  - Pose Detection 2.1.3。
- 运行库保存在 `public/vendor/movenet/`，正式运行不依赖 CDN。

### 记录 07 — DONE：三区与 1–5 人 active group

- 新增带迟滞和 dwell time 的 `ZoneTracker`。
- 已区分 visible、engaged、capture 和 active 人数。
- active group 使用 tracking ID，不使用数组顺序。
- 第 6 人进入拍摄区时：
  - `overflow = true`；
  - active group 为空；
  - 不会随机选择其中五人；
  - 不会进入动作或倒计时。
- 区域阈值、迟滞、稳定时间和人数上限均集中配置。

### 记录 08 — DONE：无点击状态机与 Raise One Arm

- 公共流程已移除 Begin 和能量选择卡片。
- 新状态流：
  - `PASSERBY → ENGAGED → CAPTURE_ZONE → DIRECT → POSE_READY → COUNTDOWN → CAPTURE → CREATE → RESULT`。
- 任意 active participant 可以成为举手 initiator。
- initiator 使用 tracking ID 锁定，反馈不会在人之间跳动。
- 举手保持默认值为 800 ms，保持和释放阈值均可配置。
- 其他成员只需在拍摄区、保持可见和入框，不需要同步举手。
- 在 `POSE_READY` 和 `COUNTDOWN` 持续检查人数、ID、站位和 overflow。
- 短暂 tracking loss 有 grace period；可见的人后退或换人仍会取消。
- Escape 键作为工作人员恢复入口；结果页 90 秒自动复位。

### 记录 09 — DONE：Full-screen AI Mirror

- `BoothPage` 已改为摄像头全屏主界面。
- 已实现 single-instruction：
  - STEP INTO VIEW；
  - STEP FORWARD；
  - HOLD YOUR POSITION；
  - RAISE ONE ARM / SOMEONE RAISE ONE ARM；
  - GOT IT — HOLD；
  - 3–2–1。
- 新增每人独立的 dotted perception halo。
- 举手时只显示 shoulder–elbow–wrist 局部关键点和动作进度。
- 正式视觉与 debug overlay 分离。
- overlay 已处理镜像和 `object-fit: cover` 坐标映射。
- 第 6 人会显示明确的分组提示。
- 无法完成动作时平滑回到正常 halo，不显示红色错误态。

### 记录 10 — DONE：AI attribution 与上墙选择

- 正式界面使用 `LOCAL AI PERCEPTION · ON DEVICE`。
- CREATE 阶段显示真实因果链，不声称运行生成式图像模型。
- 结果明确标注 `AI-ASSISTED · LOCAL POSE PERCEPTION`。
- 删除结果生成后自动发布到 wall 的行为。
- Save、Add to wall、Retake 已成为三个独立动作。
- V1 暂用配置中的 `Intelligence` 作为确定性 Primary Energy，目的是跑通 demo；最终 Primary Energy 的产生方式仍是产品待定项。

### 记录 11 — DONE：有限浏览器验证

- 使用已运行的 `http://localhost:4173/booth`，没有重启本地服务。
- 页面成功加载，标题为 `Bosch AI Future Portraits`。
- 摄像头视频达到 `readyState = 4`，分辨率为 1440×1080。
- 页面存在 Full-screen AI Mirror 和 perception canvas。
- MoveNet 模型缺失时，页面明确显示：
  - `DEMO FALLBACK`；
  - `MoveNet model is not installed...`；
  - `Using MediaPipe development fallback`。
- 浏览器控制台没有应用错误；只出现 MediaPipe WASM 的 OpenGL 检查提示。
- 视觉检查发现拍摄区引导线与主 instruction 距离过近，已调整引导线位置并复查。
- `/booth` 与 `/wall` 均返回 200。
- 四个本地 MoveNet runtime 文件均返回 JavaScript 200。
- `/models/movenet/model.json` 当前返回 HTML fallback，MoveNet loader 会据此判断模型尚未安装并使用明确 fallback。

### 记录 12 — DONE：最终自动验证

- TypeScript `--noEmit` 检查通过。
- 交互规则测试通过，覆盖：
  - 任意一名参与者成为举手 initiator；
  - 800 ms 前不确认；
  - 第 6 人不会被静默裁成 5 人；
  - 未经过 `POSE_READY` 不能进入倒计时；
  - group invalid 会取消倒计时。
- Vite production build 通过。
- demo server production bundle 已在本轮实现过程中成功构建。
- `git diff --check` 通过。

### 记录 13 — TODO：用户放入 MoveNet 模型后

- 按 `public/models/movenet/README.md` 放入 `model.json` 和全部 weight shards。
- 打开 `/booth?debug=true`，确认 debug engine 从 `MEDIAPIPE` 变为 `MOVENET`。
- 在目标电脑记录 1–5 人的 FPS、inference time、ID switch 和最差遮挡场景。
- 根据现场地面标记调整 Z0/Z1/Z2 阈值；当前数值只是 demo 默认值。

### 记录 14 — DONE：约 0.5 米前进一步的三段区域 Demo

- 新增 `DEMO_HALF_METER_STEP` 空间预设。
- Z0、Z1、Z2 仍然按人物脚点在画面中的归一化位置判断，不伪装成摄像头真实米制测距。
- 主界面明确显示 `≈0.5M FORWARD · STEP BACK TO CANCEL`。
- `ENGAGED` 状态的主 instruction 改为 `STEP FORWARD ABOUT 0.5 M`。
- `/booth?debug=true` 现在显示 Z0、Z1、Z2 区域带和两条边界线，便于现场对着地面标识调参。
- 约 0.5 米只是本轮 Demo 的可理解动作；最终物理距离仍需结合镜头、安装高度和展位深度标定。

### 记录 15 — DONE：互动空间优先进入模型

- MoveNet 不再直接把整幅通道画面作为推理输入。
- 新增中央 interaction ROI；先裁出互动空间，再运行最多 6 人的姿势识别。
- MoveNet 输出的关键点、人体框、脚点和中心点会重新映射到原始摄像头坐标，后续区域和镜像绘制逻辑不需要知道裁剪细节。
- MediaPipe development fallback 使用同一 interaction ROI 和坐标回映射，避免两条运行路径出现不同空间语义。
- 该改动降低通道路人占用 6 个检测位的风险，但不能代替真实展会人流压力测试。

### 记录 16 — DONE：AI 身体反馈补全

- 普通 halo 从人体 bounding-box 椭圆改为身体关键点凸包外扩形成的贴身点状轮廓。
- Z0 路过者获得低强度环境响应，但不会被加入 session、接受动作教学或触发倒计时。
- 人物首次稳定进入 Z1/Z2 时，身体关键点短暂依次亮起。
- 举手开始后，对应侧 halo 会沿肩到腕方向产生局部 directional flow。
- 动作确认后播放 `shoulder → elbow → wrist` sweep、halo 收紧/pulse，并在进入倒计时后淡出。
- 动作检测逻辑和绘制逻辑仍然分离；视觉动画不参与是否触发拍照的判定。

### 记录 17 — DONE：MoveNet 模型接入与当前电脑 smoke check

- `public/models/movenet/` 已存在：
  - `model.json`；
  - `group1-shard1of3.bin`；
  - `group1-shard2of3.bin`；
  - `group1-shard3of3.bin`。
- 官方 TensorFlow.js 压缩下载入口已写入模型目录 README。
- 浏览器 debug overlay 已确认显示 `MOVENET ENGINE` 和 `running`，不再进入 MediaPipe fallback。
- 第一次 WebGL 推理存在明显 shader/model 预热成本，因此 MoveNet 初始化现在先执行一次空白帧 warm-up；完成前界面使用真实的本地模型初始化提示。
- 本机浏览器热运行 smoke check 曾观察到约 46 ms inference、约 10 FPS；刷新后的短采样会因预热和采样窗口出现更低瞬时值。
- 以上仅证明当前电脑和当前零人/单画面环境能够运行 MoveNet，不等于已经完成目标硬件的 1–5 人性能基线。

### 记录 18 — DONE：本轮最终验证

- TypeScript `--noEmit` 检查通过。
- 交互规则测试通过，并新增 Z1 到 Z2 半米 Demo 预设的状态测试。
- Vite production build 通过；MediaPipe bundle 的 `eval` 与大 chunk 信息仍是第三方依赖构建警告，不是构建失败。
- `git diff --check` 通过。
- 现有服务未重启：
  - `/booth` 返回 200；
  - `/wall` 返回 200；
  - `/models/movenet/model.json` 返回 JSON 200；
  - MoveNet weight shard 返回二进制 200。
- 浏览器确认：
  - 摄像头为 `ready`；
  - MoveNet 为 `running`；
  - 半米前进提示已出现；
  - 页面控制台没有应用错误。
- 尚未完成：真人 1–5 人、遮挡、ID switch、第 6 人、后退取消与完整举手倒计时的现场矩阵。
