#!/usr/bin/env bash
# 一键安装引导脚本（scripts/install.sh）回归测试：用 PATH shim 模拟 Debian / Alpine / macOS / Docker 场景
# 用法：bash .dsh-tests/run-install-tests.sh <repo-dir>
set -u

REPO_DIR="${1:?用法: run-install-tests.sh <repo-dir>}"
SCRIPT="$REPO_DIR/scripts/install.sh"
ROOT="$(mktemp -d 2>/dev/null || mktemp -d -t airmic-test)"
BIN="$ROOT/fakebin"
# docker shim 单独放一个目录：需要模拟“没有 docker”的主机时，只去掉这一层即可，
# 不必依赖真实 PATH 里是否恰好有 docker（CI runner 就自带 /usr/bin/docker）。
DOCKER_BIN="$ROOT/dockerbin"
mkdir -p "$BIN" "$DOCKER_BIN"
PASS=0
FAIL=0

cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

report_pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
report_fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL  %s\n' "$1"
  printf '  期望包含：%s\n' "$2"
  printf '  退出码：%s\n' "${3:-?}"
  printf '  实际输出：\n%s\n' "$4"
}

assert_contains() {
  local name="$1" needle="$2" code="$3" output="$4"
  if printf '%s' "$output" | grep -qF -- "$needle"; then report_pass "$name"; else report_fail "$name" "$needle" "$code" "$output"; fi
}

assert_not_contains() {
  local name="$1" needle="$2" code="$3" output="$4"
  if printf '%s' "$output" | grep -qF -- "$needle"; then report_fail "$name" "不应包含：$needle" "$code" "$output"; else report_pass "$name"; fi
}

assert_code() {
  local name="$1" expected="$2" code="$3" output="$4"
  if [ "$code" = "$expected" ]; then report_pass "$name"; else report_fail "$name" "退出码 $expected" "$code" "$output"; fi
}

# ---------- fake 命令 ----------
cat >"$BIN/uname" <<'EOS'
#!/usr/bin/env bash
case "${1:--s}" in
  -s) printf '%s\n' "${FAKE_UNAME_S:-Linux}" ;;
  -m) printf '%s\n' "${FAKE_UNAME_M:-x86_64}" ;;
  -r) printf '%s\n' "${FAKE_UNAME_R:-6.8.0-fake}" ;;
  *) printf '%s\n' "${FAKE_UNAME_S:-Linux}" ;;
esac
EOS

cat >"$BIN/node" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "-p" ]; then printf '%s\n' "${FAKE_NODE_VERSION:-22.19.0}"; exit 0; fi
if [ "${1:-}" = "-v" ]; then printf 'v%s\n' "${FAKE_NODE_VERSION:-22.19.0}"; exit 0; fi
printf 'NODE_RUN %s\n' "$*" >>"${AIRMIC_TEST_LOG:-/dev/null}"
# 模拟部署 CLI 的 __validate-home：回显 --dir 指定的目录，供引导脚本继续流程
validate=0
home=""
for a in "$@"; do
  case "$a" in
    __validate-home) validate=1 ;;
    --dir=*) home="${a#--dir=}" ;;
  esac
done
if [ "$validate" = "1" ]; then printf '%s\n' "$home"; fi
exit 0
EOS

cat >"$BIN/ldd" <<'EOS'
#!/usr/bin/env bash
if [ "${FAKE_LIBC:-glibc}" = "musl" ]; then echo "musl libc (x86_64)"; else echo "ldd (GNU libc) 2.39"; fi
EOS

cat >"$BIN/curl" <<'EOS'
#!/usr/bin/env bash
url=""; dest=""; args=("$@"); i=0
while [ $i -lt ${#args[@]} ]; do
  a="${args[$i]}"
  case "$a" in
    -o) i=$((i + 1)); dest="${args[$i]:-}" ;;
    -*) : ;;
    *) url="$a" ;;
  esac
  i=$((i + 1))
done
printf 'CURL %s\n' "$url" >>"${AIRMIC_TEST_LOG:-/dev/null}"
if [ "${FAKE_CURL_FAIL:-0}" = "1" ]; then exit 22; fi
[ -n "$dest" ] || exit 0
case "$url" in
  *airmic-cli.mjs) printf '#!/usr/bin/env node\n// AirMic CLI stub\n' >"$dest" ;;
  *airmic.sh) printf '#!/usr/bin/env bash\n' >"$dest" ;;
  *) printf 'stub\n' >"$dest" ;;
esac
exit 0
EOS

cat >"$DOCKER_BIN/docker" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "Docker version 27.0.0, build fake"; exit 0; fi
if [ "${1:-}" = "info" ]; then exit 0; fi
if [ "${1:-}" = "compose" ] && [ "${2:-}" = "version" ]; then echo "Docker Compose version v2.29.0"; exit 0; fi
exit 0
EOS

