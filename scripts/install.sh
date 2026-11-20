#!/usr/bin/env bash
#
# AirMic 一键安装 / 升级 / 卸载 引导脚本（Linux / macOS / WSL）
#
# 推荐用法（无需 clone 仓库，直接从 GitHub 拉取）：
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --language zh-CN
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --mode docker --language zh-CN
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- upgrade
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- uninstall --purge --yes
#   curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- status
#
# 说明：
#   - 脚本本身只做三件事：准备运行环境（Node / 基础工具 / Docker）、下载部署 CLI、把参数交给 CLI。
#     安装、升级、卸载、状态、日志等全部由部署 CLI 完成。
#   - 默认 --source auto：GitHub 有 Release 预构建资产/GHCR 镜像就用预构建（不编译）；
#     没有就直接从 GitHub 源码归档安装并在本机构建（本地模式 npm ci + build，Docker 模式本地构建镜像）。
#   - 缺少 Node.js >= 22.13 时下载官方二进制到 <安装目录>/.runtime/，不污染系统。
#   - 缺少基础命令（curl/tar/gzip）时按发行版自动用 apt/dnf/yum/pacman/zypper/apk 安装。
#   - 所有 AirMic 文件都放在安装目录中（默认 ~/.airmic，可用 --dir 或 AIRMIC_HOME 修改）。
#
# 环境变量：
#   AIRMIC_REPO=poouo/Airmic          GitHub 仓库
#   AIRMIC_REF=main                   下载脚本/CLI 的 git ref（可指向 tag）
#   AIRMIC_HOME=~/.airmic             安装目录
#   AIRMIC_NODE_VERSION=22.19.0       自动下载的 Node 版本
#   AIRMIC_NODE_MIRROR=               Node 下载镜像（如 https://npmmirror.com/mirrors/node）
#   AIRMIC_RAW_BASE=                  raw 下载镜像（默认 https://raw.githubusercontent.com）
#   AIRMIC_SKIP_NODE_INSTALL=1        缺少 Node 时不自动下载
#   AIRMIC_SKIP_PREREQ=1              不自动安装系统依赖
#   AIRMIC_LANGUAGE=zh-CN             语言（AirMic 界面目前仅简体中文，兼容传参）
#   GITHUB_TOKEN=...                  可选，提高 GitHub API 限额
#
set -euo pipefail

APP_NAME="AirMic"
REPO="${AIRMIC_REPO:-poouo/Airmic}"
REF="${AIRMIC_REF:-main}"
REF_EXPLICIT=0
REPO_EXPLICIT=0
[ -z "${AIRMIC_REF:-}" ] || REF_EXPLICIT=1
[ -z "${AIRMIC_REPO:-}" ] || REPO_EXPLICIT=1
NODE_VERSION="${AIRMIC_NODE_VERSION:-22.19.0}"
NODE_MIRROR="${AIRMIC_NODE_MIRROR:-}"
RAW_BASE="${AIRMIC_RAW_BASE:-https://raw.githubusercontent.com}"
DEFAULT_HOME="${HOME:-/root}/.airmic"
HOME_DIR="${AIRMIC_HOME:-$DEFAULT_HOME}"
LANG_CODE="${AIRMIC_LANGUAGE:-zh-CN}"
ACTION="install"
MODE=""
SOURCE=""
BUILD=0
FROM=0
PASS_ARGS=()
DRY_RUN="${AIRMIC_DRY_RUN:-0}"
INSTALL_DOCKER=0
HAS_YES=0
TMP_DIR=""
TMP_PARENT=""
SUDO=""
OS=""
ARCH=""
LIBC="glibc"
DISTRO=""
PM=""
NODE_BIN=""
NODE_SOURCE=""
CLI_PATH=""
LOCAL_CLI=""

if [ -t 1 ]; then
  C_CYAN='\033[36m'
  C_YELLOW='\033[33m'
  C_RED='\033[31m'
  C_GREEN='\033[32m'
  C_RESET='\033[0m'
else
  C_CYAN='' C_YELLOW='' C_RED='' C_GREEN='' C_RESET=''
fi

