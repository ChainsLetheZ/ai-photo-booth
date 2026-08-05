# 骨架检测中断：分层诊断与 F16 精度定位备案

日期：2026-08-04

## 症状

实时预览中骨架整体消失一小段时间后又出现。不是抖动、不是偏移，是渲染中断。
用户初始假设：`poseSanityFilter` 的 `requireCoreKeypoints` 在转身/举手/靠近时把整个 pose 拒掉。

**该假设被实测否定。** 见下文。

## 方法：先诊断，不猜

在改任何逻辑之前，先给整条链路加分层观测（`perception/PipelineHealthStore.ts`），
每一层只回答"这一帧我有没有产出"：

| 层 | 含义 | 上报点 |
| --- | --- | --- |
| L1 | `video.readyState` | `PerceptionManager` 每个 rAF tick |
| L2 | inference calls / skipped | 同上，只统计"该跑而没跑"的 tick |
| L3 | MoveNet 返回的 pose 数 | `InteractionController` |
| L4 | 通过 `poseSanityFilter` 的帧 + 真实测量值 | 同上 |
| L5 | 确认 track 的帧 + grace 期重关联次数 | 同上 |
| L6 | 至少一个关键点高于 `moveNet.scoreThreshold` 的人 | 同上 |
| L7 | 实际画出骨架的渲染帧 | `PerceptionHaloLayer` + `PerceptionDebugOverlay` |

设计要点：

- **漏斗式计数**：某层失败后下游不再为该帧计失败，计数可直接从上往下读成漏斗。
- **责任层取最先断的那一层**，同一次消失期间不被后续层覆盖。
- **`blank` 与 `stale` 分离**：`blank` = 画布清空后没画出东西，骨架真的消失；
  `stale` = 画布没重绘，骨架冻在上一个姿势仍在屏幕上。只有 `blank` 是本次要修的症状。
- 缺口以骨架 canvas（用户实际看到消失的那一层）为准计时。
- 每次缺口同时打到 console，因为站在摄像头前读不到面板。

## 三轮实测的关键数据

**第一轮**发现历史只留 8 条、且门槛按 20Hz 设定（实际推理约 10Hz），
造成 4 条 `L7 unknown` 假阳性。修正：`blank`/`stale` 分离、`stale` 门槛提到 260ms、历史扩到 24 条。

**第二轮**（约 24 秒在画面内）：

| 时段 | 时长 | 断在哪 |
| --- | --- | --- |
| t+127.4 → 134.8 | 7.4 秒 | 全是 L4 `missing_core`，可见时间合计 94ms |
| t+134.8 → 138.0 | 3.2 秒 | 正常，无缺口 |
| t+138.0 → 144.5 | 6.5 秒 | 全是 L3（12 次） |
| t+145.4 → 151.4 | 6 秒 | L3 / L4 交替 |

骨架在 24 秒里只显示约 6 秒。**这不是偶发抖动，是大部分时间不在。**

**第三轮**（补上模型原始输出和 sanity 真实测量值后）：

```
BLANK L3  model returned nothing                     ← ×12
BLANK L4  sanity: too_small                          ← ×4
BLANK L4  sanity: missing_core (leftHip 0.48 < 0.50) ← ×2
```

三条决定性证据：

1. **L3 全部是 `model returned nothing`** —— 模型原始输出就是空的，不是被
   `minPoseScore = 0.35` 这道闸门过滤掉的。数据根本没走到 sanity。
2. **`too_small` 拒的不是人。** 用户全身入镜（要录到脚），身高占画面 70%+，
   肩宽应在 180–200px；而 `too_small` 门槛是 39px。差 5 倍。那几帧模型只吐出了噪声姿态。
3. **`leftHip 0.48` / `0.49`，阈值 0.50** —— 差 0.01~0.02 被毙。典型的"阈值正好压在信号上"。

补充证据：用户报告**站远了不行、站近了也不行**。分辨率不足只会在远处失效，
两端都失效指向与尺度无关的原因。

## 根因：`WEBGL_FORCE_F16_TEXTURES`

查 `docs/2026-08-03-pre-m2-movenet-webgl-benchmark-record-zh.md`：

> 热机纯推理 100 次，F16 关闭：median 42.5 ms；F16 开启：median 35.9 ms，中位数改善约 15.5%。
> 生产路径保留 `WEBGL_FORCE_F16_TEXTURES=true`。

**该基准跑的是一张纯黑的 256×256 空白图，只测延迟，从未测过精度。**
空白输入不产生有意义的激活值，精度损失没有东西可以破坏 ——
这个基准在结构上就不可能发现它所启用的开关的代价。

技术机理：TF.js WebGL 后端把张量存在 GPU 纹理里。该 flag 强制使用 16 位半精度纹理
（10 位尾数，约 3 位十进制有效数字）替代 32 位（23 位尾数，约 7 位）。
MoveNet 是卷积网络，逐层累积舍入误差，最终输出的是决定
"检测到没有"和"每个关键点多少分"的热力图。热力图峰值被压平后：

- 置信度整体下移一档 → `leftHip 0.48`
- 边缘峰值跌破模型内部检测门限 → `model returned nothing`
- 退化热力图中的噪声形成伪峰 → 39px 的 ghost 姿态
- 精度损失与人在画面中的尺度无关 → 远近都失败

