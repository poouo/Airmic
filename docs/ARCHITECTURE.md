# AirMic 架构与接口说明

AirMic 是一个 **纯 Web 的语音开黑平台**：用户打开网页即可进入房间进行实时语音，无需安装客户端。
服务端只负责账号/房间/权限/信令与状态同步，媒体流走浏览器之间的 WebRTC P2P（Mesh）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + zustand + react-router 7 |
| 后端 | Node.js (>=22.13) + Fastify 5 + @fastify/websocket + @fastify/cookie |
| 数据库 | SQLite（Node 内置 `node:sqlite`，无需编译原生模块） |
| 实时语音 | WebRTC Mesh（每人与房间内其他人建立一条 PeerConnection） |
| 认证 | httpOnly Cookie 中的 JWT + 数据库会话表（可注销/封禁失效） |

## 目录结构

```
AirMic/
├─ shared/                 # 前后端共享的契约（类型/协议/音质预设/SDP 工具）
│  └─ src/
│     ├─ types.ts          # 领域类型：用户、房间、消息、音频参数、封禁...
│     ├─ protocol.ts       # WebSocket 消息类型（ClientMessage / ServerMessage）
│     ├─ api.ts            # REST 请求/响应 DTO
│     ├─ audio.ts          # 音质预设、参数合并、Opus SDP 修饰
│     └─ permissions.ts    # 角色 -> 权限
├─ server/
│  ├─ src/
│  │  ├─ app.ts            # Fastify 应用组装
│  │  ├─ index.ts          # 启动入口
│  │  ├─ config.ts         # 环境变量 / .env
│  │  ├─ db.ts / schema.ts # SQLite 封装与表结构
│  │  ├─ lib/              # 密码、JWT、限流、校验、错误
│  │  ├─ services/         # 业务层：settings/users/rooms/bans/audit/auth
│  │  ├─ plugins/auth.ts   # 认证装饰器（requireAuth / requirePermission）
│  │  ├─ routes/           # REST 路由
│  │  └─ realtime/         # WebSocket 信令层（hub）
│  └─ tests/               # node:test 集成测试
└─ web/                    # React 前端
```

## 常用命令

```bash
npm install                 # 安装依赖（workspaces）
npm run build -w @airmic/shared   # 修改 shared 后必须重新构建
npm run dev                 # 同时启动后端(3000)与前端(5173)
npm run typecheck           # 全仓库类型检查
npm run test                # 后端集成测试
npm run build               # 生产构建
npm start                   # 生产启动（需先 build）
```

开发环境前端通过 Vite 代理 `/api` 与 `/ws` 到 `http://127.0.0.1:3000`。
生产模式由 Fastify 直接托管 `web/dist`。

## 数据模型（SQLite）

- **users**：账号。`role` = admin | moderator | user | guest；游客为 `is_guest=1`、无密码；
  封禁状态冗余在 `is_banned / ban_reason / banned_until`。
- **sessions**：登录会话（`session_id` 同时写入 JWT 的 `sid`），注销/封禁时置 `revoked=1`。
- **rooms**：房间。可选密码（scrypt 哈希）、容量 `max_users`（0=继承服务器限制）、
  `locked`、`screen_share_enabled`、音频覆盖 `audio_override`（JSON，仅保存与服务器默认不同的字段）。
- **messages**：房间聊天记录（保留最近 N 条，N 由服务器设置控制）。
- **bans**：封禁记录，支持账号封禁与 IP 封禁、到期时间。
- **audit_log**：管理操作审计。
- **settings**：键值对形式的服务器设置（`services/settings.ts` 中有完整默认值与校验）。

## 认证与权限

- 注册/登录/游客登录成功后写入 httpOnly Cookie `airmic_token`（JWT HS256，含会话 ID）。
- 每次 HTTP 请求（`plugins/auth.ts` 的 onRequest 钩子）解析 Cookie/Bearer 并校验会话；
  被封禁用户的会话立即失效。
- WebSocket 升级请求从 `Cookie` 头解析同一个 token；未认证连接直接关闭（4001/4003）。
- 权限点见 `shared/src/permissions.ts`：
  - 管理员：全部权限
  - 版主：管理房间、踢人、封禁、强制静音
  - 用户：可创建房间（需服务器开启）
  - 游客：默认无管理权限

## REST API

认证 = 需要登录；权限 = 需要指定权限点。

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | /api/health | - | 健康检查 |
| GET | /api/server | - | 公开服务器信息（服务器名/MOTD/注册模式/音质默认值/ICE 配置/是否首次部署） |
| GET | /api/rtc/ice | - | STUN/TURN 配置 |
| POST | /api/auth/register | - | 注册（受注册模式限制；首个用户自动成为管理员） |
| POST | /api/auth/login | - | 登录 |
| POST | /api/auth/guest | - | 游客登录（需开启游客模式） |
| POST | /api/auth/logout | 可选 | 注销当前会话 |
| GET | /api/auth/me | 认证 | 当前用户（含 permissions、roomId） |
| PATCH | /api/users/me | 认证 | 修改昵称/头像色/表情/状态 |
| POST | /api/users/me/password | 认证 | 修改密码（注销其他会话） |
| GET | /api/rooms | 认证 | 房间列表（含实时人数） |
| POST | /api/rooms | 认证+权限 | 创建房间 |
| PATCH | /api/rooms/:id | 认证+权限 | 修改房间（管理房间权限或房间创建者） |
| DELETE | /api/rooms/:id | 认证+权限 | 删除房间（会通知房间内用户） |
| GET | /api/rooms/:id/messages | 认证 | 历史消息（limit/beforeId） |
| POST | /api/rooms/:id/check-password | 认证 | 校验房间密码 |
| GET | /api/admin/overview | manage_server | 仪表盘：统计/在线用户/最近审计 |
| GET/PATCH | /api/admin/settings | manage_server | 服务器设置（含 ICE/TURN、默认音质、注册码等） |
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
（当前用户、服务器设置、房间列表、在线用户），之后按事件推送。