log() { printf '%b[AirMic]%b %s\n' "$C_CYAN" "$C_RESET" "$*"; }
warn() { printf '%b[AirMic]%b %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
ok() { printf '%b[AirMic]%b %s\n' "$C_GREEN" "$C_RESET" "$*"; }
fail() {
  printf '%b[AirMic]%b %s\n' "$C_RED" "$C_RESET" "$*" >&2
  printf '%b[AirMic]%b 已中止。问题反馈：https://github.com/%s/issues\n' "$C_RED" "$C_RESET" "$REPO" >&2
  exit 1
}

# 统一的分区标题：与部署 CLI 的安装/升级/状态输出保持同一套观感
banner() {
  local title="$1"
  shift
  printf '\n%b==============================================%b\n' "$C_CYAN" "$C_RESET"
  printf ' %s\n' "$title"
  if [ "$#" -gt 0 ]; then
    printf '%b----------------------------------------------%b\n' "$C_CYAN" "$C_RESET"
    local row
    for row in "$@"; do printf ' %s\n' "$row"; done
  fi
  printf '%b==============================================%b\n\n' "$C_CYAN" "$C_RESET"
}

# 引导阶段进度：[1/3] 检查系统与基础工具
phase() { printf '%b[%s/%s]%b %s\n' "$C_CYAN" "$1" "$2" "$C_RESET" "$3"; }

have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'USAGE'

AirMic 一键安装引导脚本（Linux / macOS / WSL）

用法：
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- <动作> [选项]
  bash install.sh <动作> [选项]                      # 已下载到本地时

动作：
  install        安装（默认本地模式；Docker 模式加 --mode docker）
  upgrade        升级（自动识别本地/Docker 模式与来源）
  uninstall      卸载（默认保留 data/ 与 backups/，加 --purge 删除 AirMic 数据）
  start|stop|restart   启动 / 停止 / 重启
  status         查看部署状态
  logs           查看日志（可用 --lines 200）
  check-update   检查 GitHub 是否有新版本
  version        显示已安装版本
  help           显示本帮助

常用选项（其余选项原样透传给部署 CLI）：
  --mode local|docker     部署模式（默认 local）
  --dir <路径>            安装目录（默认 ~/.airmic，或环境变量 AIRMIC_HOME）
  --source auto|release|github|local
                          安装来源（默认 auto：Release 预构建优先，缺失时直接用 GitHub 源码构建）
  --build                 开发者模式：使用当前仓库源码构建（需要已 clone 仓库）
  --from <包|URL|目录>    从离线预构建包安装/升级
  --port <端口>           AirMic 端口（默认 9811）
  --host <地址>           本地模式监听地址（默认 127.0.0.1）
  --no-livekit            跳过 LiveKit 下载与启动（语音不可用，便于快速验证）
  --livekit-version <v>   指定 LiveKit 版本
  --setup-token [值]      设置初始化口令
  --force                 已安装时强制重装（保留 data/ 与 backups/）
  --yes                   确认卸载（非交互执行时必填）
  --purge                 卸载时连同 data/、backups/ 一起删除
  --json                  check-update 以 JSON 输出
  --ref <git ref>         指定安装的 git ref（分支/Tag，默认 main）
  --repo <owner/name>     指定 GitHub 仓库（默认 poouo/Airmic）
  --language <code>       语言（AirMic 界面目前仅简体中文，兼容保留）
  --install-docker        Docker 缺失时自动安装 Docker Engine 与 Compose v2
  --dry-run               只打印将要执行的动作，不下载、不修改任何文件
  -h, --help              显示本帮助

环境变量：
  AIRMIC_REPO / AIRMIC_REF / AIRMIC_HOME / AIRMIC_NODE_VERSION / AIRMIC_NODE_MIRROR /
  AIRMIC_RAW_BASE / AIRMIC_SKIP_NODE_INSTALL / AIRMIC_SKIP_PREREQ / AIRMIC_LANGUAGE / GITHUB_TOKEN

示例：
  # 本地模式安装（自动准备 Node，无需 clone）
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --language zh-CN
  # Docker 模式安装（缺失 Docker 时自动安装）
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- install --mode docker --install-docker
  # 升级 / 卸载 / 状态
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- upgrade
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- uninstall --purge --yes
  curl -fsSL https://raw.githubusercontent.com/poouo/Airmic/main/scripts/install.sh | bash -s -- status

USAGE
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && [ ! -L "$TMP_DIR" ] &&
    [ "${TMP_DIR%/*}" = "$TMP_PARENT" ] && [[ "${TMP_DIR##*/}" =~ ^airmic-install\.[a-zA-Z0-9]{10}$ ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ============ 参数解析 ============

need_value() {
  [ "$#" -ge 2 ] && [[ "$2" != -* ]] || fail "选项 $1 需要一个值（使用 --help 查看用法）"
}

while [ "$#" -gt 0 ]; do
  arg="$1"
  shift
  case "$arg" in
    -h|--help|help|--usage)
      usage
      exit 0
      ;;
    --dry-run) DRY_RUN=1 ;;
    --install-docker) INSTALL_DOCKER=1 ;;
    -y|--yes)
      HAS_YES=1
      PASS_ARGS+=("--yes")
      ;;
    --language|--lang)
      need_value "$arg" "$@"
      LANG_CODE="$1"
      shift
      ;;
    --language=*|--lang=*)
      LANG_CODE="${arg#*=}"
      ;;
    --mode)
      need_value "$arg" "$@"
      MODE="$1"
      shift
      PASS_ARGS+=("--mode" "$MODE")
      ;;
    --mode=*)
      MODE="${arg#*=}"
      PASS_ARGS+=("--mode" "$MODE")
      ;;
    --dir)
      need_value "$arg" "$@"
      HOME_DIR="$1"
      shift
      ;;
    --dir=*)
      HOME_DIR="${arg#*=}"
      ;;
    --ref)
      need_value "$arg" "$@"
      REF="$1"
      REF_EXPLICIT=1
      shift
      ;;
    --ref=*)
      REF="${arg#*=}"
      REF_EXPLICIT=1
      ;;
    --repo)
      need_value "$arg" "$@"
      REPO="$1"
      REPO_EXPLICIT=1
      shift
      ;;
    --repo=*)
      REPO="${arg#*=}"
      REPO_EXPLICIT=1
      ;;
    --source|--from|--port|--host|--livekit-version|--lines)
      need_value "$arg" "$@"
      [ "$arg" != "--source" ] || SOURCE="$1"
      [ "$arg" != "--from" ] || FROM=1
      PASS_ARGS+=("$arg=$1")
      shift
      ;;
    --source=*)
      SOURCE="${arg#*=}"
      PASS_ARGS+=("$arg")
      ;;
    --build)
      BUILD=1
      PASS_ARGS+=("$arg")
      ;;
    --from=*)
      FROM=1
      PASS_ARGS+=("$arg")
      ;;
    --setup-token)
      if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
        PASS_ARGS+=("$arg=$1")
        shift
      else
        PASS_ARGS+=("$arg")
      fi
      ;;
    update) ACTION="upgrade" ;;
    remove) ACTION="uninstall" ;;
    install|upgrade|uninstall|status|start|stop|restart|logs|check-update|version)
      ACTION="$arg"
      ;;
    -*)
      PASS_ARGS+=("$arg")
      ;;
    *)
      fail "无法识别的参数：$arg（使用 --help 查看用法）"
      ;;
  esac
