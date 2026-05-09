# Bericht: Plan für einen Trace-Render-Consistency-Debugger

**Datum:** 2026-05-04  
**Thema:** Programmatische Erkennung von Span-Anordnungsfehlern in der Pibo Webchat-App  
**Status:** Planung abgeschlossen, Implementation ausstehend  

---

## 1. Executive Summary

Die Webchat-App zeigt trotz deutlicher Stabilitätsverbesserungen weiterhin visuelle Anordnungsfehler in der Trace-Timeline: Spans rutschen beim Streaming hin und her, Statusberichte (z.B. Flash Status) landen am unteren Ende der Liste statt an der erwarteten Position, und Tab-Wechsel führen zu durcheinandergewürfelten Render-Reihenfolgen.

Diese Fehler sind visuell schwer zu debuggen, weil sie transient auftreten und von React-Virtualisierung, Streaming-Deltas und mehreren aufeinanderfolgenden Transformationsschichten überlagert werden.

Dieser Bericht dokumentiert:
- Die **fünf identifizierten Transformationsschichten**, durch die ein Backend-Event bis zur Darstellung im Browser läuft.
- Die **konkreten Code-Pfade**, an denen Fehler entstehen können.
- Einen **dreistufigen Plan** für einen Debug-Layer, der bei jedem Event programmatisch den Render-Zustand snapshotet und später gegen die Backend-Source-of-Truth abgleicht.

---

## 2. Problembeschreibung

### 2.1 Beobachtete Symptome

1. **Tab-Wechsel-Degeneration:** Beim Wechseln des Browser-Tabs sind auf einmal alle Spans durcheinander. Das deutet auf einen Re-Render-Bug oder einen State-Loss in React/Virtuoso hin.
2. **Streaming-Rutschen:** Während des Streamings (insbesondere bei `TEXT_MESSAGE_CONTENT`-Deltas) verschieben sich Spans visuell.
3. **Falsche Positionierung von Statusberichten:** Executive Commands und Execution Commands (z.B. Flash Status) erscheinen oft ganz unten in der Liste, obwohl sie aufgrund ihrer semantischen Bedeutung (Phase) höher stehen sollten.

### 2.2 Warum visuelles Debuggen nicht ausreicht

- **Transiente Natur:** Die Fehler verschwinden oft, sobald das Streaming endet oder die Seite neu geladen wird.
- **Hohe Frequenz:** Bei Streaming kommen Deltas mit hoher Frequenz einzeln rein. Ein Mensch kann die sequentielle Veränderung nicht wahrnehmen.
- **Mehrere Abstraktionsschichten:** Der Fehler könnte im Backend-Sortieralgorithmus, im Frontend-Adapter, im Tree-Processor oder im Virtuoso-Renderer liegen. Ohne programmatischen Abgleich ist die Ursache nicht isolierbar.

---

## 3. Architektur-Analyse: Die fünf Transformationsschichten

Ein einzelnes Backend-Event durchläuft bis zur Darstellung fünf aufeinanderfolgende Transformationsschichten. An jeder Schicht kann sich die Reihenfolge verändern.

### Schicht 1: Backend — Trace-View-Aufbau (`src/apps/chat/trace.ts`)

**Funktion:** `buildTraceView({ session, sessions, events, status })`

**Was passiert hier:**
- Liest das Pi-Session-Transcript (`readEntries`, `parseSessionEntries`).
- Projiziert Transcript-Einträge zu `PiboTraceNode[]` (`traceNodesFromEntries`).
- Verarbeitet gespeicherte Events (`ChatWebStoredEvent`) aus `web_chat_events`.
- Führt Merge-Logiken durch:
  - `mergeAssistantDeltaEvent` — appended Text zu einem existierenden `assistant.message`-Node.
  - `mergeThinkingDeltaEvent` — appended Text zu einem `model.reasoning`-Node.
  - `mergeToolEvent` — aktualisiert Tool-Nodes bei Ergebnissen.
