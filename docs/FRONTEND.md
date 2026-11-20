# AirMic 前端开发说明

前端为 React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + zustand + react-router 7 的单页应用，
界面语言为中文，风格是深色游戏语音风格（TeamSpeak / Discord 氛围）。

## 已提供的基础设施（由 Lead 编写，**只读**，不要修改）

| 路径 | 内容 |
| --- | --- |
| `src/App.tsx` | 路由：`/login`、`/`（AppLayout + LobbyPage）、`/room/:roomId`、`/admin`；全局弹窗/Toast；认证守卫 |
| `src/stores/auth.ts` | 当前用户、登录/注册/游客/退出 |
| `src/stores/app.ts` | 服务器设置、房间列表、在线用户、WS 连接状态 |
| `src/stores/room.ts` | 当前房间快照/成员/消息/加入与离开 |
| `src/stores/ui.ts` | Toast、全局弹窗（settings/profile）、确认框、移动端侧栏 |
| `src/stores/settings.ts` | 本地偏好（输入设备、PTT、音量、本地音质覆盖等，已持久化） |
| `src/lib/api.ts` | 全部 REST 接口封装（`api.auth / api.users / api.rooms / api.admin`） |
| `src/lib/ws.ts` | WebSocket 客户端：`socket.send / socket.on / socket.onStatus` |
| `src/lib/events.ts` | WS 事件到 store/语音引擎的完整分发（已实现，一般不需要改） |
| `src/components/ui/index.tsx` | 通用组件：Button/IconButton/Input/Textarea/Select/Switch/Slider/Avatar/Badge/Spinner/Modal/Tabs/ToastHost/ConfirmDialog/EmptyState/Kbd 等 |
| `src/voice/engine.ts` | 语音引擎接口与事件契约（frontend-room 负责实现） |
| `src/lib/format.ts` | cn/时间格式化/initials/颜色工具等 |

需要新的通用组件时，在自己的目录里创建，不要修改 `components/ui`。
如需修改 store/lib/App 路由结构或 shared 类型，先发消息给 Lead。

## 页面与组件归属

**frontend-core** 负责：
- `src/pages/AuthPage.tsx`、`src/pages/LobbyPage.tsx`、`src/pages/AdminPage.tsx`
- `src/components/layout/AppLayout.tsx`
- `src/components/lobby/**`、`src/components/admin/**`、`src/components/auth/**`、`src/components/profile/ProfileModal.tsx`

**frontend-room** 负责：
- `src/pages/RoomPage.tsx`
- `src/voice/engine.ts`（替换为完整实现）
- `src/components/room/**`、`src/components/chat/**`、`src/components/settings/SettingsModal.tsx`

## 设计规范

- 颜色 token（Tailwind 自定义）：`bg-ink-950/900/850/800/750/700`、`text-mist-100/200/300/400/500`、
  `brand-400/500/600`（靛蓝）、`aqua-400`（青色）、`good/warn/bad`。
- 面板：`rounded-2xl border border-white/5 bg-ink-850`；强调按钮用 brand 渐变。
- 图标统一使用 `lucide-react`。中文文案，必要时补充小号辅助文字。
- 桌面优先，同时保证 768px 以下可用（侧栏抽屉、聊天面板可折叠）。
- 交互反馈：按钮 loading、操作 Toast（`useUiStore.getState().toast(...)`）、危险操作二次确认（`confirm(...)`）。

## 页面功能要求

### 登录页（AuthPage）
- 左侧品牌区：AirMic logo/名称、服务器名、MOTD、在线人数、特性简介；右侧卡片。
- Tabs：登录 / 注册 / 游客。
  - 登录：用户名、密码（可切换可见）、提交。错误内联显示。
  - 注册：用户名（提示规则）、昵称、密码、确认密码；注册模式为 invite 时显示邀请码输入；
    registrationMode=closed 且非首用户时禁用注册并提示；`setupRequired=true` 时提示“第一个注册账号将成为管理员”。
  - 游客：昵称即可进入（guestEnabled=false 时隐藏/禁用并提示）。
