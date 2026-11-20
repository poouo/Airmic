#!/usr/bin/env bash
# OTA 升级：在线检查 GitHub 版本并安全升级（失败自动回滚）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/airmic-cli.mjs" upgrade "$@"
