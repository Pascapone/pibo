# Report: Shared Trace Refactor – Problemanalyse & Erkenntnisse

**Datum:** 2026-05-04
**Commit untersucht:** `7dd8b3d` (refactor(shared-trace): Extract shared trace engine...)
**Vergleichsbasis:** `8b7a5c4` (letzter Commit vor dem Refactor)

---

## 1. Was wurde umgebaut

### Vorher (8b7a5c4)
- **Backend:** `buildTraceView` in `src/apps/chat/trace.ts` – lokale 1300-Zeilen-Engine
- **Frontend:** `applyChatStreamEvent` in `src/apps/chat-ui/src/App.tsx` – inkrementeller Patch direkt im React Query Cache
- **Duplizierte Typen** zwischen Backend (`trace.ts`) und Frontend (`types.ts`)
- **`streamId`** wurde nicht in DB persistiert

### Nachher (7dd8b3d)
- **Shared Engine:** `src/shared/trace-engine.ts` – zentrale `buildTraceViewFromEvents()`
- **Shared Types:** `src/shared/trace-types.ts` – einheitliche Typen
- **Frontend:** `allEvents` (React State) + `useMemo(() => buildTraceViewFromEvents(...))`
- **`streamId`** wird in `web_chat_events` persistiert (mit Migration)
- **`traceTree.ts`** sortiert nicht mehr, vertraut auf Input-Sortierung

---

## 2. Was funktioniert grundsätzlich

| Komponente | Status |
|-----------|--------|
| `npm run typecheck` | ✅ Grün |
| `npm run build` | ✅ Grün |
| `streamId` Persistenz in DB | ✅ Funktioniert, Migration läuft |
| Backend Trace-View über Shared Engine | ✅ Liefert konsistente Ergebnisse |
| Chat-UI lädt initial | ✅ Funktioniert |

---

## 3. Kritische Probleme (P0)

### 3.1 Live-Events werden bei Query-Refresh vernichtet

**Ort:** `src/apps/chat-ui/src/App.tsx:1274-1282`

```tsx
useEffect(() => {
    if (traceQuery.data) {
        setAllEvents(traceQuery.data.rawEvents);  // ← ALLE Live-Events WEG
        const maxSeq = traceQuery.data.rawEvents
            .map((e) => e.eventSequence ?? 0)
            .reduce((a, b) => Math.max(a, b), 0);
        liveEventSeqRef.current = maxSeq + 1;
    }
}, [traceQuery.data]);
```

**Was passiert:**
- React Query führt automatisch Refetches durch (Window Focus, `scheduleTraceRefresh` nach 1500ms)
- `traceQuery.data` ändert sich → `useEffect` feuert
- `setAllEvents(traceQuery.data.rawEvents)` überschreibt den kompletten State
- Alle seit dem letzten Fetch hereingekommenen Live-Events (SSE-Deltas) sind **weg**

**Symptom:** "Sachen laden nicht richtig", "Rendert nicht mehr korrekt", flackernde/verschwindende Nodes

**Vorher:** `applyChatStreamEvent` patchte direkt im Query-Cache. Live-Events waren persistiert und gingen nicht verloren.

---

### 3.2 Sequenznummern-Kollision

**Ort:** `src/apps/chat-ui/src/App.tsx:1279-1280`

```tsx
liveEventSeqRef.current = maxSeq + 1;
```

**Was passiert:**
1. Frontend fetched Events 1-100 aus DB (`maxSeq = 100`)
2. Während des Streams kommen Live-Events 101, 102, 103 rein
3. React Query refreshed → `maxSeq` aus DB ist immer noch 100
4. `liveEventSeqRef.current = 100 + 1 = 101`
5. Nächstes Live-Event bekommt Sequenznummer 101 → **Kollision mit Event 101**

**Symptom:** "Nicht in der richtigen Reihenfolge", doppelte Nodes, Nodes an falscher Position

---

### 3.3 Komplette Neuberechnung bei JEDEM SSE-Event

**Ort:** `src/apps/chat-ui/src/App.tsx:1284-1299`

```tsx
const currentTraceView = useMemo(() => {
    if (!selectedPiboSessionId || !bootstrap || allEvents.length === 0) return traceQuery.data ?? null;
    return buildTraceViewFromEvents({
        session: { id: selectedPiboSessionId, piSessionId: ... },
        events: allEvents,  // ← ALLE Events, bei JEDER Änderung
        status: sessionStatus,
        latestStreamId: traceQuery.data?.latestStreamId,
        includeRawEvents: true,
        rawEventsLimit: 10000,
    });
}, [allEvents, selectedPiboSessionId, bootstrap, traceQuery.data]);
```

**Was passiert:**
- `buildTraceViewFromEvents` ist **1300 Zeilen**
- Sie iteriert über **alle** Events, baut Nodes auf, merged Deltas, nested, sortiert
- Bei jedem einzelnen `assistant_delta` (und ein LLM-Stream produziert Dutzende pro Sekunde) wird diese Funktion **komplett neu** ausgeführt
- Komplexität: **O(n × m)** – n = persistierte Events, m = Live-Events

**Symptom:** "Mit der Zeit funktioniert es tatsächlich schlechter als vorher"

**Vorher:** `applyChatStreamEvent` war **O(1)** pro Event – nur die betroffene Node wurde aktualisiert.

