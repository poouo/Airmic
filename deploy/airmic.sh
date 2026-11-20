#!/usr/bin/env bash
# AirMic 部署 CLI 的 bash 包装脚本（Linux / macOS / Git Bash / WSL）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/airmic-cli.mjs" "$@"