- Nestet Nodes via `nestTraceNodes` (Parent-Child-Beziehungen über `parentId`).
- **Sortiert** den gesamten Baum via `sortTraceNodes` unter Verwendung von `compareTraceNodes`.

**Kritischer Code:**
```ts
function compareTraceNodes(left: PiboTraceNode, right: PiboTraceNode): number {
  const byOrder = compareTraceOrder(left.orderKey, right.orderKey);
  if (byOrder !== 0) return byOrder;
  return (left.startedAt ?? "").localeCompare(right.startedAt ?? "") || left.id.localeCompare(right.id);
}
```

**Fehlermöglichkeiten:**
- `orderKey` ist `undefined` → Fallback auf `startedAt` + `id`.
- Merge-Logik überschreibt `orderKey` oder `parentId` inkonsistent.
- `nestTraceNodes` kann bei Race Conditions zwischen Live- und Transcript-Einträgen falsche Parent-Child-Beziehungen aufbauen.

### Schicht 2: Frontend-API — Trace-Abruf (`src/apps/chat/web-app.ts`)

**Funktion:** `GET /api/chat/trace`

**Was passiert hier:**
- Der Server baut `PiboSessionTraceView` (Schicht 1).
- Gibt `nodes`, `version`, `latestStreamId` und optional `rawEvents` zurück.
- Der Client cached das Ergebnis in `react-query`.

**Fehlermöglichkeiten:**
- `version`-Hash ändert sich nicht, obwohl sich die Daten ändern (sehr unwahrscheinlich, da SHA1 über Session + Events).
- Race zwischen Trace-Refresh und SSE-Stream: Der Client hat eine alte Trace und bekommt dann Events mit `streamId`, die auf einer neueren Trace basieren.

### Schicht 3: Frontend — Live-Stream-Anwendung (`src/apps/chat-ui/src/App.tsx`)

**Funktion:** `applyChatStreamEvent` (ca. Zeile 4706)

**Was passiert hier:**
- SSE-Events (`ChatStreamEvent`) werden auf die bestehende `PiboSessionTraceView` angewendet.
- Jeder Event-Typ hat eine eigene Logik:
  - `TEXT_MESSAGE_CONTENT` → `appendTextToNode`
  - `TOOL_CALL_RESULT` → `updateTraceNode` + `withAsyncAgentRunChild`
  - `AGENT_DELEGATION` → `upsertTraceNode` oder `updateTraceNode`
  - `EXECUTION_RESULT` → `upsertTraceNode`
- Neue Nodes werden via `upsertTraceNode` eingefügt, das bei Bedarf `sortTraceNodes` aufruft.

**Kritischer Code:**
```ts
function upsertTraceNode(nodes: PiboTraceNode[], update: PiboTraceNode): PiboTraceNode[] {
  const existing = findTraceNode(nodes, update.id);
  if (existing) {
    return updateTraceNode(nodes, update.id, (node) => ({ ...node, ...update, ... }));
  }
  const parent = update.parentId ? findTraceNode(nodes, update.parentId) : undefined;
  if (parent) {
    return updateTraceNode(nodes, parent.id, (node) => ({
      ...node,
      children: sortTraceNodes([...(node.children ?? []), update]),
    }));
  }
  return sortTraceNodes([...nodes, update]);
}
```

**Fehlermöglichkeiten:**
- `upsertTraceNode` sortiert nur die *Kinder* des Parents oder die Root-Ebene, aber nicht den gesamten Baum neu.
- Wenn ein Live-Event einen Node mit einem `orderKey` erzeugt, der eigentlich *vor* einem bereits existierenden Node stehen müsste, aber derselbe Parent hat, wird nur innerhalb der Kinder sortiert. Wenn aber der Parent selbst falsch positioniert ist, bleibt das unbemerkt.
- `compareTraceNodes` im Frontend ist eine Kopie von `compareTraceNodes` im Backend — sie müssen exakt identisch bleiben, sonst driftet die Live-Version gegenüber dem Server-Refresh auseinander.

