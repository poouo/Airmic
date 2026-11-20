#!/usr/bin/env bash
# 一键本地部署（Node + 本地 LiveKit，不使用 Docker）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/airmic-cli.mjs" install --mode local "$@"