done

[[ "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]] && [[ ! "$REPO" =~ /\.{1,2}$ ]] || fail "--repo 需要有效的 GitHub owner/name"
[[ "$REF" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$ ]] && [[ "/$REF/" != */../* ]] || fail "--ref 无效"
[[ "$NODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "AIRMIC_NODE_VERSION 必须为 major.minor.patch"
[ -n "$HOME_DIR" ] || fail "--dir 需要一个安装目录路径"
PASS_ARGS+=("--dir=$HOME_DIR")
[ "$REPO_EXPLICIT" -eq 0 ] || PASS_ARGS+=("--repo=$REPO")
[ "$REF_EXPLICIT" -eq 0 ] || PASS_ARGS+=("--ref=$REF")

# 非交互执行（curl | bash、CI 等）时自动确认安装/升级；卸载仍需显式 --yes
if [ "$HAS_YES" -eq 0 ] && [ ! -t 0 ] && [[ "$ACTION" =~ ^(install|upgrade)$ ]]; then
  PASS_ARGS+=("--yes")
  HAS_YES=1
fi

# ============ 平台检测 ============

detect_platform() {
  local uname_s uname_m
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  uname_m="$(uname -m 2>/dev/null || echo unknown)"

  case "$uname_s" in
    Linux*) OS="linux" ;;
    Darwin*) OS="darwin" ;;
    FreeBSD*) fail "暂不支持 FreeBSD；请使用 Docker 部署或参照 docs/DEPLOY.md 手动安装。" ;;
    MINGW*|MSYS*|CYGWIN*|Windows*)
      fail "检测到 Windows 的 Bash 环境。请用 PowerShell 运行 README 中的一键命令。"
      ;;
    *) fail "不支持的系统：$uname_s（支持 Linux / macOS / WSL）。" ;;
  esac

  case "$uname_m" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    armv7l|armv7|armv8l) ARCH="armv7l" ;;
    *)
      fail "不支持的 CPU 架构：$uname_m（支持 x86_64 / aarch64 / armv7l）。"
      ;;
  esac

  if [ "$OS" = "linux" ]; then
    LIBC="glibc"
    if [ -f /etc/alpine-release ]; then
      LIBC="musl"
    elif have ldd && ldd --version 2>&1 | head -n 1 | grep -qi musl; then
      LIBC="musl"
    fi
  else
    LIBC="libc"
  fi

  if [ -r /etc/os-release ]; then
    DISTRO="$( (unset PRETTY_NAME ID; . /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-${ID:-}}") 2>/dev/null || true )"
  fi
  if [ -z "$DISTRO" ]; then
    if [ "$OS" = "darwin" ]; then
      DISTRO="macOS $(sw_vers -productVersion 2>/dev/null || true)"
    elif [ "$OS" = "linux" ]; then
      DISTRO="Linux ($(uname -r 2>/dev/null || echo unknown))"
    fi
  fi
  DISTRO="${DISTRO:-未知系统}"
}

describe_platform() {
  echo "$DISTRO · $OS/$ARCH · $LIBC"
}

# ============ 权限与包管理器 ============

detect_sudo() {
  SUDO=""
  if [ "$(id -u 2>/dev/null || echo 1000)" = "0" ]; then
    return 0
  fi
  if have sudo; then
    SUDO="sudo"
  fi
}

as_root() {
  if [ -n "$SUDO" ]; then
    $SUDO "$@"
  else
    "$@"
  fi
}

ensure_root_access() {
  if [ "$(id -u 2>/dev/null || echo 1000)" = "0" ]; then
    return 0
  fi
  have sudo || fail "需要 root 或 sudo 才能安装系统依赖。请用 root 运行，或先手动安装依赖后重试。"
  if sudo -n true 2>/dev/null; then
    return 0
  fi
  if [ -t 1 ] && [ -r /dev/tty ]; then
    log "需要 sudo 权限安装系统依赖，请输入密码 ..."
    sudo -v < /dev/tty || fail "sudo 认证失败。"
    return 0
  fi
  fail "当前为非交互环境且没有免密码 sudo，无法自动安装系统依赖。请用 root 运行，或先安装依赖（curl tar gzip ca-certificates docker）后重试。"
}

detect_pm() {
  [ -n "$PM" ] && { echo "$PM"; return 0; }
  local candidate
  for candidate in apt-get dnf yum pacman zypper apk; do
    if have "$candidate"; then
      PM="$candidate"
      echo "$PM"
      return 0
    fi
  done
  echo "none"
}

pm_install() {
  local pm
  pm="$(detect_pm)"
  [ "$pm" != "none" ] || fail "未识别的包管理器，无法自动安装：$*。请手动安装后重试。"
  ensure_root_access
  case "$pm" in
    apt-get)
      as_root env DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || warn "apt-get update 失败，继续尝试安装 ..."
      as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
      ;;
    dnf|yum)
      as_root "$pm" install -y "$@"
      ;;
    pacman)
      as_root pacman -Sy --noconfirm --needed "$@"
      ;;
    zypper)
      as_root zypper --non-interactive install "$@"
      ;;
    apk)
      as_root apk add --no-cache "$@"
      ;;
  esac
}

# ============ 基础工具 ============

ensure_base_tools() {
  local missing="" cmd
  if ! have curl && ! have wget; then
    missing="$missing curl"
  fi
  for cmd in tar gzip; do
    have "$cmd" || missing="$missing $cmd"
  done
  [ -n "$missing" ] || return 0

  if [ "${AIRMIC_SKIP_PREREQ:-0}" = "1" ]; then
    fail "缺少基础命令：$missing（已设置 AIRMIC_SKIP_PREREQ=1，不自动安装）。请手动安装后重试。"
  fi
  log "缺少基础命令：$missing，尝试自动安装 ..."
  case "$(detect_pm)" in
    apt-get) pm_install ca-certificates curl tar gzip || fail "自动安装基础依赖失败，请手动安装：$missing" ;;
    dnf|yum) pm_install ca-certificates curl tar gzip || fail "自动安装基础依赖失败，请手动安装：$missing" ;;
    pacman) pm_install ca-certificates curl tar gzip || fail "自动安装基础依赖失败，请手动安装：$missing" ;;
    zypper) pm_install ca-certificates curl tar gzip || fail "自动安装基础依赖失败，请手动安装：$missing" ;;
    apk) pm_install ca-certificates curl tar gzip || fail "自动安装基础依赖失败，请手动安装：$missing" ;;
    *) fail "缺少基础命令：$missing，且未识别包管理器。请手动安装后重试。" ;;
  esac
  if ! have curl && ! have wget; then
    fail "基础依赖安装后仍缺少 curl/wget，请手动安装后重试。"
  fi
}

fetch_to() {
  local url="$1" dest="$2"
  if have curl; then
    curl -fsSL --retry 3 --connect-timeout 15 --max-time 900 "$url" -o "$dest"
  elif have wget; then
    wget -q -O "$dest" --tries=3 --timeout=20 --timeout=900 "$url"
  else
    fail "缺少 curl/wget，无法下载：$url"
  fi
}

# ============ Node.js ============

node_ok() {
  local candidate="$1" version major minor
  [ -n "$candidate" ] || return 1
  command -v "$candidate" >/dev/null 2>&1 || return 1
  version="$("$candidate" -p 'process.versions.node' 2>/dev/null || true)"
  [ -n "$version" ] || return 1
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; then return 0; fi
  return 1
}

node_download_base() {
  if [ -n "$NODE_MIRROR" ]; then
    echo "${NODE_MIRROR%/}"
    return 0
  fi
  if [ "$OS" = "linux" ] && [ "$LIBC" = "musl" ]; then
    echo "https://unofficial-builds.nodejs.org/download/release"
    return 0
  fi
  echo "https://nodejs.org/dist"
}

node_tarball_name() {
  if [ "$OS" = "linux" ] && [ "$LIBC" = "musl" ]; then
    echo "node-v${NODE_VERSION}-linux-${ARCH}-musl.tar.gz"
    return 0
  fi
  echo "node-v${NODE_VERSION}-${OS}-${ARCH}.tar.gz"
}

install_node_from_archive() {
  local base tarball url extract root expected actual
  base="$(node_download_base)"
  tarball="$(node_tarball_name)"
  url="${base}/v${NODE_VERSION}/${tarball}"

  log "未检测到 Node.js >= 22.13，下载官方 Node v${NODE_VERSION}（$(describe_platform)）..."
  log "  下载地址：$url"
  fetch_to "$url" "$TMP_DIR/$tarball" || return 1
  fetch_to "$base/v${NODE_VERSION}/SHASUMS256.txt" "$TMP_DIR/SHASUMS256.txt" || return 1
  expected="$(awk -v name="$tarball" '$2 == name || $2 == "*" name { print $1; exit }' "$TMP_DIR/SHASUMS256.txt")"
  if have sha256sum; then
    actual="$(sha256sum < "$TMP_DIR/$tarball")" || return 1
  else
    actual="$(shasum -a 256 < "$TMP_DIR/$tarball")" || return 1
  fi
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] && [ "${actual%% *}" = "$expected" ] || return 1

  extract="$TMP_DIR/node-extract"
  mkdir "$extract" || return 1
  tar -xzf "$TMP_DIR/$tarball" -C "$extract" || return 1

  root=""
  for candidate in "$extract"/*/; do
    root="${candidate%/}"
    break
  done
  [ -n "$root" ] && [ -x "$root/bin/node" ] || return 1

  NODE_BIN="$root/bin/node"
  node_ok "$NODE_BIN" || return 1
  NODE_SOURCE="runtime"
  return 0
}

ensure_node() {
  local candidate
  candidate="$(command -v node 2>/dev/null || true)"
  if node_ok "$candidate"; then
    NODE_BIN="$candidate"
    NODE_SOURCE="system"
    log "使用系统 Node.js：$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
    return 0
  fi
  if [ "${AIRMIC_SKIP_NODE_INSTALL:-0}" = "1" ]; then
    fail "未检测到 Node.js >= 22.13，且已设置 AIRMIC_SKIP_NODE_INSTALL=1。请手动安装 Node.js 22.13+ 后重试。"
  fi
  if [ -n "$candidate" ]; then
    warn "当前 Node.js 版本过低：$("$candidate" -v 2>/dev/null || echo unknown)（需要 >= 22.13）"
  fi
  if ! install_node_from_archive; then
    fail "Node.js 自动安装失败。请手动安装 Node.js 22.13+（或设置 AIRMIC_NODE_MIRROR 使用国内镜像）后重试。"
  fi
  log "Node.js 就绪：$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
}

cache_node_runtime() {
  local staged candidate target
  staged="${NODE_BIN%/bin/node}"
  for candidate in "$HOME_DIR"/.runtime/"${staged##*/}"*; do
    if [ -d "$candidate" ] && [ ! -L "$candidate" ] && [ ! -L "$candidate/bin" ] &&
      [ ! -L "$candidate/bin/node" ] && node_ok "$candidate/bin/node"; then
      NODE_BIN="$candidate/bin/node"
      return
    fi
  done
  target="$(mktemp -d "$HOME_DIR/.runtime/${staged##*/}.XXXXXXXXXX")" || fail "创建 Node.js 运行时目录失败"
  cp -R "$staged/." "$target" || fail "保存 Node.js 运行时失败"
  NODE_BIN="$target/bin/node"
}

# ============ Docker ============

docker_cli_ready() { have docker; }

docker_compose_ready() {
  have docker || return 1
  docker compose version >/dev/null 2>&1
}

docker_daemon_ready() { have docker && docker info >/dev/null 2>&1; }

install_compose_plugin() {
  local compose_arch plugin_dir url
  case "$ARCH" in
    x64) compose_arch="x86_64" ;;
    arm64) compose_arch="aarch64" ;;
    armv7l) compose_arch="armv7" ;;
    *) warn "未知架构 $ARCH，跳过 Compose 插件下载"; return 1 ;;
  esac
  plugin_dir="$HOME/.docker/cli-plugins"
  mkdir -p "$plugin_dir" || return 1
  url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${compose_arch}"
  log "下载 Docker Compose v2 插件：$url"
  fetch_to "$url" "$plugin_dir/docker-compose" || return 1
  chmod +x "$plugin_dir/docker-compose" 2>/dev/null || true
  docker compose version >/dev/null 2>&1
}

