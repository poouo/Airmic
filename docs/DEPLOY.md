# AirMic 生产部署指南

面向运维/开发者的可操作部署文档。AirMic 的语音由 **LiveKit SFU** 在服务端中转，因此生产环境必须同时部署：

1. **AirMic**：账号、房间、权限、聊天、管理后台与 LiveKit 访问令牌签发（Node.js + SQLite）；
2. **LiveKit Server**：语音媒体服务器（浏览器只与它建立 WebRTC 连接，音频经服务器转发，不做 P2P）。

> 本地开发和快速试用请看 [README](../README.md) 的"快速开始"；架构与接口见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 0. 部署前检查清单

- [ ] 服务器安装 **Node.js ≥ 22.13（推荐 24 LTS）**，或可用的 Docker / Docker Compose v2。
- [ ] 公网访问准备域名并解析：AirMic 用一个域名（如 `airmic.example.com`），LiveKit 再用一个域名（如 `livekit.example.com`）。
- [ ] 放行端口：AirMic 的 **9811**（仅本机/内网）；反向代理 **80/443**；LiveKit 的 **7880/tcp、7881/tcp、7882/udp**；如启用内置 TURN 再放行 **3478/udp、5349/tcp**。
- [ ] 决定部署方式：**Docker Compose（推荐，一条命令同时拉起 AirMic + LiveKit）** 或裸机 systemd + LiveKit 二进制。
- [ ] 生成并保存 LiveKit 的 API Key/Secret（**不要用默认 devkey/secret**），AirMic 与 LiveKit 两侧必须一致。
- [ ] 设置 `SETUP_TOKEN`（推荐），防止部署后被他人抢先完成初始化。
- [ ] 备份策略：`data/airmic.db`、`.env`、`deploy/livekit.yaml` 必须定期备份。
- [ ] 安全：LiveKit 媒体端口尽量只开放必要范围；以非 root 用户运行；管理员使用强密码。

> 应用层（AirMic）的实时状态保存在进程内存中，**不要多个 AirMic 实例共用一个 SQLite 数据库**。LiveKit 可以独立扩展，但本文按单节点部署描述。

## 1. 通用准备

### 1.1 获取代码与目录约定

本文以 `/opt/airmic` 作为 AirMic 部署目录、`airmic` 作为运行用户；LiveKit 二进制部署目录为 `/opt/livekit`、运行用户 `livekit`。

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin airmic
sudo useradd --system --create-home --shell /usr/sbin/nologin livekit
sudo mkdir -p /opt/airmic /opt/livekit
sudo chown -R airmic:airmic /opt/airmic
sudo chown -R livekit:livekit /opt/livekit
# 将代码放到 /opt/airmic（git clone / scp / rsync 均可）
```

也可以使用任意目录，只需同步修改下文 systemd 单元中的路径。

### 1.2 生产环境 .env 示例

```bash
cd /opt/airmic
cp .env.example .env
chmod 600 .env
```

最小生产配置（反向代理 + LiveKit）：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=9811
DATABASE_PATH=./data/airmic.db
JWT_SECRET=请替换为至少 32 字节的随机字符串
SETUP_TOKEN=请替换为一次性初始化口令
TRUST_PROXY=true
USER_SESSION_TTL_DAYS=30
GUEST_SESSION_TTL_HOURS=24
LOG_LEVEL=info
# 管理后台运行日志（SQLite app_logs）保留天数，1-30，默认 3
LOG_RETENTION_DAYS=3
# 可选：检查 GitHub 更新/下载源码时提高 API 限额
# GITHUB_TOKEN=

# LiveKit SFU（浏览器可访问的信令地址；生产必须是 wss）
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=替换为与 deploy/livekit.yaml 一致的 API Key
LIVEKIT_API_SECRET=替换为与 deploy/livekit.yaml 一致的 API Secret
```

生成随机密钥：

```bash
# JWT_SECRET
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# LiveKit API Secret（任选一种）
openssl rand -hex 32
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# SETUP_TOKEN
node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))"
```

> `.env` 只能放在**项目根目录**（不是 `server/.env`）。已在系统环境变量中设置的同名变量优先。
> LiveKit 配置也可以不写在 `.env`：初始化向导/管理后台保存到数据库的值优先，`.env` 中的 `LIVEKIT_*` 只是"从未配置时"的兜底默认值。
> 部署在 Nginx/Caddy 等可信反向代理之后才设置 `TRUST_PROXY=true`，否则客户端 IP 可被伪造。

### 1.3 部署顺序（重要）

```text
1. 启动 LiveKit（Docker Compose 会自动启动；裸机见第 2 节）
2. 启动 AirMic（Docker Compose 会自动启动；裸机见第 3 节）
3. 浏览器访问 https://airmic.example.com/setup 完成初始化向导
   （创建管理员、服务器信息、填写 LiveKit URL / API Key / Secret、默认房间）
4. 初始化完成后自动登录进入大厅，部署完成
```

首次启动第一次访问会跳转 `/setup`；如果 `.env` 中已经配置了 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（旧兼容方式），服务器启动时就会创建管理员，`/setup` 会显示"已完成初始化"。

### 1.4 一键部署 CLI（推荐）

仓库提供零依赖部署 CLI，可一条命令完成“复制源码 → 构建 → 生成配置 → 下载并启动 LiveKit → 健康检查”，并支持状态、日志、在线检查更新、OTA 升级/回滚、卸载。完整说明见第 12 节“一键部署 CLI、OTA 升级与卸载”。

```bash
# Linux / macOS：本地部署
./deploy/install-local.sh --yes

# Windows PowerShell：本地部署
.\deploy\install-local.ps1 --yes

# Docker 部署（AirMic + LiveKit）
./deploy/install-docker.sh --yes
.\deploy\install-docker.ps1 --yes
```

安装目录默认 Windows `%USERPROFILE%\.airmic`、Linux/macOS `~/.airmic`，可用 `--dir` 或环境变量 `AIRMIC_HOME` 修改；安装后访问 `http://<主机>:9811/setup` 完成初始化。

## 2. LiveKit SFU 部署与网络

### 2.1 方式一：Docker Compose（推荐）

仓库根目录的 [docker-compose.yml](../docker-compose.yml) 已把 LiveKit 作为**必需服务**与 AirMic 一起编排：

- 镜像：`livekit/livekit-server`，默认标签 `v1.13.11`（可用环境变量 `LIVEKIT_VERSION` 覆盖）；
- 配置：挂载 [deploy/livekit.yaml](../deploy/livekit.yaml) 到容器内 `/etc/livekit.yaml`；
- 端口：`7880/tcp`（HTTP/WebSocket 信令）、`7881/tcp`（RTC over TCP）、`7882/udp`（RTC UDP mux）；
- 密钥：来自 `deploy/livekit.yaml` 的 `keys`；AirMic 通过 `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` 使用同一组密钥。

