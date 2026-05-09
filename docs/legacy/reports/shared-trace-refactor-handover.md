# Handover: Shared Trace Refactor – Implementierungsstand

**Datum:** 2026-05-04  
**Branch/Commit:** working directory auf `52c55fc`  
**Zuständig:** Kimi Code CLI  

---

## Was wurde implementiert (Phasen 1–3)

| Phase | Änderung | Status |
|-------|----------|--------|
| **1.1** | `App.tsx`: Merge-Logik statt `allEvents`-Reset bei Query-Refresh | ✅ |
| **1.2** | `App.tsx`: `liveEventSeqRef` als monotoner Counter gesichert | ✅ |
| **1.3** | `App.tsx`: `rawEventsLimit` / `includeRawEvents` wieder konfigurierbar | ✅ |
| **2.1** | `trace-engine.ts`: `patchTraceViewWithEvent` + `applySingleEventToNodes` | ✅ |
| **2.2** | `App.tsx`: Zweistufige View-Berechnung (`baseTraceView` + `liveEvents.reduce`) | ✅ |
| **3.1** | `trace-engine.ts`: Doppelte `sortTraceNodes` nach `nestTraceNodes` entfernt | ✅ |
| **3.2** | `traceTree.ts`: Defensive Sortierung mit `sortByStartTime` wiederhergestellt | ✅ |
| **Tests** | 6 neue Unit-Tests für `patchTraceViewWithEvent` | ✅ |

## Dateien die geändert wurden

- `src/shared/trace-engine.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/traceTree.ts`
- `src/apps/chat/trace.ts` (Re-Export von `traceNodesFromEntries`)
- `test/chat-trace.test.mjs` (RAW_EVENT-Fixes + 6 neue Tests)

## Build & Unit-Tests

```bash
cd /root/code/pibo
npm run typecheck   # ✅ grün
npm run build       # ✅ grün
node --test test/chat-trace.test.mjs   # ✅ 42/42 pass
```

## Was noch offen ist (Phase 4 & 5)

### 1. Integrationstest: Live-Stream-Simulation
Noch **nicht** implementiert. Soll simulieren:
- `message_started` → `thinking_delta` ×3 → `thinking_finished` → `assistant_delta` ×10 → `tool_call` → `tool_execution_finished` → `message_finished`
- Query-Refresh mitten im Stream
- Performance-Assertion: < 16ms pro Event

### 2. End-to-End-Browser-Test
Noch **nicht** durchgeführt. Sollte folgendes abdecken:
1. Gateway starten (`pibo gateway:web --web-port 4788`)
2. Dev-Auth: `curl -c /tmp/cookies.txt "http://localhost:4788/api/auth/callback/google?code=dev"`
3. Mit `browser-use` oder `pibo mcp` (Chrome DevTools MCP) öffnen:
   - `http://localhost:4788/chat`
4. Neue Session erstellen
5. Nachricht "Hello" senden
6. Auf Assistant-Antwort warten (min. 1 `assistant.message` Node)
7. Screenshot der Timeline
8. Node-Reihenfolge prüfen (User → Assistant)

### 3. Performance-Profiling
- React DevTools Profiler für `currentTraceView` Re-renders
- `countRender` aus `renderMetrics.ts` auswerten

## Empfohlene nächste Schritte

1. **E2E-Test manuell durchführen**
   - Gateway läuft bereits auf `127.0.0.1:4788` (siehe `systemctl status pibo-web`)
   - Authentifizierung über Dev-Auth-Cookie
   - `browser-use` oder `pibo mcp` für Browser-Automation nutzen
   - Siehe Incident Report `reports/browser-use-incident-2026-05-04.md` für bekannte Start-Probleme

2. **Integrationstest ergänzen**
   - Neue Test-Datei `test/chat-ui-integration.test.mjs` oder Erweiterung von `test/chat-trace.test.mjs`
   - SSE-Stream mit 50+ Delta-Events simulieren

3. **Cleanup**
   - `git diff` reviewen
   - Commit erstellen
   - zuerst `deploy-web-dev.sh` ausführen und auf dem Dev Gateway validieren
   - `deploy-web.sh` final erst nach Freigabe ausführen (Service braucht manchmal >30s bis Port 4788 erreichbar ist)

---