- 成功后由 App 自动跳转大厅（本页在已登录时 Navigate 到 "/"）。
- 优雅的背景（`.bg-grid`、渐变光晕），移动端单列。

### 主布局（AppLayout）
- 顶栏：移动端菜单按钮、服务器名/连接状态（online/reconnecting/offline 小圆点）、右侧用户菜单
  （个人资料、语音设置、管理后台（有权限时）、退出登录）。
- 左侧栏：房间列表按分类分组，显示人数/上限、密码锁、锁定图标、当前房间高亮；
  有权限时显示“创建房间”按钮；底部在线用户列表（头像 + 状态 + 所在房间）；底部用户卡片（头像/昵称/角色 + 设置/退出）。
- 移动端：侧栏为抽屉（uiStore.sidebarOpen），遮罩点击关闭；内容区自适应。
- 进入管理后台的入口按权限显示（`user.permissions` 含 manage_server/manage_rooms/manage_users/view_audit/ban_users 任一）。

### 大厅页（LobbyPage）
- 欢迎区：服务器名/MOTD/统计（在线人数、房间数），快捷“创建房间”。
- 房间卡片网格：名称、简介、分类、人数/上限、锁/锁房/共享状态；点击进入房间；
  有密码时弹出密码输入框（`api.rooms.checkPassword` 可预校验或直接 `roomStore.joinRoom(id, password)`）；
  有权限时显示编辑按钮。加入后 `navigate("/room/"+id)`。
- 创建/编辑房间弹窗（前后台共用组件）：名称、简介、分类（服务器设置中的分类）、密码（设置/清除）、
  人数上限（0=继承服务器默认）、锁定、允许屏幕共享、音质参数编辑器（预设 + 自定义：码率/采样率/声道/DTX/FEC/回声消除/降噪/AGC），
  调用 `api.rooms.create/update`，成功后刷新 appStore 房间列表并 Toast。
- 无房间时显示引导（管理员可创建）。
- 可显示公告/MOTD 卡片。

### 管理后台（AdminPage）
- 独立全屏布局：左侧导航（概览、房间管理、用户管理、封禁管理、审计日志、服务器设置、登录会话），
  顶部“返回大厅”。
- 概览：统计卡片（用户数/在线/峰值/房间/消息/封禁）、在线用户表（踢出/静音/移动房间）、最近审计。
- 房间管理：表格/卡片列表，创建/编辑/删除（复用房间表单与音质编辑器），显示实时人数与生效音质。
- 用户管理：搜索、分页、角色修改（admin/moderator/user）、封禁（时长+原因）、踢出、强制静音、移动房间、删除（不可删自己/最后管理员）。
- 封禁管理：有效/全部列表，解封，新增封禁（用户搜索或 IP + 时长 + 原因）。
- 审计日志：分页 + action 过滤，显示操作者/目标/时间/IP/详情。
- 服务器设置：服务器名、MOTD、注册模式（开放/邀请码/关闭）与邀请码、游客开关与游客权限、
  人数/房间/消息上限、聊天开关、屏幕共享开关、默认音质编辑器、ICE 服务器列表编辑（STUN/TURN，支持用户名密码）、
  强制中继、房间分类管理。保存后 Toast；WS 会广播新设置。
- 登录会话：列表（用户、IP、UA、创建/过期时间）。
- 所有操作捕获 ApiError 显示 Toast；危险操作确认框。

### 个人资料弹窗（ProfileModal）
- 修改昵称、头像颜色（预设色板）、头像 emoji（常用表情选择 + 清除）、状态文本；
- 修改密码（当前密码/新密码/确认）；
- 显示账号信息（用户名、角色、注册时间、游客提示）；
- 保存后 `authStore.setUser` / `refreshUser` 并 Toast。

## 语音引擎契约（frontend-room）