### Schicht 4: Frontend — Adaption & Tree-Processing (`src/apps/chat-ui/src/tracing/adapt.ts` + `traceTree.ts`)

**Funktion:** `adaptTrace` + `processSpanTree`

**Was passiert hier:**
- `adaptTrace`: Mappt `PiboTraceNode` auf `Span` (Typ-Anpassung, Attribut-Extraktion).
- `processSpanTree`:
  - Filtert: `model.request` → nicht anzeigen, `agent.run` → Kinder hochziehen.
  - Sortiert erneut mit `compareSpans`, das `compareTraceOrder` aufruft.

**Kritischer Code:**
```ts
function compareSpans(left: Span, right: Span): number {
  const byTraceOrder = compareTraceOrder(left.pibo?.traceOrder, right.pibo?.traceOrder);
  if (byTraceOrder !== 0) return byTraceOrder;
  return left.startTime - right.startTime || left.id.localeCompare(right.id);
}
```

**Fehlermöglichkeiten:**
- `left.pibo?.traceOrder` kann `undefined` sein (z.B. bei Nodes, die aus älteren Transcript-Einträgen stammen, die kein `orderKey` haben). Dann greift der Fallback auf `startTime`.
- `processSpanTree` sortiert die *flache* Liste nach `startTime`, aber wenn `startTime` identisch ist (was bei schnell aufeinanderfolgenden Events passiert), entscheidet `id.localeCompare`. Diese Sortierung ist deterministisch, aber nicht unbedingt semantisch korrekt.
- Bei `agent.run` → Kinder hochziehen: Die Kinder verlieren ihren Parent-Container und werden in die flache Liste eingereiht. Wenn ihre `orderKey` nicht konsistent mit den Geschwistern auf der Root-Ebene sind, rutschen sie an das falsche Ende.

### Schicht 5: Frontend — Flattening & Virtualisierung (`src/apps/chat-ui/src/tracing/TraceTimeline.tsx`)

**Funktion:** `flattenVisibleSpans`

**Was passiert hier:**
- Der gefilterte/sortierte Baum (`spanTree`) wird in eine flache Liste `VisibleSpanRow[]` expandiert.
- Expansion-Zustände (`expansionDepth`, `expansionOverrides`, `expandThinking`) bestimmen, welche Kinder sichtbar sind.
- `Virtuoso` rendert nur den aktuell sichtbaren Ausschnitt.

**Kritischer Code:**
```ts
function flattenVisibleSpans(
  spans: readonly Span[],
  expansionDepth: SpanExpansionDepth,
  expandThinking: boolean,
  expansionOverrides: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>,
  depth = 0,
): VisibleSpanRow[] {
  const rows: VisibleSpanRow[] = [];
  for (const span of spans) {
    const defaultExpanded = isExpandedAtDepth(depth, expansionDepth);
    const override = expansionOverrides[span.id];
    const contentExpanded = override?.contentExpanded ?? (span.spanType === "model.reasoning" ? expandThinking : defaultExpanded);
    const childrenExpanded = override?.childrenExpanded ?? defaultExpanded;
    rows.push({ id: span.id, span, depth, contentExpanded, childrenExpanded });
    if (span.children?.length && contentExpanded && childrenExpanded) {
      rows.push(...flattenVisibleSpans(span.children, expansionDepth, expandThinking, expansionOverrides, depth + 1));
    }
  }
  return rows;
}
```

**Fehlermöglichkeiten:**
- `expansionOverrides` ist UI-State. Wenn er nach einem Tab-Wechsel verloren geht oder sich ändert, ändert sich die sichtbare Reihenfolge.
- `Virtuoso` nutzt `computeItemKey={(_, row) => row.id}`. Wenn sich die Reihenfolge ändert, aber die IDs gleich bleiben, kann Virtuoso interne Positionen wiederverwenden und falsch rendern.
- Tab-Wechsel: Browser pausiert `requestAnimationFrame`. Wenn während des Wechsels ein `flushPendingStreamEvents` aussteht, kann es beim Zurückkehren zu einem Burst kommen, der Virtuoso überfordert.