install_docker_packages() {
  ensure_base_tools
  local pm
  pm="$(detect_pm)"
  log "使用 $pm 安装 Docker Engine ..."
  case "$pm" in
    apt-get)
      pm_install ca-certificates curl docker.io || return 1
      pm_install docker-compose-v2 >/dev/null 2>&1 || pm_install docker-compose-plugin >/dev/null 2>&1 || true
      ;;
    dnf|yum)
      pm_install ca-certificates curl docker >/dev/null 2>&1 || pm_install ca-certificates curl moby-engine || return 1
      pm_install docker-compose-plugin >/dev/null 2>&1 || pm_install docker-compose >/dev/null 2>&1 || true
      ;;
    pacman)
      pm_install ca-certificates curl docker docker-compose || return 1
      ;;
    zypper)
      pm_install ca-certificates curl docker docker-compose || return 1
      ;;
    apk)
      pm_install ca-certificates curl docker docker-cli-compose || return 1
      ;;
    *)
      return 1
      ;;
  esac
  return 0
}

start_docker_daemon() {
  if [ -d /run/systemd/system ] && have systemctl; then
    as_root systemctl enable --now docker >/dev/null 2>&1 || as_root systemctl start docker >/dev/null 2>&1 || true
    return 0
  fi
  if have rc-service; then
    as_root rc-update add docker default >/dev/null 2>&1 || true
    as_root rc-service docker start >/dev/null 2>&1 || true
    return 0
  fi
  if have service; then
    as_root service docker start >/dev/null 2>&1 || true
    return 0
  fi
  warn "未检测到 systemd/OpenRC/SysV，无法自动启动 Docker 守护进程，请手动启动 dockerd。"
  return 0
}

