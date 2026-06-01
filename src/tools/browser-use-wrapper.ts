import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliToolStatus } from './registry.js';

export const BROWSER_USE_DEFAULT_PROFILE = 'PIBo';
export const BROWSER_USE_FRESH_PROFILE_FLAG = '--fresh-profile';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createBrowserUseWrapper(realExecutablePath: string): string {
  return `#!/bin/sh
set -eu

real_browser_use=${shellQuote(realExecutablePath)}
default_profile=\${PIBO_BROWSER_USE_DEFAULT_PROFILE:-${shellQuote(BROWSER_USE_DEFAULT_PROFILE)}}
fresh_flag=${shellQuote(BROWSER_USE_FRESH_PROFILE_FLAG)}
python_cmd=\${PIBO_BROWSER_USE_PYTHON:-$(dirname "$real_browser_use")/python}
if [ ! -x "$python_cmd" ]; then
  python_cmd=$(command -v python3 || command -v python || printf '%s' "$python_cmd")
fi

session=\${PIBO_BROWSER_USE_SESSION:-default}
explicit_profile=0
fresh_profile=0
starts_browser=0
show_help=0
headed=0
pibo_ensure_chrome=0
sanitized_args=

append_arg() {
  if [ "$#" -eq 0 ]; then
    return
  fi
  if [ -z "$sanitized_args" ]; then
    sanitized_args=$(printf '%s\\n' "$1")
  else
    sanitized_args=$(printf '%s\\n%s\\n' "$sanitized_args" "$1")
  fi
}

find_chrome() {
  if [ -n "\${PIBO_BROWSER_USE_CHROME:-}" ]; then
    printf '%s\\n' "$PIBO_BROWSER_USE_CHROME"
    return
  fi
  for candidate in google-chrome chrome chromium chromium-browser /opt/google/chrome/chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return
    fi
    if [ -x "$candidate" ]; then
      printf '%s\\n' "$candidate"
      return
    fi
  done
}

resolve_profile_directory() {
  user_data_dir=$1
  profile_name=$2

  if [ -n "\${PIBO_BROWSER_USE_CHROME_PROFILE_DIRECTORY:-}" ]; then
    printf '%s\\n' "$PIBO_BROWSER_USE_CHROME_PROFILE_DIRECTORY"
    return
  fi

  "$python_cmd" - "$user_data_dir" "$profile_name" <<'PY'
import json
import sys
from pathlib import Path

user_data_dir = Path(sys.argv[1])
profile_name = sys.argv[2]
local_state = user_data_dir / "Local State"
try:
    data = json.loads(local_state.read_text())
except Exception:
    print(profile_name if (user_data_dir / profile_name).is_dir() else "Default")
    raise SystemExit

info_cache = data.get("profile", {}).get("info_cache", {})
if profile_name in info_cache:
    print(profile_name)
    raise SystemExit

profile_name_lower = profile_name.lower()
for directory, info in info_cache.items():
    if str(info.get("name", directory)).lower() == profile_name_lower:
        print(directory)
        raise SystemExit

for directory in info_cache:
    if directory.lower() == profile_name_lower:
        print(directory)
        raise SystemExit

print(profile_name if (user_data_dir / profile_name).is_dir() else "Default")
PY
}

find_free_port() {
  "$python_cmd" - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

pibo_cdp_is_ready() {
  "$python_cmd" - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
try:
    with socket.create_connection(("127.0.0.1", port), timeout=0.2) as sock:
        sock.sendall(b"GET /json/version HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n")
        data = sock.recv(128)
    raise SystemExit(0 if b"200" in data else 1)
except Exception:
    raise SystemExit(1)
PY
}

find_chrome_pids_for_profile() {
  user_data_dir=$1
  "$python_cmd" - "$user_data_dir" <<'PYFINDCHROME'
import os
import shlex
import subprocess
import sys

managed_dir = os.path.normpath(os.path.abspath(sys.argv[1]))
browser_names = {"chrome", "google-chrome", "chromium", "chromium-browser"}

def normalize_path(value):
    return os.path.normpath(os.path.abspath(value))

def has_managed_user_data_dir(args):
    for index, arg in enumerate(args):
        if arg.startswith("--user-data-dir="):
            return normalize_path(arg.split("=", 1)[1]) == managed_dir
        if arg == "--user-data-dir" and index + 1 < len(args):
            return normalize_path(args[index + 1]) == managed_dir
    return False

try:
    output = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True, stderr=subprocess.DEVNULL)
except Exception:
    raise SystemExit(0)

for line in output.splitlines():
    line = line.strip()
    if not line:
        continue
    pid_text, _, command = line.partition(" ")
    if not pid_text.isdigit() or not command:
        continue
    try:
        args = shlex.split(command)
    except ValueError:
        continue
    if not args:
        continue
    command_name = os.path.basename(args[0]).lower()
    if command_name not in browser_names:
        continue
    if has_managed_user_data_dir(args):
        print(pid_text)
PYFINDCHROME
}

find_recorded_browser_targets_for_profile() {
  user_data_dir=$1
  pid_file=$2
  pool_state_file=$3
  "$python_cmd" - "$user_data_dir" "$pid_file" "$pool_state_file" <<'PYRECORDED'
import json
import os
import sys
from pathlib import Path

managed_dir = os.path.normpath(os.path.abspath(sys.argv[1]))
pid_file = Path(sys.argv[2])
pool_state_file = Path(sys.argv[3])

def normalize_path(value):
    return os.path.normpath(os.path.abspath(value))

def print_target(source, pid, pgid=""):
    try:
        pid_text = str(int(str(pid).strip()))
    except Exception:
        return
    if int(pid_text) <= 0:
        return
    pgid_text = ""
    if pgid not in (None, ""):
        try:
            pgid_text = str(int(str(pgid).strip()))
        except Exception:
            pgid_text = ""
    print(f"{source}\t{pid_text}\t{pgid_text}")

try:
    data = json.loads(pool_state_file.read_text())
    if normalize_path(str(data.get("userDataDir", ""))) == managed_dir:
        print_target("pool-state", data.get("pid"), data.get("processGroupId"))
except FileNotFoundError:
    pass
except Exception:
    pass

try:
    print_target("cdp-pid-file", pid_file.read_text())
except FileNotFoundError:
    pass
except Exception:
    pass
PYRECORDED
}

process_group_for_pid() {
  pid=$1
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' '
}

process_is_running() {
  pid=$1
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  state=$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ' | cut -c1)
  [ "$state" != "Z" ]
}

wait_for_pid_exit() {
  pid=$1
  attempts=0
  while [ "$attempts" -lt "\${PIBO_BROWSER_POOL_TERM_WAIT_ATTEMPTS:-10}" ]; do
    if ! process_is_running "$pid"; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep "\${PIBO_BROWSER_POOL_TERM_WAIT_SECONDS:-0.1}"
  done
  return 1
}

terminate_managed_browser_target() {
  source=$1
  pid=$2
  recorded_pgid=$3
  if [ -z "$pid" ] || ! process_is_running "$pid"; then
    return 0
  fi

  actual_pgid=$(process_group_for_pid "$pid")
  target_group=
  if [ -n "$recorded_pgid" ] && [ "$actual_pgid" = "$recorded_pgid" ]; then
    target_group=$recorded_pgid
  elif [ -n "$actual_pgid" ] && [ "$actual_pgid" = "$pid" ]; then
    target_group=$actual_pgid
  fi

  if [ -n "$target_group" ]; then
    echo "pibo browser-use: terminating stale Chrome process group $target_group for managed profile ($source pid $pid)..." >&2
    kill -TERM "-$target_group" 2>/dev/null || true
    if ! wait_for_pid_exit "$pid"; then
      kill -KILL "-$target_group" 2>/dev/null || true
      wait_for_pid_exit "$pid" || true
    fi
    return 0
  fi

  echo "pibo browser-use: terminating stale Chrome process $pid for managed profile ($source)..." >&2
  kill -TERM "$pid" 2>/dev/null || true
  if ! wait_for_pid_exit "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
    wait_for_pid_exit "$pid" || true
  fi
}

pid_file_process_is_dead() {
  pid_file=$1
  if [ ! -s "$pid_file" ]; then
    return 0
  fi
  recorded_pid=$(cat "$pid_file" 2>/dev/null || true)
  if [ -z "$recorded_pid" ]; then
    return 0
  fi
  ! process_is_running "$recorded_pid"
}

kill_stale_chrome_for_profile() {
  user_data_dir=$1
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port
  paths=$(browser_pool_paths)
  pool_state_file=$(printf '%s\n' "$paths" | sed -n '1p')

  # Prefer recorded pool/CDP pid metadata before falling back to exact profile matching.
  recorded_targets=$(find_recorded_browser_targets_for_profile "$user_data_dir" "$pid_file" "$pool_state_file")
  if [ -n "$recorded_targets" ]; then
    while IFS='\t' read -r source recorded_pid recorded_pgid; do
      terminate_managed_browser_target "$source" "$recorded_pid" "$recorded_pgid"
    done <<EOFRECORDED
$recorded_targets
EOFRECORDED
  fi

  # Then terminate any Chrome/Chromium process using this exact managed profile directory.
  stale_pids=$(find_chrome_pids_for_profile "$user_data_dir")
  for stale_pid in $stale_pids; do
    terminate_managed_browser_target "profile-match" "$stale_pid" ""
  done

  # Remove stale lock files if the managed browser is confirmed gone.
  sleep 0.2
  if [ -z "$(find_chrome_pids_for_profile "$user_data_dir")" ]; then
    for stale_file in SingletonLock SingletonCookie SingletonSocket; do
      if [ -f "$user_data_dir/$stale_file" ]; then
        rm -f "$user_data_dir/$stale_file" 2>/dev/null || true
      fi
    done
  fi

  # Remove stale CDP pid/port files only after their recorded process is gone.
  if pid_file_process_is_dead "$pid_file"; then
    rm -f "$pid_file" "$port_file" 2>/dev/null || true
  fi
}

persistent_chrome_url_if_alive() {
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port

  if [ -s "$pid_file" ] && [ -s "$port_file" ]; then
    chrome_pid=$(cat "$pid_file" 2>/dev/null || true)
    chrome_port=$(cat "$port_file" 2>/dev/null || true)
    if [ -n "$chrome_pid" ] && [ -n "$chrome_port" ] && kill -0 "$chrome_pid" 2>/dev/null && pibo_cdp_is_ready "$chrome_port"; then
      printf 'http://127.0.0.1:%s\\n' "$chrome_port"
      return 0
    fi
    # Clean up stale state files when process is dead or CDP unreachable
    rm -f "$pid_file" "$port_file" 2>/dev/null || true
  fi

  return 1
}

start_persistent_chrome() {
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  mkdir -p "$state_dir"
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port
  log_file=$state_dir/$safe_session.chrome.log

  chrome_bin=$(find_chrome)
  if [ -z "$chrome_bin" ]; then
    echo "pibo browser-use: could not find Chrome; managed browser-pool acquire cannot start a browser. Install Chrome/Chromium or use $fresh_flag for Browser Use managed Chromium." >&2
    return 1
  fi

  user_data_dir=\${PIBO_BROWSER_USE_CHROME_USER_DATA_DIR:-}
  if [ -z "$user_data_dir" ]; then
    user_data_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/chrome-profiles/$default_profile
  fi

  mkdir -p "$user_data_dir"

  retry=0
  while [ "$retry" -lt 2 ]; do
    kill_stale_chrome_for_profile "$user_data_dir"
    profile_directory=$(resolve_profile_directory "$user_data_dir" "$default_profile")
    chrome_port=$(find_free_port)
    headless_arg=
    if [ "$headed" -eq 0 ]; then
      headless_arg=--headless=new
    fi
    rm -f "$log_file"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$chrome_bin" \
        --user-data-dir="$user_data_dir" \
        --profile-directory="$profile_directory" \
        --remote-debugging-port="$chrome_port" \
        --no-first-run \
        --no-default-browser-check \
        --disable-default-apps \
        --no-sandbox \
        --disable-setuid-sandbox \
        --disable-dev-shm-usage \
        $headless_arg \
        about:blank >"$log_file" 2>&1 &
    else
      nohup "$chrome_bin" \
        --user-data-dir="$user_data_dir" \
        --profile-directory="$profile_directory" \
        --remote-debugging-port="$chrome_port" \
        --no-first-run \
        --no-default-browser-check \
        --disable-default-apps \
        --no-sandbox \
        --disable-setuid-sandbox \
        --disable-dev-shm-usage \
        $headless_arg \
        about:blank >"$log_file" 2>&1 &
    fi
    chrome_pid=$!

    ready=0
    if [ "\${PIBO_BROWSER_USE_SKIP_CDP_WAIT:-}" = "1" ]; then
      ready=1
    fi
    attempt=0
    while [ "$ready" -ne 1 ] && [ "$attempt" -lt 50 ]; do
      if pibo_cdp_is_ready "$chrome_port"; then
        ready=1
        break
      fi
      if ! kill -0 "$chrome_pid" 2>/dev/null; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 0.1
    done

    if [ "$ready" -eq 1 ]; then
      printf '%s\n' "$chrome_pid" > "$pid_file"
      printf '%s\n' "$chrome_port" > "$port_file"
      printf 'pibo browser-use: started Chrome profile "%s" (%s/%s) on CDP port %s.\n' "$default_profile" "$user_data_dir" "$profile_directory" "$chrome_port" >&2
      printf '%s\n%s\nhttp://127.0.0.1:%s\n%s\n' "$chrome_pid" "$chrome_port" "$chrome_port" "$user_data_dir"
      return 0
    fi

    echo "pibo browser-use: Chrome did not expose CDP on port $chrome_port (attempt $retry)." >&2
    sed -n '1,80p' "$log_file" >&2 2>/dev/null || true
    if grep -q "SingletonLock" "$log_file" 2>/dev/null; then
      echo "pibo browser-use: retrying after lock cleanup..." >&2
    fi
    retry=$((retry + 1))
    sleep 0.5
  done

  echo "pibo browser-use: Chrome failed to start after retries." >&2
  return 1
}

browser_pool_safe_segment() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

browser_pool_worker_id() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_WORKER_ID:-\${PIBO_COMPUTE_WORKER_ID:-\${HOSTNAME:-local}}}"
}

browser_pool_id() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_ID:-default}"
}

browser_pool_root() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_ROOT:-\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-browser-pool}"
}

browser_pool_paths() {
  worker=$(browser_pool_safe_segment "$(browser_pool_worker_id)")
  pool=$(browser_pool_safe_segment "$(browser_pool_id)")
  base=$(browser_pool_root)/browser-pools/$worker/$pool
  printf '%s\n%s\n' "$base/state.json" "$base/state.lock"
}

browser_pool_read_summary() {
  state_file=$1
  "$python_cmd" - "$state_file" <<'PYSUMMARY'
import json
import sys
from pathlib import Path
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except FileNotFoundError:
    print("missing")
    raise SystemExit(0)
except Exception as exc:
    print("malformed")
    print(str(exc))
    raise SystemExit(0)
for key in ("state", "pid", "cdpPort", "cdpUrl", "userDataDir", "activeLeaseId", "activeLeaseCount", "idleExpiresAt", "holder"):
    value = data.get(key, "")
    print(value if value is not None else "")
PYSUMMARY
}

browser_pool_lease_is_busy() {
  active_lease=$1
  requested_lease=$2
  idle_expires_at=$3
  if [ -z "$active_lease" ] || [ "$active_lease" = "$requested_lease" ]; then
    return 1
  fi
  "$python_cmd" - "$idle_expires_at" <<'PYBUSY'
import sys
from datetime import datetime, timezone
value = sys.argv[1]
if not value:
    raise SystemExit(0)
try:
    expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
except Exception:
    raise SystemExit(0)
if expires_at.tzinfo is None:
    expires_at = expires_at.replace(tzinfo=timezone.utc)
raise SystemExit(1 if expires_at <= datetime.now(timezone.utc) else 0)
PYBUSY
}

browser_pool_write_state() {
  state_file=$1
  lifecycle_state=$2
  chrome_pid=$3
  chrome_port=$4
  cdp_url=$5
  user_data_dir=$6
  active_lease_id=$7
  holder=$8
  last_error=$9
  "$python_cmd" - "$state_file" "$(browser_pool_worker_id)" "$(browser_pool_id)" "\${PIBO_BROWSER_POOL_MAX_PROCESSES:-1}" "$lifecycle_state" "$chrome_pid" "$chrome_port" "$cdp_url" "$user_data_dir" "$active_lease_id" "$holder" "$last_error" <<'PYSTATE'
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
state_file = Path(sys.argv[1])
worker_id, pool_id, max_processes, lifecycle_state = sys.argv[2:6]
pid, port, cdp_url, user_data_dir, lease_id, holder, last_error = sys.argv[6:13]
now = datetime.now(timezone.utc)
record = {
    "workerId": worker_id,
    "poolId": pool_id,
    "maxBrowserProcesses": int(max_processes or "1"),
    "state": lifecycle_state,
    "lastUsedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}
if pid:
    record["pid"] = int(pid)
    record["processGroupId"] = int(pid)
if port:
    record["cdpPort"] = int(port)
if cdp_url:
    record["cdpUrl"] = cdp_url
if user_data_dir:
    record["userDataDir"] = user_data_dir
if lease_id:
    record["activeLeaseId"] = lease_id
    record["activeLeaseCount"] = 1
    record["cleanupStatus"] = "not-attempted"
    record["idleExpiresAt"] = (now + timedelta(milliseconds=int(os.environ.get("PIBO_BROWSER_POOL_IDLE_TIMEOUT_MS", "600000")))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
else:
    record["activeLeaseCount"] = 0
if holder:
    record["holder"] = holder
if last_error:
    record["lastError"] = last_error
state_file.parent.mkdir(parents=True, exist_ok=True)
tmp = state_file.with_name(f"{state_file.name}.{os.getpid()}.tmp")
tmp.write_text(json.dumps(record, indent=2) + "\\n")
tmp.replace(state_file)
PYSTATE
}

browser_pool_acquire() {
  paths=$(browser_pool_paths)
  state_file=$(printf '%s\n' "$paths" | sed -n '1p')
  lock_dir=$(printf '%s\n' "$paths" | sed -n '2p')
  mkdir -p "$(dirname "$state_file")"
  safe_session=$(browser_pool_safe_segment "$session")
  lease_id=\${PIBO_BROWSER_POOL_LEASE_ID:-browser-use:$safe_session}
  holder=\${PIBO_BROWSER_POOL_HOLDER:-browser-use:$session}
  attempts=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "\${PIBO_BROWSER_POOL_LOCK_ATTEMPTS:-100}" ]; then
      echo "pibo browser-use: managed browser-pool acquire timed out waiting for $lock_dir" >&2
      return 1
    fi
    sleep 0.05
  done
  trap 'rm -rf "$lock_dir"' EXIT INT TERM

  summary=$(browser_pool_read_summary "$state_file")
  summary_state=$(printf '%s\n' "$summary" | sed -n '1p')
  if [ "$summary_state" = "malformed" ]; then
    malformed_reason=$(printf '%s\n' "$summary" | sed -n '2p')
    browser_pool_write_state "$state_file" dirty "" "" "" "" "" "$holder" "Malformed browser pool state: $malformed_reason"
  elif [ "$summary_state" != "missing" ]; then
    recorded_state=$summary_state
    recorded_pid=$(printf '%s\n' "$summary" | sed -n '2p')
    recorded_port=$(printf '%s\n' "$summary" | sed -n '3p')
    recorded_cdp_url=$(printf '%s\n' "$summary" | sed -n '4p')
    recorded_user_data_dir=$(printf '%s\n' "$summary" | sed -n '5p')
    recorded_active_lease_id=$(printf '%s\n' "$summary" | sed -n '6p')
    recorded_idle_expires_at=$(printf '%s\n' "$summary" | sed -n '8p')
    recorded_holder=$(printf '%s\n' "$summary" | sed -n '9p')
    if [ "$recorded_state" = "leased" ] && browser_pool_lease_is_busy "$recorded_active_lease_id" "$lease_id" "$recorded_idle_expires_at" && [ -n "$recorded_pid" ] && [ -n "$recorded_port" ] && [ -n "$recorded_cdp_url" ] && kill -0 "$recorded_pid" 2>/dev/null && pibo_cdp_is_ready "$recorded_port"; then
      busy_reason="pool-exhausted: browser pool $(browser_pool_id) is already leased by $recorded_active_lease_id until \${recorded_idle_expires_at:-unknown}"
      echo "pibo browser-use: $busy_reason" >&2
      rm -rf "$lock_dir"
      trap - EXIT INT TERM
      return 1
    fi
    if [ "$recorded_state" != "dirty" ] && [ -n "$recorded_pid" ] && [ -n "$recorded_port" ] && [ -n "$recorded_cdp_url" ] && kill -0 "$recorded_pid" 2>/dev/null && pibo_cdp_is_ready "$recorded_port"; then
      browser_pool_write_state "$state_file" leased "$recorded_pid" "$recorded_port" "$recorded_cdp_url" "$recorded_user_data_dir" "$lease_id" "$holder" ""
      rm -rf "$lock_dir"
      trap - EXIT INT TERM
      printf '%s\n' "$recorded_cdp_url"
      return 0
    fi
    browser_pool_write_state "$state_file" stale "$recorded_pid" "$recorded_port" "$recorded_cdp_url" "$recorded_user_data_dir" "" "$holder" "Recorded browser is not alive or CDP is unreachable"
  fi

  start_result=$(start_persistent_chrome) || {
    browser_pool_write_state "$state_file" dirty "" "" "" "" "" "$holder" "Managed browser start failed"
    rm -rf "$lock_dir"
    trap - EXIT INT TERM
    return 1
  }
  chrome_pid=$(printf '%s\n' "$start_result" | sed -n '1p')
  chrome_port=$(printf '%s\n' "$start_result" | sed -n '2p')
  cdp_url=$(printf '%s\n' "$start_result" | sed -n '3p')
  user_data_dir=$(printf '%s\n' "$start_result" | sed -n '4p')
  browser_pool_write_state "$state_file" leased "$chrome_pid" "$chrome_port" "$cdp_url" "$user_data_dir" "$lease_id" "$holder" ""
  rm -rf "$lock_dir"
  trap - EXIT INT TERM
  printf '%s\n' "$cdp_url"
}

ensure_persistent_chrome() {
  if cdp_url=$(browser_pool_acquire); then
    printf '%s\n' "$cdp_url"
    return 0
  fi
  echo "pibo browser-use: managed browser-pool acquire failed; refusing to start an unmanaged browser." >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  arg=$1
  shift

  case "$arg" in
    "$fresh_flag")
      fresh_profile=1
      continue
      ;;
    --help|-h)
      show_help=1
      ;;
    --headed)
      headed=1
      ;;
    --profile)
      explicit_profile=1
      append_arg "$arg"
      continue
      ;;
    --cdp-url)
      explicit_profile=1
      append_arg "$arg"
      if [ "$#" -gt 0 ]; then
        append_arg "$1"
        shift
      fi
      continue
      ;;
    --profile=*|--cdp-url=*|--connect|--mcp|--use-cloud|--cloud-profile-id|--cloud-profile-id=*)
      explicit_profile=1
      ;;
    --session)
      append_arg "$arg"
      if [ "$#" -gt 0 ]; then
        session=$1
        append_arg "$1"
        shift
      fi
      continue
      ;;
    --session=*)
      session=\${arg#--session=}
      ;;
    --pibo-ensure-chrome)
      pibo_ensure_chrome=1
      continue
      ;;
    -*)
      ;;
    open|click|type|input|scroll|back|screenshot|state|switch|close-tab|keys|select|upload|eval|extract|hover|dblclick|rightclick|cookies|wait|get|python)
      starts_browser=1
      ;;
    close|sessions|install|init|setup|doctor|cloud|profile)
      ;;
  esac

  append_arg "$arg"
done

if [ "$pibo_ensure_chrome" -eq 1 ]; then
  cdp_url=$(ensure_persistent_chrome)
  printf '%s\\n' "$cdp_url"
  exit 0
fi

if [ "$show_help" -eq 1 ]; then
  {
    echo "Pibo browser-use wrapper:"
    echo "  New browser-use daemon sessions default to persistent Chrome profile \\"$default_profile\\" via CDP."
    echo "  Use $fresh_flag to start a fresh temporary browser profile."
    echo "  Use --pibo-ensure-chrome to only start Chrome and print the CDP URL."
    echo ""
  } >&2
fi

set --
if [ -n "$sanitized_args" ]; then
  while IFS= read -r item; do
    set -- "$@" "$item"
  done <<EOF
$sanitized_args
EOF
fi

# Prepend --session if the user did not pass it explicitly and a non-default session is set.
has_session_arg=0
for a in "$@"; do
  case "$a" in
    --session|--session=*) has_session_arg=1; break ;;
  esac
done
if [ "$has_session_arg" -eq 0 ] && [ "$session" != "default" ]; then
  set -- --session "$session" "$@"
fi

session_pid_file=\${BROWSER_USE_HOME:-$HOME/.browser-use}/$session.pid
session_alive=0
if [ -s "$session_pid_file" ]; then
  session_pid=$(cat "$session_pid_file" 2>/dev/null || true)
  if [ -n "$session_pid" ] && kill -0 "$session_pid" 2>/dev/null; then
    session_alive=1
  else
    # Clean up stale session pid file
    rm -f "$session_pid_file" 2>/dev/null || true
  fi
fi

if [ "$starts_browser" -eq 1 ] && [ "$explicit_profile" -eq 0 ] && [ "$fresh_profile" -eq 0 ]; then
  if [ "$session_alive" -eq 1 ]; then
    "$real_browser_use" --session "$session" close >/dev/null 2>&1 || true
    sleep 0.2
  fi
  cdp_url=$(ensure_persistent_chrome)
  exec "$real_browser_use" --cdp-url "$cdp_url" "$@"
fi

exec "$real_browser_use" "$@"
`;
}

export function ensureBrowserUseWrapper(status: CliToolStatus): string | undefined {
  if (status.entry.name !== 'browser-use') return undefined;
  const wrapperPath = join(status.homeDir, 'bin', 'browser-use');
  mkdirSync(dirname(wrapperPath), { recursive: true });
  writeFileSync(wrapperPath, createBrowserUseWrapper(status.executablePath));
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}
