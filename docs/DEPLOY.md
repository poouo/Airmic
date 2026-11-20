# AirMic 生产部署指南

面向运维/开发者的可操作部署文档，覆盖两种主流方式（裸机 systemd、Docker Compose）、反向代理与 TLS、TURN 中继、备份恢复、升级与排障。

> 本地开发和快速试用请看 [README](../README.md) 的"快速开始"；架构与接口见 [ARCHITECTURE.md](ARCHITECTURE.md)。

---

## 0. 部署前检查清单

- [ ] 服务器安装 **Node.js ≥ 22.13（推荐 24 LTS）**，或可用的 Docker / Docker Compose v2。
- [ ] 公网访问准备域名并解析 A/AAAA 记录；纯局域网访问可跳过域名，用自签证书。
- [ ] 放行端口：反向代理 **80/443**；AirMic 自身 **3000**（仅本机或内网）；TURN 见下文。
- [ ] 决定 TLS 终止位置：**推荐在 Nginx/Caddy 终止 HTTPS，AirMic 只监听 127.0.0.1:3000**。
- [ ] 决定 TURN 部署位置：公网/复杂 NAT 场景**必须**部署 TURN，只配 STUN 无法保证可用。
- [ ] 备份策略：`data/airmic.db` 与 `.env` 必须定期备份，且备份不要和数据库放在同一块盘上。
- [ ] 安全：设置强 `JWT_SECRET`、限制注册、管理员使用强密码、以非 root 用户运行。

> 单机部署即可满足中小规模使用。AirMic 的实时状态保存在进程内存中，**不要多个实例共用一个 SQLite 数据库**。

## 1. 通用准备（两种方式都需要）

### 1.1 获取代码与目录约定

本文以 `/opt/airmic` 作为部署目录、`airmic` 作为运行用户：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin airmic
sudo mkdir -p /opt/airmic
sudo chown -R airmic:airmic /opt/airmic
# 将代码放到 /opt/airmic（git clone / scp / rsync 均可）
```

也可以使用任意目录，只需同步修改下文 systemd 单元中的路径。

### 1.2 生产环境 .env 示例

```bash
cd /opt/airmic
cp .env.example .env
chmod 600 .env
```

最小生产配置（反向代理 + 数据库）：

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/airmic.db
JWT_SECRET=请替换为至少 32 字节的随机字符串
TRUST_PROXY=true
USER_SESSION_TTL_DAYS=30
GUEST_SESSION_TTL_HOURS=24
LOG_LEVEL=info
```

生成随机 `JWT_SECRET`：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

> `.env` 只能放在**项目根目录**（不是 `server/.env`）。已在系统环境变量中设置的同名变量优先。
> 部署在 Nginx/Caddy 等可信反向代理之后才设置 `TRUST_PROXY=true`，否则客户端 IP 可被伪造。

### 1.3 首次启动

第一次启动会自动创建 `data/` 目录、SQLite 数据库与表结构。启动后：

- 健康检查：`GET /api/health` 返回 `{"status":"ok","version":"1.0.0","uptimeSeconds":...}`。
- 浏览 <http://localhost:3000>，**第一个注册的用户自动成为管理员**。
- 也可以提前在 `.env` 设置 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（仅在服务器还没有管理员时生效），避免"抢注"管理员。

后续的服务器名、MOTD、注册模式、人数上限、音质、ICE/TURN 等都在 **管理后台 → 服务器设置** 中修改，保存在数据库里。

## 2. 方式 A：裸机 + systemd（推荐）

### 2.1 安装 Node.js 24 LTS

```bash
# Debian / Ubuntu（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

其他发行版请参考 Node.js 官方安装方式。注意：**systemd 不会加载 shell 的 PATH**，下面单元里的 `ExecStart` 必须写 Node 的绝对路径（`which node` 的结果；NodeSource 安装通常是 `/usr/bin/node`，nvm 安装则类似 `/home/airmic/.nvm/versions/node/v24.x/bin/node`）。

### 2.2 安装依赖并构建

```bash
cd /opt/airmic
sudo -u airmic npm ci
sudo -u airmic npm run build
```

- `npm ci` 需要 `package-lock.json`，构建需要 devDependencies（TypeScript、Vite 等）。
- 构建产物：`shared/dist`、`server/dist`、`web/dist`。
- 如需减小体积，可在构建完成后执行 `sudo -u airmic npm prune --omit=dev`（下次重新构建前要重新 `npm ci`）。

### 2.3 数据目录与权限

```bash
sudo -u airmic mkdir -p /opt/airmic/data
sudo chown -R airmic:airmic /opt/airmic
```

### 2.4 systemd 单元

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
curl -fsS http://127.0.0.1:3000/api/health
```