wait_docker_daemon() {
  local i
  i=0
  while [ "$i" -lt 20 ]; do
    if docker_daemon_ready; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

ensure_docker_access() {
  if docker_daemon_ready; then
    return 0
  fi
  if [ "$(id -u 2>/dev/null || echo 1000)" = "0" ]; then
    warn "docker 已安装但无法连接 dockerd，请检查 Docker 服务状态（systemctl status docker）。"
    return 1
  fi
  have sudo || return 1
  if ! sudo -n docker info >/dev/null 2>&1; then
    if [ -t 1 ] && [ -r /dev/tty ]; then
      log "当前用户不在 docker 组，尝试通过 sudo 调用 docker ..."
      sudo -v < /dev/tty || return 1
    else
      sudo -v 2>/dev/null || return 1
    fi
  fi
  if sudo docker info >/dev/null 2>&1; then
    mkdir -p "$TMP_DIR/bin"
    cat >"$TMP_DIR/bin/docker" <<'SHIM'
#!/bin/sh
# AirMic 自动生成：当前用户不在 docker 组，通过 sudo 调用 docker
exec sudo docker "$@"
SHIM
    chmod +x "$TMP_DIR/bin/docker"
    PATH="$TMP_DIR/bin:$PATH"
    export PATH
    warn "已改用 sudo 调用 docker。建议执行：sudo usermod -aG docker $USER 并重新登录，之后无需 sudo。"
    return 0
  fi
  return 1
}

ensure_docker() {
  local need_install=0
  if ! docker_cli_ready; then
    need_install=1
  fi

  if [ "$need_install" = "1" ]; then
    if [ "${INSTALL_DOCKER:-0}" != "1" ]; then
      fail "未找到 docker 命令。请先安装 Docker Engine + Compose v2，或加 --install-docker 让脚本自动安装。\n提示：Debian/Ubuntu 用 apt-get install -y docker.io docker-compose-v2；macOS 请安装 Docker Desktop。"
    fi
    log "未检测到 Docker，开始自动安装（--install-docker）..."
    install_docker_packages || fail "Docker 自动安装失败。请手动安装 Docker Engine + Compose v2 后重试，或改用 --mode local。"
    start_docker_daemon
    if ! wait_docker_daemon; then
      fail "Docker 已安装但守护进程未运行。请执行 systemctl start docker（或 rc-service docker start）后重试。"
    fi
    ok "Docker 安装完成：$(docker --version 2>/dev/null || echo unknown)"
  fi

  if ! docker_compose_ready; then
    warn "未检测到 Docker Compose v2，尝试安装 Compose 插件 ..."
    if ! install_compose_plugin; then
      fail "未检测到 Docker Compose v2。请安装 docker compose v2 后重试（或改用 --mode local）。"
    fi
    ok "Docker Compose v2 就绪：$(docker compose version 2>/dev/null | head -n 1)"
  fi

  ensure_docker_access || fail "无法访问 Docker 守护进程。请确认 Docker 正在运行，并把当前用户加入 docker 组（sudo usermod -aG docker \$USER 后重新登录），或改用 --mode local。"
}

# ============ 下载部署 CLI ============

download_cli() {
  local raw base
  raw="${RAW_BASE%/}/${REPO}/main"
  base="$TMP_DIR"

  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] 将下载部署 CLI：${raw}/deploy/airmic-cli.mjs"
    return 0
  fi

  log "下载 AirMic 部署 CLI（${REPO}@main）..."
  fetch_to "${raw}/deploy/airmic-cli.mjs" "$base/airmic-cli.mjs" || return 1
  [ -s "$base/airmic-cli.mjs" ] || return 1
  grep -q "AirMic" "$base/airmic-cli.mjs" 2>/dev/null || return 1

  for name in airmic.sh airmic.ps1 airmic.cmd; do
    if fetch_to "${raw}/deploy/${name}" "$base/${name}" >/dev/null 2>&1; then
      :
    else
      warn "可选文件下载失败：deploy/${name}（不影响安装，CLI 会自动生成包装脚本）"
    fi
  done
  CLI_PATH="$base/airmic-cli.mjs"
  return 0
}