---

## 4. Root-Cause-Analyse: Wo entstehen die beobachteten Fehler?

### Hypothese 1: Inkonsistenz zwischen Backend- und Frontend-Sortierung

**Begründung:**
- Backend: `compareTraceNodes` in `src/apps/chat/trace.ts`.
- Frontend-Live: `compareTraceNodes` in `src/apps/chat-ui/src/App.tsx` (Kopie).
- Frontend-Tree: `compareSpans` in `src/apps/chat-ui/src/tracing/traceTree.ts`.

Alle drei verwenden `compareTraceOrder`, aber die Fallback-Ketten unterscheiden sich leicht:
- Backend nutzt `(left.startedAt ?? "").localeCompare(...)`.
- Frontend-Tree nutzt `left.startTime - right.startTime`.

Wenn ein Node kein `orderKey` hat und `startedAt`/`startTime` sehr nahe beieinander liegen oder identisch sind, kann `localeCompare` vs. numerische Subtraktion zu unterschiedlichen Ergebnissen führen. Dies ist besonders bei Transcript-Einträgen relevant, die aus der `.session`-Datei gelesen werden und möglicherweise kein `orderKey` besitzen.

### Hypothese 2: Falsche `orderKey`-Generierung für Live-Events

**Begründung:**
Live-Events erhalten ihre `orderKey` via `liveTraceOrder(event.streamId, event.streamFrameIndex, nodeType)`.

Die `streamId` und `streamFrameIndex` kommen aus der SSE `lastEventId`. Wenn das Backend einen Event speichert (`readModel.recordEvent`), wird eine `eventSequence` vergeben, aber die `streamId` wird **nicht** in `web_chat_events` persistiert.

**Konsequenz:**
Wenn der Client einen Trace-Refresh macht, baut das Backend die Trace aus den gespeicherten Events neu auf. Diese haben keine `streamId`, sondern nur `eventSequence`. Die Neu-Sortierung im Backend kann deshalb ein anderes Ergebnis liefern als die inkrementelle Live-Anwendung im Frontend, wo `streamId` verfügbar war.

### Hypothese 3: Race zwischen Trace-Refresh und SSE-Deltas

**Begründung:**
In `App.tsx` gibt es einen `EventSource` und gleichzeitig `scheduleTraceRefresh`. Ein Trace-Refresh lädt die vollständige Trace vom Server. Währenddessen können weiterhin SSE-Events eintreffen, die auf der alten Live-Trace angewendet werden (`enqueueStreamEvent`).

Wenn `flushPendingStreamEvents` nach einem Trace-Refresh läuft, werden die gepufferten Deltas auf die *neue* Trace angewendet. Aber `applyChatStreamEvent` prüft:
```ts
if (event.streamFrameId && view.rawEvents.some((rawEvent) => rawEvent.id === `stream:${event.streamFrameId}`)) {
  return view; // Deduplizierung
}
```

Wenn die neue Trace diese `rawEvents` noch nicht enthält, werden die Deltas doppelt angewendet oder an der falschen Stelle eingefügt.

### Hypothese 4: `agent.run`-Auflösung und verlorene Kinder

**Begründung:**
In `processSpanTree`:
```ts
if (span.spanType === "agent.run") return children ?? [];
```

Ein `agent.run`-Span wird vollständig aufgelöst; seine Kinder treten an seine Stelle. Wenn diese Kinder `orderKey`-Werte haben, die eigentlich nur innerhalb des `agent.run` Containers gültig waren, können sie nach der Auflösung in der flachen Liste an einer unerwarteten Position landen.

### Hypothese 5: Virtuoso & React-State nach Tab-Wechsel

