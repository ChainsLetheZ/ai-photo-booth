# 抽奖环节数据盘点报告（只读）

> 目的：抽奖环节要在大屏上展示若干条"今日之最"式的真实发现，数据来源是 photo booth 的行为记录。本报告先如实盘点"现在到底有什么"，不改任何代码、不新增数据。
>
> 盘点范围：项目源码（排除 `node_modules`、`reference/mosaic-wall` 参考实现）与本地已落盘数据（`data/`）。
>
> 结论先行：**当前落盘的只有"结果画像"（`WallEntry`），几乎不含行为特征。所有行为维度（紧密度、同步率、稳定性、停留/举手时长、举手人数、重拍、上墙选择、跨 session 身份）都在内存里实时算完就丢弃，没有任何一层把它们写下来。** 详见第 6 节。

---

## 0. 速览表

| 维度 | 现状 | 一句话依据 |
|---|---|---|
| 是否存在 `SessionRecord` | **不存在** | 全库无该类型；会话结束只留 `PortraitRecord`（内存）→ `WallEntry`（落盘） |
| 落盘的内容 | 结果画像 + 图像 | `WallEntry`：id/短号/时间戳/图像/主次能量/人数/单帧姿态轮廓 |
| 落盘里有行为数据吗 | **几乎没有** | 只有 `personCount`；紧密度/同步率/稳定性等全部未落盘 |
| 重启后历史还在吗 | **在** | `data/wall-entries.json` + `data/photos/` 磁盘持久化 |
| 图像有稳定 ID 吗 | **有** | `WallEntry.id`（UUID）与 3 位短号；照片文件名由 id 派生 |
| 能跨 session 聚合排序吗 | **部分能** | 有读取接口，但只能按人数/次能量/时间/姿态排；行为指标缺失 |
| 本地真实样本 | **有 18 条** | 均为单人、`Intelligence/Precision`，属开发期测试数据，非真实活动数据集 |

---

## 1. 数据结构现状

### 1.1 有没有 `SessionRecord` 或等价结构

**没有名为 `SessionRecord` 的结构。** 全库检索 `SessionRecord` 无任何代码命中。

会话级别实际存在的、能代表"一次拍摄"的结构有两个，二者都**不是行为记录，而是"结果画像"记录**：

1. **`PortraitRecord`**（客户端内存对象，[types.ts:20-34](../types.ts)）——一次拍摄在浏览器端生成的完整结果。字段：

   | 字段 | 类型 | 单位/取值 | 说明 |
   |---|---|---|---|
   | `id` | string | UUID | `crypto.randomUUID()`，[portraitRenderer.ts:144](../services/portraitRenderer.ts) |
   | `sourceImageData?` | string | dataURL | 原始相机帧（用于墙面照片河），可选 |
   | `imageData` | string | dataURL(jpeg 0.92) | 合成后的画像 |
   | `timestamp` | number | ms epoch | 客户端拍摄时间，[portraitRenderer.ts:147](../services/portraitRenderer.ts) |
   | `primary` | PrimaryEnergy | Motion/Intelligence/Life/Impact | **实际恒为 `Intelligence`**，见 1.4 |
   | `secondary` | SecondaryDimension | Collaboration/Precision/Momentum/Exploration | 见 1.3 |
   | `mode` | GroupMode | Single/Pair/Group | 由人数派生 |
   | `narrative` | string | 文案 | 次维度文案或 LLM 生成 |
   | `color` | string | `#0069B4` 硬编码 | |
   | `personCount?` | number | 1–5 | 来自 `reading.peopleCount` |
   | `poseTrace?` | PoseTrace[] | 归一化坐标 | **单帧**姿态快照，非时序 |
   | `shortCode?` | string | `\d{3}` | 墙面登记号 |

   注意：拍摄时算出的 `movement / stability / cohesion`（封装在 `BehaviorReading` 里传给渲染器，[BoothPage.tsx:225-232](../pages/BoothPage.tsx)）**没有一个被写进 `PortraitRecord`**——渲染器在 [portraitRenderer.ts:143-155](../services/portraitRenderer.ts) 构造返回对象时把它们全部丢掉了。

