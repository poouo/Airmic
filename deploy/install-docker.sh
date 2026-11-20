#!/usr/bin/env bash
# 一键 Docker 部署（AirMic + LiveKit）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/airmic-cli.mjs" install --mode docker "$@"