chmod +x "$BIN"/* "$DOCKER_BIN"/*

BASE_PATH="$DOCKER_BIN:$BIN:$PATH"

run_dry() {
  # $1 = name; rest = args
  local name="$1"
  shift
  local out code
  out="$(env PATH="$BASE_PATH" FAKE_UNAME_S="${FAKE_UNAME_S:-Linux}" FAKE_UNAME_M="${FAKE_UNAME_M:-x86_64}" FAKE_LIBC="${FAKE_LIBC:-glibc}" FAKE_NODE_VERSION="${FAKE_NODE_VERSION:-22.19.0}" FAKE_CURL_FAIL="${FAKE_CURL_FAIL:-0}" bash "$SCRIPT" --dry-run "$@" </dev/null 2>&1)"
  code=$?
  printf '%s\n' "$out"
  LAST_CODE=$code
  LAST_OUT="$out"
  CASE_NAME="$name"
}

echo "== 1) Debian/glibc dry-run =="
FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc
run_dry "debian" install --language zh-CN
assert_code "debian: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "debian: 平台 linux/x64" "linux/x64" "$LAST_CODE" "$LAST_OUT"
assert_contains "debian: glibc" "glibc" "$LAST_CODE" "$LAST_OUT"
assert_contains "debian: 使用系统 Node" "使用系统 Node.js" "$LAST_CODE" "$LAST_OUT"
assert_not_contains "debian: --language 不透传" "--language" "$LAST_CODE" "$LAST_OUT"
assert_contains "debian: RSS 定位 raw URL" "raw.githubusercontent.com/poouo/Airmic/main" "$LAST_CODE" "$LAST_OUT"

echo "== 2) Alpine/musl dry-run =="
FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=musl
run_dry "alpine" install
assert_code "alpine: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "alpine: musl" "musl" "$LAST_CODE" "$LAST_OUT"

echo "== 3) macOS/arm64 dry-run =="
FAKE_UNAME_S=Darwin FAKE_UNAME_M=arm64 FAKE_LIBC=glibc
run_dry "macos" install
assert_code "macos: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "macos: darwin/arm64" "darwin/arm64" "$LAST_CODE" "$LAST_OUT"

echo "== 4) Node 版本过低 dry-run =="
FAKE_UNAME_S=Linux FAKE_UNAME_M=aarch64 FAKE_LIBC=glibc FAKE_NODE_VERSION=20.10.0
run_dry "old-node" install
assert_code "old-node: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "old-node: 计划下载 Node" "将下载并校验 Node v22.19.0" "$LAST_CODE" "$LAST_OUT"

echo "== 5) Docker 缺失 dry-run =="
FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0
# CI runner 自带真实 docker：只把 shim 挪走不够，`command -v docker` 会命中
# /usr/bin/docker，导致这两个用例在 CI 上误判。这里改成过滤掉含真实 docker 的 PATH 目录。
NO_DOCKER_PATH=""
_old_ifs="$IFS"; IFS=':'
for _p in $PATH; do
  [ -n "$_p" ] || continue
  [ -x "$_p/docker" ] && continue
  NO_DOCKER_PATH="${NO_DOCKER_PATH:+$NO_DOCKER_PATH:}$_p"
done
IFS="$_old_ifs"

if [ -z "$(env PATH="$BIN:$NO_DOCKER_PATH" bash -c 'command -v docker' 2>/dev/null)" ]; then
  report_pass "docker-missing: PATH 已屏蔽真实 docker"
else
  report_fail "docker-missing: PATH 已屏蔽真实 docker" "一个不含 docker 的 PATH" "0" "$NO_DOCKER_PATH"
fi

run_dry_no_docker() {
  local name="$1"
  shift
  local out code
  out="$(env PATH="$BIN:$NO_DOCKER_PATH" FAKE_UNAME_S="${FAKE_UNAME_S:-Linux}" FAKE_UNAME_M="${FAKE_UNAME_M:-x86_64}" FAKE_LIBC="${FAKE_LIBC:-glibc}" FAKE_NODE_VERSION="${FAKE_NODE_VERSION:-22.19.0}" FAKE_CURL_FAIL="${FAKE_CURL_FAIL:-0}" bash "$SCRIPT" --dry-run "$@" </dev/null 2>&1)"
  code=$?
  printf '%s\n' "$out"
  LAST_CODE=$code
  LAST_OUT="$out"
  CASE_NAME="$name"
}

run_dry_no_docker "docker-missing" install --mode docker
assert_code "docker-missing: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "docker-missing: 提示缺 Docker" "未检测到 Docker" "$LAST_CODE" "$LAST_OUT"

echo "== 6) Docker 缺失 + --install-docker dry-run =="
run_dry_no_docker "docker-install" install --mode=docker --install-docker
assert_code "docker-install: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "docker-install: 自动安装计划" "自动安装 Docker" "$LAST_CODE" "$LAST_OUT"

echo "== 7) Docker 就绪 dry-run =="
FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0
run_dry "docker-ready" install --mode docker
assert_code "docker-ready: 退出码 0" 0 "$LAST_CODE" "$LAST_OUT"
assert_contains "docker-ready: Docker 已就绪" "已就绪" "$LAST_CODE" "$LAST_OUT"

echo "== 8) 真实执行（假 curl + 假 node）=="
LOG="$ROOT/run.log"; : >"$LOG"
OUT="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 AIRMIC_TEST_LOG="$LOG" bash "$SCRIPT" install --dir "$ROOT/home" --language zh-CN </dev/null 2>&1)"
CODE=$?
printf '%s\n' "$OUT"
assert_code "run: 退出码 0" 0 "$CODE" "$OUT"
NODE_RUN="$(cat "$LOG" 2>/dev/null || true)"
assert_contains "run: CLI 被调用" " install " "$CODE" "$NODE_RUN"
assert_contains "run: 传递 --dir" "--dir" "$CODE" "$NODE_RUN"
assert_contains "run: 非交互自动 --yes" "--yes" "$CODE" "$NODE_RUN"
assert_contains "run: 下载 CLI" "deploy/airmic-cli.mjs" "$CODE" "$NODE_RUN"
assert_contains "run: 下载包装脚本" "deploy/airmic.sh" "$CODE" "$NODE_RUN"

echo "== 9) 下载失败（无本地 CLI）=="
LOG2="$ROOT/run2.log"; : >"$LOG2"
OUT2="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 FAKE_CURL_FAIL=1 AIRMIC_TEST_LOG="$LOG2" bash "$SCRIPT" install --dir "$ROOT/home2" </dev/null 2>&1)"
CODE2=$?
printf '%s\n' "$OUT2"
assert_code "download-fail: 退出码 1" 1 "$CODE2" "$OUT2"
assert_contains "download-fail: 提示下载失败" "下载部署 CLI 失败" "$CODE2" "$OUT2"

echo "== 10) 已安装时离线 status（curl 失败仍可用）=="
mkdir -p "$ROOT/home3/bin"
printf '#!/usr/bin/env node\n// AirMic CLI stub installed\n' >"$ROOT/home3/bin/airmic-cli.mjs"
LOG3="$ROOT/run3.log"; : >"$LOG3"
OUT3="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 FAKE_CURL_FAIL=1 AIRMIC_TEST_LOG="$LOG3" bash "$SCRIPT" status --dir "$ROOT/home3" </dev/null 2>&1)"
CODE3=$?
printf '%s\n' "$OUT3"
NODE_RUN3="$(cat "$LOG3" 2>/dev/null || true)"
assert_code "offline-status: 退出码 0" 0 "$CODE3" "$OUT3"
assert_contains "offline-status: 使用已安装 CLI" "/home3/bin/airmic-cli.mjs status" "$CODE3" "$NODE_RUN3"
assert_not_contains "offline-status: 未发起下载" "CURL " "$CODE3" "$NODE_RUN3"

echo "== 11) 未知选项透传给 CLI（由 CLI 报错）=="
OUT4="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 bash "$SCRIPT" --dry-run install --bogus </dev/null 2>&1)"
CODE4=$?
assert_code "bad-arg: dry-run 退出码 0" 0 "$CODE4" "$OUT4"
assert_contains "bad-arg: 未知选项透传" "--bogus" "$CODE4" "$OUT4"

echo "== 12) --dir 相对路径转绝对 =="
OUT5="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 bash "$SCRIPT" --dry-run install --dir ./rel-home </dev/null 2>&1)"
CODE5=$?
assert_code "rel-dir: 退出码 0" 0 "$CODE5" "$OUT5"
assert_contains "rel-dir: 绝对路径" "/rel-home" "$CODE5" "$OUT5"

echo "== 13) 管道 --help =="
OUT6="$(cat "$SCRIPT" | env PATH="$BASE_PATH" bash -s -- --help 2>&1)"
CODE6=$?
assert_code "pipe-help: 退出码 0" 0 "$CODE6" "$OUT6"
assert_contains "pipe-help: 用法" "一键安装引导脚本" "$CODE6" "$OUT6"

echo "== 14) upgrade 透传 =="
LOG7="$ROOT/run7.log"; : >"$LOG7"
OUT7="$(env PATH="$BASE_PATH" FAKE_UNAME_S=Linux FAKE_UNAME_M=x86_64 FAKE_LIBC=glibc FAKE_NODE_VERSION=22.19.0 AIRMIC_TEST_LOG="$LOG7" bash "$SCRIPT" upgrade --dir "$ROOT/home4" --check </dev/null 2>&1)"
CODE7=$?
NODE_RUN7="$(cat "$LOG7" 2>/dev/null || true)"
assert_code "upgrade: 退出码 0" 0 "$CODE7" "$OUT7"
assert_contains "upgrade: 动作透传" " upgrade " "$CODE7" "$NODE_RUN7"
assert_contains "upgrade: --check 透传" "--check" "$CODE7" "$NODE_RUN7"

echo
echo "===== 结果：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ]