2. **`WallEntry`**（服务端落盘对象，[types.ts:54-71](../types.ts)）——`PortraitRecord` 上墙后被服务器持久化的版本。字段：`id / shortCode / createdAt / imageUrl / sourceImageUrl? / primaryEnergy / secondaryDimension / narrativeLine / personCount / poseTrace / poseTraceVersion:2`。**这是唯一落盘的会话级结构，其中与行为有关的只有 `personCount` 一项。**

`BehaviorReading`（[types.ts:11-18](../types.ts)）确实带了 `movement / stability / cohesion`，但它是**渲染期的一次性入参**，不落盘。

### 1.2 每次拍摄结束实际保留了什么

- **客户端**：`PortraitRecord`（内存，随 React 状态存活，页面 reset/IDLE 即清空，[BoothPage.tsx:97-104,149-156](../pages/BoothPage.tsx)）+ localStorage 里的 `WallEntry` 副本（离线兜底，[portraitStore.ts:26-36](../services/portraitStore.ts)）。
- **服务端**：`WallEntry` 追加进 `data/wall-entries.json`，图像落到 `data/photos/`。
- **丢弃**：整个 `InteractionEngineSnapshot`（[InteractionController.ts:89-110](../interaction/InteractionController.ts)）——即所有 `BehaviorFeatures`、区域/时序/手势/稳定度状态——都是逐帧覆盖的内存快照，拍完即弃。

### 1.3 行为特征字段逐条盘点

行为特征集中在 `BehaviorFeatures`（[behavior/types.ts:1-15](../behavior/types.ts)），由 `BehaviorFeatureExtractor.extract()` 每帧重算（[BehaviorFeatureExtractor.ts:110-144](../behavior/BehaviorFeatureExtractor.ts)）。

| 字段 | 每帧 / 会话聚合 | 是否按 bodyScale 归一化 | 计算位置（文件·函数） |
|---|---|---|---|
| `personCount` | 每帧 | — | `extract`（[BehaviorFeatureExtractor.ts:111](../behavior/BehaviorFeatureExtractor.ts)） |
| `groupCohesion` | 每帧（瞬时） | **否**（除以固定常量 0.58，图像归一化坐标） | `analyzeGroup`（[GroupAnalyzer.ts:35-38](../behavior/GroupAnalyzer.ts)） |
| `peopleClose` | 每帧 | 否（固定阈值） | `analyzeGroup`（[GroupAnalyzer.ts:39-41](../behavior/GroupAnalyzer.ts)） |
| `handsConverged` / `handsTowardCenter` | 每帧 | 否 | `analyzeGroup`（[GroupAnalyzer.ts:49-60](../behavior/GroupAnalyzer.ts)） |
| `movementIntensity` | **滑动窗口聚合**（`movementWindowMs`） | **否**（除以固定 `movementVelocityScale`） | `MovementTracker.update`（[MovementTracker.ts:112-114](../behavior/MovementTracker.ts)） |
| `movementSynchrony` | **滑动窗口聚合** | 否（速度向量夹角余弦，无量纲） | `calculateSynchrony`（[MovementTracker.ts:133-148](../behavior/MovementTracker.ts)） |
| `spatialExploration` | **窗口聚合**（`featureHistoryMs`） | 否（除以固定 0.42） | `calculateExploration`（[MovementTracker.ts:150-160](../behavior/MovementTracker.ts)） |
| `stability` | 窗口聚合（由强度反推） | 否 | `MovementTracker.update`（[MovementTracker.ts:124](../behavior/MovementTracker.ts)，`1 - intensity*1.4`） |
| `detectionStable` | 短窗口（`gestureConfirmMs`） | — | `extract`（[BehaviorFeatureExtractor.ts:119-122](../behavior/BehaviorFeatureExtractor.ts)） |
| `allSubjectsInFrame` | 每帧 | — | `extract` + `subjectInFrameResult`（[BehaviorFeatureExtractor.ts:136-141](../behavior/BehaviorFeatureExtractor.ts)） |
| `armsOpen` | 每帧 | 相对肩宽（局部归一，非全局 bodyScale） | `isArmsOpen`（[BehaviorFeatureExtractor.ts:24-71](../behavior/BehaviorFeatureExtractor.ts)） |

