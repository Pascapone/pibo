#!/bin/sh
set -e

# Xvfb starten (virtueller Display-Server für Browser-Automation)
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  echo "[docker-entrypoint] Starting Xvfb on DISPLAY=:99 ..."
  Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp &
  sleep 0.5
fi

export DISPLAY=:99

# Sicherstellen, dass die Browser-Wrapper existieren
if [ ! -x "$HOME/.pibo/tools/browser-use/home/bin/browser-use" ]; then
  echo "[docker-entrypoint] Preparing browser-use wrapper ..."
  /app/scripts/prepare-browser-use-wrapper.sh
fi

if [ ! -x "$HOME/.pibo/tools/agent-browser/home/bin/agent-browser" ]; then
  echo "[docker-entrypoint] Preparing agent-browser wrapper ..."
  /app/scripts/prepare-agent-browser-wrapper.sh
fi

# PATH erweitern
export PATH="$HOME/.pibo/tools/agent-browser/home/bin:$HOME/.pibo/tools/agent-browser/node/node_modules/.bin:$HOME/.pibo/tools/browser-use/home/bin:$HOME/.pibo/tools/browser-use/.venv/bin:$PATH"
export BROWSER_USE_HOME="$HOME/.pibo/tools/browser-use/home"
export AGENT_BROWSER_HOME="$HOME/.pibo/tools/agent-browser/home"

# Pibo-CLI-Argumente verarbeiten
case "${1:-gateway}" in
  gateway)
    echo "[docker-entrypoint] Starting Pibo gateway on 0.0.0.0:4789 ..."
    exec node -e "import('./dist/gateway/server.js').then(m => m.runGatewayServer({ host: '0.0.0.0' }))"
    ;;
  gateway:web)
    echo "[docker-entrypoint] Starting Pibo gateway:web with local auth on 0.0.0.0:4789 ..."
    exec node -e "import('./dist/gateway/web.js').then(m => m.runWebGatewayServer({ authMode: 'local', web: { host: '0.0.0.0' } }))"
    ;;
  shell|bash|sh)
    exec /bin/sh
    ;;
  *)
    # Alles andere direkt an Pibo weiterleiten
    exec node dist/bin/pibo.js "$@"
    ;;
esac