```bash
cd /opt/airmic
cp .env.example .env
# 修改 .env：LIVEKIT_URL、LIVEKIT_API_KEY、LIVEKIT_API_SECRET、JWT_SECRET、SETUP_TOKEN
# 修改 deploy/livekit.yaml：keys、rtc.use_external_ip
docker compose up -d --build
docker compose ps
docker compose logs -f livekit airmic
```

> **Docker 与网络：** 生产环境建议给 livekit 服务使用 host 网络（在 docker-compose.yml 中取消 `network_mode: host` 注释并删除 ports），避免 Docker NAT 导致 ICE/媒体端口问题。使用桥接网络时，必须在 `deploy/livekit.yaml` 中设置 `rtc.use_external_ip: true` 或显式 `rtc.node_ip`，并确保 7881/7882 端口映射生效。

### 2.2 方式二：LiveKit 二进制（Linux / Windows）

从 GitHub Releases 下载对应平台压缩包：<https://github.com/livekit/livekit-server/releases>

| 平台 | 资产示例 |
| --- | --- |
| Linux x86_64 | `livekit-server_<version>_linux_amd64.tar.gz` |
| Linux arm64 | `livekit-server_<version>_linux_arm64.tar.gz` |
| Windows x86_64 | `livekit-server_<version>_windows_amd64.zip` |

**Linux（systemd）：**

```bash
# 1) 解压二进制
tar -xzf livekit-server_*_linux_amd64.tar.gz
sudo cp livekit-server /opt/livekit/
sudo chown livekit:livekit /opt/livekit/livekit-server

# 2) 配置
sudo cp deploy/livekit.yaml /opt/livekit/livekit.yaml
sudo vi /opt/livekit/livekit.yaml        # 修改 keys / use_external_ip
sudo chown livekit:livekit /opt/livekit/livekit.yaml

# 3) systemd 单元（仓库已提供 deploy/livekit.service）
sudo cp deploy/livekit.service /etc/systemd/system/livekit.service
sudo systemctl daemon-reload
sudo systemctl enable --now livekit
sudo systemctl status livekit
journalctl -u livekit -f
```

**Windows：**

```powershell
# 解压后进入目录
.\livekit-server.exe --config .\deploy\livekit.yaml
# 本地开发可临时使用开发模式（固定 devkey/secret）
.\livekit-server.exe --dev
```

### 2.3 生成并配置 API 密钥

LiveKit 使用 API Key/Secret 对访问令牌签名。**AirMic 与 LiveKit 必须使用同一组值**：

1. 生成随机 Secret：`openssl rand -hex 32`（Windows 可用 Git 自带的 OpenSSL，或 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`）。
2. 编辑 `deploy/livekit.yaml`：

```yaml
keys:
  # API Key: API Secret
  airmic_prod_2026: 替换为上面生成的 64 位十六进制 Secret
```

3. 把同一组值填到 AirMic：`.env` 的 `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`，或在初始化向导/管理后台"语音中转（LiveKit）"中填写。
4. 重启 LiveKit 与 AirMic 后验证 `/api/server` 返回的 `voiceAvailable` 为 `true`。

> 默认的 `devkey: secret` 仅供本地开发；**部署到公网前必须更换**，否则任何人都可以伪造令牌加入你的语音房间。

### 2.4 use_external_ip 与 NAT

`deploy/livekit.yaml` 中的 `rtc` 配置决定 LiveKit 向客户端公布的媒体地址：

```yaml
rtc:
  tcp_port: 7881
  udp_port: 7882
  # 云主机 / 1:1 NAT / 公网直连：true（通过 STUN 探测公网 IP）
  use_external_ip: true
  # 多网卡 / Docker 桥接 / 探测不准时显式指定对外 IP
  # node_ip: 203.0.113.10
```

- **纯局域网/单机开发**：`use_external_ip: false` 即可。
- **云服务器（有公网 IP 或 1:1 NAT）**：`use_external_ip: true`。
- **Docker 桥接网络且无法使用 host 网络**：设置 `node_ip` 为宿主机公网/局域网 IP，并正确映射 7881/tcp、7882/udp。

### 2.5 防火墙与云安全组

```bash
# UFW 示例
sudo ufw allow 7880/tcp      # LiveKit 信令（HTTP/WS；对外通常经 443 反代，可不直接暴露）
sudo ufw allow 7881/tcp      # RTC over TCP
sudo ufw allow 7882/udp      # RTC UDP mux（媒体主通道）
# 可选：内置 TURN
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw reload
```

| 端口 | 协议 | 用途 | 建议暴露 |
| --- | --- | --- | --- |
| 7880 | TCP | LiveKit HTTP / WebSocket 信令 | 仅本机（实际由 443 wss 反代） |
| 7881 | TCP | WebRTC over TCP（UDP 被封时回退） | 公网 |
| 7882 | UDP | WebRTC UDP mux（媒体主通道） | 公网 |
| 3478 | UDP | LiveKit 内置 TURN（可选） | 需要 TURN 时公网 |
| 5349 | TCP | LiveKit 内置 TURN over TLS（可选） | 需要 TURN 时公网 |

> 只放行 7880 是常见错误：信令能连上、但媒体走 7881/7882，结果"能进房间但没声音"。

### 2.6 wss 反向代理（livekit.example.com）

公网推荐用 Nginx/Caddy 为 LiveKit 提供 `wss://`（HTTPS 页面不能连接 `ws://`）。完整示例见 [deploy/nginx.conf](../deploy/nginx.conf) 与 [deploy/Caddyfile](../deploy/Caddyfile)：

**Nginx（关键片段）：**

```nginx
server {
    listen 443 ssl http2;
    server_name livekit.example.com;

    ssl_certificate     /etc/letsencrypt/live/livekit.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
```

**Caddy：**

```caddyfile
livekit.example.com {
    reverse_proxy 127.0.0.1:7880
}
```

然后把 `LIVEKIT_URL` 设置为 `wss://livekit.example.com`（初始化向导/管理后台或 `.env`）。

- DNS：`livekit.example.com` 解析到服务器；证书可用 certbot 单独申请（`certbot --nginx -d livekit.example.com`）或复用已有证书。
- **UDP/TCP 媒体端口不经过反代**：浏览器拿到 `wss` 信令后，会直接连接 7881/7882，因此这两个端口必须由防火墙直达。
- Docker 部署时 `proxy_pass` 指向 `http://127.0.0.1:7880`（端口已映射到宿主机）或容器名 `http://livekit:7880`（Nginx 也在同一 Compose 网络时）。

### 2.7 验证语音服务

```bash
# 1) 信令 HTTP 可达（返回 LiveKit 欢迎页/健康响应）
curl -fsS http://127.0.0.1:7880/ | head
# 2) wss 域名可达（证书有效）
curl -fsS https://livekit.example.com/ | head
# 3) AirMic 认为语音可用
curl -fsS https://airmic.example.com/api/server | grep -o '"voiceAvailable":[a-z]*'
# 4) 真实通话验证
#    浏览器打开 AirMic → 初始化向导/管理后台确认 LiveKit 配置 → 两个账号进入同一房间 → 说话
```