# ============ 输出计划（--dry-run） ============

print_plan() {
  local mode_label node_label cli_label docker_label action_label
  mode_label="$MODE"
  [ -n "$mode_label" ] || mode_label="local（默认）"
  case "$ACTION" in
    install) action_label="安装" ;;
    upgrade) action_label="升级" ;;
    uninstall) action_label="卸载" ;;
    *) action_label="$ACTION" ;;
  esac

  if node_ok "$(command -v node 2>/dev/null || true)"; then
    node_label="使用系统 Node.js：$(node -v 2>/dev/null || echo unknown)"
  else
    node_label="将下载并校验 Node v${NODE_VERSION}"
  fi

  if [ -n "$LOCAL_CLI" ]; then
    cli_label="使用当前仓库的 CLI：$LOCAL_CLI"
  else
    cli_label="下载 ${RAW_BASE%/}/${REPO}/main/deploy/airmic-cli.mjs"
  fi

  case "$MODE" in
    docker|docker-up|docker-down|docker-logs|docker-status)
      if docker_compose_ready; then
        docker_label="已就绪：$(docker --version 2>/dev/null | head -n 1)"
      elif [ "${INSTALL_DOCKER:-0}" = "1" ]; then
        if [ "$(detect_pm)" = "none" ]; then
          docker_label="将自动安装 Docker，但未识别包管理器（预计失败，请手动安装 Docker Engine + Compose v2）"
        else
          docker_label="将使用 $(detect_pm) 自动安装 Docker Engine + Compose v2"
        fi
      else
        docker_label="未检测到 Docker（实际执行时会报错，可加 --install-docker）"
      fi
      ;;
    *)
      docker_label="不需要（本地模式）"
      ;;
  esac

  banner "${APP_NAME} 一键安装计划（--dry-run，不会修改任何文件）" \
    "动作      : ${action_label}（${ACTION}）" \
    "系统      : $(describe_platform)" \
    "安装目录  : ${HOME_DIR}" \
    "部署模式  : ${mode_label}" \
    "语言      : ${LANG_CODE}（AirMic 界面目前仅简体中文）" \
    "Node.js   : ${node_label}" \
    "部署 CLI  : ${cli_label}" \
    "Docker    : ${docker_label}" \
    "转发参数  : ${PASS_ARGS[*]:-（无）}" \
    "非交互确认: ${HAS_YES}"
  log "去掉 --dry-run 即可开始执行。"
}