**关于 bodyScale 归一化（重要）**：项目确实计算 bodyScale（`interaction/BodyScaleZoneDecision.ts`、`PersonTrackStore`），但它**只用于区域门控**（判断人离相机够不够近），**没有**用来归一化上述任何行为特征。因此紧密度/位移都建立在**原始图像归一化坐标**上——同一组人离相机远时"看起来更紧凑"、位移看起来更小。若要做跨 session 的公平排名，这是必须留意的偏差。

这些窗口聚合是"最近几百毫秒的滑动平均"，**不是整段会话的聚合**，而且不落盘。

### 1.4 一个会显著影响抽奖的现状：`primary` 是常量

`this.primary` 除了初始化和 reset，从未被赋成别的值（[InteractionController.ts:200,334,946](../interaction/InteractionController.ts)），`defaultPrimary` = `Intelligence`（[interactionConfig.ts:206](../config/interactionConfig.ts)）。因此**"今日最具 X 能量"这类以主能量分类的玩法在当前构建下不成立**——所有画像的主能量都是 Intelligence（已落盘的 18 条实测数据 100% 印证）。次维度 `secondary` 由 `scoreSecondaryDimensions` 实算（[SecondaryRuleEngine.ts:16-47](../interaction/SecondaryRuleEngine.ts)）并落盘，是可用于分类的字段，但它依赖的原始分数 `secondaryScores` 不落盘。

---

## 2. 持久化现状

### 2.1 一次完整拍摄结束后，真正写盘的是什么

**存储位置：服务端本地文件系统。** 没有 IndexedDB（仅 localStorage 兜底副本）、没有数据库。

1. `data/wall-entries.json`（[wallConfig.ts:4](../config/wallConfig.ts)，`WallRepository` 原子写，[wallRepository.ts:257-262](../services/wallRepository.ts)）：
   ```
   { version:5, nextShortCode, entries: WallEntry[], reservations: {id→shortCode} }
   ```
   格式为单个 JSON 文件；`entries` 即上墙记录数组。
2. `data/photos/*.jpg`：图像按 `<id>-<hash>.jpg`（及缩略图 `.thumb.jpg`）落盘（[wallMedia.ts](../services/wallMedia.ts)），`WallEntry.imageUrl` 指向 `/media/wall/...`。
3. 客户端 localStorage：`bosch_collective_wall_v2`（entries 副本）与 `..._codes_v2`（短号预约），仅同设备离线兜底（[portraitStore.ts:15-60](../services/portraitStore.ts)）。

**写入触发**：拍照即视为同意，每次拍摄都自动 POST 上墙，无二次确认、无法保留不发（[BoothPage.tsx:246-249](../pages/BoothPage.tsx)）。服务端校验见 `isWallEntryDraft`（[server.ts:29-52](../server.ts)），入库见 `POST /api/wall/entries`（[server.ts:205-223](../server.ts)）。

**注意 `/api/narrative`**：它接收了 `groupCohesion/movementIntensity/movementSynchrony/handsConverged/armsOpen` 等行为元数据（[server.ts:107-175](../server.ts)），但仅转发给 Gemini 生成文案，**不落任何盘**。这是行为数据"离服务端最近的一次"，然后被丢弃。

### 2.2 collective wall 持久化了什么——含行为数据吗