**Begründung:**
- `useEffect` in `TraceTimeline.tsx` setzt bei `trace?.id`-Wechsel `expansionOverrides` zurück.
- Tab-Wechsel löst keinen `trace.id`-Wechsel aus, aber der Browser kann `requestAnimationFrame` pausieren.
- `Virtuoso` hält internen State über die Scroll-Position und die gerenderten Items. Wenn React während des Tab-Wechsels ein Re-Render durchführt (z.B. weil ein `setState` aus einem Timeout kommt), kann Virtuoso mit veralteten Props rendern.
- `bottomLockedRef.current = true` wird in mehreren `useEffect`s gesetzt. Nach Tab-Wechsel kann es zu einem ungewollten Auto-Scroll kommen, der die wahrgenommene Reihenfolge ändert.

---

## 5. Das geplante Snapshot-/Debug-System

### 5.1 Überblick

Ein dreistufiges System, das bei jedem eingehenden Event den Zustand der Trace-Timeline erfasst und später programmatisch gegen die rekonstruierte Backend-Trace vergleicht.

```
┌─────────────────┐     ┌────────────────────┐     ┌─────────────────┐
│  Layer 1        │     │  Layer 2           │     │  Layer 3        │
│  Frontend       │────▶│  Backend Replay    │────▶│  Vergleichs-    │
│  Snapshot       │     │  API               │     │  Engine         │
│  Collector      │     │                    │     │                 │
└─────────────────┘     └────────────────────┘     └─────────────────┘
```

### 5.2 Layer 1: Frontend Snapshot Collector

**Ort:** Neues Modul `src/apps/chat-ui/src/tracing/snapshotCollector.ts`

**Aktivierung:** Per `localStorage.setItem('pibo.chat.traceDebug', 'true')` oder Feature-Flag. Im Normalbetrieb inaktiv (Performance).

**Was wird pro Snapshot erfasst:**

| Feld | Beschreibung |
|------|-------------|
| `timestamp` | Zeitstempel des Snapshots |
| `piboSessionId` | Aktuelle Session |
| `trigger` | Auslöser: `sse` (welches Event), `traceRefresh`, `tabVisible` |
| `frontend.visibleRowIds` | Die ID-Liste aus `flattenVisibleSpans` |
| `frontend.visibleRowsWithMeta` | ID + depth + spanType + status + orderKey |
| `frontend.spanTreeDigest` | Hash über `processSpanTree`-Output |
| `frontend.expansionOverrides` | Aktueller UI-Expansion-State |
| `frontend.domElementCount` | Anzahl `[data-span-id]` im DOM (Sanity-Check für Virtuoso) |
| `backendReference.traceVersion` | Aktueller Trace-Version-Hash |
| `backendReference.latestStreamId` | Letzte bekannte Stream-ID |
| `backendReference.lastRawEventId` | Letzte Raw-Event-ID |

**Integrationspunkte:**

1. **`App.tsx` — `enqueueStreamEvent`:** Snapshot vor und nach `flushPendingStreamEvents`.
2. **`App.tsx` — `applyChatStreamEvent`:** Nach jedem einzelnen Delta-Event (`TEXT_MESSAGE_CONTENT`, `REASONING_MESSAGE_CONTENT`, `TOOL_CALL_ARGS`), da diese die höchste Frequenz haben und die wahrscheinlichsten Ursachen für "Rutschen" sind.
3. **`TraceTimeline.tsx` — `useMemo(visibleRows)`:** Bei jeder Änderung der sichtbaren Zeilen.
4. **Tab-Visibility-Listener:** Bei `document.visibilitychange` → `hidden` und `visible`.

**Speicherung & Deduplizierung:**
- Ring-Buffer pro Session (max. 5000 Einträge).
- Wenn `visibleRowIds` identisch zum letzten Snapshot ist, wird kein neuer Snapshot erzeugt, sondern nur der Trigger protokolliert (Vermeidung von Spam bei Text-Deltas, die nur Inhalt ändern).
- Export-Funktion: `window.__piboTraceSnapshots.exportAsJson()` → Download als `.json`.

