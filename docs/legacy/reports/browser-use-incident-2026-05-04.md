# Incident Report: browser-use Start-Timeout bei E2E-Test

**Datum:** 2026-05-04 23:40 UTC  
**System:** Ubuntu (headless Server, kein X11/Display)  
**Betroffener Service:** `pibo-web` auf Port 4788 (läuft, siehe unten)  

---

## Zusammenfassung

Beim Versuch, den End-to-End-Browser-Test mit `browser-use` durchzuführen, ist der Browser-Start in einen 30-Sekunden-Timeout gelaufen. Der `pibo-web` Gateway selbst läuft korrekt, die Dev-Auth funktioniert, aber die Browser-Automation lässt sich nicht initialisieren.

## Ablauf

### 1. Gateway-Status
```bash
curl -fsS http://127.0.0.1:4788/health
# => {"status":"ok","mode":"main"}
```
→ Gateway ist erreichbar.

### 2. Dev-Auth
```bash
curl -fsS -c /tmp/pibo-cookies.txt "http://localhost:4788/api/auth/callback/google?code=dev"
```
→ HTTP 200, Cookie gesetzt.

### 3. browser-use Start (fehlgeschlagen)

#### Versuch A – headless (default)
```bash
/root/.pibo/tools/browser-use/.venv/bin/browser-use \
  --session pibo-test \
  open "http://localhost:4788/api/auth/callback/google?code=dev"
```
**Fehler:**
```
Error: Event handler browser_use.browser.watchdog_base.BrowserSession
  .on_BrowserStartEvent#0000 timed out after 30.0s
```

#### Versuch B – headed
```bash
/root/.pibo/tools/browser-use/.venv/bin/browser-use \
  --session pibo-test --headed \
  open "http://localhost:4788/api/auth/callback/google?code=dev"
```
**Fehler:** Gleicher 30s-Timeout.

### 4. Diagnose (browser-use doctor)
```bash
/root/.pibo/tools/browser-use/.venv/bin/browser-use doctor
```
**Output:**
```
✓ package: browser-use unknown
✓ browser: Browser profile available
✓ network: Network connectivity OK
○ cloudflared: not installed
○ profile_use: not installed
⚠ 3/5 checks passed, 2 missing
```
→ Grundlegende Installation scheint OK, aber Browser-Daemon startet nicht.

## Vermutete Ursache

Die Umgebung ist ein **headless Linux-Server** ohne laufenden X11/Wayland-Display-Server. `browser-use` versucht vermutlich, Chromium über Playwright/CDP zu starten, scheitert aber daran, dass:
1. Kein Display verfügbar ist (auch `--headed` funktioniert nicht, weil kein X11 läuft)
2. Der CDP-/Chromium-Start-Prozess hängt und nach 30s abgebrochen wird
3. Möglicherweise fehlende System-Dependencies für Chromium (z.B. `libnss3`, `libatk`, etc.)

## Empfohlene Lösungsansätze

### Option A – Playwright/Chromium System-Deps installieren
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libxss1 libasound2 \
  libgtk-3-0 libgbm1 libxshmfence1

# Dann nochmal browser-use doctor
```

### Option B – `pibo mcp` Chrome DevTools verwenden
Der Benutzer hat explizit `pibo mcp` als Alternative genannt. Prüfen, ob ein MCP-Server für Chrome DevTools konfiguriert ist:
```bash
pibo mcp                    # Listet konfigurierte Server
pibo mcp info chrome-devtools   # Falls vorhanden
```
Falls nicht konfiguriert, könnte man `mcp-cli` oder einen eigenen CDP-MCP-Server einrichten.

### Option C – Externen Browser via `browser-use --cdp-url`
Wenn ein entfernter Chrome mit `--remote-debugging-port=9222` verfügbar ist:
```bash
browser-use --cdp-url http://<host>:9222 open "http://localhost:4788/chat"
```

### Option D – playwright/chromium headless direkt
Falls `browser-use` zu viel Overhead hat, könnte man mit `playwright` direkt ein headless-Skript schreiben:
```bash
npx playwright install chromium
# dann Node-Skript mit chromium.launch({ headless: true })
```

## Nächste Schritte

1. **System-Dependencies für Chromium prüfen** (`ldd` auf Chromium-Binary)
2. **Falls Chromium nicht startet:** Option B (`pibo mcp`) oder Option D (Playwright direkt) evaluieren
3. **Test-Skript unabhängig vom Browser-Wrapper schreiben**, um das Problem zu isolieren

---
