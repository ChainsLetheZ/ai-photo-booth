# Collective Wall P0 实施备案

日期：2026-08-04

## 用户命令

依据 `collective-wall-spec-zh.md` 实现 Collective Wall，本轮最终范围仅包括第 11 节四项 P0：

1. 数据契约、持久化与 WebSocket 推送。
2. 六边形密铺网格与呼吸浮动。
3. 完整七段加入动画，包含 poseTrace 感知痕迹。
4. 顺序编号找自己，并在结果页显示编号。

明确不做四象限、自动聚光、Logo 浮现、连线、溢出/分页与第 9 节额外性能优化。

## 已确认参数与实现取舍

- 目标屏幕固定为 1920×1080、16:9。
- 固定规划 200 个六边形空位，尺寸不随当前照片数变化。
- 页面首次加载即显示全部 200 个、描边透明度 5% 的空位。
- 编号从 `101` 开始按顺序递增，必须持久化且重启不重复。
- 本轮不按 energy 分象限，采用实现简单且位置稳定的编号顺序填充。
- `poseTrace` 在 Simple Mode 当前快门快照处获取；无 initiator 时改为全身关键点顺序点亮。
- poseTrace 映射必须复用 `utils/viewportTransform.ts`，不得复制坐标公式。
- booth 状态机、手势、halo、坐标变换和既有拍照行为不可改；结果页最终只新增编号显示。
- 新配置只进入 `config/wallConfig.ts`。
- 不修改任何现有测试文件，只允许新增测试。

## 分阶段检查点

用户要求先完成：

1. 数据契约、持久化、WebSocket。
2. 200 个静态六边形空位布局。

完成第 2 步后必须先在 1920×1080 展示布局并等待确认；确认前不继续照片填入、呼吸、编号查找或七段动画。

## 后续实施记录

### 检查点 1：数据契约、持久化与 WebSocket

- `types.ts` 新增 `WallEntry`、`WallEntryDraft`、`PoseTrace` 与 WebSocket 消息契约。
- `services/wallRepository.ts` 使用 `data/wall-entries.json` 保存记录、`nextShortCode` 和版本号。
- 编号从 101 顺序发放；同一 `id` 重复提交保持幂等且不消耗新编号。
- `server.ts` 新增 `/api/wall/entries` GET/POST 和 `/api/wall/ws`。
- WebSocket 连接后先推送全量 `sync`，新增时推送 `entry_added`。
- 客户端指数退避自动重连，重连后的服务端全量消息补齐断线期间记录。
- 服务暂时不可用时保留原有同机 localStorage/BroadcastChannel 回退，避免结果页 ADD TO WALL 卡在 publishing。
- 运行时照片数据目录加入 `.gitignore`，避免参与者照片被提交到代码库。

### 检查点 2：200 个静态六边形空位

- `config/wallConfig.ts` 集中定义 200 容量、20×10 排布、86×100 逻辑单元和 5px 间距。
- 采用 pointy-top honeycomb，奇数行水平错开半个 pitch，编号 101—300 从左上到右下。
- 1920×1080 目标下保持固定逻辑尺寸；较小预览仅整体等比缩放，不随照片数改变单元大小。
- 页面加载时一次性渲染全部 200 个 5% 透明度描边空位。
- 本检查点有意不填照片、不启用呼吸、不实现查找或七段加入动画，等待布局确认。

### 验证

- `tsc --noEmit`：通过。
- `npm run test:rules`：通过，原测试文件未修改；新增持久化、重启后编号连续与布局容量测试。
- `npm run build`：通过。
- 实际页面：200 个 `.hex-wall-slot` 全部存在；WebSocket 状态为 `LIVE LINK`。
- REST 全量同步端点：返回空数组（当前没有写入任何测试参与者数据）。
- 视觉截图：`collective-wall-layout-review.png`。

### 布局确认反馈（一）

用户确认品牌条与整体构图方向正确，并要求在继续其余 P0 前完成第二轮布局预览：

- 标题改为 `200 PLACES · #101—#300`。
- 单元逻辑宽度提高到至少 105px；压缩上下留白到约 40px。
- 空位描边透明度改为 4%、线宽 1px。
- 空位内部不显示编号；编号只在照片、高亮、查找和加入动画阶段出现。
- 待机时随机选择 3—5 个空位，在 2 秒内以 4%→7%→4% 微光呼吸，随后随机轮换位置。
- 完成后再次展示布局并等待确认，不提前实施照片填入等后续功能。

实现几何取舍：保留 20×10，共 200 位；改为横向六边形，逻辑尺寸 106×83px、间距 5px。
通过横向 3/4 pitch 密铺与奇数列纵向错位，网格逻辑高度约 919px，在品牌条下方 1002px 舞台中上下各留约 41px。

第二版验证：

- 页面仍精确渲染 200 个空位，空位内编号 DOM 数量为 0。
- 标题 `200 PLACES · #101—#300` 精确匹配。
- 待机微光首轮随机选中 4 格，2.2 秒后仍为 4 格但位置从 145 轮换到 117，证明随机轮换生效。
- `tsc --noEmit`、`npm run test:rules`、`npm run build` 全部通过。
- 第二版截图：`collective-wall-layout-review-v2.png`。

