# AirMic 前端开发说明

前端为 React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + zustand + react-router 7 的单页应用，
界面语言为中文，风格是深色游戏语音风格（TeamSpeak / Discord 氛围）。
语音使用 **LiveKit SFU**：浏览器只连接 LiveKit 媒体服务器，音频经服务器中转，**不再实现 P2P/Mesh**。

## 已提供的基础设施（由 Lead 编写，**只读**，不要修改）

| 路径 | 内容 |
| --- | --- |
| `src/App.tsx` | 路由：`/setup`（初始化向导）、`/login`、`/`（AppLayout + LobbyPage）、`/room/:roomId`、`/admin`；全局弹窗/Toast；认证与初始化守卫 |
| `src/pages/SetupPage.tsx` | 部署初始化向导页面（frontend-core 负责） |
| `src/stores/auth.ts` | 当前用户、登录/注册/游客/退出 |
| `src/stores/app.ts` | 服务器设置（含 livekitUrl / voiceAvailable / mediaTransport）、房间列表、在线用户、WS 连接状态 |
| `src/stores/room.ts` | 当前房间快照/成员/消息/加入与离开 |
| `src/stores/ui.ts` | Toast、全局弹窗（settings/profile）、确认框、移动端侧栏 |
| `src/stores/settings.ts` | 本地偏好（输入设备、PTT、音量、本地音质覆盖等，已持久化） |
| `src/lib/api.ts` | REST 接口封装（`api.auth / api.users / api.rooms / api.admin / api.setup`，以及 LiveKit 令牌） |
| `src/lib/ws.ts` | WebSocket 客户端：`socket.send / socket.on / socket.onStatus` |
| `src/lib/events.ts` | WS 事件到 store/语音引擎的完整分发（已实现，一般不需要改） |
| `src/components/ui/index.tsx` | 通用组件：Button/IconButton/Input/Textarea/Select/Switch/Slider/Avatar/Badge/Spinner/Modal/Tabs/ToastHost/ConfirmDialog/EmptyState/Kbd 等 |
| `src/voice/engine.ts` | LiveKit 语音引擎接口与事件契约（frontend-room 负责实现） |
| `src/lib/format.ts` | cn/时间格式化/initials/颜色工具等 |

需要新的通用组件时，在自己的目录里创建，不要修改 `components/ui`。
如需修改 store/lib/App 路由结构或 shared 类型，先发消息给 Lead。

## 页面与组件归属

**frontend-core** 负责：
- `src/pages/AuthPage.tsx`、`src/pages/LobbyPage.tsx`、`src/pages/AdminPage.tsx`、`src/pages/SetupPage.tsx`
- `src/components/layout/AppLayout.tsx`
- `src/components/lobby/**`、`src/components/admin/**`（含管理后台 LiveKit 配置区块）、
  `src/components/auth/**`、`src/components/setup/**`、`src/components/profile/ProfileModal.tsx`
- `src/App.tsx` 中的 `/setup` 路由与"未初始化跳转"逻辑

**frontend-room** 负责：
- `src/pages/RoomPage.tsx`
- `src/voice/**`（替换为 LiveKit-only 实现）
- `src/components/room/**`、`src/components/chat/**`、`src/components/settings/SettingsModal.tsx`

## 设计规范

- 颜色 token（Tailwind 自定义）：`bg-ink-950/900/850/800/750/700`、`text-mist-100/200/300/400/500`、
  `brand-400/500/600`（靛蓝）、`aqua-400`（青色）、`good/warn/bad`。
- 面板：`rounded-2xl border border-white/5 bg-ink-850`；强调按钮用 brand 渐变。
- 图标统一使用 `lucide-react`。中文文案，必要时补充小号辅助文字。
- 桌面优先，同时保证 768px 以下可用（侧栏抽屉、聊天面板可折叠）。
- 交互反馈：按钮 loading、操作 Toast（`useUiStore.getState().toast(...)`）、危险操作二次确认（`confirm(...)`）。

## 页面功能要求

### 初始化向导（SetupPage，`/setup`）

首次部署（`appStore.setupRequired=true`）时，访问任何页面都应重定向到 `/setup`；初始化完成后跳转登录页/大厅。