浏览器侧排障：DevTools → Network → WS 看 `wss://livekit.example.com` 是否连接成功；Console/Network 中会有 LiveKit 信令与 ICE 日志。LiveKit 日志（`journalctl -u livekit -f` / `docker compose logs -f livekit`）应出现 participant joined / track published。

### 2.8 容量与带宽估算

SFU 不做混音：每个成员的声音要分别转发给房间内其他 `N-1` 人。按每路约 40 kbps（32 kbps Opus + RTP/WebRTC 开销）估算：

| 房间人数 N | 每人下行 | LiveKit 出向带宽（近似） | 建议配置 |
| --- | --- | --- | --- |
| 10 | ~0.36 Mbps | ~3.6 Mbps | 任意 2 核小机器 |
| 25 | ~0.96 Mbps | ~24 Mbps | 2 vCPU / 2–4 GB |
| 50 | ~1.96 Mbps | ~98 Mbps | 4 vCPU / 4–8 GB，1 Gbps 网卡 |
| 100 | ~3.96 Mbps | ~396 Mbps | 4–8 vCPU / 8–16 GB，1 Gbps 网卡 |

- 公式：`服务器出向 ≈ N × (N-1) × 40 kbps`；音质预设 64/96 kbps 时按比例增加。
- 屏幕共享会给每个观看者增加约 1–2.5 Mbps 出向，务必按实际共享人数预留带宽。
- 以上只算单房间；多房间同时使用时相加。1 Gbps 网卡建议把总出向控制在 700–800 Mbps 以内。
- LiveKit 只转发不转码，CPU 压力主要来自加解密与转发；带宽通常是瓶颈。上线前用真实人数与音质压测。

### 2.9 内置 TURN（NAT/防火墙复杂时）

如果部分用户所在网络禁止 UDP（且 TCP 回退也不稳定），可以启用 LiveKit 内置 TURN。它需要：

- 一个解析到本机的域名（如 `turn.example.com`）；
- TLS 证书（可与 wss 使用同一张）；
- 防火墙放行 `3478/udp` 与 `5349/tcp`。

在 `deploy/livekit.yaml` 中取消注释并配置：

```yaml
turn:
  enabled: true
  domain: turn.example.com
  tls_port: 5349
  udp_port: 3478
  cert_file: /etc/letsencrypt/live/turn.example.com/fullchain.pem
  key_file: /etc/letsencrypt/live/turn.example.com/privkey.pem
```

客户端无需额外配置：LiveKit 会在加入房间的响应中下发 ICE/TURN 配置，浏览器自动尝试 TURN 中继。改完重启 LiveKit。

### 2.10 LiveKit 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| AirMic 返回 `voice_not_configured`（HTTP 400） | 服务器未配置 LiveKit（URL/Key/Secret 不齐全） | 初始化向导/管理后台补配，或在 `.env` 设置 `LIVEKIT_*` 后重启 |
| 令牌接口 403"请先加入房间" | 前端还没通过 `/ws` 加入房间就请求令牌 | 先加入房间（或刷新页面）；检查 WebSocket 是否正常 |
| 令牌接口 401 | 未登录/会话失效 | 重新登录 |
| 浏览器连不上 `wss` | 证书错误、DNS 未解析、反代未配置 Upgrade | 用 `curl` 验证；检查 Nginx `proxy_set_header Upgrade` 与 `proxy_read_timeout` |
| 能连上但没有声音 | 7882/udp 或 7881/tcp 未放行；NAT 地址错误 | 放行端口；设置 `use_external_ip` 或 `node_ip`；必要时启用内置 TURN |
| 只有部分用户没声音 | 该用户网络禁 UDP | 检查其浏览器 Console；启用内置 TURN |
| LiveKit 容器启动失败 | `livekit.yaml` 语法/密钥错误 | `docker compose logs livekit`；检查 YAML 缩进与 `keys` |
| 媒体卡顿/丢包 | 服务器带宽不足、UDP 丢包 | 降低音质预设；扩容带宽；把 LiveKit 拆到独立机器 |

## 3. 方式 A：AirMic 裸机 + systemd

### 3.1 安装 Node.js 24 LTS

```bash
# Debian / Ubuntu（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

注意：**systemd 不会加载 shell 的 PATH**，systemd 单元中的 `ExecStart` 必须写 Node 的绝对路径（`which node`；NodeSource 安装通常是 `/usr/bin/node`，nvm 安装类似 `/home/airmic/.nvm/versions/node/v24.x/bin/node`）。

### 3.2 安装依赖并构建

```bash
cd /opt/airmic
sudo -u airmic npm ci
sudo -u airmic npm run build
```

- `npm ci` 需要 `package-lock.json`，构建需要 devDependencies（TypeScript、Vite 等）。
- 构建产物：`shared/dist`、`server/dist`、`web/dist`。
- 如需减小体积，可在构建完成后执行 `sudo -u airmic npm prune --omit=dev`（下次重新构建前要重新 `npm ci`）。

### 3.3 数据目录与权限

```bash
sudo -u airmic mkdir -p /opt/airmic/data
sudo chown -R airmic:airmic /opt/airmic
```

### 3.4 systemd 单元

仓库已提供 [deploy/airmic.service](../deploy/airmic.service)，按需修改用户、路径、Node 绝对路径：

```ini
[Unit]
Description=AirMic 网页语音服务器
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=airmic
Group=airmic
WorkingDirectory=/opt/airmic
EnvironmentFile=/opt/airmic/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/airmic/server/dist/index.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/airmic/data
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

安装并启动：

```bash
sudo cp deploy/airmic.service /etc/systemd/system/airmic.service
sudo systemctl daemon-reload
sudo systemctl enable --now airmic
sudo systemctl status airmic
curl -fsS http://127.0.0.1:9811/api/health
journalctl -u airmic -f --since today
```

> AirMic 监听 9811；LiveKit 二进制/systemd 部署见第 2.2 节，两者互相独立，可以分开部署在不同机器上（此时 `LIVEKIT_URL` 用 LiveKit 机器的域名）。

### 3.5 完成初始化

浏览器访问 `https://airmic.example.com/setup` 完成初始化向导（详见第 7 节）：创建管理员、服务器信息、LiveKit URL/API Key/Secret、默认房间。

## 4. 方式 B：AirMic Docker Compose

### 4.1 完整栈（AirMic + LiveKit，推荐）

```bash
cd /opt/airmic
cp .env.example .env
# 修改 .env：JWT_SECRET、SETUP_TOKEN、LIVEKIT_URL、LIVEKIT_API_KEY、LIVEKIT_API_SECRET
# 修改 deploy/livekit.yaml：keys、rtc.use_external_ip
docker compose up -d --build
docker compose ps
docker compose logs -f airmic livekit
```

