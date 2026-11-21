# AirMic 架构与接口说明

AirMic 是一个 **纯 Web 的语音开黑平台**：用户打开网页即可进入房间进行实时语音，无需安装客户端。
应用服务端（Fastify）负责账号/房间/权限/聊天/状态同步与 **LiveKit 访问令牌签发**；
语音媒体由 **LiveKit SFU 在服务端中转**，浏览器只与 LiveKit 建立 WebRTC 连接，**不做客户端之间的 P2P/Mesh 直连**。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + zustand + react-router 7 + livekit-client |
| 后端 | Node.js (>=22.13) + Fastify 5 + @fastify/websocket + @fastify/cookie + livekit-server-sdk |
| 数据库 | SQLite（Node 内置 `node:sqlite`，无需编译原生模块，WAL 模式） |
| 实时语音 | **LiveKit SFU**（livekit-server）：浏览器 ⇄ 服务器 ⇄ 浏览器，全部音频经服务器转发 |
| 应用信令 | WebSocket（`/ws`），JSON 消息（房间/聊天/状态，不承载语音媒体） |
| 认证 | httpOnly Cookie 中的 JWT（HS256）+ 数据库会话表（可注销/封禁失效） |

## 目录结构

```text
AirMic/
├─ shared/                 # 前后端共享的契约（类型/协议/音质预设/媒体常量）
│  └─ src/
│     ├─ types.ts          # 领域类型（含 ServerSettingsPublic.voiceAvailable/mediaTransport）
│     ├─ protocol.ts       # WebSocket 消息类型（ClientMessage / ServerMessage）
│     ├─ api.ts            # REST 请求/响应 DTO（含 Setup* 与 LivekitTokenResponse）
│     ├─ media.ts          # SFU 媒体常量：MEDIA_TRANSPORT、airmic-r 房间名前缀、令牌 TTL、推荐人数
│     ├─ audio.ts          # 音质预设、参数合并、Opus SDP 工具
│     └─ permissions.ts    # 角色 -> 权限
├─ server/
│  ├─ src/
│  │  ├─ app.ts            # Fastify 应用组装
│  │  ├─ index.ts          # 启动入口
│  │  ├─ config.ts         # 环境变量 / .env（含 SETUP_TOKEN / LIVEKIT_*）
│  │  ├─ db.ts / schema.ts # SQLite 封装与表结构
│  │  ├─ lib/              # 密码、JWT、限流、校验、错误
│  │  ├─ services/         # 业务层：settings/users/rooms/bans/audit/auth
│  │  ├─ plugins/auth.ts   # 认证装饰器（requireAuth / requirePermission）
│  │  ├─ routes/
│  │  │  ├─ setup.ts       # 部署初始化：/api/setup/status、/api/setup/initialize
│  │  │  ├─ media.ts       # LiveKit 令牌：POST /api/rooms/:id/livekit-token
│  │  │  └─ ...            # auth/users/rooms/admin/server 等
│  │  └─ realtime/         # WebSocket 应用信令层（hub）
│  └─ tests/               # node:test 集成测试（含 setup/media 用例）
├─ web/                    # React 前端（含 pages/SetupPage.tsx 与 LiveKit voice 引擎）
├─ deploy/                 # livekit.yaml / livekit.service / nginx.conf / Caddyfile / airmic.service
└─ docker-compose.yml      # airmic + livekit 服务
```

## 常用命令

```bash
npm install                 # 安装依赖（workspaces）
npm run build -w @airmic/shared   # 修改 shared 后必须重新构建
npm run dev                 # 同时启动后端(9811)与前端(5173)
npm run typecheck           # 全仓库类型检查
npm run test                # 后端集成测试
npm run build               # 生产构建
npm start                   # 生产启动（需先 build）
```

开发环境前端通过 Vite 代理 `/api` 与 `/ws` 到 `http://127.0.0.1:9811`。
生产模式由 Fastify 直接托管 `web/dist`。语音媒体不经过 Vite/AirMic，而是由浏览器直连 LiveKit。

## 数据模型（SQLite）

- **users**：账号。`role` = admin | moderator | user | guest；游客为 `is_guest=1`、无密码；
  封禁状态冗余在 `is_banned / ban_reason / banned_until`。
- **sessions**：登录会话（`session_id` 同时写入 JWT 的 `sid`），注销/封禁时置 `revoked=1`。
- **rooms**：房间。可选密码（scrypt 哈希）、容量 `max_users`（0=继承服务器限制，SFU 模式下默认 100、可配置 1–500）、
  `locked`、`screen_share_enabled`、音频覆盖 `audio_override`（JSON，仅保存与服务器默认不同的字段）。
