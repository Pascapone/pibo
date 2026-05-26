#!/bin/sh
set -e

real_agent_browser="$HOME/.pibo/tools/agent-browser/node/node_modules/.bin/agent-browser"
wrapper_dir="$HOME/.pibo/tools/agent-browser/home/bin"
wrapper_path="$wrapper_dir/agent-browser"

mkdir -p "$wrapper_dir" "$HOME/.pibo/tools/agent-browser/home/profiles"

cat > "$wrapper_path" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

real_agent_browser="$HOME/.pibo/tools/agent-browser/node/node_modules/.bin/agent-browser"
default_home="$HOME/.pibo/tools/agent-browser/home"

if [ -z "${AGENT_BROWSER_HOME:-}" ]; then
  export AGENT_BROWSER_HOME="$default_home"
fi
mkdir -p "$AGENT_BROWSER_HOME" "$AGENT_BROWSER_HOME/profiles"

if [ "${PIBO_AGENT_BROWSER_PRESERVE_HOME:-0}" != "1" ]; then
  export HOME="$AGENT_BROWSER_HOME"
fi

explicit_runtime=0
fresh_profile=0
show_help=0
starts_browser=0
args=()

print_wrapper_help() {
  cat <<'HELP'
Pibo agent-browser wrapper
  - keeps Agent Browser state under AGENT_BROWSER_HOME by default
  - prepends a persistent Pibo profile for browser-launching commands
  - pass --fresh-profile to disable Pibo profile injection
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) show_help=1; args+=("$1") ;;
    --fresh-profile) fresh_profile=1 ;;
    --profile|--state|--cdp|--auto-connect|--provider|--engine|--executable-path|--config)
      explicit_runtime=1; args+=("$1"); if [ "$#" -gt 1 ]; then shift; args+=("$1"); fi ;;
    --profile=*|--state=*|--cdp=*|--auto-connect=*|--provider=*|--engine=*|--executable-path=*|--config=*)
      explicit_runtime=1; args+=("$1") ;;
    open|launch|new|goto) starts_browser=1; args+=("$1") ;;
    *) args+=("$1") ;;
  esac
  shift
done

if [ "$show_help" -eq 1 ]; then
  print_wrapper_help
  exec "$real_agent_browser" "${args[@]}"
fi

if [ "$starts_browser" -eq 1 ] && [ "$fresh_profile" -eq 0 ] && [ "$explicit_runtime" -eq 0 ]; then
  profile_dir=${AGENT_BROWSER_PROFILE:-$AGENT_BROWSER_HOME/profiles/PIBo}
  mkdir -p "$profile_dir"
  exec "$real_agent_browser" --profile "$profile_dir" "${args[@]}"
fi

exec "$real_agent_browser" "${args[@]}"
WRAPPER

chmod +x "$wrapper_path"
printf '%s\n' "$wrapper_path"