客户端 -> 服务端：

| t | 说明 |
| --- | --- |
| `join_room` {roomId, password?} | 加入房间（会先离开当前房间） |
| `leave_room` | 离开房间 |
| `chat` {content} | 发送房间文本消息 |
| `state` {state: {muted?, deafened?, speaking?, screenSharing?}} | 同步麦克风状态/说话状态 |
| `signal` {to, payload} | WebRTC 信令：offer/answer/candidate 转发给同房间用户 |
| `screen_share` {active} | 开始/停止屏幕共享（房间内同时只允许一人共享） |
| `ping` {ts?} | 心跳 |
| `request_rooms` / `request_online_users` | 请求快照 |

服务端 -> 客户端：

| t | 说明 |
| --- | --- |
| `hello` | 连接初始化数据 |
| `rooms` / `online_users` | 房间列表/在线用户变化 |
| `room_joined` {snapshot} | 加入成功：房间详情 + 成员 + 最近 50 条消息 + 当前共享者 |
| `room_left` | 已离开房间 |
| `peer_joined` / `peer_left` / `peer_updated` / `peer_state` | 房间成员变化与状态 |
| `chat_message` | 新消息 |
| `notice` | 系统提示（进出房间、被静音等） |
| `signal` {from, payload} | 转发的 WebRTC 信令 |
| `room_updated` / `room_deleted` | 房间配置变化/被删除 |
| `server_settings` | 管理员修改服务器设置后广播 |
| `kicked` / `force_muted` / `session_ended` | 管理动作/会话失效 |
| `error` {code, message, request?} | 操作失败 |
| `pong` | 心跳响应 |

### 实时层职责（realtime/hub.ts）

- 连接认证（Cookie token）、心跳、单账号只保留最新连接（旧连接关闭 code 4001）。
- 维护在线客户端、房间成员、成员的麦克风/说话/共享状态。
- 校验入房条件：房间存在、未锁定、未超员、密码正确、服务器总人数上限。
- 聊天限流、长度校验、持久化并广播。
- WebRTC 信令只转发给同房间的用户，并校验消息大小/频率。
- 提供 `HubLike`（见 `realtime/contracts.ts`）给 REST 管理接口调用：踢人、强制静音、移动、
  刷新用户资料、广播房间/在线列表/服务器设置。
- 连接关闭时清理房间成员并广播。

## 音质设计

`shared/src/audio.ts` 定义 4 个预设（省流语音 16k / 标准语音 32k / 高清语音 64k / 音乐 96k 立体声）
与自定义参数。生效优先级：

`服务器默认音质` <- `房间覆盖（audio_override）` <- `用户本机覆盖（设置页，可选）`

应用方式（前端 `voice/`）：
- `getUserMedia` 约束使用房间参数的回声消除/降噪/自动增益/采样率/声道。
- Opus 编码参数通过修改 SDP 的 `a=fmtp`（maxaveragebitrate/stereo/useinbandfec/usedtx）实现。
- 码率还可通过 `RTCRtpSender.setParameters({encodings:[{maxBitrate}]})` 实时调整。
- 立体声/DTX 等 fmtp 变化需要重新协商（perfect negotiation），码率变化可即时生效。

## 语音连接（Mesh）

- 新加入者向房间内每个已有成员发起 offer（自己 `polite=false`），已有成员应答。
- 每对连接预先添加 audio 与 video 两个 transceiver（video 用于屏幕共享，平时 replaceTrack(null)），
  避免屏幕共享时重新协商。
- 说话检测：本地 AudioContext 分析音量，节流后通过 `state.speaking` 广播用于 UI 高亮。
- 断线重连：WebSocket 指数退避重连，重连后重新加入原房间并重建 PeerConnection。
- 服务器只转发信令，不承载媒体；局域网可直连，公网需配置 STUN/TURN（管理后台可编辑）。

## Web 前端结构

```
web/src/
├─ main.tsx / App.tsx     # 路由与全局装配
├─ styles.css             # Tailwind + 主题变量
├─ lib/                   # api 客户端、ws 客户端、事件分发、格式化
├─ stores/                # zustand：auth / app / room / ui / settings
├─ components/ui/         # 通用 UI 组件
├─ components/...         # 布局/大厅/房间/设置/管理后台组件
├─ pages/                 # 登录、大厅、房间、管理后台
└─ voice/                 # WebRTC 语音引擎
```

## 开发约定

- 界面文案使用中文；代码标识符/注释使用英文。
- 严格 TypeScript（`strict: true`），不使用 `any` 绕过检查（必要时用 `unknown` + 收窄）。
- 不新增第三方依赖（已有依赖足够），确需新增时先与 Lead 沟通。
- 修改 `shared/` 后执行 `npm run build -w @airmic/shared`，前后端才能看到新类型。
- 每个任务完成前至少运行：`npm run typecheck -w @airmic/server` 或 `-w @airmic/web`，
  以及相关测试。
