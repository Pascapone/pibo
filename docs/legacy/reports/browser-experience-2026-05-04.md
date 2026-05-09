# Erfahrungsbericht: Browser-Nutzung während Mobile-UI-Entwicklung

**Datum:** 2026-05-04  
**Kontext:** Mobile-Ansicht der Pibo Chat Web App testen, Screenshots erstellen  

## Zusammenfassung

Die Browser-Automation für Screenshots der Mobile-Ansicht funktionierte nicht out-of-the-box. Mehrere Schichten von Problemen mussten überwunden werden, bevor Playwright als stabile Lösung diente.

## Reibungspunkte und Probleme

### 1. Lease-Acquisition blockiert durch stale Lock

**Problem:** `pibo tools browser-use lease acquire` schlug mit `BROWSER_USE_AUTH_TEMPLATE_RUNNING` fehl. Ein `SingletonSocket` aus einer früheren Session blockierte die Lease-Erstellung.

**Lösung:** Manuell `find ... -name "SingletonSocket" -delete` ausführen, dann Lease erneut anfordern.

**Lerneffekt:** Auth-Template-Profile müssen sauber heruntergefahren werden. Ein SingletonSocket-Lock ist ein häufiger Stolperstein.

### 2. Chrome startete nicht automatisch nach Lease

**Problem:** Nach erfolgreichem Lease-Acquire (`pibo-chat-slot-001`) lief kein Chrome-Prozess. `curl http://127.0.0.1:56663/json/list` lieferte keine Targets.

**Lösung:** Manueller Chrome-Start mit `--remote-debugging-port=56663 --headless=new --no-sandbox`.

**Lerneffekt:** Die Lease gibt nur ein isoliertes Profil, startet aber nicht automatisch den Browser. Das muss separat erfolgen.

### 3. CDP-Timeout mit eigenem Node.js-Script

**Problem:** Ein selbstgeschriebenes Script über `ws`-Modul hat sich mit dem Chrome-Tab verbunden, aber `Page.enable` und weitere Befehle liefen in Timeouts. Verschiedene Ansätze (neues Profil, neuer Tab via `json/new`, `--headless=new` vs. `--headless`) brachten keine Besserung.

**Lösung:** Playwright verwendet statt direktem CDP.

**Lerneffekt:** Direktes CDP ist fehleranfällig bei headless Chrome. Playwright abstrahiert die Verbindungsprobleme weg.

### 4. Chrome-Zombie-Prozesse

**Problem:** Alte Chrome-Prozesse blieben als `[chrome_crashpad] <defunct>` bzw. `[chromium] <defunct>` im System hängen. Ein `pkill` half teilweise, aber Zombies verschwinden nur, wenn der Parent-Prozess sie reaped.

**Lösung:** Frischer Chrome-Start mit separatem `--user-data-dir=/tmp/chrome-profile2`.

**Lerneffekt:** `--user-data-dir` auf ein frisches Verzeichnis setzen vermeidet Profil-Korruption.

### 5. ES-Module vs. CommonJS-Konflikt

**Problem:** Playwright als global installiertes Paket war im Projekt-Verzeichnis ( `"type": "module"` in `package.json`) nicht als `require()` verfügbar.

**Lösung:** `playwright` als Dev-Dependency im Projekt installieren, Script als `.cjs` benennen.

**Lerneffekt:** Im Pibo-Projekt (ESM) muss jeder Browser-Automation-Code entweder als `.cjs` oder mit `import`-Syntax geschrieben werden.

### 6. Port-Verwirrung zwischen Host und Docker

**Problem:** Der lokale Host-Gateway lief auf `127.0.0.1:4789`, der Docker-Container war auf `217.154.222.150:32813`. Für Screenshots musste klar sein, welche URL getestet wird.

**Lösung:** Explizit die Docker-Container-URL (`http://217.154.222.150:32813/...`) für Tests verwenden.

## Was schlussendlich funktioniert hat

**Playwright** ist der zuverlässigste Weg:

```bash
cd ~/code/pibo
npx playwright install chromium
# Script als .cjs schreiben (CommonJS)
node screenshot_playwright.cjs
```

Mit Playwright konnten in einem einzigen Durchlauf mehrere Mobile-Screenshots (Chat, Sidebar, Agents, Settings) in unter 60 Sekunden erstellt werden – inklusive Mobile-Viewport, Touch-Events und User-Agent.

## Empfehlungen

1. **SingletonSocket automatisieren:** Beim Lease-Acquire prüfen und ggf. automatisch löschen.
2. **Browser-Start automatisieren:** Nach Lease-Acquire Chrome automatisch mit `--no-sandbox --headless=new` starten.
3. **Playwright bevorzugen:** Statt direktem CDP-Websocket die Playwright-API nutzen – stabiler, weniger Boilerplate.
4. **Frische Profile:** Für jede Session ein neues `--user-data-dir` verwenden.