# ============ 主流程 ============

main() {
  local validate_args validated_home code cache_runtime=0
  detect_platform
  detect_sudo

  if [ "$FROM" = "0" ] && { [ "$SOURCE" = "local" ] || { [ "$BUILD" = "1" ] && [[ "$SOURCE" =~ ^(auto|release)?$ ]]; }; }; then
    [ -n "${BASH_SOURCE[0]:-}" ] || fail "本地源码构建请从 AirMic 仓库运行 scripts/install.sh"
    LOCAL_CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy/airmic-cli.mjs"
    [ -f "$LOCAL_CLI" ] || fail "找不到本地 AirMic 部署 CLI"
  fi

  if [ "$DRY_RUN" = "1" ]; then
    print_plan
    exit 0
  fi

  local mode_label
  mode_label="$MODE"
  [ -n "$mode_label" ] || mode_label="local（默认）"

  banner "${APP_NAME} 一键安装 · ${ACTION}" \
    "系统      : $(describe_platform)" \
    "动作      : ${ACTION}" \
    "安装目录  : ${HOME_DIR}" \
    "部署模式  : ${mode_label}"

  phase 1 3 "检查系统与基础工具"
  ensure_base_tools
  TMP_PARENT="$(cd -P -- "${TMPDIR:-/tmp}" && pwd -P)" || fail "找不到临时目录"
  [ "$TMP_PARENT" != "/" ] || fail "临时目录不能指向根目录"
  TMP_DIR="$(mktemp -d "$TMP_PARENT/airmic-install.XXXXXXXXXX")" || fail "创建临时目录失败"

  phase 2 3 "准备 Node.js 与部署 CLI"
  if [ -n "$LOCAL_CLI" ]; then
    CLI_PATH="$LOCAL_CLI"
  elif [ -f "$HOME_DIR/bin/airmic-cli.mjs" ] && [[ "$ACTION" =~ ^(status|start|stop|restart|logs|version|check-update|upgrade|uninstall|docker-up|docker-down|docker-logs|docker-status)$ ]]; then
    # 已安装的部署 CLI 优先，管理类命令无需联网重新下载
    CLI_PATH="$HOME_DIR/bin/airmic-cli.mjs"
    log "使用已安装的部署 CLI：$CLI_PATH"
  else
    download_cli || fail "下载部署 CLI 失败。请检查网络或设置 AIRMIC_RAW_BASE。"
  fi
  ensure_node
  validate_args=(__validate-home "--action=$ACTION" "${PASS_ARGS[@]}")
  if [ "$NODE_SOURCE" = "runtime" ] && [[ "$ACTION" =~ ^(install|upgrade|start|restart)$ ]]; then
    cache_runtime=1
    validate_args+=("--prepare-runtime")
  fi
  validated_home="$("$NODE_BIN" "$CLI_PATH" "${validate_args[@]}")" || fail "安装目录校验失败"
  [ -n "$validated_home" ] || fail "部署 CLI 缺少目录校验功能"
  HOME_DIR="$validated_home"
  if [ "$cache_runtime" = "1" ]; then
    cache_node_runtime
  fi
  PATH="$(dirname "$NODE_BIN"):$PATH"
  export PATH

  if [ "$MODE" = "docker" ] && [[ "$ACTION" =~ ^(install|upgrade|start|restart)$ ]]; then
    ensure_docker
  fi

  phase 3 3 "执行 AirMic ${ACTION}"
  code=0
  "$NODE_BIN" "$CLI_PATH" "$ACTION" "${PASS_ARGS[@]}" || code=$?

  if [ "$code" -eq 0 ]; then
    case "$ACTION" in
      install|upgrade)
        printf '\n'
        ok "完成。后续管理命令："
        log "  ${HOME_DIR}/bin/airmic status      # 查看状态"
        log "  ${HOME_DIR}/bin/airmic logs        # 查看日志"
        log "  ${HOME_DIR}/bin/airmic upgrade     # 升级"
        log "  ${HOME_DIR}/bin/airmic uninstall   # 卸载（加 --purge 删除数据）"
        log "下一步：打开上方 CLI 输出的访问地址，在浏览器中完成初始化（创建管理员、配置 LiveKit、设置音质）。"
        ;;
    esac
  else
    warn "AirMic ${ACTION} 未成功（退出码 ${code}）。可执行 ${HOME_DIR}/bin/airmic logs 查看日志。"
    exit "$code"
  fi
  exit 0
}

main "$@"
