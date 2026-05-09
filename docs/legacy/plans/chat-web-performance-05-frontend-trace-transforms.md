> Status: Still relevant for frontend trace performance. Data-system assumptions that mention legacy stores are superseded by the V2-only cutover.

# Chat Web Performance 05: Frontend Trace Transforms optimieren

## Zweck

Dieses Dokument bewertet weitere Client-Optimierungen im Chat Web Trace. Ziel ist weniger Render- und Transform-Arbeit während Streaming, Sessionwechseln und langen Trace-Verläufen.

## Ausgangslage

Der Client in `src/apps/chat-ui/src/App.tsx` hat bereits einige Performance-Fixes:

- Stream Events werden pro Session gesammelt.
- Text- und Reasoning-Deltas werden per `requestAnimationFrame` gebatcht.
- Nicht-Text-Events flushen sofort.
- Raw Events werden nur kompaktiert, wenn `showRawEvents` aktiv ist.

Trotzdem bleibt ein heißer Pfad:

1. `currentTraceView` wird aus Server-Trace plus Live Overlay gebaut.
2. `patchTraceViewWithEvents()` wendet Overlay Events an.
3. `patchTraceViewWithEvent()` cloned aktuell den flachen kompletten Node-Baum.
4. `adaptTrace()` baut daraus Span-Objekte.
5. `TraceTimeline` verarbeitet, filtert, flacht und rendert die Spans.

`adapt.ts` nutzt zwar einen `WeakMap`-Cache pro `PiboTraceNode`, aber der Cache hilft wenig, wenn vorher alle Node-Objekte neu erzeugt werden.

## Was sinnvoll ist

### Trace-Version statt Objektidentität nutzen

Memoization sollte soweit möglich an stabilen Versionen hängen:

- Server-Trace `version`;
- Live Overlay Sequence;
- selected session id;
- show/hide thinking state.

Objektidentität allein ist zu fragil, weil Patches neue Objekte erzeugen.

### Live Patches auf betroffene Nodes begrenzen

Text-Deltas sollten nur den Assistant- oder Reasoning-Node ändern. Tool Updates sollten nur den passenden Tool Node ändern. Struktur-Events dürfen neue Nodes einfügen, sollten aber unveränderte Nodes referenziell stabil halten.

### Normalisierten Trace-State prüfen

Ein stabiler Client-State könnte so aussehen:

- `nodesById: Map<string, PiboTraceNode>`
- `rootIds: string[]`
- `childrenById: Map<string, string[]>`
- `rawEvents` separat
- `version` und `liveSequence`

Das ermöglicht Map-Lookups statt rekursiver Suche und gezielte Updates.

### Debug Collection härter gaten

`collectVisibleRows(...)` und `collectBackendNodes(...)` sollten nur laufen, wenn Debugging explizit aktiv ist. Sie gehören nicht in den normalen Produktions-Hotpath.

## Was riskant ist

### Normalisierter Trace Store

Das ist ein größerer Client-Umbau. Risiken:

- Node-Reihenfolge ändert sich;
- Expansion State geht verloren;
- Fork-Entry-IDs werden falsch annotiert;
- Subagent- und yielded-run-Nodes werden falsch verschachtelt;
- Live Overlay und Server-Rebase divergieren.

### Direct Rendering von `PiboTraceNode`

Den Span-Adapter aus dem Live-Pfad zu entfernen ist sinnvoll, aber riskant. `TraceTimeline` und `SpanNode` enthalten UI-Logik, die heute auf Span-Feldern basiert. Ein direkter Renderer muss alle Typen gleich darstellen:

- user.message;
- assistant.message;
- model.reasoning;
- tool.call;
- tool.result;
- agent.delegation;
- agent.async;
- yielded.run;
- execution.command;
- execution.compaction;
- error.

### Batching nicht zu aggressiv machen

Text- und Reasoning-Deltas dürfen gebatcht werden. Struktur-, Terminal- und Error-Events sollten sofort oder fast sofort sichtbar bleiben.

## Was den Code fundamental ändert

Fundamental wird der Umbau, wenn der Client nicht mehr `PiboSessionTraceView` als Baum direkt rendert, sondern einen normalisierten Store führt. Betroffen sind:

- `src/apps/chat-ui/src/App.tsx`;
- `src/apps/chat-ui/src/traceLiveReducer.ts`;
- `src/shared/trace-engine.ts` Patch-Funktionen;
- `src/apps/chat-ui/src/tracing/adapt.ts`;
- `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`;
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`;
- Tests für Trace UI und Live Reducer.

## Problematische Annahmen

„Batch non-text live events“ ist zu pauschal. Nicht-Text-Events sind oft genau die Events, die UI-Status, Tool-Status oder Fehler finalisieren.

„WeakMap im Adapter löst das Problem“ ist ebenfalls zu optimistisch. Der Cache wirkt nur, wenn `PiboTraceNode`-Referenzen stabil bleiben.

## Übersehene Punkte

### Expansion State

Expansion State muss an stabile Node IDs gebunden sein und darf nicht durch Server-Rebase oder Live-Patch verloren gehen.

### Auto-Scroll

Virtuoso und Sticky-Scroll dürfen nur scrollen, wenn der User am unteren Rand ist. Sonst zieht Streaming den User aus alten Trace-Inhalten heraus.

### Server-Rebase

Wenn ein neuer Server-Trace kommt, muss das Live Overlay getrimmt und sauber rebased werden. Dabei dürfen bereits finalisierte Deltas nicht doppelt erscheinen.

### Raw Events

Raw Events sind Debug-Daten. Sie sollten getrennt vom Struktur-State bleiben und keine Transform-Arbeit auslösen, wenn das Panel versteckt ist.

## Empfohlene Reihenfolge

1. Debug Collection hinter ein hartes Flag legen.
2. Tests für referenzstabile Live-Patches schreiben.
3. `patchTraceViewWithEvent()` so ändern, dass unveränderte Nodes stabil bleiben.
4. Adapter-Memoization an stabilere Versionen koppeln.
5. Normalisierten Trace-State als internen Reducer einführen.
6. Danach optional `PiboTraceNode` direkt rendern.
7. Virtualisierung nur prüfen, wenn danach noch lange Traces zu teuer sind.

## Akzeptanzkriterien

- Text-Delta ersetzt nicht den kompletten Trace-Baum.
- Unveränderte Nodes behalten ihre Objektidentität.
- Bei Streaming rendert nur der betroffene Node plus minimale Header-/Status-UI.
- Sessionwechsel mischt keine Events zwischen Sessions.
- Raw Panel verursacht keine Arbeit, wenn es versteckt ist.
- Visual Output bleibt für alle Trace Node Types gleich.

## Mindesttests

- Assistant Delta ändert nur den Assistant Node.
- Reasoning Delta ändert nur den Reasoning Node.
- Tool Update ändert nur den Tool Node.
- Server-Rebase entfernt schon persistierte Overlay Events.
- Expansion State bleibt nach Live Delta erhalten.
- Sessionwechsel während Streaming verschmutzt die neue Session nicht.
- Trace-Reihenfolge entspricht weiter dem Server-Full-Rebuild.

## Empfehlung

Der nächste echte Client-Schritt ist Referenzstabilität. Batching ist bereits teilweise erledigt. Ein normalisierter Trace Store ist sinnvoll, sollte aber mit Tests und ohne visuelles Redesign eingeführt werden.