**Messung:** Bei einer Session mit 500 persistierten Events und 50 Live-Deltas pro Antwort → 25.000 Iterationen pro Antwort. Vorher: ~50 Operationen.

---

## 4. Code-Qualitätsprobleme (P1)

### 4.1 Doppelte Sortierung

**Ort:** `src/shared/trace-engine.ts:215-217`

```ts
const nestedNodes = nestTraceNodes(nodes);  // ← sortiert bereits intern
reconcileAsyncAgentRunStatuses(nestedNodes);
sortTraceNodes(nestedNodes);  // ← sortiert NOCHMAL
```

`nestTraceNodes` ruft bereits `sortTraceNodes(roots)` auf. Die zweite Sortierung ist redundant.

---

### 4.2 Hartcodierte Limits

**Ort:** `src/apps/chat-ui/src/App.tsx`

- `rawEventsLimit: 10000` statt `DEFAULT_RAW_EVENTS_LIMIT` (80)
- `includeRawEvents: true` immer aktiv, auch wenn `showRawEvents = false`
- `traceQueryKey` hängt nicht mehr von `showRawEvents` ab

**Auswirkung:** Selbst wenn der User keine Raw Events sehen will, werden immer 10.000 Events geladen und durch die Engine gejagt.

---

### 4.3 `traceTree.ts` sortiert nicht mehr defensiv

**Ort:** `src/apps/chat-ui/src/tracing/traceTree.ts`

**Vorher:**
```ts
for (const span of sortByStartTime(spans)) { ... }
```

**Jetzt:**
```ts
for (const span of spans) { ... }  // ← KEINE Sortierung
```

Wenn die Engine jemals nicht perfekt sortiert ausgibt (z.B. durch Sequenznummern-Kollisionen), rendert die Tree-Ansicht komplett falsch.

---

### 4.4 `liveTraceOrder` vs `eventTraceOrder`

**Ort:** `src/shared/trace-order.ts`

Vorher wurden Live-Events mit `liveTraceOrder(streamId, streamFrameIndex, type)` sortiert. Der `turnSeq` war `streamId ?? MAX_SAFE_INTEGER`.

Jetzt bekommen Live-Events `eventTraceOrder(eventSequence, type, streamId, streamFrameIndex)`. Der `turnSeq` dort ist `eventSequence ?? streamId ?? MAX_SAFE_INTEGER`.

Wenn `eventSequence` für Live-Events inkrementell vergeben wird, aber nicht mit den `streamId`/`streamFrameIndex` der Backend-Events synchronisiert ist, können Live-Events an der **falschen Position** in der Timeline landen.

---

## 5. Architektonische Erkenntnis

### Das Kernproblem ist eine Architektur-Regression

Der Refactor hat zwei **getrennte Verantwortlichkeiten** in **eine** Funktion gepresst:

| Verantwortlichkeit | Vorher | Jetzt |
|---|---|---|
| Initial-Load / Backend-Trace | `buildTraceView` (Backend) | `buildTraceViewFromEvents` (Shared) ✅ |
| Live-Stream-Updates | `applyChatStreamEvent` (Frontend, O(1)) | `buildTraceViewFromEvents` (Shared, O(n)) ❌ |

`buildTraceViewFromEvents` ist die **richtige** Lösung für:
- Backend-API (`/api/chat/trace`)
- Initial-Load im Frontend
- Tests und Validation

Sie ist die **falsche** Lösung für:
- Inkrementelle Live-Updates im Frontend
- SSE-Stream-Verarbeitung in Echtzeit

---

## 6. Erfolgskriterien für einen Fix

1. ✅ Live-Events gehen bei Query-Refresh nicht verloren
2. ✅ Sequenznummern sind streng monoton steigend
3. ✅ `assistant_delta` bei 50+ Events hintereinander: < 16ms pro Update (60 FPS)
4. ✅ `buildTraceViewFromEvents` und inkrementeller Patch produzieren identische Ergebnisse
5. ✅ `traceTree.ts` sortiert defensiv
6. ✅ `rawEventsLimit` ist konfigurierbar (nicht hartcodiert)
7. ✅ Alle bestehenden Tests grün
8. ✅ Neue Unit-Tests für inkrementellen Patch grün
9. ✅ E2E-Browser-Test läuft durch und zeigt korrekte Timeline

---

## 7. Dateien im Scope

### Kernänderungen nötig
| Datei | Problem |
|-------|---------|
| `src/apps/chat-ui/src/App.tsx` | Live-State-Management, Performance, hartcodierte Limits |
| `src/shared/trace-engine.ts` | Fehlende inkrementelle Patch-Funktion, doppelte Sortierung |
| `src/apps/chat-ui/src/tracing/traceTree.ts` | Fehlende defensive Sortierung |

### Tests nötig
| Datei | Test-Typ |
|-------|----------|
| `test/chat-trace.test.mjs` | Unit-Tests für inkrementellen Patch |
| `test/chat-ui-e2e.test.mjs` | **Neu** – Browser-E2E-Test |

---

*Dieser Report wurde erstellt aus Code-Review des Commits `7dd8b3d`, Analyse der betroffenen Dateien, und Vergleich mit der Vorher-Version `8b7a5c4`.*
