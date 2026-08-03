# 第 2a 阶段第 1 节：性能修复备案

日期：2026-08-03

## 一、用户命令与范围

读取《第 2a 阶段：性能修复 + bodyScale 接入决策 + 阈值标定》，本次只执行第 1 节“性能修复”。完成后报告 `CAP / INF / POST / RENDER` 四段实测值。

本次明确不执行附件第 2 节及其后内容：

- 不把 bodyScale 接入区域判定；
- 不改变脚点主判据；
- 不修改 baseline 维护规则；
- 不修改 enter/exit 阈值、dwell 或投票积分器；
- 不把 posture 接入决策；
- 不修改状态机、COUNTDOWN、halo 视觉或 instruction 文案。

## 二、改动依据

第 1.5 阶段实测显示：空场景 inference 约 64 ms；有人时约 100～144 ms，整体 FPS 降到 6～7。当前单一 `inference_ms` 可能混入捕获、后处理或渲染，必须先把各段独立测量，再按证据优化。

## 三、执行逻辑

1. 审计当前视频 ROI 裁剪、MoveNet 调用、坐标反映射、sanity/tracking 和 Canvas 渲染的调用边界。
2. 新增集中定义的 `FrameTiming`：
   - `captureMs`：取帧、ROI 裁剪/缩放以及进入模型前的准备；
   - `inferMs`：只包住 `detector.estimatePoses()`；
   - `postMs`：结果解码、坐标反映射、sanity 与 tracking；
   - `renderMs`：halo、关键点和 debug overlay 绘制；
   - `totalMs`：完整帧耗时。
3. Debug overlay 同时显示 CAP / INF / POST / RENDER / TOTAL；CSV 增加对应五列。
4. 在插桩版本上先实测，按瓶颈选择附件第 1.2 节允许的修复，不预判瓶颈。
5. 检查 MoveNet Lightning 配置、WebGL backend/flags、初始化次数、离屏 canvas 复用、tensor 数稳定性以及推理与渲染是否互相等待。
6. 运行 TypeScript、规则测试和生产构建；通过本机真实页面测量并记录四段数值。

## 四、验收目标

- 空场景 `inferMs` 中位数小于 35 ms；
- 单人在场 `totalMs` 中位数小于 66 ms；
- 单人在场 `inferMs` 相比空场景增幅小于 20%；
- `numTensors` 60 秒内稳定不增长。

若当前设备、浏览器、摄像头授权或现场人物条件使某一项无法在自动测试中真实测得，必须明确记录限制，不用模拟数据冒充实测值。

## 五、实施后记录

已完成第 1 节代码改造，未执行第 2 节。

### 插桩结果

- 新增 `FrameTiming`，逐帧记录 `captureMs / inferMs / postMs / renderMs / totalMs`。
- `captureMs` 包住复用离屏 Canvas 的 ROI `drawImage`、256×256 缩放和显式 `tf.browser.fromPixels()`；输入 tensor 在 `finally` 中逐帧释放。
- `inferMs` 只包住 `detector.estimatePoses()` 这一个 `await`。
- `postMs` 包含关键点结果转换、原始摄像头坐标反映射、fallback ID 处理、sanity、stable tracking 和现有 zone/behavior 后处理。
- `renderMs` 汇总最近一次 halo、debug landmarks 和 probe chart 三个 Canvas 绘制耗时；渲染保持独立 `requestAnimationFrame/effect`，不被推理循环 `await`。
- Debug 同时显示瞬时值和最近 5 秒中位数；CSV 增加 `capture_ms / infer_ms / post_ms / render_ms / total_ms`，并保留旧 `inference_ms` 兼容列。

### 性能修复

- interaction ROI 继续使用复用的离屏 Canvas，不存在 `getImageData()`、`readPixels()` 或整幅 1440×1080 tensor 后裁剪。
- 明确传入 256×256 tensor，避免模型包装层重复创建不可见输入；逐帧释放，便于通过 tensor delta 验证无泄漏。
- 确认模型实际配置为 `MULTIPOSE_LIGHTNING`，warm-up 只在 service 创建时运行一次，代码中不存在 `.dataSync()` / `.arraySync()`。
- Debug 暴露实际 model type、`WEBGL_PACK`、`WEBGL_FORCE_F16_TEXTURES`、`WEBGL_RENDER_FLOAT32_CAPABLE`。
- halo、landmark overlay 和 30 秒 probe chart 的 Canvas backing store 物理宽度上限设为 1280；尺寸没变化时不再每帧重建 Canvas。halo 视觉逻辑、粒子形态和 interaction 行为不变。
- Debug 增加 tensor 起始值、delta 和观测秒数，便于直接做 60 秒稳定性验收。

### 自动验证

- `tsc --noEmit`：通过；
- `interactionEngine`、`bodyScaleProbe`、`poseSanityFilter`、`trackStability`：全部通过；
- Vite 客户端与 esbuild 服务端生产构建：通过；
- `ZoneTracker.ts`、`InteractionStateMachine.ts` 未修改；配置仍为 `baselineFollowRate=0.02`、`enterZ2Growth=1.15`、`exitZ2Growth=1.06`、`captureEnterY=0.70`、`captureExitY=0.65`、`stableDwellMs=550`。

### 实测状态

自动化测试浏览器不暴露本机摄像头，页面停在 `CAMERA starting`；本机 Edge 当时处于被用户最小化/使用状态，不能安全抢占。因此本次没有伪造 CAP/INF/POST/RENDER 数字。最终构建已经提供最近 5 秒的 `MEDIAN CAP / INF / POST / RENDER / TOTAL`，需要在有摄像头权限的真实 Booth 页面分别保持空场和单人在场约 10 秒后读取。

### 30 秒空场实测（2026-08-03）

随后在本机 Edge、真实摄像头、MoveNet WebGL、`VISIBLE=0` 的空场条件下完成 30.09 秒观测。由于 Windows 可访问性层会缓存动态 React 文本，最终值以 30 秒结束时前台页面实际显示的最近 5 秒 `MEDIAN` 为准：

```text
CAP     1.4 ms
INF   101.1 ms
POST    0.1 ms
RENDER  1.0 ms
TOTAL 103.0 ms
FPS       6
```

观测期间看到 `inferMs` 的瞬时值约 82.9～134.9 ms；结束帧瞬时值为 CAP 1.5 / INF 82.9 / POST 0.0 / RENDER 1.3 / TOTAL 85.9 ms。Tensor 稳定性为 `303 → 303`，页面显示 `delta=0`，累计观测约 245 秒。

结论：CAP、POST、RENDER 均不构成瓶颈；瓶颈明确位于 `detector.estimatePoses()`。空场 `inferMs < 35 ms` 与 `totalMs < 66 ms` 两项目标均未达到，因此按照阶段约束不能进入第 2 节。单人在场 30 秒数据尚未测量。