- **messages**：房间聊天记录（保留最近 N 条，N 由服务器设置控制）。
- **bans**：封禁记录，支持账号封禁与 IP 封禁、到期时间。
- **audit_log**：管理操作审计（初始化向导会写入 `setup_initialize`）。
- **settings**：键值对形式的服务器设置，包含 **LiveKit SFU 配置**（`livekitUrl` / `livekitApiKey` / `livekitApiSecret`）
  与派生的只读字段 `voiceAvailable` / `mediaTransport`（不写库，按配置实时计算）。

## 部署初始化流程（/api/setup/*）

首次部署（数据库中没有任何管理员）时，前端会把用户引导到 `/setup` 向导；HTTP 接口：

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | /api/setup/status | - | 是否需要初始化、是否需要 SETUP_TOKEN、当前公开服务器设置 |
| POST | /api/setup/initialize | -（初始化前） | 创建管理员、写入服务器设置、可选创建默认房间，并自动登录 |

`GET /api/setup/status` 返回：

```json
{
  "setupRequired": true,
  "requiresToken": true,
  "server": { "name": "...", "registrationMode": "open", "voiceAvailable": false, "mediaTransport": "sfu" }
}
```

`POST /api/setup/initialize` 请求要点：

- `token`：服务器设置了 `SETUP_TOKEN` 时必填（常量时间比较，错误返回 403 `setup_token_invalid`）。
- `admin`：管理员用户名/密码/昵称（用户名规则与普通注册一致）。
- `server`：可选，服务器名、MOTD、注册模式、游客开关、人数上限、默认音质、
  **LiveKit 配置**（`livekitUrl` / `livekitApiKey` / `livekitApiSecret`）。
- `createDefaultRooms`：默认 true；仅当当前没有任何房间时创建"开黑大厅 / 休息室"。

安全与约束：

- 仅当 `setupRequired=true` 时可用；已完成初始化返回 409 `setup_completed`。
- 进程内并发保护：同一时间只允许一个初始化请求（409 `setup_in_progress`）。
- IP 限流：10 次 / 10 分钟（超出返回 429）。
- 初始化成功后设置 httpOnly 登录 Cookie，返回 `{ user, server, rooms }`，并广播房间/在线列表/服务器设置。
- 兼容旧部署：仍支持 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 环境变量在启动时创建管理员（仅在无管理员时生效），此时 `/setup` 会显示已完成。

## LiveKit SFU 媒体架构

### 角色划分

- **浏览器**：通过 `livekit-client` 连接 LiveKit，发布自己的麦克风（及可选屏幕共享），订阅房间内其他人的音频。
- **LiveKit Server**：SFU，负责在服务端接收并转发音频轨道；**不混音、不转码**，服务器必须能同时被所有参与者访问。
- **AirMic 服务端**：不接触媒体。只负责房间成员关系、权限，并用 API Secret 为已加入房间的用户签发 LiveKit 访问令牌。

### 令牌签发流程

1. 用户通过 `/ws` 的 `join_room` 加入 AirMic 房间（服务端校验密码/容量/锁定等）。
2. 前端调用 `POST /api/rooms/:id/livekit-token`（需登录 Cookie）。
3. 服务端校验：
   - 语音服务已配置（`voiceAvailable`），否则 400 `voice_not_configured`；
   - 房间存在（404）；
   - 当前用户已通过 WebSocket 加入该房间，否则 403"请先加入房间"；
   - 每用户令牌限流 30 次/分钟。
4. 服务端用 `livekit-server-sdk` 的 `AccessToken` 签发令牌：
   - `identity` = 用户 ID；`name` = 昵称；`metadata` 含角色/头像/游客标识（供客户端渲染）；
   - `ttl` = `LIVEKIT_TOKEN_TTL_SECONDS`（默认 2 小时）；
   - 授权：`roomJoin: true`，`room = airmic-r{roomId}`，`canPublish: true`，`canSubscribe: true`，`canPublishData: false`。
5. 前端用 `{ url, token, room, identity }` 连接 LiveKit，并发布/订阅媒体。

### 配置项与优先级

- 设置项：`livekitUrl`、`livekitApiKey`、`livekitApiSecret`（仅管理员可见 Secret）。
- 优先级：**数据库中保存的值** > `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` 环境变量（仅作为从未配置时的默认值）。
  管理后台显式清空某项会写入空值，覆盖环境变量。
