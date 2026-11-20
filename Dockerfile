# syntax=docker/dockerfile:1
# =============================================================================
# AirMic 多阶段镜像
#   builder   : 安装全部依赖并构建 shared / server / web
#   prod-deps : 只安装生产依赖（workspace 链接由 npm 生成）
#   runtime   : 复制构建产物与生产依赖，以非 root 用户运行
#
# 构建：docker build -t airmic:latest .
# 运行：docker run -d --name airmic -p 9811:9811 -v airmic-data:/data \
#         -e JWT_SECRET=... -e TRUST_PROXY=true \
#         -e LIVEKIT_URL=ws://localhost:7880 -e LIVEKIT_API_KEY=... -e LIVEKIT_API_SECRET=... \
#         airmic:latest
#
# 注意：LiveKit SFU 是独立服务，不在本镜像内。完整部署请使用 docker-compose.yml
#       （同时启动 livekit 与 airmic），或单独部署 LiveKit 二进制约（见 docs/DEPLOY.md）。
# =============================================================================
FROM node:24-alpine AS deps
WORKDIR /app

# 先复制 workspace 清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# 生产依赖：不包含 typescript / vite / tsx 等开发依赖
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9811 \
    DATABASE_PATH=/data/airmic.db \
    WEB_DIST=/app/web/dist

WORKDIR /app

# npm workspaces 清单（Node 解析 @airmic/shared 需要 shared/package.json）
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

# 生产依赖（来自 prod-deps 阶段）
COPY --from=prod-deps /app/node_modules ./node_modules

# 修复 workspace 软链接，避免 COPY 过程中符号链接被展开导致解析失败
RUN rm -rf node_modules/@airmic \
    && mkdir -p node_modules/@airmic \
    && ln -s ../../shared node_modules/@airmic/shared \
    && ln -s ../../server node_modules/@airmic/server \
    && ln -s ../../web node_modules/@airmic/web

# 构建产物：shared 的 dist 必须在（server 运行时通过 @airmic/shared 导入它）
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# 备份/证书脚本（容器内可执行 node scripts/backup.mjs）
COPY scripts ./scripts

# 数据目录：SQLite 数据库与备份（建议挂载卷持久化）
RUN mkdir -p /data \
    && chown -R node:node /data

USER node

EXPOSE 9811
VOLUME ["/data"]

# 健康检查（/api/health 由 server 提供；PORT 可通过环境变量覆盖）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 9811) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/dist/index.js"]