**Besonderheit Virtuoso:**
Da Virtuoso nur einen Ausschnitt der Daten im DOM hält, ist `querySelectorAll` allein unzureichend. Primär wird die Daten-Ebene (`visibleRows`) erfasst. Der DOM-Check (`domElementCount`) dient als Sanity-Check, um Tab-Wechsel-Bugs zu erkennen, bei denen Virtuoso weniger Elemente rendert als erwartet.

### 5.3 Layer 2: Backend Replay API

**Ort:** Neuer Endpoint in `src/apps/chat/web-app.ts`

**Endpoint:** `POST /api/chat/debug/trace-at-sequence`

**Request:**
```json
{
  "piboSessionId": "sess-abc-123",
  "eventSequence": 42,
  "includeRawEvents": false
}
```

**Logik:**
1. Liest aus `ChatWebReadModel.listAllEvents(piboSessionId)` alle Events mit `eventSequence <= 42`.
2. Ruft `buildTraceView({ session, sessions, events, status: 'running' })` auf.
3. Gibt `PiboSessionTraceView` zurück.

**Warum das funktioniert:**
Die `ChatWebReadModel` speichert jedes eingehende `PiboOutputEvent` mit einer monoton steigenden `eventSequence` pro Session. Jedes SSE-Event, das im Frontend ankommt, wurde zuvor in der SQLite-Datenbank persistiert. Dadurch können wir für jede `eventSequence` den exakten Zustand reproduzieren, den das Backend zu diesem Zeitpunkt hatte.

**Notwendige Erweiterung:**
Die `ChatWebStoredEvent` enthält derzeit keine `streamId`. Für ein präzises Mapping zwischen Frontend-SSE-Events und Backend-Events sollte `streamId` (aus `lastEventId`) ebenfalls in `web_chat_events` gespeichert werden. Alternativ kann das Mapping über den zeitlichen Verlauf (`createdAt`) und die Reihenfolge hergestellt werden.

### 5.4 Layer 3: Vergleichs-Engine

**Ort:** Neues Modul `src/debug/trace-render-check.ts` oder `test/trace-render-consistency.test.mjs`

**Ablauf:**
1. Lädt den Frontend-Snapshot-Export (JSON).
2. Für jeden Snapshot:
   a. Bestimmt die zugehörige `eventSequence` (über `streamId`-Mapping oder Trace-Version).
   b. Ruft `/api/chat/debug/trace-at-sequence` auf.
   c. Wendet exakt die gleichen Frontend-Transformationen an:
      - `adaptTrace(nodes)` → `Span[]`
      - `processSpanTree(spans)` → gefilterter/sortierter Baum
      - `flattenVisibleSpans(..., expansionOverrides)` → flache Reihenfolge
   d. Vergleicht die resultierende ID-Reihenfolge mit `frontend.visibleRowIds`.
3. Erzeugt einen Report mit dem ersten Mismatch, der Differenz und dem auslösenden Event.

**Vergleichsmodi:**

| Modus | Beschreibung |
|-------|-------------|
| **Structural Mode** | Simulation mit `expansionDepth: 'all'`, ignoriert UI-Overrides. Prüft die strukturelle Sortierung des Baums. |
| **Visual Mode** | Verwendet die tatsächlichen `expansionOverrides` aus dem Snapshot. Prüft die visuell wahrgenommene Reihenfolge. |

**Erkannte Fehlertypen:**