查看日志：

```bash
journalctl -u airmic -f --since today
```

> 说明：
> - `ProtectSystem=strict` 让除 `ReadWritePaths` 外的文件系统只读；如果要把备份写在 `/opt/airmic/backups`，请在单元中追加 `ReadWritePaths=-/opt/airmic/backups`（`-` 前缀表示目录不存在时忽略），或把 `BACKUP_DIR` 设置为 `/opt/airmic/data/backups`。
> - 修改 `.env` 后需要 `sudo systemctl restart airmic`。
> - `HOST=127.0.0.1` 时服务只监听本机；如果不用反向代理、直接对外提供服务，改为 `0.0.0.0` 并自行处理防火墙与 HTTPS。

## 3. 方式 B：Docker / Docker Compose

### 3.1 构建与启动

仓库根目录提供多阶段 [Dockerfile](../Dockerfile) 与 [docker-compose.yml](../docker-compose.yml)：

- 构建阶段安装全部依赖并执行 `npm run build`；
- 运行镜像只包含生产依赖、`dist` 产物与备份脚本，以非 root 用户 `node` 运行；
- 数据目录为容器内 `/data`（Compose 使用命名卷 `airmic-data` 持久化）；
- 镜像内置健康检查（`/api/health`）。

```bash
cd /opt/airmic
cp .env.example .env        # 按需修改 JWT_SECRET / TRUST_PROXY 等
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f airmic
curl -fsS http://127.0.0.1:3000/api/health
```

Compose 默认把容器的 3000 映射到宿主机 3000。生产建议由宿主机 Nginx/Caddy 终止 TLS，并只在 `127.0.0.1` 暴露端口；可以把 `docker-compose.yml` 中的

```yaml
ports:
  - "3000:3000"
```

改为：

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

- `.env` 通过 `env_file` 注入容器，容器内固定使用 `DATABASE_PATH=/data/airmic.db`、`BACKUP_DIR=/data/backups`。
- 不需要 `.env` 也能启动（全部使用默认值），但生产环境请至少设置 `JWT_SECRET` 与 `TRUST_PROXY`。

### 3.2 常用运维命令

```bash
docker compose exec airmic sh                  # 进入容器
docker compose exec airmic node scripts/backup.mjs   # 立即备份（输出到 /data/backups）
docker compose logs --tail=200 airmic          # 最近日志
docker compose restart airmic                  # 重启
docker compose down                            # 停止（不会删除命名卷 airmic-data）
docker compose down -v                         # 停止并删除数据卷（危险！）
```

查看健康状态：

```bash
docker inspect --format "{{json .State.Health.Status}}" airmic
```

### 3.3 Docker 部署的 HTTPS

三条路线，按推荐程度排序：

**路线 1（推荐）：宿主机反向代理终止 TLS。** 容器只监听 `127.0.0.1:3000`，Nginx/Caddy 配置见第 4 节。证书续期、HTTP/2、HSTS 都在宿主机处理，AirMic 无需感知 HTTPS。

**路线 2：容器内直接启用 HTTPS。** 适合单机内网、不想装反代的场景：

```bash
# 宿主机生成自签证书（或放入正式证书）
node scripts/generate-cert.mjs

# 在 .env 中增加（容器内路径）
# SSL_KEY=/app/certs/key.pem
# SSL_CERT=/app/certs/cert.pem
# 取消 docker-compose.yml 中 ./certs:/app/certs:ro 的注释并重新 up
docker compose up -d
```

此时访问 `https://宿主机IP:3000`。如果前面还有一层 Nginx，需要 `proxy_pass https://127.0.0.1:3000;` 并（自签时）`proxy_ssl_verify off;`。

**路线 3：Caddy 容器自动 HTTPS。** 仓库提供 [deploy/Caddyfile](../deploy/Caddyfile)；在 Compose 中增加一个 Caddy 服务（注意替换域名与邮箱）：

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - airmic

volumes:
  caddy-data:
  caddy-config:
```

```caddyfile
airmic.example.com {
    encode zstd gzip
    reverse_proxy airmic:3000
}
```

> 注意：AirMic 容器不要同时把 3000 暴露到公网；Caddy 通过 Compose 内部网络访问 `airmic:3000`。

## 4. 反向代理（Nginx / Caddy）

### 4.1 架构约定

- AirMic 监听 `127.0.0.1:3000`（`HOST=127.0.0.1`），只接受本机代理的请求。
- `.env` 设置 `TRUST_PROXY=true`，让服务端从 `X-Forwarded-For` 获取真实 IP（用于封禁、审计、登录限流）。
- WebSocket `/ws` 必须转发 `Upgrade` / `Connection` 头，并放大读超时；否则聊天、信令会周期性断开或直接 400。

### 4.2 Nginx 完整配置

仓库已提供 [deploy/nginx.conf](../deploy/nginx.conf)，可以直接作为站点配置使用（其中的 `map` 位于 http 上下文，`conf.d/*.conf` 会被 `http{}` 包含）。核心步骤：

```bash
# Debian/Ubuntu
sudo apt install -y nginx
sudo cp deploy/nginx.conf /etc/nginx/conf.d/airmic.conf
sudo vi /etc/nginx/conf.d/airmic.conf     # 修改 server_name 与证书路径
sudo nginx -t
sudo systemctl reload nginx
```

配置要点（完整内容见文件）：

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
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "same-origin" always;

    location /ws {
        proxy_pass http://127.0.0.1:3000;
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

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
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

`deploy/nginx.conf` 末尾有方案 B 的注释示例。选择方案 B 时记得先 `npm run build` 并把 `web/dist` 复制到 `/var/www/airmic`。

### 4.3 Caddy（更简单的自动 HTTPS）

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

    # Caddy 会自动处理 WebSocket upgrade
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会自动申请/续期 Let's Encrypt 证书，并把 HTTP 重定向到 HTTPS。域名解析到服务器后执行 `sudo systemctl reload caddy` 即可。

### 4.4 反向代理常见问题

- **502 Bad Gateway**：AirMic 没启动，或 `HOST` 不是 `127.0.0.1`（例如只监听了 `0.0.0.0` 之外的其他地址），或 Docker 部署时 Nginx 在宿主机而端口没映射。
- **WebSocket 反复断开 / 400**：检查 `Upgrade`、`Connection` 头与 `proxy_read_timeout`；Cloudflare 等 CDN 需要开启 WebSocket 支持。
- **客户端 IP 都是 127.0.0.1**：未设置 `TRUST_PROXY=true` 或代理未传 `X-Forwarded-For`。
- **登录后立刻掉线**：多数是 Cookie 问题（域名/HTTPS 配置不一致、代理未透传 Cookie）；浏览 `/api/auth/me` 响应与 DevTools → Application → Cookies。
- **Cloudflare 等 CDN**：可以代理页面/API/WebSocket，但**媒体流（UDP）不会经过 CDN**，仍需要 STUN/TURN；另外真实 IP 需要配置 `real_ip` 模块，否则封禁/审计拿到的是 CDN 节点 IP。

## 5. TLS 证书

### 5.1 公网域名：Let's Encrypt（推荐）

**Nginx + certbot：**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d airmic.example.com
# 证书位置：
#   /etc/letsencrypt/live/airmic.example.com/fullchain.pem
#   /etc/letsencrypt/live/airmic.example.com/privkey.pem
sudo certbot renew --dry-run
```

certbot 会自动安装 `systemd` 定时器续期。首次申请前请确保 80 端口可达、域名已解析。

**Caddy：** 自动申请，无需手动操作。

**直接用 Node 加载正式证书（不使用反代）：** 在 `.env` 中设置 `SSL_KEY` / `SSL_CERT` 指向 PEM 文件并重启；注意 Node 需要能读取证书文件。

### 5.2 局域网 / 内网：自签证书

内网或没有域名时，用仓库脚本生成本地证书，避免浏览器因非安全上下文禁用麦克风：

```bash
cd /opt/airmic
node scripts/generate-cert.mjs
# 生成 certs/key.pem 与 certs/cert.pem
node scripts/generate-cert.mjs --force             # 覆盖旧证书
node scripts/generate-cert.mjs 192.168.1.50 airmic.local   # 追加额外 SAN
```

脚本会自动把 `localhost`、`127.0.0.1`、`::1`、本机 hostname 与所有局域网 IPv4 加入 SAN。生成后在 `.env` 中设置：

```ini
SSL_KEY=./certs/key.pem
SSL_CERT=./certs/cert.pem
```

重启 AirMic，访问 `https://<局域网IP>:3000`。

- 需要 OpenSSL：Linux/macOS 通常自带；Windows 推荐 Git for Windows 自带的 `C:/Program Files/Git/usr/bin/openssl.exe`（脚本会自动探测），也可用 `OPENSSL_BIN` 指定。
- 生成的 `certs/` 已被 `.gitignore` 忽略，**不要提交私钥**。
- IP 变化后需要重新生成（可加 `--force`）。
- 如果使用 Nginx 终止 TLS，把 `ssl_certificate` / `ssl_certificate_key` 指向上面的两个文件即可，Node 端不需要再设置 `SSL_KEY` / `SSL_CERT`。

### 5.3 让设备信任自签证书

浏览器访问自签 HTTPS 时，**必须先让证书受信任**，否则部分浏览器/系统仍会限制麦克风等能力：

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

**Linux（Chrome/Chromium）：** 将证书导入 NSS 数据库：

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "AirMic Local" -i certs/cert.pem
```

> 提示：自签证书只适合内网/测试。需要长期公网使用请购买域名并申请 Let's Encrypt 证书；也可使用 mkcert 生成受信任的本地 CA。

## 6. TURN 中继

### 6.1 为什么需要 TURN

WebRTC 先尝试 P2P 直连（STUN 帮客户端发现公网地址）。但在对称 NAT、企业防火墙、部分 4G/5G 网络下直连会失败，此时必须通过 TURN 服务器中继。**公网部署只配置 STUN 不能保证可用。**

默认 STUN 列表（可在管理后台修改）：

- `stun:stun.l.google.com:19302`、`stun:stun1.l.google.com:19302`
- `stun:stun.cloudflare.com:3478`
- `stun:stun.miwifi.com:3478`

### 6.2 安装 coturn（裸机）

```bash
sudo apt update
sudo apt install -y coturn
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo cp /opt/airmic/deploy/coturn.conf /etc/turnserver.conf
sudo vi /etc/turnserver.conf
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

必须修改 [deploy/coturn.conf](../deploy/coturn.conf) 中的：

- `external-ip`：服务器公网 IP（云主机有内网/公网双网卡时**必填**，格式如 `203.0.113.10`；多 IP 用逗号分隔）。
- `realm` / `server-name`：你的域名或服务器名。
- `user=airmic:CHANGE_ME_STRONG_PASSWORD`：改成强密码，稍后填到 AirMic 管理后台。

关键配置说明：

| 配置项 | 说明 |
| --- | --- |
| `listening-port=3478` | STUN/TURN 监听端口 |
| `min-port` / `max-port` | 中继使用的 UDP 端口范围（默认 49160-49200） |
| `lt-cred-mech` + `user=...` | 静态用户名/密码认证，与后台 ICE 配置对应 |
| `fingerprint` | 安全增强，建议保持开启 |
| `no-cli` | 关闭 telnet CLI，避免暴露管理接口 |
| `no-loopback-peers` | 禁止中继到 loopback；同机自测 TURN 时临时注释 |
| `tls-listening-port=5349` | 可选：TURN over TLS，需要证书 |

### 6.3 Docker 运行 coturn

`docker-compose.yml` 中已包含可选的 `coturn` 服务（profile `turn`，使用 host 网络）：

```bash
# 先修改 deploy/coturn.conf 的 external-ip / realm / user
cd /opt/airmic
docker compose --profile turn up -d coturn
docker compose logs -f coturn
```

- `network_mode: host` 需要 **Linux 宿主机**；Windows/macOS 的 Docker Desktop 不支持，请在宿主机安装 coturn，或改用桥接网络并正确配置 `external-ip` 与端口映射。
- 修改 `deploy/coturn.conf` 后需 `docker compose restart coturn`。

### 6.4 防火墙与云安全组

```bash
# UFW 示例
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
sudo ufw allow 5349/tcp        # 可选：TURN over TLS
sudo ufw reload
```

云厂商（阿里云/腾讯云/AWS 等）还需在**安全组**放行同样的端口。常见错误：只放行了 3478，忘记中继端口 49160-49200/udp，导致 TURN 分配成功但媒体不通。

### 6.5 在 AirMic 管理后台填写 TURN

1. 用管理员登录 → **管理后台 → 服务器设置 → ICE 服务器**。
2. 添加条目（可添加多条，客户端会全部使用）：

| urls | username | credential |
| --- | --- | --- |
| `turn:turn.example.com:3478?transport=udp` | `airmic` | 与 coturn 的 `user=` 密码一致 |
| `turn:turn.example.com:3478?transport=tcp` | `airmic` | 同上 |
| `turns:turn.example.com:5349?transport=tcp`（可选） | `airmic` | 启用 TURN/TLS 时配置 |

3. 保存后设置会广播给在线客户端；**已有连接需要重新进入房间/刷新页面**才会使用新 ICE 配置。
4. "强制中继"（`forceRelay`）仅用于排障：开启后媒体只能走 TURN，TURN 故障时完全无法通话，排障结束请关闭。

### 6.6 验证 TURN 是否可用

1. 打开 <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>，填入 TURN 地址、用户名、密码，点击 Gather candidates；应出现 `relay` 类型候选。
2. 观察 coturn 日志（`journalctl -u coturn -f` / `docker compose logs -f coturn`），连接时应出现分配记录。
3. coturn 自带工具（部分发行版在 `coturn-utils` 包中）：

```bash
turnutils_uclient -v -u airmic -w '你的密码' -p 3478 turn.example.com
```

4. 页面内排障：浏览器 DevTools Console 查看 ICE 状态；`chrome://webrtc-internals`（Edge 为 `edge://webrtc-internals`，Firefox 为 `about:webrtc`）可以看到候选对与选中路径。

### 6.7 只开放 443 的网络（备选）

部分公司/校园网络只允许 443 出站。可选的应对方式：

- 在**独立公网 IP** 上让 coturn 监听 443/tcp（TURN over TLS）：`tls-listening-port=443`，配置 `cert` / `pkey`，客户端使用 `turns:IP:443?transport=tcp`。不能与同一 IP 上的 Nginx 443 冲突。
- 使用 `alt-listening-port` / 额外端口方案时同样要注意防火墙与证书。
- 如果无法提供 443，至少保证 3478 tcp+udp 可达；UDP 被封时优先使用 `turn:...:3478?transport=tcp`。

## 7. 数据备份与恢复

### 7.1 需要备份什么

| 内容 | 是否必须 | 说明 |
| --- | --- | --- |
| `data/airmic.db` | ✅ 必须 | 全部账号、房间、消息、设置、封禁、审计、会话（含自动生成的 JWT 密钥） |
| `.env` | ✅ 必须 | 端口、`JWT_SECRET`、SSL 路径等部署配置 |
| `certs/` | 建议 | 自签证书与私钥（用于恢复后用同一证书） |
| `web/dist`、`server/dist` | ❌ | 重新 `npm run build` 即可 |
| Docker 命名卷 `airmic-data` | ✅ 必须 | 容器部署时数据库在卷里 |

### 7.2 备份命令（脚本）

```bash
cd /opt/airmic
npm run backup
# 或指定参数/环境变量
BACKUP_DIR=/opt/airmic/data/backups RETENTION=14 node scripts/backup.mjs
node scripts/backup.mjs --db ./data/airmic.db --dir ./backups --retention 10
```

脚本特性：

- 使用 SQLite `VACUUM INTO` 生成一致性快照，**服务运行中执行也安全**（WAL 模式）。
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

### 7.3 Docker 部署的备份

```bash
# 容器内备份（写入命名卷 /data/backups）
docker compose exec airmic node scripts/backup.mjs

# 复制到宿主机
docker compose cp airmic:/data/backups/. ./backups/

# 或者直接打包数据卷
docker run --rm -v airmic-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/airmic-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

### 7.4 恢复步骤

**裸机：**

```bash
sudo systemctl stop airmic
cd /opt/airmic
cp backups/airmic-20261120-153120.db data/airmic.db
rm -f data/airmic.db-wal data/airmic.db-shm      # 必须删除旧的 WAL/SHM
sudo chown airmic:airmic data/airmic.db
sudo systemctl start airmic
curl -fsS http://127.0.0.1:3000/api/health
```

**Docker：**

```bash
docker compose down
docker run --rm -v airmic-data:/data -v "$PWD/backups:/backup" alpine \
  sh -c "cp /backup/airmic-20261120-153120.db /data/airmic.db && rm -f /data/airmic.db-wal /data/airmic.db-shm && chown 1000:1000 /data/airmic.db"
docker compose up -d
```

**恢复后验证：**

- `GET /api/health` 返回 `ok`；
- 能正常登录、房间列表存在；
- 如需校验数据库完整性：`node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/airmic.db');console.log(db.prepare('PRAGMA integrity_check').get())"`；
- **JWT 密钥注意**：如果 `.env` 中显式设置了 `JWT_SECRET`，恢复时必须使用同一个值，否则所有旧登录会话失效（重新登录即可）；如果未设置，密钥保存在数据库里，会随备份一起恢复。

> 版本兼容：数据库迁移在启动时按 `PRAGMA user_version` 自动升级且只向前。**不要用旧版本程序打开新版本数据库**；回滚版本时需要同时恢复对应时期的数据库备份。

## 8. 升级步骤

### 8.1 裸机

```bash
cd /opt/airmic
npm run backup                       # 1. 先备份
sudo systemctl stop airmic           # 2. 停止服务（也可在线升级，但会有短暂中断）
git pull                             # 3. 更新代码（或解压新版本覆盖）
npm ci                               # 4. 安装依赖
npm run build                        # 5. 重新构建 shared/server/web
sudo chown -R airmic:airmic /opt/airmic
sudo systemctl start airmic          # 6. 启动（自动执行数据库迁移）
curl -fsS http://127.0.0.1:3000/api/health
journalctl -u airmic -n 100 --no-pager   # 7. 检查日志
```

> 修改了 `shared/` 的版本必须重新 `npm run build`，否则前后端类型/协议不一致；升级后首次启动会自动迁移数据库。

### 8.2 Docker

```bash
cd /opt/airmic
docker compose exec airmic node scripts/backup.mjs   # 1. 备份
git pull                                              # 2. 更新代码
docker compose build --pull                           # 3. 重新构建镜像
docker compose up -d                                  # 4. 滚动替换容器
docker compose ps
docker compose logs --tail=100 airmic
```

如果使用预构建镜像，把 `build` 换成 `docker compose pull`。

### 8.3 回滚

1. 停止服务；
2. 切回旧版本代码（`git checkout <tag>`），重新 `npm ci && npm run build`（Docker 则切回旧镜像）；
3. 用升级前的备份恢复数据库（`data/airmic.db`，删除 `-wal/-shm`）；
4. 启动并验证。数据库迁移不可逆，**回滚必须同时回滚数据**。

## 9. 日志与排障

### 9.1 健康检查

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"status":"ok","version":"1.0.0","uptimeSeconds":123}
```

Docker：`docker inspect --format "{{json .State.Health.Status}}" airmic`。

### 9.2 日志位置

| 部署方式 | 查看方式 |
| --- | --- |
| systemd | `journalctl -u airmic -f`；`journalctl -u airmic --since "1 hour ago"` |
| Docker | `docker compose logs -f airmic` |
| Nginx | `/var/log/nginx/access.log`、`/var/log/nginx/error.log` |
| coturn | `journalctl -u coturn -f` / `docker compose logs -f coturn`（配置了 `log-file=stdout`） |

需要更详细的服务端日志时，临时把 `.env` 的 `LOG_LEVEL` 改为 `debug`（或 `trace`）并重启；排障后改回 `info`。

### 9.3 常见问题速查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 502 Bad Gateway | AirMic 未启动 / 端口不对 / `HOST` 绑定错误 | `curl 127.0.0.1:3000/api/health`，检查 systemd/Docker 状态与 Nginx `proxy_pass` |
| 首页空白、接口 404 | 未构建前端 / `WEB_DIST` 路径错误 | `npm run build`；检查 `web/dist/index.html` 存在；Nginx 方案 B 检查 `root` |
| 登录后又回到登录页 | Cookie 未保存 / HTTPS 配置不一致 / JWT_SECRET 变化 | 检查 DevTools Cookies；确认 TLS 代理与访问域名一致；确认未更换 JWT_SECRET |
| WebSocket 不断重连 | 代理未升级 WS / 超时太短 / 网络中断 | 检查 Upgrade/Connection 头与 `proxy_read_timeout`；看浏览器 Network → WS |
| 能进房间但互相听不到 | ICE 打洞失败、TURN 未配置或端口未放行 | 按第 6 节部署 TURN；Trickle ICE 检查 relay 候选；看 `chrome://webrtc-internals` |
| 只有部分人听不到 | 单个客户端 NAT/防火墙、设备问题 | 让该用户改用 `turn` 中继测试；检查其麦克风权限与输入设备 |
| 没有任何声音但连接正常 | 浏览器自动播放限制 | 点击页面"启用声音"按钮；检查系统输出设备与浏览器标签页静音 |
| 麦克风权限被拒绝 | 非安全上下文（http + 非 localhost） | 必须使用 HTTPS（正式或自签证书）或 localhost 访问 |
| 服务器 CPU/带宽很高 | 房间人数过多（Mesh） | 控制每房间 ≤10 人；降低音质预设；为大房间规划 SFU |
| `database is locked` | 多个进程/实例共用同一数据库文件 | 只运行一个 AirMic 实例；确认没有两个服务指向同一 `DATABASE_PATH` |
| 时间/会话异常 | 服务器时钟漂移 | 启用 NTP（`timedatectl set-ntp true`）；JWT 与会话过期依赖系统时间 |
| Docker 健康检查 unhealthy | 容器启动失败 / 端口被改 | `docker compose logs airmic`；确认 `PORT` 与健康检查端口一致 |

### 9.4 端口一览

| 端口 | 协议 | 用途 | 建议暴露范围 |
| --- | --- | --- | --- |
| 3000 | TCP | AirMic HTTP/HTTPS（默认） | 仅本机 / 反向代理内部 |
| 80 | TCP | HTTP（跳转/证书签发） | 公网 |
| 443 | TCP | HTTPS / WSS | 公网 |
| 3478 | TCP + UDP | STUN / TURN | 公网（TURN 服务器） |
| 49160-49200 | UDP | TURN 中继数据 | 公网（TURN 服务器） |
| 5349 | TCP | TURN over TLS（可选） | 公网（可选） |
| 443 | TCP/UDP | 备选 TURN/TLS（独立 IP） | 仅在需要 443 穿透时 |
| 5173 | TCP | Vite 开发服务器 | 仅开发机 |

## 10. 安全清单（上线前逐项确认）

- [ ] `JWT_SECRET` 足够随机且未泄露；更换后所有用户需重新登录。
- [ ] 全站 HTTPS，HTTP 自动跳转 HTTPS，启用 HSTS。
- [ ] AirMic 仅监听 `127.0.0.1:3000`，公网只开放 80/443 与 TURN 必要端口。
- [ ] 反向代理后设置 `TRUST_PROXY=true`，且代理会覆盖而不是透传客户端伪造的 `X-Forwarded-For`。
- [ ] 管理后台使用邀请码/关闭注册，管理员强密码；定期检查登录会话与审计日志。
- [ ] coturn 使用强密码，开启 `no-cli`，定期轮换；只放行必要端口。
- [ ] 定期备份并异地保存；至少每月演练一次恢复流程。
- [ ] 以非 root 运行（systemd `User=airmic` / Docker `USER node`）；及时更新 Node.js 与依赖安全补丁。
- [ ] 不要提交 `.env`、`data/`、`certs/`；限制文件权限（`.env` 600）。
- [ ] 监控 `/api/health` 与磁盘空间（SQLite、备份、日志）。

## 附：部署文件索引

| 文件 | 用途 |
| --- | --- |
| [Dockerfile](../Dockerfile) | 多阶段生产镜像（非 root、健康检查、`/data` 数据目录） |
| [docker-compose.yml](../docker-compose.yml) | airmic 服务 + 可选 coturn（`--profile turn`） |
| [deploy/nginx.conf](../deploy/nginx.conf) | Nginx HTTPS + WebSocket 反向代理完整示例 |
| [deploy/coturn.conf](../deploy/coturn.conf) | coturn TURN 配置示例 |
| [deploy/airmic.service](../deploy/airmic.service) | systemd 单元示例 |
| [deploy/Caddyfile](../deploy/Caddyfile) | Caddy 自动 HTTPS + WebSocket 反向代理示例 |
| [scripts/backup.mjs](../scripts/backup.mjs) | 数据库备份（VACUUM INTO + 校验 + 轮换） |
| [scripts/generate-cert.mjs](../scripts/generate-cert.mjs) | 局域网自签 HTTPS 证书 |
| [.env.example](../.env.example) | 环境变量模板与说明 |
