#!/usr/bin/env bash
# AirMic 部署 CLI 的 bash 包装脚本（Linux / macOS / Git Bash / WSL）
# 优先使用安装目录内的 Node（<安装目录>/.runtime），其次使用系统 Node
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${AIRMIC_NODE:-}"
if [ -z "$NODE_BIN" ] && [ -d "$HOME_DIR/.runtime" ]; then
  for candidate in "$HOME_DIR"/.runtime/node-*/bin/node; do
    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi
if [ -z "$NODE_BIN" ]; then
  echo "[AirMic] 未找到 Node.js，请先运行 install.sh 或设置 AIRMIC_NODE" >&2
  exit 1
fi
exec "$NODE_BIN" "$SCRIPT_DIR/airmic-cli.mjs" "$@"
