#!/bin/sh
set -e

# Xvfb starten (virtueller Display-Server für Browser-Automation)
if ! pgrep -x Xvfb >/dev/null 2>&1; then
  echo "[docker-entrypoint] Starting Xvfb on DISPLAY=:99 ..."
  Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp &
  sleep 0.5
fi

export DISPLAY=:99

# Sicherstellen, dass der Browser-Use-Wrapper existiert
if [ ! -x /root/.pibo/tools/browser-use/home/bin/browser-use ]; then
  echo "[docker-entrypoint] Preparing browser-use wrapper ..."
  /app/scripts/prepare-browser-use-wrapper.sh
fi

# PATH erweitern
export PATH="/root/.pibo/tools/browser-use/home/bin:/root/.pibo/tools/browser-use/.venv/bin:$PATH"
export BROWSER_USE_HOME=/root/.pibo/tools/browser-use/home

# Pibo-CLI-Argumente verarbeiten
case "${1:-gateway}" in
  gateway)
    echo "[docker-entrypoint] Starting Pibo gateway on 0.0.0.0:4789 ..."
    exec node -e "import('./dist/gateway/server.js').then(m => m.runGatewayServer({ host: '0.0.0.0' }))"
    ;;
  gateway:web)
    echo "[docker-entrypoint] Starting Pibo gateway:web on 0.0.0.0:4789 ..."
    export PIBO_DEV_AUTH=1
    export PIBO_IN_DOCKER=1
    exec node -e "import('./dist/gateway/web.js').then(m => m.runWebGatewayServer({ web: { host: '0.0.0.0' } }))"
    ;;
  shell|bash|sh)
    exec /bin/sh
    ;;
  *)
    # Alles andere direkt an Pibo weiterleiten
    exec node dist/bin/pibo.js "$@"
    ;;
esac