- `voiceAvailable = Boolean(livekitUrl && livekitApiKey && livekitApiSecret)`；公开接口（`/api/server`、`hello`、`server_settings`）只下发 `voiceAvailable` 与 `mediaTransport`，**不下发 SFU 地址与 Secret**（地址仅在入房后由 `/api/rooms/:id/livekit-token` 返回，管理后台仅管理员可见）。
- `mediaTransport` 固定为 `"sfu"`（`shared/src/media.ts` 的 `MEDIA_TRANSPORT`），含义是"全部媒体经服务端 SFU 中转，无 P2P"。
- 房间名为 `airmic-r{roomId}`（`livekitRoomName()`），与 AirMic 房间一一对应；房间销毁/重建不会复用令牌。

### 媒体流

- 音频：浏览器 `getUserMedia` 采集 → WebRTC 上传到 LiveKit（UDP 7882，失败回退 TCP 7881）→ LiveKit 转发给房间内其他订阅者。
- 屏幕共享：发布者为每个观看者转发一路视频（LiveKit SFU），同时只允许一个共享者（应用层 `screen_share` 状态互斥）。
- 无客户端 P2P：token 的 grants 中不包含任何 P2P/直连语义；浏览器之间不交换 SDP/ICE。
- 网络：浏览器到 LiveKit 使用 LiveKit 自己的 ICE/STUN/TURN；应用服务端原有的 `iceServers` / `forceRelay` 设置属于旧版 P2P 遗留字段，**对 LiveKit 语音不生效**（LiveKit 内置 TURN 的开关在 LiveKit 配置中）。

### 相关接口

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | /api/rooms/:id/livekit-token | 认证 + 已加入房间 | 签发 LiveKit 访问令牌，返回 `{ url, token, room, identity }` |
| GET | /api/server | - | 公开信息：含 `voiceAvailable`、`mediaTransport`（不含 SFU 地址） |
| GET | /api/admin/settings | manage_server | 管理员可见完整 LiveKit 配置（含 API Secret） |
| PATCH | /api/admin/settings | manage_server | 修改 LiveKit 配置（URL/Key/Secret），保存后广播 `server_settings` |

错误码示例：`voice_not_configured`（400）、`room_not_found`（404）、`forbidden`"请先加入房间"（403）、
`too_many_requests`（429）、`internal`（500，签名失败时）。

## 认证与权限

- 注册/登录/游客登录成功后写入 httpOnly Cookie `airmic_token`（JWT HS256，含会话 ID）。
- 每次 HTTP 请求（`plugins/auth.ts` 的 onRequest 钩子）解析 Cookie/Bearer 并校验会话；被封禁用户的会话立即失效。
- WebSocket 升级请求从 `Cookie` 头解析同一个 token；未认证连接直接关闭（4001/4003）。
- 权限点见 `shared/src/permissions.ts`：
  - 管理员：全部权限
  - 版主：管理房间、踢人、封禁、强制静音
  - 用户：可创建房间（需服务器开启）
  - 游客：默认无管理权限
- LiveKit 令牌只能由"已登录且已加入该房间"的用户获取；管理员也不能在未加入房间时替他人取令牌。

## REST API