只有 `WallEntry`（第 1.1 节）+ 图像。**行为数据：除 `personCount` 外没有。** `poseTrace` 是拍摄瞬间的**单帧**关键点+凸包（[poseTrace.ts:103-124](../services/poseTrace.ts)、[BoothPage.tsx:163-171](../pages/BoothPage.tsx)），可视为一次性姿态，不含时序、不含抖动、不含群体动力学。

### 2.3 重启服务后历史还读得到吗

**能。** `WallRepository` 构造时从 `data/wall-entries.json` 读取并做版本迁移（[wallRepository.ts:82-85,194-255](../services/wallRepository.ts)），图像在磁盘长期缓存（[server.ts:96-103](../server.ts)）。重启不丢历史。

### 2.4 portrait 图像有没有可与行为记录关联的稳定 ID

**有稳定 ID，但没有行为记录可关联。** `WallEntry.id`（UUID）全程稳定，照片文件名由 id 派生（`mediaBaseName(id)`，[wallRepository.ts:155-162](../services/wallRepository.ts)），短号 `shortCode` 也稳定。也就是说"图像 ↔ 结果画像"可以稳定关联；缺的是"结果画像 ↔ 行为记录"这一侧——因为行为记录根本没落盘。一旦将来补上行为落盘，用现成的 `id` 关联即可，无需新造键。

---

## 3. 可查询性

### 3.1 能否读取"全部历史 session"并跨 session 聚合排序

**部分能。** 读取接口是现成的：`GET /api/wall/entries` 返回全部并按 `createdAt` 升序（[server.ts:179-181](../server.ts)、[wallRepository.ts:88-92](../services/wallRepository.ts)）；WebSocket 首帧也全量 sync。可直接在其上聚合/排序的字段：**`personCount`（组内人数）、`secondaryDimension`（次维度分类）、`createdAt`（时间/时段分布）、`poseTrace`（姿态形态）**。

**不能**按紧密度、同步率、稳定性、停留/举手时长、举手人数、重拍、上墙选择做跨 session 排名——因为这些字段没落盘。

### 3.2 缺的是哪一层

**缺"落盘"层，不是读取层、也不是索引层。** 读取接口有（3.1）；数据量小到不需要索引（3.3）。真正的缺口是：行为特征在内存里算完就丢，从未写入 `WallEntry`（或任何其他存储）。补齐顺序应是"先落盘 → 再谈聚合"。

### 3.3 单条体积与 342 条全载内存可行性

- 实测 `data/wall-entries.json` 单条 JSON（**图像已在磁盘、不计入**）：最小 340 B、最大 2091 B、均值约 **1.5 KB**（含单帧 `poseTrace`）。
- 342 条 × 1.5 KB ≈ **0.5 MB**，全载内存**完全可行**，排序聚合零压力。
- **但有个硬约束**：`wallConfig.capacity = 200`（[wallConfig.ts:2](../config/wallConfig.ts)），`WallRepository` 读取和入库都 `slice(0, capacity)`（[wallRepository.ts:205,232](../services/wallRepository.ts)），入库超限直接抛 `WALL_CAPACITY_REACHED`。因此**沿用 wall-entries.json 这条通道最多留 200 条**，342 条会被截断/拒收。要支撑 342 条分析样本，应另开一条不受 200 上限约束的分析存储（见第 6 节）。

---

## 4. 字段可用性判断

判定口径：
- **现在就有** = 已落盘、跨 session 可直接读。
- **需要少量改动** = 值在拍摄瞬间已在内存算好，只差"接线 + 写盘"，不需要新的感知/算法。
- **现在完全没有** = 既没落盘，也没有现成的会话级计算，需要新逻辑。

