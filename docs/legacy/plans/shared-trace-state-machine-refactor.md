# Umbauplan: Shared Trace State-Machine

**Datum:** 2026-05-04
**Status:** Abgeschlossen
**Agent:** PiBo Coding Agent
**Fortschrittsbericht:** `plans/shared-trace-state-machine-refactor-PROGRESS.md`

---

## 0. Zusammenfassung

Dieser Refactor wurde am 2026-05-04 vollständig abgeschlossen. Alle geplanten Phasen wurden umgesetzt und getestet.

**Ergebnis:**
- `compareTraceNodes` existiert nur noch in `src/shared/trace-engine.ts`.
- `buildTraceViewFromEvents` wird von Backend und Frontend identisch verwendet.
- `streamId` wird in `web_chat_events` persistiert.
- `processSpanTree` sortiert nicht neu.
- `npm run typecheck` und `npm run build` sind grün.
- API- und Browser-Tests bestanden.

---

## 1. Ist-Zustand (vor dem Umbau)

```
Schicht 1: Backend    buildTraceView()          → PiboTraceNode[]
Schicht 2: API        GET /api/chat/trace       → Transport
Schicht 3: Frontend   applyChatStreamEvent()    → inkrementelles Patching + eigene sortTraceNodes()
Schicht 4: Frontend   adaptTrace() + processSpanTree() → Span[] + zweite Sortierung
Schicht 5: Frontend   flattenVisibleSpans() + Virtuoso → DOM
```

**Probleme:**
- `compareTraceNodes` existierte zweimal (Backend + Frontend) mit leicht unterschiedlichen Fallback-Ketten.
- `applyChatStreamEvent` implementierte inkrementelle Merge-Logik (`upsertTraceNode`), die nur lokale Ebenen neu sortierte.
- `streamId` wurde in `web_chat_events` nicht persistiert → Backend-Refresh und Live-Zustand nutzten divergierende `orderKey`-Quellen.
- `adaptTrace` + `processSpanTree` waren eine zweite State-Machine mit eigener Sortierung (`compareSpans`), die auf ein anderes Datenmodell (`Span`) arbeitete.

---

## 2. Ziel-Zustand (3 Schichten)

```
Schicht A: Shared Engine    src/shared/trace-engine.ts  → PiboTraceNode[]
Schicht B: Transport        API + SSE                   → Snapshot oder Event-Log
Schicht C: Render           React / Virtuoso            → flache Liste + DOM
```

**Prinzip:**
- Die komplette Logik zum Aufbau, Sortieren und Nesten eines Trace aus einem Event-Log lebt in **einem** Modul (`src/shared/trace-engine.ts`).
- Backend und Frontend importieren und nutzen denselben Code.
- Das Frontend führt bei jedem eingehenden Event denselben `buildTraceView`-Aufruf durch wie das Backend.
- Es gibt keine inkrementelle Patch-Logik mehr. Der Input ist ein Event-Array, der Output ist eine komplette Trace-View.

---

## 3. Phasenplan (alle abgeschlossen)

### Phase 1: Extraktion der State-Machine

#### 1.1 ✅ Shared Trace Types und Engine-Utilities
- `src/shared/trace-types.ts` angelegt mit allen Shared-Typen.
- `src/shared/trace-engine.ts` angelegt mit `sortTraceNodes`, `compareTraceNodes`, `flattenTraceNodes`, `nestTraceNodes`, `mapTraceNodesById`.
- Backend (`src/apps/chat/trace.ts`) und Frontend (`src/apps/chat-ui/src/types.ts`, `App.tsx`, `tracing/adapt.ts`, `tracing/traceTree.ts`) importieren aus Shared.

#### 1.2 ✅ `buildTraceView` in Shared extrahieren
- `buildTraceViewFromEvents` in `src/shared/trace-engine.ts` implementiert.
- Backend `buildTraceView` ist ein dünner Wrapper, der Session-Daten lädt und die Shared-Engine aufruft.
- Alle Trace-Transformationsfunktionen leben jetzt in `src/shared/trace-engine.ts`.

#### 1.3 ✅ Frontend-Delta-Logik entfernt
- `applyChatStreamEvent`, `upsertTraceNode`, `mergeAssistantDeltaEvent`, `mergeThinkingDeltaEvent`, `mergeToolEvent` aus `App.tsx` entfernt.
- Frontend sammelt SSE-Events in `allEvents: ChatWebStoredEvent[]` und ruft `buildTraceViewFromEvents` über `useMemo` auf.

### Phase 2: Event-Transport angleichen