认证 = 需要登录；权限 = 需要指定权限点。

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | /api/health | - | 健康检查 |
| GET | /api/server | - | 公开服务器信息（名称/MOTD/注册模式/音质默认值/LiveKit URL/voiceAvailable/mediaTransport/是否首次部署） |
| GET | /api/setup/status | - | 初始化状态（setupRequired / requiresToken / server） |
| POST | /api/setup/initialize | -（初始化前） | 完成初始化：管理员 + 服务器设置（含 LiveKit） + 默认房间 |
| GET | /api/rtc/ice | - | **旧版 P2P 遗留**：STUN/TURN 列表（SFU 语音不使用） |
| POST | /api/auth/register | - | 注册（受注册模式限制；首个用户兼容逻辑自动成为管理员） |
| POST | /api/auth/login | - | 登录 |
| POST | /api/auth/guest | - | 游客登录（需开启游客模式） |
| POST | /api/auth/logout | 可选 | 注销当前会话 |
| GET | /api/auth/me | 认证 | 当前用户（含 permissions、roomId） |
| PATCH | /api/users/me | 认证 | 修改昵称/头像色/表情/状态 |
| POST | /api/users/me/password | 认证 | 修改密码（注销其他会话） |
| GET | /api/rooms | 认证 | 房间列表（含实时人数） |
| GET | /api/room-directory | 认证 | 读取完整分区目录与当前用户的直接授权 |
| POST / PATCH / DELETE | /api/room-directory/areas[/:id] | 管理目标或上级分区 | 创建、编辑、删除分区；一级分区由服务器管理员创建、删除 |
| GET / POST / DELETE | /api/room-directory/:kind/:id/managers[/:userId] | 服务器管理员 | 查看、新增、撤销房间或分区的直接授权 |
| POST | /api/rooms | 认证+权限 | 创建房间 |
| GET | /api/rooms/:id/settings | 房间编辑权限 | 读取编辑所需的房间设置 |
| PATCH | /api/rooms/:id | 房间编辑权限 | 修改房间；移动时还需管理目标子区 |
| DELETE | /api/rooms/:id | 认证+权限 | 删除房间（会通知房间内用户） |
| POST | /api/rooms/:id/members/:userId/kick | 目标房间管理权限 | 将仍在该房间的成员移出房间 |
| GET | /api/rooms/:id/messages | 认证 | 历史消息（limit/beforeId） |
| POST | /api/rooms/:id/check-password | 认证 | 校验房间密码 |
| POST | /api/rooms/:id/livekit-token | 认证+已加入房间 | 获取 LiveKit 语音访问令牌 |
| GET | /api/admin/overview | manage_server | 仪表盘：统计/在线用户/最近审计 |
| GET/PATCH | /api/admin/settings | manage_server | 服务器设置（含 LiveKit、默认音质、注册码等） |
| GET | /api/admin/users | manage_users | 用户列表（搜索/分页，含在线状态） |
| PATCH | /api/admin/users/:id | manage_users | 修改昵称/角色/状态 |
| DELETE | /api/admin/users/:id | manage_users | 删除用户（不能删自己/最后一名管理员） |
| POST | /api/admin/users/:id/kick | kick_users | 踢出服务器或房间 |
| POST | /api/admin/users/:id/mute | moderate_voice | 强制静音/解除 |
| POST | /api/admin/users/:id/move | moderate_voice | 移动到指定房间/大厅 |
| GET | /api/admin/bans | ban_users | 封禁列表 |
| POST | /api/admin/bans | ban_users | 新增封禁（账号或 IP，可设置时长） |
| PATCH | /api/admin/bans/:id | ban_users | 解除封禁 |
| GET | /api/admin/audit | view_audit | 审计日志 |
| GET | /api/admin/sessions | manage_users | 有效登录会话 |
| GET | /api/admin/rooms | manage_server | 房间详情列表（含生效音质） |

错误响应统一为：`{ "error": { "code": "xxx", "message": "中文提示" } }`。

## WebSocket 协议（/ws）

消息类型定义见 `shared/src/protocol.ts`，全部为 JSON。连接建立后服务端发送 `hello`
（当前用户、服务器设置、房间列表、在线用户），之后按事件推送。WebSocket 只承载应用信令，
**不承载语音媒体，也不用于 WebRTC 信令转发**。

客户端 -> 服务端：

| t | 说明 |
| --- | --- |
| `join_room` {roomId, password?} | 加入房间（会先离开当前房间） |
| `leave_room` | 离开房间 |
| `chat` {content} | 发送房间文本消息 |
| `state` {state: {muted?, deafened?, speaking?, screenSharing?}} | 同步麦克风状态/说话状态 |
| `screen_share` {active} | 开始/停止屏幕共享（房间内同时只允许一人共享） |
| `ping` {ts?} | 心跳 |
| `request_rooms` / `request_online_users` | 请求快照 |
| `signal` {to, payload} | **旧版 P2P 遗留**，SFU 模式不再使用，客户端不应发送 |

服务端 -> 客户端：

| t | 说明 |
| --- | --- |
| `hello` | 连接初始化数据（含 voiceAvailable / mediaTransport） |
| `rooms` / `online_users` | 房间列表/在线用户变化 |
| `room_joined` {snapshot} | 加入成功：房间详情 + 成员 + 最近 50 条消息 + 当前共享者 |
| `room_left` | 已离开房间 |
| `peer_joined` / `peer_left` / `peer_updated` / `peer_state` | 房间成员变化与状态 |
| `chat_message` | 新消息 |
| `notice` | 系统提示（进出房间、被静音等） |
| `signal` {from, payload} | **旧版 P2P 遗留**，不再下发 |
| `room_updated` / `room_deleted` | 房间配置变化/被删除 |
| `server_settings` | 管理员修改服务器设置后广播（含 LiveKit 配置的公开字段） |
| `kicked` / `force_muted` / `session_ended` | 管理动作/会话失效 |
| `error` {code, message, request?} | 操作失败 |
| `pong` | 心跳响应 |