`src/voice/engine.ts` 中已定义完整类型与事件。必须实现：
- `enter(snapshot)`：获取麦克风（`getUserMedia`，约束来自 `shared/src/audio.ts` 的 `audioConstraints` +
  房间生效音质 + `settingsStore.localAudioOverride`），为每个 peer 建立连接；
- `addPeer/removePeer/handleSignal`：WebRTC Mesh + perfect negotiation（避免 glare），trickle ICE；
- SDP 使用 `applyOpusToSdp` 修饰 opus fmtp；`RTCRtpSender.setParameters` 设置 maxBitrate；
- 每 2 秒 `getStats` 计算 RTT/丢包/抖动/收发码率并通过 `peer-stats` 事件输出；
- 本地音量分析（AudioContext AnalyserNode）→ `local-level` 事件（约 10 次/秒，含 speaking 判定）；
- 远端音频播放（AudioContext + GainNode 支持每用户音量、耳聋静音），`peer-stream` 事件提供 MediaStream；
- 屏幕共享：`getDisplayMedia`，预置 video transceiver 上 `replaceTrack`；接收方 `screen-stream` 事件；
- `applyForceMute`、`setMicEnabled`、`setDeafened`、`setPTTActive`、`applyAudioSettings`、`switchInputDevice`、
  `resumeAudio`、`setPeerVolume`、`leave`、`destroy`；
- 权限被拒绝/无设备时通过 `error` 事件提示，但仍可收听（receive-only）；
- 浏览器自动播放被拦截时置 `audioBlocked=true`（state 事件），页面提供“点击启用声音”。

`src/lib/events.ts` 已负责把 WS 事件接到引擎（enter/addPeer/removePeer/handleSignal/applyAudioSettings/
applyForceMute/leave），房间页面不要再重复调用这些生命周期方法。

## 房间页（RoomPage）功能要求

- 进入时若无快照或房间 id 不匹配则 `roomStore.joinRoom(roomId)`（密码房间从大厅传入密码后进入；
  直接 URL 进入无密码时展示 joinError 与重试/返回大厅）。加入中显示 loading，失败显示错误卡片。
- 页面结构：顶部房间信息栏（名称、简介、分类、人数、音质摘要、密码/锁图标、返回/离开）；
  中间舞台（成员网格 / 屏幕共享大画面 / 空位提示）；右侧聊天面板（可折叠）；
  底部控制栏（麦克风、耳聋、屏幕共享、语音设置、离开；连接状态与延迟/码率提示）。
- 成员卡片：头像（说话高亮）、昵称、角色徽章、静音/耳聋/强制静音图标、连接质量（语音引擎 peer-stats）、
  点击展开音量滑块（本地音量，settingsStore + engine.setPeerVolume）与“本地静音”。
  自己卡片显示麦克风电平条。
- 说话状态：`local-level` 事件驱动自己的电平；说话状态变化时通过 `socket.send({t:"state",state:{speaking}})` 节流上报（≤5 次/秒）。
- 麦克风/耳聋/屏幕共享操作后同步 `socket.send({t:"state", ...})`；屏幕共享开始失败（被占用/服务器禁用）显示 Toast。
- PTT：settingsStore.pttEnabled 时按住绑定键说话（输入框聚焦时忽略），显示“[按键] 说话中”提示。
- 聊天：历史消息 + 新消息 + notice 系统提示；发送输入框（Enter 发送，Shift+Enter 换行）；自动滚到底部；自己的消息右侧高亮。
- 断线重连：appStore.connection 为 reconnecting 时显示横幅；恢复后（events 自动重连房间）自动重建语音。
- 房间被删除/被踢/管理员移动房间：以 store 状态变化为准，Toast + 返回大厅或显示新房间。
- 移动端：聊天面板变为抽屉/底部浮层；成员网格自适应列数。

## 自测

- `npm run typecheck -w @airmic/web`
- `npm run build -w @airmic/web`
- 后端 `npm run dev` 可用时，`npm run dev` 打开 http://localhost:5173 手动验证（无需自动化浏览器）。
- 不要修改其他 agent 的文件；完成后 send_message 向 Lead 汇报。