| Code | Beschreibung | Wahrscheinliche Ursache |
|------|-------------|------------------------|
| `ORDER_MISMATCH` | IDs sind in anderer Reihenfolge | Inkonsistenz in `compareTraceOrder` oder Fallback-Logik zwischen Backend und Frontend |
| `DEPTH_MISMATCH` | Gleiche ID hat andere Tiefe | `nestTraceNodes` (Backend) vs. `processSpanTree` (Frontend) |
| `MISSING_SPAN` | ID fehlt im Frontend | `shouldDisplaySpan` filtert zu viel; Merge-Logik hat Node verloren |
| `EXTRA_SPAN` | ID existiert nur im Frontend | Phantom-Node durch inkrementelles Delta-Handling |
| `STATUS_MISMATCH` | Status divergiert (z.B. `running` vs. `done`) | `sessionStatus` wird im Frontend nicht korrekt aktualisiert |
| `TAB_REGRESSION` | Nach Tab-Wechsel ändert sich Reihenfolge | Virtuoso- oder React-Re-Render-Bug |
| `STREAM_DRIFT` | Live-Version divergiert nach N Deltas vom Backend-Refresh | `applyChatStreamEvent` akkumuliert Inkonsistenzen |

---

## 6. Implementations-Roadmap

### Schritt 1: Frontend Snapshot Collector (1–2 Tage)
- Modul `snapshotCollector.ts` mit Ring-Buffer und Export.
- Integration in `App.tsx` bei `enqueueStreamEvent` / `flushPendingStreamEvents`.
- Integration in `TraceTimeline.tsx` bei `visibleRows`-Änderung.
- Tab-Visibility-Listener.
- Manueller Test: Chat starten, Snapshots exportieren, JSON auf Plausibilität prüfen.

### Schritt 2: Backend Replay API (0.5–1 Tag)
- Neuer Endpoint `POST /api/chat/debug/trace-at-sequence`.
- Mapping-Logik `streamId` ↔ `eventSequence` (ggf. Erweiterung der DB-Schema).
- Test mit `curl` für verschiedene `eventSequence`-Werte.

### Schritt 3: Vergleichs-Engine als Node.js-Skript (1–2 Tage)
- Liest Snapshot-JSON.
- Ruft Replay-API auf.
- Importiert und führt `adaptTrace`, `processSpanTree`, `flattenVisibleSpans` aus (via `tsx` direkt aus den Source-Dateien, um Code-Duplikation zu vermeiden).
- Report-Generator mit Differenz-Anzeige.
- Erster Lauf mit einem bekannten Problemfall.

### Schritt 4: Automatisierung & CI-Integration (optional)
- Ein `browser-use`-Test oder API-Test, der eine Session mit Tool-Calls und Streaming fährt.
- Snapshots automatisch exportieren und prüfen.
- Als `npm run test:trace-consistency` verfügbar machen.

---

## 7. Offene Fragen & Entscheidungspunkte

1. **Performance im Normalbetrieb:** Der Collector sollte per Default inaktiv sein. Soll die Aktivierung rein über `localStorage` erfolgen, oder brauchen wir ein UI-Flag (z.B. ein "Debug Mode"-Toggle im Settings-Bereich)?

2. **Datenschutz der Snapshots:** Snapshots enthalten keine sensiblen Chat-Inhalte (nur IDs, Typen, Status, Reihenfolge), aber `visibleRowsWithMeta` enthält `span.name` und `spanType`. Das ist unkritisch, sollte aber dokumentiert werden, falls Snapshots geteilt werden.

3. **Stream-ID-Persistenz:** Soll `streamId` in `web_chat_events` gespeichert werden? Das würde das Mapping Frontend ↔ Backend erheblich vereinfachen, erfordert aber ein DB-Migration.

4. **Virtuoso-Interna:** Sollten wir Virtuoso-spezifische Debug-Informationen (z.B. `virtuosoRef.current?.getState()`) ebenfalls sammeln? Das könnte Tab-Wechsel-Bugs genauer lokalisieren, ist aber abhängig von der Virtuoso-API.

5. **Umfang des ersten Milestones:** Soll Schritt 3 (Vergleichs-Engine) als CLI-Skript oder als integrierter "Check"-Button im Frontend-UI umgesetzt werden? Eine CLI ist schneller zu bauen; ein UI-Button wäre für schnelles Feedback während der Entwicklung komfortabler.

