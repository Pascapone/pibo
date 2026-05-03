#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "==> Building main web gateway"
npm run build

echo "==> Refreshing stable fallback backup"
node dist/bin/pibo.js gateway backup update

echo "==> Restarting main web gateway"
systemctl restart pibo-web

echo "==> Waiting for main gateway health"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4788/health >/tmp/pibo-web-health.json; then
    break
  fi
  sleep 1
done

if ! grep -q '"mode":"main"' /tmp/pibo-web-health.json; then
  echo "Main gateway did not become healthy on 127.0.0.1:4788"
  echo "Current health payload:"
  cat /tmp/pibo-web-health.json 2>/dev/null || true
  exit 1
fi

echo "==> Stopping fallback if it is still running"
if systemctl is-active --quiet pibo-web-fallback; then
  systemctl stop pibo-web-fallback
fi

echo "==> Verifying public web app"
curl -fsS https://pibo.neuralnexus.me/apps/chat >/tmp/pibo-web-app.html
curl -fsS http://127.0.0.1:4788/health
echo
echo "Deploy complete"