- 4 步向导（服务器信息 / 管理员 / 语音中转与音质 / 确认），左侧或顶部显示步骤条：
  1. **服务器信息**：服务器名、MOTD、注册模式（开放 / 邀请码 / 关闭）、游客开关；若 `GET /api/setup/status` 返回 `requiresToken=true`，本步显示「初始化口令」输入框（对应 `SETUP_TOKEN`）。
  2. **管理员账号**：用户名（规则同注册）、昵称、密码、确认密码。
  3. **语音中转与音质**：LiveKit URL（wss:// 示例）、API Key、API Secret（密码输入框，可显示/隐藏）、单房间人数上限（默认 100，范围 1–500）、默认音质预设（省流/标准/高清/音乐），以及「创建默认房间」开关；LiveKit 可以留空（稍后在管理后台补配），但需提示「留空则无法语音」。
  4. **确认并完成**：汇总信息并提交（默认房间为「开黑大厅 / 休息室」）。
- 提交调用 `api.setup.initialize({ token?, admin, server, createDefaultRooms })`：
  - 成功后自动带 Cookie 登录（响应含 `user`），刷新 `appStore` 服务器设置，跳转大厅（或登录页并 Toast）。
  - 失败处理：口令错误（403）、已完成初始化（409）、用户名占用（409）、限流（429）均需内联/Toast 提示。
- 页面在已初始化（`setupRequired=false`）时应跳转登录页/大厅；不要展示注册表单。
- 初始化接口有并发与限流保护，提交时按钮 loading，避免重复点击。

### 登录页（AuthPage）
- 左侧品牌区：AirMic logo/名称、服务器名、MOTD、在线人数、特性简介；右侧卡片。
- Tabs：登录 / 注册 / 游客。
  - 登录：用户名、密码（可切换可见）、提交。错误内联显示。
  - 注册：用户名（提示规则）、昵称、密码、确认密码；注册模式为 invite 时显示邀请码输入；
    registrationMode=closed 时禁用注册并提示；不再有"第一个注册用户成为管理员"的引导（管理员由 `/setup` 创建）。
  - 游客：昵称即可进入（guestEnabled=false 时隐藏/禁用并提示）。
- 未初始化时页面应引导到 `/setup`（由 App 统一守卫）。
- 成功后由 App 自动跳转大厅（本页在已登录时 Navigate 到 "/"）。
- 优雅的背景（`.bg-grid`、渐变光晕），移动端单列。

### 主布局（AppLayout）
- 顶栏：移动端菜单按钮、服务器名/连接状态（online/reconnecting/offline 小圆点）、右侧用户菜单
  （个人资料、语音设置、管理后台（有权限时）、退出登录）。
- 左侧栏：房间列表按分类分组，显示人数/上限、密码锁、锁定图标、当前房间高亮；
  有权限时显示“创建房间”按钮；底部在线用户列表（头像 + 状态 + 所在房间）；底部用户卡片（头像/昵称/角色 + 设置/退出）。
- 移动端：侧栏为抽屉（uiStore.sidebarOpen），遮罩点击关闭；内容区自适应。
- 进入管理后台的入口按权限显示（`user.permissions` 含 manage_server/manage_rooms/manage_users/view_audit/ban_users 任一）。
- 如果 `server.voiceAvailable=false`，可在顶栏或大厅提示"语音服务未配置，请联系管理员"。

### 大厅页（LobbyPage）
- 欢迎区：服务器名/MOTD/统计（在线人数、房间数），快捷“创建房间”。
- 房间卡片网格：名称、简介、分类、人数/上限、锁/锁房/共享状态；点击进入房间；
  有密码时弹出密码输入框（`api.rooms.checkPassword` 可预校验或直接 `roomStore.joinRoom(id, password)`）；
  有权限时显示编辑按钮。加入后 `navigate("/room/"+id)`。
- 创建/编辑房间弹窗（前后台共用组件）：名称、简介、分类（服务器设置中的分类）、密码（设置/清除）、
  人数上限（0=继承服务器默认，SFU 下默认 100）、锁定、允许屏幕共享、音质参数编辑器（预设 + 自定义：码率/采样率/声道/DTX/FEC/回声消除/降噪/AGC），
  调用 `api.rooms.create/update`，成功后刷新 appStore 房间列表并 Toast。
- 无房间时显示引导（管理员可创建）。
- 可显示公告/MOTD 卡片。

