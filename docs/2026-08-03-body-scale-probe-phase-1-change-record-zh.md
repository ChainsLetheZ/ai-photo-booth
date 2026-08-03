# 深度代理量改造 · 第一阶段：仪表化变更备案

- 备案日期：2026-08-03
- 变更性质：只测量、不改行为（shadow computation）
- 关联记录：`docs/implementation-log-zh.md`
- 当前阶段：实施前备案

## 一、提出这次修改的原因

当前 `ZoneTracker` / `ZoneClassifier` 使用脚点在画面中的归一化 Y 位置判断 Z1/Z2。实际运行中，状态会在两区之间高频抖动。现阶段的判断是：问题可能同时来自脚踝关键点置信度不足、近距离时脚部离开画面，以及真实前后移动信号与关键点噪声处在相近量级。

因此，这次不直接改判定逻辑，也不先猜阈值，而是增加一套完全旁路的 `bodyScale` 深度代理量测量链路，采集原始尺度、滤波尺度、基线归一化增益 `g`、脚点信号以及置信度和丢帧原因。数据将用于第二阶段定阈值和判断方案是否成立。

核心思路是：先把噪声、信号、延迟和丢帧率量出来，再决定是否以及如何让新信号参与交互。

## 二、本阶段不可突破的边界

1. 不修改任何现有区域判定逻辑；现有脚点判定继续原样驱动状态机。
2. 不修改状态机、halo 渲染和 instruction 文案。
3. 新增代码只做旁路计算：可以计算、保存、显示和导出，但不得参与任何决策。
4. 探针只在配置允许且 `debug=true` 时执行；`debug=false` 时不进入探针计算路径，避免生产性能回退。
5. 不修改任何现有测试文件；只能新增探针测试。
6. 完成后必须通过 `npm run test:rules`、`npm run build` 和 `tsc --noEmit`。
7. 改造后原有交互仍可能抖动，这是本阶段的预期结果，不得借机修正交互行为。

## 三、拟实施的测量链路

输入必须是已经从 interaction ROI 反变换回原始摄像头像素坐标的语义关键点，不使用 ROI 内部归一化坐标，避免未来 ROI 尺寸变化引入伪缩放。

处理顺序固定如下，不能颠倒：

```text
原始摄像头像素坐标关键点
  → 四个肩髋点的置信度门控
  → bodyScale
  → 3 帧滑动中值
  → One Euro Filter
  → 基线归一化得到 g
  → 只记录、显示、导出（第二阶段才可能接入决策）
```

置信度门控使用 `leftShoulder`、`rightShoulder`、`leftHip`、`rightHip`。任一点缺失时返回 `missing_keypoint`；任一点分数低于配置阈值时返回 `low_confidence`。不可估算或补点，宁可整帧丢弃；空帧不进入中值、One Euro 和基线更新，但必须计数并写入 CSV。

尺度定义为：

```text
torso = distance(mid(leftShoulder, rightShoulder), mid(leftHip, rightHip))
shoulderWidth = distance(leftShoulder, rightShoulder)
scale = max(torso, shoulderWidth × shoulderWidthFactor)
```

第一阶段 `shoulderWidthFactor = 0.8`。使用 `max` 是为了让躯干长度和肩宽互相兜底：侧身时肩宽可能投影塌陷，低头前倾时躯干长度可能被透视压缩，两者不应轻易造成“人变远”的假信号。

中值窗口先消除单帧离群值，One Euro 再平衡静止噪声和运动响应。初始配置为 `medianWindowSize = 3`、`minCutoff = 0.8`、`beta = 0.02`、`dCutoff = 1.0`。

## 四、每条人物轨迹上的旁路状态

在不删除、不更名、不改变任何现有字段语义的前提下，为每条 track 附加：

```ts
interface TrackScaleState {
  rawScale: number | null;
  medScale: number | null;
  filtScale: number | null;
  baseline: number | null;
  g: number | null;
  baselineFrozen: boolean;
  nullFrameCount: number;
  totalFrameCount: number;
  median: MedianWindow;
  euro: OneEuroFilter;
}
```

基线首次取有效的 `filtScale`。之后仅依据现有逻辑给出的 zone 维护旁路基线：现有 zone 不是 Z2 时以 `0.02` 慢跟随；现有 zone 是 Z2 时冻结。归一化量为 `g = filtScale / baseline`。

冻结规则是本方案最需要验证的风险点：如果进入 Z2 后基线仍继续追随当前尺度，`g` 会自动回落到 1.0，未来接入决策时可能导致倒计时无故取消。因此本阶段必须观察并用测试证明 Z2 连续 100 帧时基线不漂移。

track 销毁时，附带的中值窗口和 One Euro 状态也必须一同丢弃，防止 tracking ID 复用时把旧人物历史带给新人。

## 五、配置备案

所有参数集中加入 `config/interactionConfig.ts`，不得散落硬编码：

```ts
export const bodyScaleProbe = {
  enabled: true,
  minKeypointConfidence: 0.3,
  shoulderWidthFactor: 0.8,
  medianWindowSize: 3,
  oneEuro: { minCutoff: 0.8, beta: 0.02, dCutoff: 1.0 },
  baselineFollowRate: 0.02,
  // 第二阶段占位；第一阶段不得接入任何逻辑
  enterZ2Growth: 1.15,
  exitZ2Growth: 1.06,
  enterDwellSeconds: 0.7,
  exitDwellSeconds: 0.35,
};
```

## 六、Debug Overlay 和 CSV 目标

仅在 `?debug=true` 下显示每个人的 `raw`、`filt`、`base`、大字号 `g`、肩髋最低置信度、现有 zone 和丢帧数/总帧数。