| 维度 | 判定 | 依据（文件·行） |
|---|---|---|
| 组内人数 | **现在就有** | `WallEntry.personCount` 已落盘（[types.ts:68](../types.ts)、[wallRepository.ts:70](../services/wallRepository.ts)） |
| 组内平均距离 / 紧密度 | **需要少量改动** | `groupCohesion` 已算但未落盘（[GroupAnalyzer.ts:35-38](../behavior/GroupAnalyzer.ts)）；拍摄期在 `features` 内（[BoothPage.tsx:216](../pages/BoothPage.tsx)），渲染时被丢（[portraitRenderer.ts:143-155](../services/portraitRenderer.ts)）。**注意未按 bodyScale 归一** |
| 动作同步率 | **需要少量改动** | `movementSynchrony` 已算但未落盘（[MovementTracker.ts:133-148](../behavior/MovementTracker.ts)、[BoothPage.tsx:218](../pages/BoothPage.tsx)）；仅 2 人以上有意义 |
| 进入拍摄区 → 举手确认 时长 | **现在完全没有** | `SimpleFlowController` 只有各状态 `heldMs` 瞬时值、无累计、无落盘（[SimpleFlowController.ts:159-187](../interaction/SimpleFlowController.ts)）；无"进区"时间戳被保存 |
| 拍摄区内停留总时长 | **现在完全没有** | 无 dwell 累计逻辑；区域状态逐帧覆盖（[InteractionController.ts:509-589](../interaction/InteractionController.ts)），不落盘 |
| 举手人数（非仅 initiator） | **现在完全没有** | 手势逻辑只认单个 `initiatorId`；`immediateRaisedHand` 命中即返回、不计数（[InteractionController.ts:136-173](../interaction/InteractionController.ts)）；无"本组几人举手"的统计 |
| 重拍次数 | **现在完全没有** | 每次拍摄新建 UUID，重拍与前次无关联；reset 清空、`cooldownMs` 仅防抖（[simpleMode.ts:22](../config/simpleMode.ts)、[InteractionController.ts:332-377](../interaction/InteractionController.ts)）；无 session 身份贯穿多次拍摄 |
| 是否选择上墙 | **现在完全没有（且该"选择"不存在）** | 每次拍摄强制自动上墙、无法保留（[BoothPage.tsx:246-249](../pages/BoothPage.tsx)）；不存在可记录的取舍 |
| 拍摄时间戳 | **现在就有** | `WallEntry.createdAt`（服务端入库时刻，[wallRepository.ts:144](../services/wallRepository.ts)）；客户端 `PortraitRecord.timestamp`（[portraitRenderer.ts:147](../services/portraitRenderer.ts)）。二者略有先后差 |
| 姿势稳定性 / 抖动幅度 | **需要少量改动（稳定性）／完全没有（抖动时序）** | 瞬时 `stability` 已算但未落盘（[MovementTracker.ts:124](../behavior/MovementTracker.ts)、[BoothPage.tsx:229](../pages/BoothPage.tsx)）；落盘的 `poseTrace` 是单帧、无"抖动幅度"这种跨帧时序量 |
| 同一人/组重复参与（跨 session 身份） | **现在完全没有** | 无人脸特征/re-id；track id 每 session 重置为临时值（[perception/types.ts:56-57](../perception/types.ts)）；无任何跨 session 身份线索 |

---

## 5. 真实数据样本

**本地有真实/测试运行产生的数据：`data/wall-entries.json` 共 18 条**（另有测试夹具 `data/e2e-wall.json` 10 条，结构同为 `WallEntry`，非真实运行，故不计入）。图像已脱敏（只列元数据，不含画像）。

18 条中前 10 条实际数值：