### 管理后台（AdminPage）
- 独立全屏布局：左侧导航（概览、房间管理、用户管理、封禁管理、审计日志、服务器设置、登录会话），顶部“返回大厅”。
- 概览：统计卡片（用户数/在线/峰值/房间/消息/封禁）、在线用户表（踢出/静音/移动房间）、最近审计。
- 房间管理：表格/卡片列表，创建/编辑/删除（复用房间表单与音质编辑器），显示实时人数与生效音质。
- 用户管理：搜索、分页、角色修改（admin/moderator/user）、封禁（时长+原因）、踢出、强制静音、移动房间、删除（不可删自己/最后管理员）。
- 封禁管理：有效/全部列表，解封，新增封禁（用户搜索或 IP + 时长 + 原因）。
- 审计日志：分页 + action 过滤，显示操作者/目标/时间/IP/详情。
- 服务器设置：
  - 服务器名、MOTD、注册模式（开放/邀请码/关闭）与邀请码、游客开关与游客权限、
    人数/房间/消息上限、聊天开关、屏幕共享开关、默认音质编辑器、房间分类管理；
  - **语音中转（LiveKit）**：LiveKit URL、API Key、API Secret（密码输入框，可显示/隐藏）以及当前 `voiceAvailable` 状态；
    保存后 WS 会广播新设置，提示"已进入房间的用户需要重新进入房间生效"；
  - 旧版 P2P 的 ICE/TURN（STUN/TURN）配置属于遗留项，SFU 模式不再用于语音；管理后台应隐藏或标注已弃用（当前 SettingsTab 仍保留「强制 TURN 中继」开关与 IceServersEditor，属于待清理的遗留 UI）。
- 登录会话：列表（用户、IP、UA、创建/过期时间）。
- 所有操作捕获 ApiError 显示 Toast；危险操作确认框。

### 个人资料弹窗（ProfileModal）
- 修改昵称、头像颜色（预设色板）、头像 emoji（常用表情选择 + 清除）、状态文本；
- 修改密码（当前密码/新密码/确认）；
- 显示账号信息（用户名、角色、注册时间、游客提示）；
- 保存后 `authStore.setUser` / `refreshUser` 并 Toast。

## 语音引擎契约（frontend-room，LiveKit-only）

`src/voice/engine.ts` 中定义完整类型与事件。必须基于 **livekit-client** 实现，**不得再使用 Mesh/perfect negotiation/浏览器间 SDP 交换**。
生命周期仍由 `src/lib/events.ts` 驱动（加入房间后 `enter`、离开房间 `leave` 等），房间页面不要重复调用。

必须实现：

- `enter(snapshot)`：
  1. 通过 `POST /api/rooms/:id/livekit-token` 获取 `{ url, token, room, identity }`（未加入房间会 403；未配置语音返回 `voice_not_configured`）；
  2. 用 `livekit-client` 的 `Room.connect(url, token)` 连接 LiveKit，发布麦克风轨道（`setMicrophoneEnabled` / `publishTrack`）；
  3. 订阅房间内其他人的音频轨道并播放；对已存在成员与后续加入成员都要处理；
  4. 获取麦克风失败时通过 `error` 事件提示，但仍可收听（receive-only）。
- **麦克风/耳聋/PTT**：`setMicEnabled` 控制本地麦克风轨道发布；`setDeafened` 静音所有远端音频；PTT 按住时发布、松开时静音。
- **每用户音量/本地静音**：按 LiveKit participant identity（用户 ID）管理 Audio 元素/GainNode，`setPeerVolume` 即时生效；耳聋时全部静音。
- **说话检测**：本地 AudioContext AnalyserNode 计算电平（约 10 次/秒，`local-level` 事件含 speaking），
  说话状态变化通过 WS `state.speaking` 节流上报（≤5 次/秒）；远端说话高亮可用 LiveKit `ActiveSpeakersChanged` 或音频分析实现。
- **连接质量统计**：每 2 秒汇总 LiveKit 的 `ConnectionQuality`（并尽量从 `getStats` 读取 RTT/丢包/抖动/码率），通过 `peer-stats` 事件输出（用于成员卡片与底部状态；某些统计在浏览器/SFU 下可能不可用，需做空值兼容）。
- **屏幕共享**：`getDisplayMedia` 获取屏幕轨道，以 `screenShare` 的方式发布（LiveKit track source 为 ScreenShare）；
  收到远端屏幕共享轨道时通过 `screen-stream` 等事件交给房间页展示；停止共享时取消发布。服务器会保证同一房间同时只有一人共享。