屏幕下方增加约 30 秒滚动曲线：同屏叠加 `rawScale`、`filtScale`、`baseline`，另画固定 Y 轴 `0.85～1.35` 的 `g` 曲线和 `1.00` 基准线，并加入现有脚点判定所使用的归一化 Y 信号作为直接对照。最近 5 秒实时显示 `g` 的 mean、标准差、min、max，其中标准差将作为第二阶段阈值依据。

Debug 页提供自由文本 `label` 输入和 `R` 键开始/停止录制。录制中必须有明显指示和已录帧数；停止时下载 CSV。CSV 每个 track、每帧记录以下字段：

```csv
timestamp_ms,frame_idx,track_id,label,raw_scale,med_scale,filt_scale,baseline,g,baseline_frozen,torso,shoulder_width,conf_ls,conf_rs,conf_lh,conf_rh,scale_null,null_reason,foot_y_norm,existing_zone,active_count,fps,inference_ms
```

`scale_null=true` 的帧也必须保留，其余不可用尺度字段留空，以便准确计算丢帧率和原因分布。

## 七、测试计划

新增 `tests/bodyScaleProbe.test.ts`，不修改 `interactionEngine.test.ts` 或其他现有测试文件。覆盖：

1. `dist` / `mid` 的 3-4-5 几何正确性。
2. 四点齐全且高置信时尺度和 `ok` 原因。
3. 低置信度时返回 null 和 `low_confidence`。
4. 缺点时返回 null 和 `missing_keypoint`。
5. 侧身肩宽退化时由 torso 兜底。
6. 举手只改变手腕、不改变肩髋时 scale 不变。
7. `MedianWindow` 吃掉 `[100, 100, 300, 100]` 中的单帧 300。
8. One Euro 对常量收敛、对阶跃单调逼近且不振荡。
9. 进入 Z2 后连续 100 帧基线不变，`g` 不被基线追平。

## 八、完成后的人工测量协议

代码验证通过后，在尽量接近展会相机高度和角度的环境下，每个场景录制 30 秒：

| # | label | 动作 | 目的 |
|---|---|---|---|
| 1 | `static_far` | 单人在 Z1 自然站立 | 远处噪声底线 σ₁ |
| 2 | `static_near` | 单人在 Z2 站立 | 近处噪声 σ₂ |
| 3 | `step_forward` | Z1→Z2 停 3 秒→退回，重复 5 次 | 信号幅度 Δg 和冻结正确性 |
| 4 | `turn_body` | Z1 原地慢速转身 360° | 侧身尺度下降和 0.8 系数 |
| 5 | `raise_arm` | Z2 反复举手 5 次 | 判断举手是否污染尺度 |
| 6 | `sit_squat` | Z1 下蹲、前倾、低头 | 极端姿态伪信号 |
| 7 | `group_3p` | 3 人从 Z1 一起前进 Z2 | 多人同步性与遮挡丢帧 |
| 8 | `group_5p` | 5 人同上并故意互相遮挡 | 最差丢帧率及聚合必要性 |
| 9 | `passerby` | 一人 Z2 静止，另一人横穿 | 路人污染 |

场景 5 是方案生死判定：如果举手造成 scale 超过 3% 的变化，需要重新考虑深度代理量。

采集后要输出六个关键指标：场景 1/2 的 `g` 标准差；场景 3 的 `g` 峰值；场景 5 举手瞬间 `g` 最大偏移；场景 8 的 `scale_null` 比例及主要原因；场景 3 从迈步到 `filtScale` 稳定的延迟；场景 1 的 `foot_y_norm` 标准差。

第二阶段阈值原则暂记为：`enterZ2Growth` 取 `1 + 4σ` 与 `1 + 0.6·Δg` 的较大值；死区至少 `4σ`；滤波延迟超过 300 ms 时增大 `minCutoff`；丢帧率超过 15% 时必须考虑多人中位数聚合。这些规则只备案，本阶段不接入交互逻辑。

## 九、实施完成定义

- 原有测试文件零修改，`npm run test:rules` 通过。
- `npm run build` 通过。
- `tsc --noEmit` 通过。
- `debug=false` 时探针不执行。
- `?debug=true` 时每人数值、30 秒曲线、脚点对照和 5 秒统计可见。
- `R` 键可录制并下载字段完整的 CSV。
- 原交互行为保持完全不变。

## 十、实施后记录（2026-08-03）

本文件先于业务代码创建，作为本次更新的实施前备案。随后已完成：旁路尺度模块、每 track 状态、集中配置、debug 数值卡和曲线、5 秒统计、脚点信号对照、带 label 的 CSV 录制，以及独立单元测试。

行为隔离检查结果：`ZoneTracker`、`InteractionStateMachine`、halo 组件、instruction 文案和所有原有测试文件均未修改；探针只由 `?debug=true` 传入的开关创建。探针更新放在现有交互处理完成之后，并带有失败隔离，探针异常不会中断原状态路径。

自动验证结果：TypeScript `--noEmit` 通过；原 interaction rules 与新增 body-scale tests 均通过；Vite 前端和 server bundle 生产构建通过。当前系统环境没有全局 `npm` 命令，因此验证使用仓库本地的 `tsc`、`tsx`、`vite` 和 `esbuild` 可执行文件执行了与脚本等价的命令。

受限项：当前会话的内置浏览器策略阻止访问本机 localhost，且真人九场景需要现场相机、站位和参与者，因此未在本次自动化会话中生成九份实测 CSV，也不能诚实给出六个现场指标。代码已为现场采集准备好；这些数据必须在实际相机条件下录制后计算。