| # | 短号 | createdAt (UTC) | 主/次能量 | 人数 | poseTrace | narrative |
|---|---|---|---|---|---|---|
| 0 | 112 | 2026-08-05T03:22:45Z | Intelligence/Precision | 1 | 13 关键点·1 人 | Clear signals become confident decisions. |
| 1 | 119 | 2026-08-05T09:16:32Z | Intelligence/Precision | 1 | 空 | 同上 |
| 2 | 120 | 2026-08-05T09:36:04Z | Intelligence/Precision | 1 | 13 关键点·1 人 | 同上 |
| 3 | 121 | 2026-08-06T03:18:20Z | Intelligence/Precision | 1 | 空 | 同上 |
| 4 | 122 | 2026-08-06T03:18:42Z | Intelligence/Precision | 1 | 空 | 同上 |
| 5 | 123 | 2026-08-06T05:18:26Z | Intelligence/Precision | 1 | 13 关键点·1 人 | 同上 |
| 6 | 124 | 2026-08-06T05:18:48Z | Intelligence/Precision | 1 | 12 关键点·1 人 | 同上 |
| 7 | 125 | 2026-08-06T05:26:45Z | Intelligence/Precision | 1 | 13 关键点·1 人 | 同上 |
| 8 | 126 | 2026-08-06T06:15:41Z | Intelligence/Precision | 1 | 12 关键点·1 人 | 同上 |
| 9 | 127 | 2026-08-06T07:09:33Z | Intelligence/Precision | 1 | 13 关键点·1 人 | 同上 |

单条完整记录（第 0 条，图像与坐标截断示意）：
```json
{
  "id": "1c9a713a-fabd-428f-add1-5ec42f690a01",
  "primaryEnergy": "Intelligence",
  "secondaryDimension": "Precision",
  "narrativeLine": "Clear signals become confident decisions.",
  "personCount": 1,
  "poseTrace": [{ "keypoints": [
      { "name": "nose", "x": 0.4800, "y": 0.2784, "score": 0.679 },
      { "name": "leftShoulder", "x": 0.5208, "y": 0.3388, "score": 0.903 }
      /* …共 13 点 */ ], "hullPoints": [/* 7 点 */], "isInitiator": true }],
  "poseTraceVersion": 2,
  "shortCode": "112",
  "createdAt": 1785900165714,
  "imageUrl": "/media/wall/1c9a713a-...-3fb5cc3d.thumb.jpg"
}
```

**样本质量提醒（对抽奖很关键）**：
- 全部 18 条 **人数=1、主/次能量恒为 `Intelligence/Precision`、文案完全一致**。这是开发期单人自测数据，**不是**真实活动的多人数据集。
- 有 4 条 `poseTrace` 为空（早期路径未采集）。
- 全部无 `sourceImageUrl`（早于该字段）。
- 时间跨度 2026-08-05 ~ 08-11。

**用现有数据能做的"今日之最"**：只有基于 `createdAt`（如"最早/最晚一张""某时段拍得最多"）、`personCount`（最大组——但当前全是 1）、`poseTrace` 形态（如"张得最开的姿态"）这类；能量/次维度分类因数据退化而无区分度。**其余以行为为核心的"今日之最"暂时无数据支撑。**

**要产生一条真实记录的最少步骤**（记录本身已能产生，只是不含行为字段）：
1. 起服务：`npm run dev`（HTTPS 见 `启动-HTTPS.command`），开 `/booth`，授权摄像头。
2. 站进取景框，等待 `PERCEIVING`，做任一手势（挥手/举手/比耶/点赞）或按空格手动快门（`simpleMode.allowManualShutter=true`，[simpleMode.ts:24](../config/simpleMode.ts)）。
3. 走完 `LOCKED → COUNTDOWN → CAPTURE → RESULT`，系统自动合成画像并 POST 上墙。
4. 结果落到 `data/wall-entries.json` + `data/photos/`，`/wall` 可见。

> 结论：产出"一条记录"零门槛；但产出"一条**带行为字段**的记录"目前不可能——落盘结构里没有这些字段。

---

## 6. 结论：要支撑跨 session 的排行与异常发现，当前最小改动是什么

按改动量从小到大排列。**本节只给方案，不动手实现。**

**A. 零改动 · 立即可用（先把能用的用起来）**
用现成落盘字段做有限的"今日之最"：`personCount`（最大组）、`createdAt`（最早/最晚、时段峰值）、`secondaryDimension`（次维度分布）、`poseTrace`（姿态形态）。
- 局限：主能量恒定、真实数据退化为单人，判别力弱；不覆盖任何行为维度。