硬件为 Intel Iris Xe 低压集显，半精度路径的数值行为在这类 GPU 上尤其不稳。

## 改动

**行为改动只有一行**（`config/interactionConfig.ts`）：

```ts
forceF16Textures: false,   // was true
```

代价：纯推理中位数 35.9ms → 42.5ms（+6.6ms，约 18%）。帧率从约 10fps 降到约 9fps。
用户实测改后骨架稳定，此代价可接受。

其余改动全部是观测，不改变任何一层的行为：

- `perception/PipelineHealthStore.ts`：新增分层记录器、责任层判定、`blank`/`stale` 分离、
  缺口历史与整场 `SESSION` 累计。
- `perception/PerceptionManager.ts`：上报 L1/L2（跳帧判定等价改写，节流行为不变）。
- `perception/MoveNetPoseService.ts`：记录 `minPoseScore` 闸门**之前**的原始 pose 数与最高分；
  新增 `?f16=on` / `?f16=off` 单次页面加载覆盖，用于随时 A/B 对照。
- `perception/PoseSanityFilter.ts`：`SanityResult` 增加 `rejectDetail`，由过滤器自己报出
  实测数值（哪个关键点、多少分、肩宽/躯干多少 px），避免调用方重复实现同一套数学。
- `interaction/PersonTrackStore.ts`：`FrameGateDiagnostics` 增加 `reassociatedCount` 与 `rejectDetail`。
- `interaction/InteractionController.ts`：每帧上报 L3–L6。
- `components/PerceptionHaloLayer.tsx`、`debug/PerceptionDebugOverlay.tsx`：上报 L7。
- `debug/PipelineHealthPanel.tsx`：面板，200ms 刷新，带 `COPY` 按钮。
- `index.css`：`.debug-pipeline` 样式。
- `tests/pipelineHealth.test.ts`：覆盖漏斗计数、责任层归属、`blank`/`stale` 门槛、
  窗口过期、L1 停帧开放缺口、`SESSION` 累计。
- `tests/poseSanityFilter.test.ts`：拒绝类断言从整对象 `deepEqual` 改为断言 `pass` + `rejectReason`
  + `rejectDetail` 存在，使其不再因新增诊断字段而失败。断言强度不变。
- `package.json`：新测试加入 `test:rules`。

## 验收

- `tsc --noEmit`：通过。
- `test:rules` 全部 14 个测试：通过。
- 现场：改后骨架稳定（用户确认）。

## 这个结论的置信度

**没有做受控 A/B。** 结论来自"改了一处、症状消失"的事后归因，不是对照实验。
已知潜在混淆项：两次观察间隔了时间，窗外自然光变化（摄像头正对一面落地窗，
逆光剪影同样会压低关键点置信度）；以及 GPU 热状态不同。

**30 秒即可确证**：打开 `?debug=true&f16=on` 复现旧行为，站 20 秒看面板 `SESSION` 行。
若缺口重新出现则根因坐实；若依旧稳定，则真凶另有其人（首选嫌疑：逆光）。
建议在展台最终定机位时顺手做一次。

## 被否定的假设，记录以免重复讨论

- **不是 sanity filter 的 `requireCoreKeypoints`**：L4 `rejected` 在 10 秒窗口内为 0，
  `missing_core` 只在少数帧触发，且触发时是 0.48 这种擦边值，不是"转身导致肩髋缺失"。
- **不是 `minPoseScore = 0.35` 太严**：L3 全部报 `model returned nothing`，模型原始输出即为空。
- **不是分辨率/站位**：远近都失败；且 `roiInputSize` 未做任何改动即已恢复稳定。
- **不是相机或渲染层**：L1 `stalls: 0`、L2 `skipped: 0`、L7 `skipped: 0`。

## 遗留问题

1. **阈值不一致仍未对齐**：渲染层用 `moveNet.scoreThreshold = 0.24` 画骨架，
   sanity 用 `perception.minKeypointConfidence = 0.5` 判定核心关键点。
   同一个关键点画得出来却过不了 sanity。F16 关闭后置信度整体回升，这个矛盾暂时不再暴露，
   但它仍是潜在风险 —— 光线变差时会再次浮现。**修它之前必须先量，不要直接放宽**，
   否则会把"消失"换成"低质量姿态涌入导致乱抖"。
2. **`skeletonPersistence` 兜底未实现**：用户原始需求的第三步（数据中断时保持上一帧
   最长 800ms 再淡出）。当前骨架已稳，暂不需要；若现场光线条件差需要它，
   此时才是合适的时机 —— 作为收尾，而不是用来盖住检测问题。
3. **`CAPTURE` 状态卡死**：观察期间出现过 `STATE: CAPTURE`、`HELD 98.5s`、
   `PERSON LATCH false`（人已离开 30 秒）而流程不自行退出。与本次问题无关，未查。
4. **`stale` 缺口的性质未深究**：骨架 canvas 依赖 `snapshot.frame` 变化触发重绘，
   perception 停顿时画布不被清空，骨架会冻结而非消失。目前只是标记出来，未处理。

## 方法论教训

**不要用不产生真实激活值的输入去评测一个精度开关。** 纯黑图上跑 100 次推理，
测得的是访存和调度开销，测不到数值精度的代价。任何改变数值表示的 flag，
基准输入必须包含真实内容，且指标必须包含精度而不只是延迟。
