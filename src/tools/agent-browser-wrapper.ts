import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliToolStatus } from './registry.js';

export const AGENT_BROWSER_DEFAULT_PROFILE = 'PIBo';
export const AGENT_BROWSER_FRESH_PROFILE_FLAG = '--fresh-profile';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createAgentBrowserWrapper(realExecutablePath: string, defaultHomeDir: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

real_agent_browser=${shellQuote(realExecutablePath)}
default_home=${shellQuote(defaultHomeDir)}
fresh_flag=${shellQuote(AGENT_BROWSER_FRESH_PROFILE_FLAG)}

if [ -z "\${AGENT_BROWSER_HOME:-}" ]; then
  export AGENT_BROWSER_HOME="$default_home"
fi
mkdir -p "$AGENT_BROWSER_HOME" "$AGENT_BROWSER_HOME/profiles"

# agent-browser@0.27.0 uses HOME for ~/.agent-browser state. Redirect it by
# default so doctor, config, sockets, and auth vault files stay inside Pibo's
# tool home. Operators can opt out for upstream debugging.
if [ "\${PIBO_AGENT_BROWSER_PRESERVE_HOME:-0}" != "1" ]; then
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
  - explicit --profile, --state, --cdp, --auto-connect, --provider, --engine,
    --executable-path, or --config flags override Pibo defaults
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      show_help=1
      args+=("$1")
      ;;
    --fresh-profile)
      fresh_profile=1
      ;;
    --profile|--state|--cdp|--auto-connect|--provider|--engine|--executable-path|--config)
      explicit_runtime=1
      args+=("$1")
      if [ "$#" -gt 1 ]; then
        shift
        args+=("$1")
      fi
      ;;
    --profile=*|--state=*|--cdp=*|--auto-connect=*|--provider=*|--engine=*|--executable-path=*|--config=*)
      explicit_runtime=1
      args+=("$1")
      ;;
    open|launch|new|goto)
      starts_browser=1
      args+=("$1")
      ;;
    *)
      args+=("$1")
      ;;
  esac
  shift
done

if [ "$show_help" -eq 1 ]; then
  print_wrapper_help
  exec "$real_agent_browser" "\${args[@]}"
fi

if [ "$starts_browser" -eq 1 ] && [ "$fresh_profile" -eq 0 ] && [ "$explicit_runtime" -eq 0 ]; then
  profile_dir=\${AGENT_BROWSER_PROFILE:-$AGENT_BROWSER_HOME/profiles/${AGENT_BROWSER_DEFAULT_PROFILE}}
  mkdir -p "$profile_dir"
  exec "$real_agent_browser" --profile "$profile_dir" "\${args[@]}"
fi

exec "$real_agent_browser" "\${args[@]}"
`;
}

export function ensureAgentBrowserWrapper(status: CliToolStatus): string | undefined {
  if (!status.homeDir || !status.executablePath) return undefined;
  const wrapperPath = join(status.homeDir, 'bin', 'agent-browser');
  mkdirSync(dirname(wrapperPath), { recursive: true });
  writeFileSync(wrapperPath, createAgentBrowserWrapper(status.executablePath, status.homeDir));
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}