## 最小可用相册版 + 骨架偏移修复

用户将后续范围收窄，并指定骨架偏移 bug 优先：

1. 先修 booth 实时骨架/关键点整体偏移。
2. debug 模式增加 nose 十字准星，同时显示 ROI 原始坐标、视频帧坐标、屏幕坐标。
3. 确认唯一使用 `utils/viewportTransform.ts`，逐层核对 ROI 反变换、镜像、DPR 和视频 DOM 尺寸。
4. 骨架修正后再采集 `poseTrace`，快门帧关键点和凸包映射到成片坐标系；旧错误 trace 标为不可用或清空。
5. Collective Wall 本轮只实现照片六边形填入、照片单元独立呼吸、现有持久化/WebSocket 实时出现。
6. 新照片只做 0.6 秒淡入，不做七段动画、查找、聚光、四象限、Logo、涟漪或过场。
7. 结果页显示顺序编号；编号从 101 起持久化发放，即使用户不选择上墙也显示，但未上墙记录不进入照片墙。

边界继续保持：不改变 Simple Mode 状态机、手势、拍照条件和结果页三个既有动作语义；不修改现有测试文件。

### 本轮实施结果：坐标修复与最小相册

骨架/关键点坐标链：

- `MoveNetPoseService` 明确保存三层坐标：256×256 ROI 输出、反变换后的原始视频像素、归一化视频坐标。
- ROI 反变换统一为 `roiToVideo`：先按 ROI 输入尺寸恢复缩放，再加 `sourceX/sourceY` 偏移；之后才进入 cover 映射。
- `PerceptionHaloLayer` 和 `PerceptionDebugOverlay` 删除各自复制的 DOM/cover/镜像拼装，统一调用 `createVideoViewportMapping`。
- 唯一映射读取 `video.getBoundingClientRect()`，用 CSS 像素输出；canvas 只通过 `context.setTransform(devicePixelRatio, ...)` 放大缓冲区，关键点不重复乘 DPR。
- video 元素保留 CSS `scaleX(-1)`，canvas 不镜像；坐标映射仅以 `mirrored=true` 翻转一次。
- debug 增加红色 nose 十字准星以及 `NOSE ROI / VIDEO / SCREEN` 三层坐标文字。

`poseTrace`：

- 在 Simple Flow 进入 `CAPTURE` 的快门帧冻结人物快照，保存每人的关键点、凸包和 initiator 标记。
- 坐标使用 `getCoverSourceRect` 与 `videoToScreen(..., mirrored=false)` 映射到最终未镜像成片，并计入成片底部信息区高度。
- 数据契约升级为 `poseTraceVersion: 2`；旧数组/v1 持久化记录在迁移时清空 trace 并升级版本，避免沿用可能偏移的旧数据。
- debug 结果页可把已采集 trace 直接叠到成片上，用于真人目视校准；生产结果页不显示该叠层。

编号、持久化与实时推送：

- 结果生成后先调用 `/api/wall/codes` 持久化预留编号，所以未上墙照片也会显示唯一顺序编号；下一编号不会因重启重复。
- ADD TO WALL 使用预留编号写入同一 JSON 仓库；WebSocket 推送 `entry_added`，重连后由全量 `sync` 补齐。
- 隔离端到端测试连续预留 `#101`、`#102` 后成功上墙 `#103` 与 `#104`；落盘版本为 2，下一编号为 105。

最小照片墙：

- 照片按编号精确填入对应六边形，使用既有六边形 `clip-path` 裁切。
- 新照片只做 0.6 秒 opacity 淡入；没有飞入、涟漪、聚光、全场变暗或七段动画。
- 每个照片单元基于 id 获得 4–6.5 秒的确定性随机周期和不同负相位，使用 `transform` 做 ±3px 呼吸浮动。
- 未填入空位继续保留 3–5 格、4%→7%→4% 的待机微光轮换。

实测与剩余人工校准：

- `#104` 从点击 ADD TO WALL 到已打开的大屏出现实测约 512ms，低于 3 秒。
- 刷新大屏后 `#104` 在同一编号位置恢复；离开页面再进入后约 611ms 完成全量补齐。
- 端到端截图确认照片为六边形而非矩形，200 个空位与 LIVE LINK 保持正常。
- 自动化环境镜头中没有真人，因此无法冒充完成“鼻尖落点、中央/左右边缘、窗口缩放”和“poseTrace 叠在真人成片上”的最终目视验收。代码侧已提供两套 debug 校准叠层，必须由现场真人完成这一步后才可宣布骨架视觉验收通过。
- 最终 `tsc --noEmit`、`npm run test:rules`（含全部既有规则测试与新增坐标/trace/仓库测试）、`npm run build` 均通过；`git diff --check` 无空白错误。
- 隔离验收服务与 `data/e2e-wall.json` 已删除；正式 `data/wall-entries.json` 未删除、未覆盖。3000 端口已切换到最新生产构建，REST 全量同步端点正常。