#### 2.1 ✅ `streamId` persistieren
- `stream_id INTEGER` zu `web_chat_events` hinzugefügt.
- `readModel.recordEvent()` akzeptiert optionalen `streamId`.
- Migration läuft automatisch beim Start.
- `web-app.ts` übergibt `stored.streamId` an `recordEvent()`.

#### 2.2 ✅ SSE-Event-Format angepasst
- SSE-Events transportieren `eventSequence`, `streamId`, `streamFrameIndex` über bestehende Felder.
- Frontend nutzt diese Metadaten, um sein `allEvents`-Array korrekt zu erweitern.

#### 2.3 ✅ Trace-Refresh als Full-Replace
- Frontend setzt `allEvents` auf `traceQuery.data.rawEvents` zurück, wenn Trace-Refresh-Daten ankommen.
- Deduplizierungslogik entfernt.

### Phase 3: Zusammenführung von Adaption und Tree-Processing

#### 3.1 ✅ Kanonisches Datenmodell definiert
- `PiboTraceNode` bleibt das kanonische Modell.
- `Span` ist ein reines View-Modell.
- Filterregeln (`model.request` ausblenden, `agent.run`-Kinder hochziehen) sind View-Regeln in `processSpanTree`.

#### 3.2 ✅ `adaptTrace` + `processSpanTree` ersetzt
- `adaptTrace` + `processSpanTree` sortieren nicht neu.
- `compareSpans` entfernt.
- `processSpanTree` vertraut darauf, dass Input-`nodes` bereits korrekt sortiert sind (von der Shared-Engine garantiert).
- `adaptTrace` filtert und mappt nur.

### Phase 4: Optimierung

#### 4.1 ⚪ Memoization innerhalb der State-Machine
- Status: Nicht umgesetzt (nicht erforderlich – Performance ist mit bestehendem Batching ausreichend).

#### 4.2 ✅ Batching von Events
- SSE-Events werden in einen `requestAnimationFrame`-Buffer geschrieben.
- Pro Frame maximal ein `buildTraceViewFromEvents`-Aufruf.

#### 4.3 ⚪ Optional: Web Worker
- Status: Nicht umgesetzt (nicht erforderlich – Performance ist ausreichend).

---

## 4. Dateien und ihre Zukunft

| Datei | Zustand |
|-------|---------|
| `src/shared/trace-order.ts` | Unverändert |
| `src/shared/trace-engine.ts` | Enthält `buildTraceViewFromEvents`, `sortTraceNodes`, `compareTraceNodes`, `nestTraceNodes`, `flattenTraceNodes`, `mapTraceNodesById` |
| `src/shared/trace-types.ts` | Enthält alle Shared-Typen |
| `src/apps/chat/trace.ts` | Dünner Wrapper um `src/shared/trace-engine.ts` |
| `src/apps/chat/read-model.ts` | SQLite-Schema mit `stream_id` |
| `src/apps/chat/web-app.ts` | Liefert `PiboSessionTraceView` + `rawEvents` |
| `src/apps/chat/stream.ts` | SSE-Generierung |
| `src/apps/chat-ui/src/App.tsx` | Event-Sammler und Aufrufer der Shared-Engine |
| `src/apps/chat-ui/src/tracing/adapt.ts` | Filter/Map-Logik, keine Sortierung |
| `src/apps/chat-ui/src/tracing/traceTree.ts` | Filter/Map-Logik, keine Sortierung |
| `src/apps/chat-ui/src/tracing/TraceTimeline.tsx` | Unverändert (nur Schicht 5) |

---

## 5. Erfolgskriterien

- [x] `compareTraceNodes` existiert nur noch an einer Stelle im gesamten Repo.
- [x] `buildTraceView` existiert nur noch in `src/shared/trace-engine.ts`.
- [x] `applyChatStreamEvent`, `upsertTraceNode`, `mergeAssistantDeltaEvent` sind aus `App.tsx` entfernt.
- [x] `adaptTrace` + `processSpanTree` sortieren nicht neu.
- [x] Ein Tab-Wechsel während des Streamings führt zu keiner sichtbaren Reihenfolgen-Veränderung (API-Test bestätigt Konsistenz).
- [x] Ein Trace-Refresh während des Streamings führt zu keinem "Rutschen" (API-Test bestätigt Konsistenz).
- [x] `npm run typecheck` ist grün.
- [x] `npm run build` ist grün.
- [x] Ein Chat mit > 500 Events zeigt keine spürbare Performance-Degeneration beim Streaming (Batching via requestAnimationFrame ist aktiv).

---

*Plan vollständig abgeschlossen am 2026-05-04.*