- `airmic` 容器监听 9811，数据在命名卷 `airmic-data:/data`；`livekit` 容器使用 7880/7881/7882。
- `.env` 通过 `env_file` 注入 AirMic；`LIVEKIT_*` 同时作为初始化向导未填写时的兜底。
- 生产建议把 `docker-compose.yml` 中 `airmic` 的端口改为 `127.0.0.1:9811:9811`，由宿主机 Nginx/Caddy 终止 TLS；LiveKit 的 wss 也由宿主机反代。
- Linux 生产建议 livekit 使用 `network_mode: host`（取消注释、删除 ports），并直接放行 7880/7881/7882。

### 4.2 常用运维命令

```bash
docker compose exec airmic sh                          # 进入 AirMic 容器
docker compose exec airmic node scripts/backup.mjs     # 立即备份（输出到 /data/backups）
docker compose logs --tail=200 livekit airmic          # 最近日志
docker compose restart airmic                          # 只重启应用
docker compose restart livekit                         # 只重启语音服务（会断开当前通话）
docker compose down                                    # 停止（不会删除命名卷 airmic-data）
docker compose down -v                                 # 停止并删除数据卷（危险！）
```

查看健康状态：

```bash
docker inspect --format "{{json .State.Health.Status}}" airmic
```

### 4.3 AirMic 容器单独部署（对接外部 LiveKit）

如果 LiveKit 已单独部署（另一台机器/另一套 compose），只启动 AirMic 服务即可：

```bash
# 确认 .env 中 LIVEKIT_URL 指向外部 wss 地址
docker compose up -d --build airmic
```

或直接用镜像运行（注意挂载数据卷并传入 `LIVEKIT_*`）。不推荐在公网直接暴露 9811，仍建议由反向代理提供 HTTPS。

### 4.4 Docker 部署的 HTTPS

- **推荐**：宿主机 Nginx/Caddy 终止 TLS：AirMic 页面 https、LiveKit 的 `wss` 反代到 127.0.0.1:7880；LiveKit 媒体端口 7881/7882 直接映射/放行。
- **AirMic 容器内启用 HTTPS**：挂载 `certs/` 到 `/app/certs`，设置 `SSL_KEY` / `SSL_CERT`；这是可选的，大多数部署由反代处理。
- 不要把 LiveKit 的 7880 管理/信令端口直接暴露到公网明文 HTTP——浏览器实际使用 wss（443 反代）。

## 5. 反向代理（AirMic 页面）

### 5.1 架构约定

- AirMic 监听 `127.0.0.1:9811`（`HOST=127.0.0.1`），只接受本机代理的请求。
- `.env` 设置 `TRUST_PROXY=true`，让服务端从 `X-Forwarded-For` 获取真实 IP（用于封禁、审计、登录限流）。
- WebSocket `/ws` 必须转发 `Upgrade` / `Connection` 头，并放大读超时；否则聊天、房间状态会周期性断开。
- LiveKit 的 wss 使用单独域名与 server 块（第 2.6 节），AirMic 的反代不需要代理媒体端口。

### 5.2 Nginx 完整配置

仓库已提供 [deploy/nginx.conf](../deploy/nginx.conf)（包含 AirMic 与 LiveKit 两个 server 块）。核心步骤：

```bash
sudo apt install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/conf.d/airmic.conf
sudo vi /etc/nginx/conf.d/airmic.conf     # 修改 server_name、证书路径、LiveKit 域名
sudo nginx -t
sudo systemctl reload nginx
```