### 实时层职责（realtime/hub.ts）

- 连接认证（Cookie token）、心跳、单账号只保留最新连接（旧连接关闭 code 4001）。
- 维护在线客户端、房间成员、成员的麦克风/说话/共享状态。
- 校验入房条件：房间存在、未锁定、未超员、密码正确、服务器总人数上限。
- 聊天限流、长度校验、持久化并广播。
- 屏幕共享互斥：同一房间同时只允许一个共享者。
- 提供 `HubLike`（见 `realtime/contracts.ts`）给 REST 管理接口调用：踢人、强制静音、移动、
  刷新用户资料、广播房间/在线列表/服务器设置。
- 为令牌接口提供 `getRoomIdForUser()`：确保只有已加入房间的用户能换取 LiveKit 令牌。
- 连接关闭时清理房间成员并广播。

## 初始化 / 启动流程

1. **服务启动**：`loadConfig()` 读取环境变量与 `.env`（含 `SETUP_TOKEN`、`LIVEKIT_*`）；`createServices()` 打开数据库、
   加载/初始化设置（LiveKit 环境变量作为默认值）、创建 JWT 密钥、清理过期数据。
2. **首次部署**：数据库无管理员 → `setupRequired=true`；前端跳转 `/setup`，完成初始化后创建管理员并自动登录。
3. **日常启动**：`/api/server` 返回公开设置；`/ws` 建立连接后下发 `hello`；前端进入大厅。
4. **进入房间**：`join_room` → 获得房间快照 → 调用 `/api/rooms/:id/livekit-token` → 连接 LiveKit 并发布/订阅音频。

## 音质设计

`shared/src/audio.ts` 定义 4 个预设（省流语音 16k / 标准语音 32k / 高清语音 64k / 音乐 96k 立体声）
与自定义参数。生效优先级：

`服务器默认音质` <- `房间覆盖（audio_override）` <- `用户本机覆盖（设置页，可选）`

在 SFU 模式下的应用方式（前端 `web/src/voice/`）：

- `getUserMedia` 约束使用生效参数的回声消除/降噪/自动增益/采样率/声道。
- 麦克风轨道发布到 LiveKit 前设置 Opus 码率/立体声/DTX/FEC 等参数（如通过 SDP fmtp 与 `RTCRtpSender.setParameters`）；
  LiveKit 只转发 Opus，不转码，因此服务器带宽与客户端设置直接对应。
- 说话检测：本地 AudioContext 分析音量，节流后通过 WS `state.speaking` 广播用于 UI 高亮。
- 断线重连：WebSocket 指数退避重连；LiveKit 客户端断线后重新获取令牌并重新连接。

## Web 前端结构

```text
web/src/
├─ main.tsx / App.tsx     # 路由与全局装配（/setup、/login、大厅、房间、管理后台）
├─ pages/                 # AuthPage / LobbyPage / RoomPage / AdminPage / SetupPage
├─ components/
│  ├─ setup/              # 初始化向导：服务器信息 / 管理员 / 语音配置 / 确认
│  ├─ admin/              # 管理后台（含 LiveKit 语音中转配置）
│  ├─ room/ chat/ ...     # 房间成员、控制栏、聊天、设置
│  └─ ui/                 # 通用 UI 组件
├─ stores/                # zustand：auth / app / room / ui / settings
├─ lib/                   # api 客户端、ws 客户端、事件分发、格式化
└─ voice/                 # LiveKit 语音引擎（令牌、连接、发布/订阅、设备、PTT、统计、屏幕共享）
```

## 开发约定

- 界面文案使用中文；代码标识符/注释使用英文。
- 严格 TypeScript（`strict: true`），不使用 `any` 绕过检查（必要时用 `unknown` + 收窄）。
- 不新增第三方依赖（已有依赖足够），确需新增时先与 Lead 沟通。
- 修改 `shared/` 后执行 `npm run build -w @airmic/shared`，前后端才能看到新类型。
- 每个任务完成前至少运行：`npm run typecheck -w @airmic/server` 或 `-w @airmic/web`，以及相关测试。
