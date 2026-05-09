# Fortschrittsbericht: Shared Trace State-Machine Refactor

**Datum:** 2026-05-04
**Agent:** PiBo Coding Agent
**Status:** Abgeschlossen

---

## 1. Was wurde erreicht

### Phase 1.1: Shared Trace Engine Extraction ✅

**Neue Dateien angelegt:**
- `src/shared/trace-types.ts` – Enthält alle Trace-relevanten Typen (`PiboTraceNode`, `TraceNodeType`, `TraceOrderKey`, `PiboSessionTraceView`, `ChatWebTraceEvent`, `ChatWebStoredEvent` etc.). Diese waren vorher dupliziert zwischen Backend und Frontend.
- `src/shared/trace-engine.ts` – Enthält die extrahierten Funktionen:
  - `sortTraceNodes(nodes)`
  - `compareTraceNodes(a, b)`
  - `flattenTraceNodes(nodes)`
  - `nestTraceNodes(nodes)`
  - `mapTraceNodesById(nodes)`
  - `buildTraceViewFromEvents(input)` – Die komplette Trace-View-Logik

**Backend-Anpassungen (`src/apps/chat/trace.ts`):**
- Entfernt lokale Kopien von allen Trace-Transformationsfunktionen.
- Importiert diese jetzt aus `src/shared/trace-engine.ts`.
- `buildTraceView` ist ein dünner Wrapper, der Session-Daten lädt und `buildTraceViewFromEvents` aufruft.

**Frontend-Anpassungen:**
- `src/apps/chat-ui/src/types.ts` – Entfernt duplizierte Typdefinitionen, importiert jetzt aus `src/shared/trace-types.ts`.
- `src/apps/chat-ui/src/App.tsx` – Entfernt `applyChatStreamEvent`, `upsertTraceNode`, `mergeAssistantDeltaEvent`, `mergeThinkingDeltaEvent`, `mergeToolEvent`. Nutzt stattdessen `allEvents: ChatWebStoredEvent[]` mit `useMemo(() => buildTraceViewFromEvents(...))`.
- `src/apps/chat-ui/src/tracing/adapt.ts` – Importiert aus `src/shared/trace-types.ts`, mappt nur ohne Sortierung.
- `src/apps/chat-ui/src/tracing/traceTree.ts` – Entfernt `compareSpans` und `sortByStartTime`. Vertraut darauf, dass Input bereits sortiert ist.

### Phase 2.1: streamId Persistence ✅

**Datenbank-Schema (`src/apps/chat/read-model.ts`):**
- Spalte `stream_id INTEGER` zu `web_chat_events` hinzugefügt.
- `recordEvent()` akzeptiert jetzt optionalen `streamId?: number` Parameter.
- Migration: Beim Start wird `ALTER TABLE web_chat_events ADD COLUMN stream_id INTEGER` ausgeführt, falls die Spalte fehlt.

**API-Integration (`src/apps/chat/web-app.ts`):**
- `stored.streamId` aus `eventLog.appendOutputEvent()` wird jetzt an `readModel.recordEvent()` übergeben.

### Phase 3: Adaptation und Tree-Processing ✅

- `adaptTrace` + `processSpanTree` sortieren nicht neu.
- `compareSpans` entfernt.
- Die Render-Vorbereitung vertraut darauf, dass `PiboTraceNode[]` bereits von der Shared-Engine korrekt sortiert ist.

---

## 2. Verifikationsergebnisse

| Prüfung | Ergebnis |
|---------|----------|
| `npm run typecheck` | ✅ Grün |
| `npm run build` | ✅ Grün |
| Docker-Container (ohne Port-Exposure) | ✅ Läuft stabil |
| API-Test: streamId in DB | ✅ Bestätigt – alle neuen Events haben `stream_id` |
| API-Test: Trace-Konsistenz | ✅ Node-IDs eindeutig, Reihenfolge stabil |
| Browser-Test (Headless) | ✅ Chat-UI lädt, Auth funktioniert, Textarea gefunden |

---

## 3. Bekannte Probleme / Hinweise

1. **Browser-Tests im Container:** Headless-Chromium funktioniert mit CDP, aber Interaktion mit dem Composer war nicht vollständig stabil. API-Tests sind die bevorzugte Verifikationsmethode.
2. **Dev-Auth:** Der Endpunkt `/api/auth/callback/google?code=dev` setzt das `pibo_dev_session`-Cookie. Damit funktionieren alle Chat-API-Routen.
3. **Datenbank-Standort im Container:** Die SQLite-DB liegt unter `/app/.pibo/web-chat.sqlite`.
4. **Test-Failures:** Zwei Unit-Tests (`plugin-registry.test.mjs`, `session-actions.test.mjs`) schlugen bereits vor diesem Refactor fehl und sind nicht durch die Änderungen entstanden.

---

## 4. Geänderte Dateien

```
A  src/shared/trace-engine.ts
A  src/shared/trace-types.ts
M  src/apps/chat/trace.ts
M  src/apps/chat/read-model.ts
M  src/apps/chat/web-app.ts
M  src/apps/chat-ui/src/App.tsx
M  src/apps/chat-ui/src/types.ts
M  src/apps/chat-ui/src/tracing/adapt.ts
M  src/apps/chat-ui/src/tracing/traceTree.ts
```

---

*Dieser Refactor wurde am 2026-05-04 vollständig abgeschlossen.*