AirMic 站点关键片段：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name airmic.example.com;

    ssl_certificate     /etc/letsencrypt/live/airmic.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/airmic.example.com/privkey.pem;

    client_max_body_size 2m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location /ws {
        proxy_pass http://127.0.0.1:9811;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:9811;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**静态文件由谁托管？** 两种方案二选一：

| 方案 | 做法 | 优点 | 注意 |
| --- | --- | --- | --- |
| A（推荐，默认） | `location /` 全部反代给 Node，Node 托管 `web/dist` 并做 SPA 回退 | 配置最简、前后端同源 | 静态资源走 Node |
| B | Nginx `root` 指向 `web/dist`，`try_files $uri $uri/ /index.html`；只反代 `/api`、`/ws` | 静态请求不经过 Node、可加长缓存 | 每次构建后需同步 dist；不要把 `location /` 再 proxy_pass |

### 5.3 Caddy（自动 HTTPS）

```caddyfile
airmic.example.com {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "same-origin"
        Permissions-Policy "microphone=(self), camera=(self), display-capture=(self)"
    }
    reverse_proxy 127.0.0.1:9811
}

# LiveKit 的 wss（另一个域名）
livekit.example.com {
    reverse_proxy 127.0.0.1:7880
}
```

Caddy 会自动申请/续期证书并处理 WebSocket upgrade；完整示例见 [deploy/Caddyfile](../deploy/Caddyfile)。

### 5.4 反向代理常见问题

- **502 Bad Gateway**：AirMic 没启动，或 `HOST` 不是 `127.0.0.1`，或 Docker 端口未映射。
- **WebSocket 反复断开 / 400**：检查 `Upgrade`、`Connection` 头与 `proxy_read_timeout`；Cloudflare 等 CDN 需要开启 WebSocket。
- **客户端 IP 都是 127.0.0.1**：未设置 `TRUST_PROXY=true` 或代理未传 `X-Forwarded-For`。
- **登录后立刻掉线**：Cookie 问题（域名/HTTPS 配置不一致、代理未透传 Cookie）。
- **HTTPS 页面无法连接 LiveKit**：`LIVEKIT_URL` 必须改成 `wss://`；混合内容会被浏览器直接拦截。

## 6. TLS 证书

### 6.1 公网域名：Let's Encrypt（推荐）

**Nginx + certbot（两个域名都申请）：**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d airmic.example.com -d livekit.example.com
# 如果还想用内置 TURN，再加 turn.example.com（先解析好 DNS）
sudo certbot renew --dry-run
```

**Caddy：** 自动申请，无需手动操作。

**AirMic 直接用 Node 加载证书（不用反代）：** 在 `.env` 中设置 `SSL_KEY` / `SSL_CERT` 指向 PEM 文件并重启。LiveKit 本身也支持直接配置 TLS 证书（`rtc.cert_file/key_file` 或反代），但推荐统一由 Nginx/Caddy 终止 TLS。

### 6.2 局域网 / 内网：自签证书

内网或没有域名时，用仓库脚本生成本地证书，避免浏览器因非安全上下文禁用麦克风（LiveKit 的 wss 反代也可以复用这张证书）：

```bash
cd /opt/airmic
node scripts/generate-cert.mjs
# 生成 certs/key.pem 与 certs/cert.pem
node scripts/generate-cert.mjs --force             # 覆盖旧证书
node scripts/generate-cert.mjs 192.168.1.50 airmic.local livekit.local turn.local
```

脚本会自动把 `localhost`、`127.0.0.1`、`::1`、本机 hostname 与所有局域网 IPv4 加入 SAN。把域名/IP 提前加入 SAN（或使用额外参数）后：

- AirMic 反代使用 `certs/cert.pem` / `certs/key.pem`，或在 `.env` 设置 `SSL_KEY` / `SSL_CERT` 让 AirMic 直接 HTTPS；
- LiveKit 的 wss 反代使用同一张证书；
- `LIVEKIT_URL` 使用对应的 `wss://<域名或IP>`。

- 需要 OpenSSL：Linux/macOS 通常自带；Windows 推荐 Git for Windows 自带的 `C:/Program Files/Git/usr/bin/openssl.exe`（脚本会自动探测），也可用 `OPENSSL_BIN` 指定。
- 生成的 `certs/` 已被 `.gitignore` 忽略，**不要提交私钥**。
- IP/域名变化后需要重新生成（可加 `--force`），并同步重新信任。

### 6.3 让设备信任自签证书

浏览器访问自签 HTTPS 时，**必须先让证书受信任**，否则部分浏览器/系统仍会限制麦克风与 WebRTC 能力：

**Windows（Chrome / Edge 使用系统证书库）：**

```powershell
# 以管理员身份运行；把 cert.pem 复制为 cert.crt 后双击导入亦可
certutil -addstore -f Root certs\cert.pem
```

或 `certmgr.msc` → 受信任的根证书颁发机构 → 证书 → 导入 `cert.pem`。Firefox 使用独立证书库：设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构 → 导入。

**macOS：**

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certs/cert.pem
```

或"钥匙串访问"导入证书并设为"始终信任"。

**iOS / iPadOS：** 把 `cert.pem` 发送到设备并安装描述文件，然后到 设置 → 通用 → 关于本机 → 证书信任设置，为该证书打开完全信任。

**Android：** 设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书（不同厂商路径略有差异）；部分 Android 版本对用户 CA 有限制，可改用正式证书或 mkcert。

**Linux（Chrome/Chromium）：**

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "AirMic Local" -i certs/cert.pem
```

> 提示：自签证书只适合内网/测试。需要长期公网使用请购买域名并申请 Let's Encrypt 证书；也可使用 mkcert 生成受信任的本地 CA。

## 7. 初始化向导（/setup）

AirMic 首次部署使用初始化向导创建管理员和基础配置。判断是否需要初始化：

```bash
curl -fsS https://airmic.example.com/api/setup/status
# {"setupRequired":true,"requiresToken":true,"server":{...}}
```

| 字段 | 含义 |
| --- | --- |
| `setupRequired` | 是否还没有管理员（需要初始化） |
| `requiresToken` | 是否设置了 `SETUP_TOKEN`（需要口令） |
| `server` | 当前公开服务器设置 |

**浏览器操作：**

1. 访问 `https://airmic.example.com/setup`（未初始化时访问其他页面也会跳转）。
2. **服务器信息**：服务器名、MOTD、注册模式（开放/邀请码/关闭）、游客开关；若设置了 SETUP_TOKEN，本步填写初始化口令。
3. **管理员**：用户名、昵称、密码。
4. **语音中转与音质**：LiveKit URL（wss://livekit.example.com）、API Key、API Secret（可留空，之后在管理后台补配）、单房间人数上限（默认 100，最大 500）、默认音质、是否创建默认房间。
5. **确认并完成**：提交后创建管理员、写入设置、自动登录并进入大厅。

**接口（自动化/排障用）：**

```bash
# 初始化（已设置 SETUP_TOKEN 时 token 必填）
curl -fsS -X POST https://airmic.example.com/api/setup/initialize \
  -H "Content-Type: application/json" \
  -d '{"token":"<SETUP_TOKEN>","admin":{"username":"admin","password":"强密码","displayName":"管理员"},"server":{"name":"我的语音服务器","maxUsersPerRoom":100,"livekitUrl":"wss://livekit.example.com","livekitApiKey":"<KEY>","livekitApiSecret":"<SECRET>"},"createDefaultRooms":true}'
```

- 初始化接口仅在没有管理员时可用；完成后再次调用返回 409 `setup_completed`。
- 有 IP 限流（10 次/10 分钟）与并发保护（同时只允许一个初始化请求）。
- `SETUP_TOKEN` 不正确返回 403 `setup_token_invalid`。
- 初始化成功后会在响应中设置登录 Cookie，响应包含管理员、服务器设置与默认房间列表。
- 初始化完成后想修改服务器名、LiveKit 配置等，全部在 **管理后台 → 服务器设置** 中操作。

## 8. 数据备份与恢复

### 8.1 需要备份什么

| 内容 | 是否必须 | 说明 |
| --- | --- | --- |
| `data/airmic.db` | ✅ 必须 | 全部账号、房间、消息、设置（含 LiveKit API Key/Secret）、封禁、审计、会话 |
| `.env` | ✅ 必须 | 端口、`JWT_SECRET`、`SETUP_TOKEN`、`LIVEKIT_*` 等部署配置 |
| `deploy/livekit.yaml` | ✅ 建议 | LiveKit 密钥与网络配置（丢失后需重新生成密钥并同步 AirMic） |
| `certs/` | 建议 | 自签证书与私钥 |
| `web/dist`、`server/dist` | ❌ | 重新 `npm run build` 即可 |
| Docker 命名卷 `airmic-data` | ✅ 必须 | 容器部署时数据库在卷里 |

### 8.2 备份命令（脚本）

```bash
cd /opt/airmic
npm run backup
# 或指定参数/环境变量
BACKUP_DIR=/opt/airmic/data/backups RETENTION=14 node scripts/backup.mjs
node scripts/backup.mjs --db ./data/airmic.db --dir ./backups --retention 10
```

- 使用 SQLite `VACUUM INTO` 生成一致性快照，服务运行中执行也安全（WAL 模式）。
- 自动执行 `PRAGMA integrity_check`，失败时非零退出并保留文件排查。
- 文件名 `airmic-YYYYMMDD-HHmmss.db`，按 `RETENTION` 自动清理旧备份（默认保留 10 份）。
- 可以从任意工作目录执行；会读取项目根目录 `.env`。
- 数据库不存在/路径错误时会给出明确提示并非零退出。

**定时任务（crontab，airmic 用户）：**

```cron
0 4 * * * cd /opt/airmic && /usr/bin/node scripts/backup.mjs >> /var/log/airmic-backup.log 2>&1
```

**异地备份：** 备份文件和数据库在同一块磁盘不算备份，请定期同步到另一台机器/对象存储：

```bash
rsync -av /opt/airmic/data/backups/ backup@backup-host:/srv/airmic-backups/
```

### 8.3 Docker 部署的备份

```bash
# 容器内备份（写入命名卷 /data/backups）
docker compose exec airmic node scripts/backup.mjs

# 复制到宿主机
docker compose cp airmic:/data/backups/. ./backups/

# 或者直接打包数据卷
docker run --rm -v airmic-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/airmic-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

### 8.4 恢复步骤

**裸机：**

```bash
sudo systemctl stop airmic
cd /opt/airmic
cp backups/airmic-20261120-153120.db data/airmic.db
rm -f data/airmic.db-wal data/airmic.db-shm      # 必须删除旧的 WAL/SHM
sudo chown airmic:airmic data/airmic.db
sudo systemctl start airmic
curl -fsS http://127.0.0.1:9811/api/health
```

**Docker：**

```bash
docker compose down
docker run --rm -v airmic-data:/data -v "$PWD/backups:/backup" alpine \
  sh -c "cp /backup/airmic-20261120-153120.db /data/airmic.db && rm -f /data/airmic.db-wal /data/airmic.db-shm && chown 1000:1000 /data/airmic.db"
docker compose up -d
```

**恢复后验证：**

- `GET /api/health` 返回 `ok`；`GET /api/setup/status` 显示已完成初始化；
- 能正常登录、房间列表与 LiveKit 配置存在（管理后台可见）；
- 进入房间能正常通话（说明数据库中的 LiveKit 配置/环境变量仍然有效）；
- 如需校验数据库完整性：`node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/airmic.db');console.log(db.prepare('PRAGMA integrity_check').get())"`。

> JWT 密钥注意：如果 `.env` 中显式设置了 `JWT_SECRET`，恢复时必须使用同一个值，否则所有旧登录会话失效（重新登录即可）。
> LiveKit 密钥注意：备份里的 `livekitApiSecret` 必须与当前 `deploy/livekit.yaml` 的 `keys` 一致，否则令牌签名校验失败（令牌接口 500/连接被拒）。
> 版本兼容：数据库迁移在启动时按 `PRAGMA user_version` 自动升级且只向前。**不要用旧版本程序打开新版本数据库**；回滚版本时需要同时恢复对应时期的数据库备份。

## 9. 升级步骤

### 9.1 裸机

```bash
cd /opt/airmic
npm run backup                       # 1. 先备份
sudo systemctl stop airmic           # 2. 停止应用（LiveKit 可继续运行）
git pull                             # 3. 更新代码
npm ci                               # 4. 安装依赖
npm run build                        # 5. 重新构建 shared/server/web
sudo chown -R airmic:airmic /opt/airmic
sudo systemctl start airmic          # 6. 启动（自动执行数据库迁移）
curl -fsS http://127.0.0.1:9811/api/health
```

LiveKit 升级（二进制）：下载新版本压缩包替换 `/opt/livekit/livekit-server`，`sudo systemctl restart livekit`。升级 LiveKit 会短暂断开当前通话，建议在低峰期进行。

### 9.2 Docker

```bash
cd /opt/airmic
docker compose exec airmic node scripts/backup.mjs   # 1. 备份
git pull                                              # 2. 更新代码
docker compose build --pull                           # 3. 重新构建 AirMic 镜像
docker compose pull livekit                           # 4. 拉取新的 LiveKit 镜像（可选）
docker compose up -d                                  # 5. 替换容器
docker compose ps && docker compose logs --tail=100 airmic livekit
```

### 9.3 回滚

1. 停止 AirMic；
2. 切回旧版本代码并重新 `npm ci && npm run build`（Docker 则切回旧镜像）；LiveKit 同理切回旧二进制/镜像；
3. 用升级前的备份恢复数据库（`data/airmic.db`，删除 `-wal/-shm`）；
4. 启动并验证 `/api/health`、`/api/setup/status` 与实际通话。数据库迁移不可逆，**回滚必须同时回滚数据**。

## 10. 日志与排障

### 10.1 健康检查

```bash
curl -fsS http://127.0.0.1:9811/api/health
# {"status":"ok","version":"1.1.0","uptimeSeconds":123}
curl -fsS http://127.0.0.1:9811/api/setup/status
curl -fsS http://127.0.0.1:7880/
```

Docker：`docker inspect --format "{{json .State.Health.Status}}" airmic`。

### 10.2 日志位置

| 组件 | 查看方式 |
| --- | --- |
| AirMic（systemd） | `journalctl -u airmic -f`；`journalctl -u airmic --since "1 hour ago"` |
| AirMic（Docker） | `docker compose logs -f airmic` |
| LiveKit（systemd） | `journalctl -u livekit -f` |
| LiveKit（Docker） | `docker compose logs -f livekit` |
| Nginx | `/var/log/nginx/access.log`、`/var/log/nginx/error.log` |

需要更详细的服务端日志时，临时把 `.env` 的 `LOG_LEVEL` 改为 `debug`（或 `trace`）并重启 AirMic；排障后改回 `info`。

### 10.3 常见问题速查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 502 Bad Gateway | AirMic 未启动 / 端口不对 / `HOST` 绑定错误 | `curl 127.0.0.1:9811/api/health`；检查 systemd/Docker 与 Nginx `proxy_pass` |
| 首页空白、接口 404 | 未构建前端 / `WEB_DIST` 路径错误 | `npm run build`；检查 `web/dist/index.html` |
| 访问根路径被引导到 `/setup` | 还没有管理员（首次部署） | 完成初始化向导；或设置 `ADMIN_*` 后重启（仅兼容用途） |
| 登录后又回到登录页 | Cookie 未保存 / HTTPS 配置不一致 / JWT_SECRET 变化 | 检查 DevTools Cookies；确认 TLS 与访问域名一致 |
| WebSocket 不断重连 | 代理未升级 WS / 超时太短 / 网络中断 | 检查 Upgrade/Connection 头与 `proxy_read_timeout` |
| 房间内提示"语音服务未配置" | LiveKit URL/Key/Secret 不齐全 | 初始化向导/管理后台配置，或设置 `LIVEKIT_*` 后重启 |
| 令牌接口 400 `voice_not_configured` | 同上 | 同上 |
| 令牌接口 403 "请先加入房间" | 未通过 `/ws` 加入房间 | 刷新页面/重进房间；检查 WebSocket 连接 |
| 能进房间但没声音 | 7881/7882 未放行；LiveKit 不可达；wss 证书问题 | 检查 LiveKit 日志与浏览器 Network；放行媒体端口；检查证书 |
| 部分用户没声音 | 该用户网络禁 UDP | 启用 LiveKit 内置 TURN（第 2.9 节） |
| LiveKit 容器反复重启 | `livekit.yaml` 配置错误/密钥不存在 | `docker compose logs livekit`；检查 YAML 与 `keys` |
| `database is locked` | 多个 AirMic 实例共用同一数据库 | 只运行一个 AirMic 实例 |
| 时间/会话异常 | 服务器时钟漂移 | 启用 NTP（`timedatectl set-ntp true`） |

### 10.4 端口一览

| 端口 | 协议 | 用途 | 建议暴露范围 |
| --- | --- | --- | --- |
| 9811 | TCP | AirMic HTTP（默认） | 仅本机 / 反向代理内部 |
| 80 | TCP | HTTP（跳转/证书签发） | 公网 |
| 443 | TCP | HTTPS / AirMic WSS / LiveKit 信令 wss | 公网 |
| 7880 | TCP | LiveKit HTTP/WebSocket 信令 | 仅本机（由 443 wss 反代） |
| 7881 | TCP | LiveKit WebRTC over TCP | 公网 |
| 7882 | UDP | LiveKit WebRTC UDP mux | 公网 |
| 3478 | UDP | LiveKit 内置 TURN（可选） | 需要时公网 |
| 5349 | TCP | LiveKit 内置 TURN over TLS（可选） | 需要时公网 |
| 5173 | TCP | Vite 开发服务器 | 仅开发机 |

### 10.5 运行日志（管理后台）

管理后台左侧 **运行日志**（需要 `manage_server` 或 `view_audit` 权限）用于排障：

- 数据存储在 SQLite 的 `app_logs` 表，通过批量异步写入，避免影响请求性能；
- 支持按 **级别**（trace/debug/info/warn/error/fatal）、**分类**（http/ws/auth/admin/system/room/voice/error/security）、**关键字**筛选与分页；
- 点击行查看 `meta` 详情；支持导出 **CSV / JSON**；
- 默认保留 **3 天**，由 `LOG_RETENTION_DAYS` 配置（1–30，服务重启生效），超期自动清理；
- 不记录请求体、密码、聊天正文或媒体内容；记录内容包括请求结果、认证/安全事件、管理操作、实时事件与异常。

### 10.6 文件日志与轮转

| 部署方式 | 日志位置 | 轮转/保留 |
| --- | --- | --- |
| CLI 本地模式 | 安装目录 `logs/airmic-YYYY-MM-DD.log`、`logs/livekit-YYYY-MM-DD.log` | 按天命名；启动时与后台清理进程每 6 小时清理，保留最近 **3 天** |
| CLI Docker 模式 | `docker compose -f <安装目录>/config/docker-compose.yml logs -f --tail=200` | 生成的 compose 使用 `json-file`，`max-size: 10m`、`max-file: 3` |
| systemd 裸机 | `journalctl -u airmic -f`（可选重定向文件） | 由 systemd/journald 管理 |
| Nginx / Caddy | `/var/log/nginx/`、`journalctl -u caddy` | 由系统 logrotate 管理 |

```bash
# CLI 查看本地日志（最近 200 行）
node ~/.airmic/bin/airmic-cli.mjs logs --lines 200

# Docker 模式
docker compose -f ~/.airmic/config/docker-compose.yml logs -f --tail=200
# 或使用别名命令
node ~/.airmic/bin/airmic-cli.mjs docker-logs --lines 200
```

> 注意区分两套“保留天数”：`LOG_RETENTION_DAYS` 控制的是 SQLite 运行日志（管理后台可查/导出）；`logs/*.log` 文件日志固定保留最近 3 天（由部署 CLI 的日志清理进程负责）。

### 10.7 结合日志定位常见问题

| 现象 | 日志线索 | 排查方向 |
| --- | --- | --- |
| 登录失败 | 运行日志 `category=auth`/`security`、`level=warn`；文件日志搜索 `login`、`401` | 密码错误、账号被封禁、登录限流（5 分钟 20 次/IP）、Cookie/HTTPS 问题 |
| 房间密码错误 | 文件日志/运行日志中的 `join_room`、`room_password` | 密码输入错误、房间密码被修改；重新输入 |
| LiveKit 令牌 400 `voice_not_configured` | 运行日志 `category=voice`；`/api/server` 的 `voiceAvailable` | 未配置 LiveKit URL/API Key/Secret（初始化向导或管理后台配置） |
| LiveKit 令牌 403“请先加入房间” | 浏览器 Network/WS 面板；运行日志 `category=voice` | 用户尚未通过 `/ws` 加入房间，刷新/重进房间 |
| WebRTC 连不上/没有声音 | 浏览器 Console/Network；`logs/livekit-*.log` 或 `docker compose logs livekit` | 7881/tcp、7882/udp 未放行；wss 证书错误；NAT 环境需启用 LiveKit 内置 TURN |
| 升级后启动失败 | `airmic-cli.mjs logs`、`backups/app-*/` 旧版本 | 查看 CLI 是否已自动回滚；参考第 12 节手动回滚/恢复数据库 |

## 11. 安全清单（上线前逐项确认）

- [ ] 已更换 LiveKit 默认 `devkey/secret`，AirMic 与 LiveKit 密钥一致且未泄露。
- [ ] 已设置 `SETUP_TOKEN` 并完成初始化；初始化完成后确认 `/api/setup/status` 显示 `setupRequired=false`。
- [ ] 全站 HTTPS（AirMic 页面）与 wss（LiveKit 信令）；HTTP 自动跳转 HTTPS，启用 HSTS。
- [ ] 防火墙只开放必要端口：443、7881/tcp、7882/udp；9811、7880 仅本机访问。
- [ ] 反向代理后设置 `TRUST_PROXY=true`，且代理会覆盖而不是透传客户端伪造的 `X-Forwarded-For`。
- [ ] 管理后台使用邀请码/关闭注册，管理员强密码；定期检查登录会话与审计日志。
- [ ] 定期备份 `data/airmic.db`、`.env`、`deploy/livekit.yaml` 并异地保存；演练恢复。
- [ ] 以非 root 运行（systemd `User=airmic` / `User=livekit`，Docker `USER node`）；及时更新 Node.js/LiveKit 安全补丁。
- [ ] 不要提交 `.env`、`data/`、`certs/`；限制文件权限（`.env` 600）。
- [ ] 监控 `/api/health`、LiveKit 日志、磁盘空间与网络带宽；设置异常告警。

## 12. 一键部署 CLI（本地/Docker）、OTA 升级与卸载

`deploy/airmic-cli.mjs` 是零第三方依赖的部署工具（Node 内置模块实现，Windows/Linux/macOS 通用），负责把代码、数据、配置、日志、LiveKit、证书等全部收拢到一个安装目录，并提供在线更新与安全升级。

### 12.1 安装（本地模式）

前提：Node.js **>= 22.13**、npm；LiveKit 由 CLI 自动从 GitHub Releases 下载（也可 `--no-livekit` 跳过后手动放置）。

```bash
# Linux / macOS
./deploy/install-local.sh --yes
# 或显式指定安装目录与端口
./deploy/airmic.sh install --mode local --dir /opt/airmic --port 9811 --yes
```

```powershell
# Windows PowerShell
.\deploy\install-local.ps1 --yes
# 指定目录 / 跳过 LiveKit 下载（快速验证）
.\deploy\airmic.ps1 install --mode local --dir "$env:USERPROFILE\.airmic" --no-livekit --yes
```

安装过程：校验 Node/npm → 复制源码（排除 node_modules/.git/dist 等）→ `npm ci` + `npm run build` → 生成 `config/airmic.env`（随机 JWT_SECRET）与 `config/livekit.yaml`（随机 API Key/Secret）→ 下载 LiveKit 二进制 → 启动 LiveKit 与 AirMic → 健康检查。

可选参数：`--source local|github`（默认当前仓库，可选从 GitHub 最新 Release/Tag/默认分支下载）、`--livekit-version vX`、`--setup-token [值]`、`--no-livekit`、`--force`（覆盖已有安装，保留 data/backups）。

### 12.2 安装（Docker 模式）

前提：Docker + Docker Compose v2。CLI 会生成 `config/docker-compose.yml` 并执行 `docker compose up -d --build`（AirMic + LiveKit 两个服务）。

```bash
./deploy/install-docker.sh --yes
# Windows PowerShell
.\deploy\install-docker.ps1 --yes
```

生成的 compose 特点：镜像 `airmic:<版本>`、端口 `<port>:9811`、数据卷 `../data:/data`、`env_file ../config/airmic.env`、LiveKit 镜像 `livekit/livekit-server:<版本>`、端口 7880/7881/7882、日志 `json-file`（`max-size: 10m`、`max-file: 3`）。使用 `docker compose logs` 查看日志。

### 12.3 统一安装目录

```text
<AIRMIC_HOME>/                  # 默认 ~/.airmic 或 %USERPROFILE%\.airmic
├─ app/                         # 源码与构建产物（升级整体替换）
├─ data/                        # SQLite（Docker: /data）
├─ config/airmic.env            # 运行配置（JWT/端口/LiveKit/LOG_RETENTION_DAYS 等，600）
├─ config/livekit.yaml          # LiveKit 配置
├─ config/docker-compose.yml    # Docker 模式
├─ livekit/bin/livekit-server   # 本地模式二进制
├─ logs/                        # 每日轮转日志（保留 3 天）
├─ backups/                     # 数据库备份 + 旧版本 app
├─ run/                         # PID 文件
├─ bin/                         # airmic-cli.mjs 与 airmic.sh/ps1/cmd
└─ version.json                 # 版本/来源/模式/安装时间/LiveKit 版本
```

### 12.4 日常运维命令

```bash
cd <AIRMIC_HOME>
node bin/airmic-cli.mjs status
node bin/airmic-cli.mjs start
node bin/airmic-cli.mjs stop
node bin/airmic-cli.mjs restart
node bin/airmic-cli.mjs logs --lines 200
node bin/airmic-cli.mjs check-update
node bin/airmic-cli.mjs upgrade
node bin/airmic-cli.mjs uninstall --yes
```

Docker 模式还支持 `docker-up / docker-down / docker-logs / docker-status` 别名。

### 12.5 在线检查更新

```bash
node <AIRMIC_HOME>/bin/airmic-cli.mjs check-update
node <AIRMIC_HOME>/bin/airmic-cli.mjs check-update --json
```

- 来源顺序：GitHub Release（`/releases/latest`）→ Tags（最高语义版本）→ 默认分支（无 Tag/Release 时回退，并提示可用默认分支升级）；
- 退出码：`0` 已是最新、`10` 有更新、`1` 检查失败；
- 版本来自 `<AIRMIC_HOME>/version.json` 或 `app/package.json`；
- 可选 `GITHUB_TOKEN`（环境变量或 `config/airmic.env`）提高 GitHub API 限额；
- 管理后台 → **系统更新** 卡片也提供只读检查（`GET /api/system/update`，需要 `manage_server` 权限），展示当前版本、GitHub 最新版本与发布链接。

### 12.6 OTA 升级（自动备份 + 失败回滚）

```bash
node <AIRMIC_HOME>/bin/airmic-cli.mjs upgrade            # 先检查，有更新才升级
node <AIRMIC_HOME>/bin/airmic-cli.mjs upgrade --check     # 只检查
node <AIRMIC_HOME>/bin/airmic-cli.mjs upgrade --force     # 跳过检查，强制从 GitHub 升级
node <AIRMIC_HOME>/bin/airmic-cli.mjs upgrade --from ./airmic-src.tar.gz --force
node <AIRMIC_HOME>/bin/airmic-cli.mjs upgrade --from https://example.com/airmic-src.zip
```

`--from` 支持：本地目录、`.zip`、`.tar.gz`、HTTP(S) URL（适合离线环境/内网镜像/回滚演练）。

升级步骤：

1. 新版本源码下载/解压到 `.staging/app-next`；
2. 本地模式在暂存目录 `npm ci` + `npm run build`（Docker 模式由镜像构建）；
3. 停止服务；备份数据库到 `backups/airmic-db-<时间>.db`（含 `-wal/-shm`）；旧 `app/` 移动到 `backups/app-<旧版本>-<时间>/`；
4. 暂存目录原子替换为 `app/`；重建 `node_modules/@airmic` 工作区链接并做 `@airmic/shared` 运行时预检（Windows 上 npm 使用绝对 junction，移动目录后可能失效；失败时自动把 shared 包实际复制到 node_modules 兜底）；
5. 启动并等待 `/api/health`；失败则自动回滚旧 app + 数据库并重启，CLI 以非 0 退出。

> 升级不会覆盖 `config/airmic.env`、`config/livekit.yaml`、`data/`、`livekit/`、`logs/`；升级成功后旧版本与数据库备份保留在 `backups/`，确认无误后可手动清理。

### 12.7 手动回滚

1. `node bin/airmic-cli.mjs stop`；
2. 用 `backups/app-<版本>-<时间>/` 覆盖 `app/`（或直接改名）；
3. 用 `backups/airmic-db-<时间>.db` 覆盖 `data/airmic.db`，并删除旧的 `airmic.db-wal/-shm`；
4. `node bin/airmic-cli.mjs start`，检查 `/api/health`、登录与语音。

### 12.8 卸载（默认保留数据）

```bash
# 删除程序文件，保留 data/ 与 backups/
node <AIRMIC_HOME>/bin/airmic-cli.mjs uninstall --yes
# 删除整个安装目录（含数据与备份，谨慎）
node <AIRMIC_HOME>/bin/airmic-cli.mjs uninstall --purge --yes
```

```powershell
# Windows PowerShell
node "$env:USERPROFILE\.airmic\bin\airmic-cli.mjs" uninstall --yes
node "$env:USERPROFILE\.airmic\bin\airmic-cli.mjs" uninstall --purge --yes
```

卸载会先停止 AirMic/LiveKit/日志清理守护进程（Docker 模式执行 `docker compose down`）。默认保留 `data/` 与 `backups/`，可重新安装继续使用。

### 12.9 常见问题（CLI）

| 现象 | 处理 |
| --- | --- |
| 提示 Node.js 版本过低 | 升级到 Node **>= 22.13**（推荐 24 LTS），重新执行 install |
| 未找到 npm | 安装 Node.js 官方发行版并确保 npm 在 PATH |
| LiveKit 下载失败/无当前平台资产 | 本地模式可加 `--no-livekit` 先启动应用，再手动把 `livekit-server[.exe]` 放入 `<AIRMIC_HOME>/livekit/bin/` 后 `restart`；Linux/macOS 可改用 apt/brew 安装后复制二进制；macOS 官方 release 可能无预编译包 |
| 端口 9811/7880 被占用 | install 时用 `--port` 修改 AirMic 端口；LiveKit 端口在 `config/livekit.yaml` 与 Docker 端口映射中修改 |
| 升级失败并回滚 | 属预期保护：查看输出的“回滚成功”与 `backups/`；根据新版本日志（`logs/airmic-*.log`）修复后可重试 |