#!/usr/bin/env bash
#
# AirMic 一键安装 / 升级 / 卸载 引导脚本（Linux / macOS / WSL）
#
# 用法（推荐，无需 clone 仓库）：
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --language zh-CN
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --mode docker --language zh-CN
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- upgrade
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- uninstall --purge
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- status
#
# 说明：
#   - 脚本只下载部署 CLI 并交给它执行；默认安装/升级从 GitHub Release 下载预构建包，
#     不在本机编译（适合低配 VPS）。开发者需要源码构建时加 --build。
#   - 若系统没有 Node.js >= 22.13，会下载官方 Node 二进制到安装目录 .runtime/ 下（不污染系统）。
#   - 所有 AirMic 文件都放在安装目录中（默认 ~/.airmic，可用 --dir 或 AIRMIC_HOME 修改）。
#
# 环境变量：
#   AIRMIC_REPO=poouo/Airmic        GitHub 仓库
#   AIRMIC_REF=main                 下载部署 CLI 的 git ref（可指向 tag）
#   AIRMIC_HOME=~/.airmic           安装目录
#   AIRMIC_NODE_VERSION=22.19.0     自动下载的 Node 版本
#   AIRMIC_SKIP_NODE_INSTALL=1      缺少 Node 时不自动下载
#   GITHUB_TOKEN=...                可选，提高 GitHub API 限额
#
set -euo pipefail

REPO="${AIRMIC_REPO:-poouo/Airmic}"
REF="${AIRMIC_REF:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"
NODE_VERSION="${AIRMIC_NODE_VERSION:-22.19.0}"
HOME_DIR="${AIRMIC_HOME:-$HOME/.airmic}"
ACTION="install"
PASSTHROUGH=()

log() { printf "\033[36m[AirMic]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[AirMic]\033[0m %s\n" "$*" >&2; }
fail() { printf "\033[31m[AirMic]\033[0m %s\n" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,30p' "$0" 2>/dev/null || true
  exit 0
fi

# 第一个参数可以是动作；其余透传给部署 CLI
if [ "$#" -gt 0 ]; then
  case "$1" in
    install|upgrade|uninstall|status|start|stop|restart|logs|check-update|version)
      ACTION="$1"
      shift
      ;;
  esac
fi

# 过滤 --language / --lang（AirMic 目前只有中文界面，保持与参考一键脚本参数兼容）
while [ "$#" -gt 0 ]; do
  case "$1" in
    --language|--lang)
      shift
      [ "$#" -gt 0 ] && shift
      ;;
    --language=*|--lang=*)
      shift
      ;;
    *)
      PASSTHROUGH+=("$1")
      shift
      ;;
  esac
done

need_cmd curl
need_cmd tar

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t airmic)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

log "下载 AirMic 部署 CLI（${REPO}@${REF}）..."
curl -fsSL --retry 3 --connect-timeout 15 "${RAW}/deploy/airmic-cli.mjs" -o "${TMP_DIR}/airmic-cli.mjs" \
  || fail "下载 airmic-cli.mjs 失败，请检查网络或 AIRMIC_REPO/AIRMIC_REF"
[ -s "${TMP_DIR}/airmic-cli.mjs" ] || fail "下载的 airmic-cli.mjs 为空"

# 查找可用 Node（>= 22.13）
node_ok() {
  local candidate="$1"
  [ -n "$candidate" ] || return 1
  command -v "$candidate" >/dev/null 2>&1 || return 1
  local version
  version="$("$candidate" -p "process.versions.node" 2>/dev/null || true)"
  [ -n "$version" ] || return 1
  local major minor
  major="${version%%.*}"
  minor="$(echo "$version" | cut -d. -f2)"
  if [ "${major:-0}" -gt 22 ] || { [ "${major:-0}" -eq 22 ] && [ "${minor:-0}" -ge 13 ]; }; then
    return 0
  fi
  return 1
}

NODE_BIN="$(command -v node 2>/dev/null || true)"
if ! node_ok "$NODE_BIN"; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    *) fail "不支持的 CPU 架构：$ARCH，请手动安装 Node.js >= 22.13" ;;
  esac
  case "$(uname -s)" in
    Linux) NODE_OS="linux" ;;
    Darwin) NODE_OS="darwin" ;;
    *) fail "不支持的系统：$(uname -s)，请手动安装 Node.js >= 22.13" ;;
  esac
  if [ "${AIRMIC_SKIP_NODE_INSTALL:-0}" = "1" ]; then
    fail "未检测到 Node.js >= 22.13（当前：${NODE_BIN:-$("$NODE_BIN" -v 2>/dev/null || echo 未安装)}）"
  fi
  mkdir -p "${HOME_DIR}/.runtime"
  NODE_DIR="${HOME_DIR}/.runtime/node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}"
  if [ ! -x "${NODE_DIR}/bin/node" ]; then
    log "未检测到 Node.js >= 22.13，下载官方 Node v${NODE_VERSION}（${NODE_OS}-${NODE_ARCH}）到安装目录..."
    NODE_TARBALL="node-v${NODE_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.gz"
    curl -fsSL --retry 3 --connect-timeout 20 "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}" -o "${TMP_DIR}/${NODE_TARBALL}" \
      || fail "下载 Node.js 失败，请手动安装 Node.js >= 22.13 后重试"
    mkdir -p "${TMP_DIR}/node"
    tar -xzf "${TMP_DIR}/${NODE_TARBALL}" -C "${TMP_DIR}/node" --strip-components=1
    rm -rf "${NODE_DIR}"
    mkdir -p "$(dirname "${NODE_DIR}")"
    mv "${TMP_DIR}/node" "${NODE_DIR}"
    chmod +x "${NODE_DIR}/bin/node"
  fi
  NODE_BIN="${NODE_DIR}/bin/node"
  node_ok "$NODE_BIN" || fail "Node.js 安装失败：$NODE_BIN"
  log "使用安装目录内的 Node.js $("$NODE_BIN" -v)"
fi
log "Node.js 版本：$("$NODE_BIN" -v)"

mkdir -p "${HOME_DIR}"
CLI="${TMP_DIR}/airmic-cli.mjs"
EXTRA_ARGS=()
if [ "${#PASSTHROUGH[@]}" -gt 0 ]; then
  for arg in "${PASSTHROUGH[@]}"; do EXTRA_ARGS+=("$arg"); done
fi

# 非交互安装/升级时自动确认；用户显式传 --dir 时以用户为准
HAS_DIR=0
HAS_YES=0
for arg in ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; do
  [ "$arg" = "--dir" ] && HAS_DIR=1
  [ "$arg" = "--yes" ] && HAS_YES=1
done
case "$ACTION" in
  install|upgrade|uninstall)
    if [ ! -t 0 ] && [ "$HAS_YES" = "0" ]; then EXTRA_ARGS+=("--yes"); fi
    ;;
esac
if [ "$HAS_DIR" = "0" ]; then EXTRA_ARGS+=("--dir" "${HOME_DIR}"); fi

log "执行：airmic $ACTION（安装目录：${HOME_DIR}）"
exec "$NODE_BIN" "$CLI" "$ACTION" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}