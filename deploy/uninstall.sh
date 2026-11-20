#!/usr/bin/env bash
# 卸载 AirMic（默认保留 data/ 与 backups/；--purge 全部删除）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/airmic-cli.mjs" uninstall "$@"