---

## 8. Referenzen

### Kern-Dateien (analysiert in dieser Session)

| Datei | Zweck |
|-------|-------|
| `src/apps/chat/trace.ts` | Backend-Trace-Aufbau, Sortierung, Merge-Logik |
| `src/apps/chat/stream.ts` | SSE-Event-Typen und Frame-Generierung |
| `src/apps/chat/read-model.ts` | SQLite-Schema für Sessions & Events |
| `src/apps/chat/web-app.ts` | Web-API, EventSource-Handling, Trace-Endpoint |
| `src/apps/chat-ui/src/App.tsx` | Frontend-State, Live-Stream-Anwendung, `applyChatStreamEvent` |
| `src/apps/chat-ui/src/tracing/adapt.ts` | Mapping `PiboTraceNode` → `Span` |
| `src/apps/chat-ui/src/tracing/traceTree.ts` | Baum-Filterung und -Sortierung (`processSpanTree`) |
| `src/apps/chat-ui/src/tracing/TraceTimeline.tsx` | Flattening, Expansion, Virtuoso-Integration |
| `src/apps/chat-ui/src/tracing/SpanNode.tsx` | Darstellung einzelner Spans |
| `src/shared/trace-order.ts` | `compareTraceOrder`, `TraceOrderKey`, `liveTraceOrder` |
| `src/debug/trace.ts` | Bestehende Debug-CLI (`inspectDebugTrace`, `checkTraceView`) |

### Relevante Datenbank-Tabellen

- `web_chat_sessions` — Session-Metadaten (Status, lastActivityAt).
- `web_chat_events` — Gespeicherte Events mit `event_sequence`, `event_id`, `type`, `payload_json`.

---

## 9. Zusammenfassung der Erkenntnisse

1. **Es gibt fünf Transformationsschichten**, an denen sich die Reihenfolge von Spans verändern kann. Die kritischsten sind Schicht 1 (Backend-Sortierung) und Schicht 3 (Frontend-Live-Anwendung), da hier inkrementelle Updates mit vollständigen Re-Sorts interagieren.

2. **`compareTraceOrder` ist das Zentrum der Sortierung**, aber die Fallback-Ketten (`startedAt` vs. `startTime`, `localeCompare` vs. numerische Subtraktion) unterscheiden sich leicht zwischen Backend und Frontend. Das ist eine potentielle Quelle für Drift.

3. **Live-Events und Backend-Refresh nutzen unterschiedliche Sortier-Schlüssel:** Frontend-Live nutzt `streamId:frameIndex`, Backend nutzt `eventSequence`. Wenn diese nicht konsistent zueinander sind, entsteht ein Mismatch zwischen Live-Zustand und dem Zustand nach einem Trace-Refresh.

4. **`upsertTraceNode` im Frontend sortiert nicht den gesamten Baum neu**, sondern nur die betroffene Ebene (Kinder eines Parents oder Root-Ebene). Bei komplexen Parent-Child-Umstrukturierungen kann das zu lokal korrekten, aber global falschen Reihenfolgen führen.

5. **Tab-Wechsel-Bugs sind wahrscheinlich keine Datenfehler, sondern Render-Fehler.** Virtuoso hält internen State, der nach einem Tab-Wechsel (Pausierung von `requestAnimationFrame`) inkonsistent sein kann. Der Snapshot-Collector muss deshalb sowohl die Daten-Ebene als auch den DOM-Zustand erfassen.

6. **Die bestehende Debug-Infrastruktur** (`src/debug/trace.ts`) prüft bereits strukturelle Probleme im Backend (duplizierte IDs, fehlende `orderKey`, fehlende Parents), aber es gibt **keine Prüfung der Frontend-Render-Reihenfolge**. Der geplante System schließt genau diese Lücke.

---

*Bericht erstellt von Pibo im Rahmen der Planung eines Trace-Render-Consistency-Debuggers.*
