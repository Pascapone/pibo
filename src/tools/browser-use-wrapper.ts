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
  fi

  return 1
}

ensure_persistent_chrome() {
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  mkdir -p "$state_dir"
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port
  log_file=$state_dir/$safe_session.chrome.log

  if cdp_url=$(persistent_chrome_url_if_alive); then
    printf '%s\\n' "$cdp_url"
    return
  fi

  chrome_bin=$(find_chrome)
  if [ -z "$chrome_bin" ]; then
    echo "pibo browser-use: could not find Chrome; install Chrome or use $fresh_flag for Browser Use managed Chromium." >&2
    exit 1
  fi

  user_data_dir=\${PIBO_BROWSER_USE_CHROME_USER_DATA_DIR:-}
  if [ -z "$user_data_dir" ]; then
    user_data_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/chrome-profiles/$default_profile
  fi

  mkdir -p "$user_data_dir"
  profile_directory=$(resolve_profile_directory "$user_data_dir" "$default_profile")
  chrome_port=$(find_free_port)
  headless_arg=
  if [ "$headed" -eq 0 ]; then
    headless_arg=--headless=new
  fi
  if command -v setsid >/dev/null 2>&1; then
    setsid "$chrome_bin" \\
      --user-data-dir="$user_data_dir" \\
      --profile-directory="$profile_directory" \\
      --remote-debugging-port="$chrome_port" \\
      --no-first-run \\
      --no-default-browser-check \\
      --disable-default-apps \\
      --no-sandbox \\
      --disable-setuid-sandbox \\
      --disable-dev-shm-usage \\
      $headless_arg \\
      about:blank >"$log_file" 2>&1 &
  else
    nohup "$chrome_bin" \\
      --user-data-dir="$user_data_dir" \\
      --profile-directory="$profile_directory" \\
      --remote-debugging-port="$chrome_port" \\
      --no-first-run \\
      --no-default-browser-check \\
      --disable-default-apps \\
      --no-sandbox \\
      --disable-setuid-sandbox \\
      --disable-dev-shm-usage \\
      $headless_arg \\
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

  if [ "$ready" -ne 1 ]; then
    echo "pibo browser-use: Chrome did not expose CDP on port $chrome_port." >&2
    sed -n '1,80p' "$log_file" >&2 2>/dev/null || true
    exit 1
  fi

  printf '%s\\n' "$chrome_pid" > "$pid_file"
  printf '%s\\n' "$chrome_port" > "$port_file"
  printf 'pibo browser-use: started Chrome profile "%s" (%s/%s) on CDP port %s.\\n' "$default_profile" "$user_data_dir" "$profile_directory" "$chrome_port" >&2
  printf 'http://127.0.0.1:%s\\n' "$chrome_port"
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

if [ "$show_help" -eq 1 ]; then
  {
    echo "Pibo browser-use wrapper:"
    echo "  New browser-use daemon sessions default to persistent Chrome profile \\"$default_profile\\" via CDP."
    echo "  Use $fresh_flag to start a fresh temporary browser profile."
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

session_pid_file=\${BROWSER_USE_HOME:-$HOME/.browser-use}/$session.pid
session_alive=0
if [ -s "$session_pid_file" ]; then
  session_pid=$(cat "$session_pid_file" 2>/dev/null || true)
  if [ -n "$session_pid" ] && kill -0 "$session_pid" 2>/dev/null; then
    session_alive=1
  fi
fi

if [ "$starts_browser" -eq 1 ] && [ "$explicit_profile" -eq 0 ] && [ "$fresh_profile" -eq 0 ]; then
  if [ "$session_alive" -eq 1 ] && persistent_chrome_url_if_alive >/dev/null; then
    exec "$real_browser_use" "$@"
  fi
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