- **设备/音质**：`switchInputDevice` 切换麦克风（`switchActiveDevice`）；音质参数来自房间生效音质 + 本机覆盖，
  通过 getUserMedia 约束与 Opus 参数/发布选项应用；`applyAudioSettings` 在房间音质变化时重新协商或重发布轨道。
- **强制静音/踢人/会话失效**：`applyForceMute` 立即静音本地麦克风并提示；被踢/会话结束时 `leave` 并断开 LiveKit。
- **断线重连**：LiveKit 连接断开时按退避重连（重新获取令牌）；同时保持 WebSocket 应用信令重连逻辑。
- **自动播放**：`resumeAudio` 调用 LiveKit `Room.startAudio()` 或恢复 AudioContext；被浏览器拦截时置 `audioBlocked=true`，
  页面提供"点击启用声音"按钮。
- 生命周期：`leave()` / `destroy()` 必须关闭 LiveKit Room、停止本地轨道、释放 AudioContext 与定时器。
- 未配置语音（`voiceAvailable=false`）时 `enter` 应通过 `error`/状态事件提示"语音服务未配置"，页面显示禁用状态。

事件/状态应保持与现有 `VoiceEventMap`、`RoomPage` 的契约一致（peer-joined/left、peer-state、peer-stream、screen-stream、
local-level、peer-stats、state、error 等）；内部从 Mesh 换成 LiveKit 不应影响页面组件的使用方式。

## 房间页（RoomPage）功能要求

- 进入时若无快照或房间 id 不匹配则 `roomStore.joinRoom(roomId)`（密码房间从大厅传入密码后进入；
  直接 URL 进入无密码时展示 joinError 与重试/返回大厅）。加入中显示 loading，失败显示错误卡片。
- 页面结构：顶部房间信息栏（名称、简介、分类、人数、音质摘要、密码/锁图标、返回/离开，
  **并显示"服务端中转 / SFU"标识**）；中间舞台（成员网格 / 屏幕共享大画面 / 空位提示）；
  右侧聊天面板（可折叠）；底部控制栏（麦克风、耳聋、屏幕共享、语音设置、离开；连接状态与连接质量/延迟提示）。
- 顶部或舞台在 `voiceAvailable=false` 时显示"语音服务未配置"的提示条（不可通话但可聊天）。
- 成员卡片：头像（说话高亮）、昵称、角色徽章、静音/耳聋/强制静音图标、连接质量（`peer-stats`）、
  点击展开音量滑块（本地音量，settingsStore + engine.setPeerVolume）与“本地静音”。自己卡片显示麦克风电平条。
- 聊天：历史消息 + 新消息 + notice 系统提示；发送输入框（Enter 发送，Shift+Enter 换行）；自动滚到底部；自己的消息右侧高亮。
- 断线重连：appStore.connection 为 reconnecting 时显示横幅；恢复后自动重建房间状态与 LiveKit 连接。
- 房间被删除/被踢/管理员移动房间：以 store 状态变化为准，Toast + 返回大厅或显示新房间。
- 移动端：聊天面板变为抽屉/底部浮层；成员网格自适应列数。

## 语音设置弹窗（SettingsModal）

- 输入/输出设备选择、主音量/每用户音量、耳聋、PTT 开关与按键、本地音质覆盖；
- 显示当前媒体传输方式：**服务端 SFU 中转（LiveKit）**，以及连接状态与连接质量（延迟/码率在数据可用时显示）；
- 网络页应显示「传输模式：服务端 SFU 中转」，不再提供 P2P/ICE/STUN/TURN 选项；当前 NetworkTab 若仍显示「ICE 服务器」「P2P 优先」等旧版文案，属于待清理的遗留 UI。

## 自测

- `npm run typecheck -w @airmic/web`
- `npm run build -w @airmic/web`
- 后端 `npm run dev` 可用时，`npm run dev` 打开 `http://localhost:5173` 手动验证（无需自动化浏览器）；
  语音验证需要本地或远端可访问的 LiveKit（`livekit-server --dev` 或 docker compose）。
- E2E：`npm run test:e2e`（需先 `npm run build`，本机 Chrome/Edge 与 LiveKit 可执行文件）。
- 不要修改其他 agent 的文件；完成后 send_message 向 Lead 汇报。