**B. 最小落盘改动 · 解锁"紧密度/同步率/稳定性"（推荐作为第一步）**
把**拍摄瞬间内存里已经算好的**行为快照随画像一起落盘——不需要任何新感知或新算法，纯粹是"别再丢"。涉及一条链路的字段透传：
- `PortraitRecord`（[types.ts:20-34](../types.ts)）补 `behavior` 快照（`groupCohesion / movementIntensity / movementSynchrony / stability / spatialExploration` + 可选 `secondaryScores`）；
- `portraitRenderer` 停止丢弃 `reading` 里的这些值（[portraitRenderer.ts:143-155](../services/portraitRenderer.ts)）；
- `portraitToDraft` / `WallEntrySubmission` / `isWallEntryDraft` / `WallEntry` / `isWallEntry` 同步加字段并放行（[portraitStore.ts:68-83](../services/portraitStore.ts)、[server.ts:29-52](../server.ts)、[wallRepository.ts:58-74](../services/wallRepository.ts)）；
- `PersistedWallState.version` 从 5→6，`read()` 迁移旧记录（缺失字段留空）。
- 解锁：紧密度、同步率、姿势稳定性 三个维度的跨 session 排名。
- 仍缺：时长/举手人数/重拍/上墙选择/身份。且需注意这些量**未按 bodyScale 归一**，跨 session 排名前建议先归一化或分组（单人/多人分开）。

**C. 增补会话级时序与计数 · 解锁"时长/举手人数"（中等）**
在 `InteractionController` / `SimpleFlowController` 记录关键时间戳与计数并随画像落盘：进区时刻、举手确认时刻（→ 反应时长）、区内累计停留、本组举手人数（把 `immediateRaisedHand` 的"命中即返回"改为遍历计数，[InteractionController.ts:136-173](../interaction/InteractionController.ts)）。属新增少量逻辑 + 沿用 B 的落盘通道。

**D. 引入真正的 `SessionRecord` 与独立分析存储（较大）**
当需要"重拍次数""是否选择上墙""整段会话的聚合窗口"时，需要：
- 一个贯穿"一次会话/一组人"的 **session 身份与生命周期**（现在每次拍摄各自独立、无上位会话）；
- 一条**独立于 `wall-entries.json` 的追加式分析日志**（绕开 `capacity=200` 上限，[wallConfig.ts:2](../config/wallConfig.ts)、[wallRepository.ts:205,232](../services/wallRepository.ts)），以容纳 342+ 条并保留被墙面淘汰的记录；
- 若要"上墙选择"，还需先改掉"拍照即强制上墙"的产品设定（[BoothPage.tsx:246-249](../pages/BoothPage.tsx)）。

**E. 跨 session 身份 / 重复参与（最大，建议单独评审）**
需人脸特征或 re-id + 隐私合规评审 + 新存储。当前架构零基础（track id 每 session 重置）。风险/成本最高，建议作为独立议题，不纳入抽奖首版。

**推荐路径：A（先上）→ B（第一笔落盘改动）→ C（补时长与人数）**，即可支撑大部分"今日之最/异常发现"；D、E 视需求再议。

---

## 附：未确认项清单

- **B/C 方案的精确改动清单**未逐一验证编译影响（本次为只读盘点，未实际改码）。
- 服务端 `createdAt` 与客户端 `timestamp` 的**具体时差**未测量（仅从代码判断为"入库时刻 vs 拍摄时刻"，通常几百毫秒级）。
- `poseTrace` 空记录（18 条中 4 条）的**具体成因**未逐条追查（推测为早期采集路径或未检出人体，未确认）。
- 生产模式（`NODE_ENV=production`）下的静态资源/持久化路径未实测，仅读代码（[server.ts:307-322](../server.ts)）。
- 18 条实测数据主/次能量高度一致，**是否也受"单人自测"以外因素影响**未进一步排查（`primary` 恒定已确认；`secondary` 退化未确认是否纯由静止单人所致）。
