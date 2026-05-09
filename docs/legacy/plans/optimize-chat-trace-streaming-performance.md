# Umbauplan: Chat Trace Streaming Performance

## Ziel

Die Chat Web App soll bei laufendem Streaming, Sessionwechseln und langen Trace-Verlaeufen fluessig bleiben. Streaming-Updates sollen nur die tatsaechlich betroffenen Trace-Inhalte aktualisieren, statt pro Token die komplette App, den kompletten Trace-Baum und die ganze Timeline neu aufzubauen.

Der Plan betrifft primar:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/*`
- `src/apps/chat/stream.ts`
- bei Bedarf die Chat Web API in `src/apps/chat/web-app.ts`

## Ausgangsbefund

Der erste Schritt ist erledigt: Die Chat Web API sendet nicht mehr bei jedem Live-Update ein komplettes `PiboOutputEvent` an die UI, sondern kompakte AG-UI-inspirierte SSE Frames aus `src/apps/chat/stream.ts`.

Der verbleibende Performance-Engpass liegt im Client. Aktuell laeuft jedes Streaming-Delta noch durch einen teuren Full-Rebuild-Pfad:

1. Der Server leitet `TEXT_MESSAGE_CONTENT` und `REASONING_MESSAGE_CONTENT` als kompakte SSE Frames weiter.
2. Die React App ruft fuer jedes Frame `setTraceView(...)` auf.
3. `applyChatStreamEvent(...)` cloned den kompletten `PiboTraceNode` Baum.
4. `adaptTrace(...)` baut daraus einen komplett neuen `Span` Baum.
5. `TraceTimeline` filtert, sortiert, flacht und zaehlt den kompletten Baum erneut.
6. Weil alle Span-Objekte neue Referenzen haben, kann React unveraenderte Nodes kaum ueberspringen.

Die reine JS-Projektion ist bei synthetischen Browser-Messungen noch moderat, aber sie skaliert linear mit Trace-Groesse. Der sichtbare Schmerz entsteht sehr wahrscheinlich durch die Kombination aus Full-Tree-Reconciliation, Layout, Paint, Auto-Scroll und haeufigen Token-Updates.

## Annahmen

- Die Chat Web Trace View bleibt eine Read-Time-Projektion und wird nicht dauerhaft als materialisierter Trace gespeichert.
- Pibo Sessions und Pi JSONL bleiben die Source of Truth fuer Session- und Transcript-Daten.
- Die kompakte SSE-Schicht bleibt Transportadapter; sie ersetzt weder Router-Events noch das Chat Web Read Model.
- Live-Streaming darf im UI leicht gebatcht werden, solange es weiterhin unmittelbar wirkt.
- Die bestehende flache Trace-Reihenfolge muss erhalten bleiben.
- Thinking bleibt hideable und optional default-expanded/default-collapsed.
- Subagent-Nesting wird spaeter separat ausgebaut; dieser Plan optimiert zuerst den aktuellen flachen Timeline-Pfad.

## Erfolgskriterien

- Beim Streaming wird pro Frame nicht mehr der komplette Trace-Baum cloned.
- Unveraenderte Trace Nodes behalten stabile Objektidentitaeten ueber Streaming-Updates hinweg.
- `SpanNode` oder ein neuer Trace Node Renderer rendert fuer unveraenderte Nodes nicht erneut.
- Streaming-Updates werden auf maximal ein React-State-Commit pro Animation Frame oder auf ein kleines Zeitfenster gebatcht.
- Sessionwechsel feuern nicht doppelt `loadTrace(...)` und `loadBootstrap(...)`.
- Raw Event Kompaktierung laeuft nur, wenn das Raw Event Panel sichtbar ist.
- Auto-Scroll erzwingt Layout nur, wenn der User am unteren Rand ist.
- `npm run typecheck` und relevante Chat/Trace Tests bleiben gruen.
- Browser QA zeigt fluessiges Wechseln zwischen Sessions, auch waehrend eine Session streamt.

## Phase 1: Messbarkeit Herstellen

1. Lightweight Render-Metriken nur im Development-Modus einbauen.
   - Zaehler fuer `App`, `TraceTimeline`, `SpanNode`, `SpanContent`.
   - Optional `performance.mark(...)` fuer `applyChatStreamEvent`, Adaptierung, Timeline-Projektion und Commit-nahe Effekte.
   - Verify: In der Browser-Konsole ist sichtbar, wie viele Nodes pro Streaming-Delta rendern.

2. Browser-Use QA Ablauf dokumentieren.
   - Browser-Use Environment einmal in einer persistenten Shell initialisieren und diese Shell fuer alle Browser-Use Befehle wiederverwenden.
   - Authentifizierte Session `pibo-auth` nutzen.
   - Testfall: lange Session oeffnen, neue Nachricht senden, waehrend Streaming in andere Session wechseln und zurueck.
   - Verify: reproduzierbare Messpunkte vor und nach jedem Umbau.

3. Baseline notieren.
   - Durchschnittliche Renderanzahl pro Text-Delta.
   - Dauer von Sessionwechsel bis erster sichtbarer Trace.
   - Spuerbare Janks beim Auto-Scroll.
   - Verify: Baseline in PR-/Commit-Notizen erfassen.

## Phase 2: Streaming-Updates Batching

1. EventSource Handler von direktem `setTraceView(...)` entkoppeln.
   - Eingehende `ChatStreamEvent`s in einem Ref-Queue sammeln.
   - Flush per `requestAnimationFrame` oder alle 30-50 ms.
   - Bei `RUN_FINISHED`, `RUN_ERROR`, Tool Result und Sessionwechsel sofort flushen.
   - Verify: Token-Stream wirkt live, aber React bekommt deutlich weniger Commits.

2. Pending Events session-sicher halten.
   - Queue pro `piboSessionId`, nicht global.
   - Beim Sessionwechsel keine Events der alten Session auf die neue View anwenden.
   - Verify: Streaming einer alten Session verschmutzt die neu ausgewaehlte Session nicht.

3. SSE Frame Frequenz optional serverseitig reduzieren.
   - Wenn Client-Batching nicht reicht: Text-/Thinking-Deltas serverseitig fuer wenige Millisekunden zusammenfassen.
   - Nicht fuer Tool-Start/Tool-End/Errors batchen.
   - Verify: UI bleibt reaktiv, keine verlorenen finalen Texte.

## Phase 3: Normalisierten Trace-State Einfuehren

1. Client-seitiges Trace Store Shape einfuehren.
   - `nodesById: Map<string, PiboTraceNode>`
   - `rootIds: string[]`
   - `childrenById: Map<string, string[]>`
   - `rawEvents` getrennt halten.
   - Verify: bestehende Trace View kann verlustfrei in den Store geladen werden.

2. Streaming-Patches auf einzelne Nodes anwenden.
   - Text Delta aktualisiert nur den Assistant- oder Reasoning-Node.
   - Tool Args/Result aktualisiert nur den betroffenen Tool-Node.
   - Agent Delegation aktualisiert nur den Delegation-Node.
   - Unveraenderte Node-Objekte muessen referenziell stabil bleiben.
   - Verify: Unit Test prueft, dass eine Text-Delta-Aktualisierung nicht alle Node-Referenzen ersetzt.

3. Indexierte Lookups statt rekursiver Suche.
   - `findTraceNode(...)` durch Map Lookup ersetzen.
   - Parent/Child-Insert ueber `childrenById`.
   - Verify: gleiche Event-Folge erzeugt gleiche sichtbare Node-Reihenfolge wie vorher.

## Phase 4: Rendering Direkt Auf PiboTraceNode Umstellen

1. Den `Span` Adapter aus dem Live-Render-Pfad entfernen.
   - Bestehende `adaptTrace(...)` API nur noch fuer Tests oder Legacy-Pfade behalten, falls noetig.
   - Trace UI rendert `PiboTraceNode` direkt.
   - Verify: Visual Output bleibt gleich fuer User, Reasoning, Tool Call, Agent Delegation, Yielded Run und Model Response.

2. Timeline-Projektion inkrementell oder memoisiert machen.
   - Root-Reihenfolge und flache Display-Reihenfolge aus Store ableiten.
   - Sortierung nur bei Struktur-Events, nicht bei Text-Deltas.
   - Stats inkrementell pflegen oder nur bei Struktur-/Statuswechseln neu berechnen.
   - Verify: Text-Deltas loesen keine Full-Sort/Full-Flatten-Operation aus.

3. Node-Komponenten nach Typ splitten.
   - `TraceNodeCard`
   - `UserMessageNode`
   - `AssistantMessageNode`
   - `ReasoningNode`
   - `ToolCallNode`
   - `AgentDelegationNode`
   - `YieldedRunNode`
   - Verify: kleinere Props, keine unnoetigen Berechnungen in gemeinsamen Komponenten.

## Phase 5: React Render-Grenzen Setzen

1. `TraceNodeCard` mit `React.memo` absichern.
   - Props muessen stabil sein: `node`, `childrenIds`, `startTime`, UI Flags.
   - Event Handler via `useCallback`.
   - Verify: Unveraenderte Cards rendern bei Text-Deltas nicht erneut.

2. Streaming-Text als kleinste dynamische Einheit isolieren.
   - Assistant-/Reasoning-Text in eigene memo-freundliche Komponente.
   - Nur diese Komponente bekommt waehrend Text-Streaming neue Props.
   - Verify: Bei Assistant-Streaming rendert nur Assistant-Text plus minimale Header-Status-Komponente.

3. Local UI State von Daten-State trennen.
   - Expand/Collapse State in separatem Store/Map keyed by node id.
   - Expansion-Controls duerfen nicht alle Datenobjekte neu erzeugen.
   - Verify: Expand/Collapse aendert nur sichtbare UI-Zweige.

## Phase 6: Sessionwechsel Entlasten

1. Doppelte Loads entfernen.
   - `selectSession(...)` sollte nicht gleichzeitig `setSelectedPiboSessionId(...)` setzen und danach denselben Effekt erneut triggern.
   - Entweder: Auswahl setzt State und der Effect laedt, oder `selectSession` laedt explizit und der Effect subscribt nur.
   - Verify: Ein Klick auf eine Session erzeugt genau einen Bootstrap-Load und einen Trace-Load.

2. Trace Loading State sauber machen.
   - Beim Wechsel alten Trace nicht weiter als neuen anzeigen.
   - Optional Skeleton/Loading-Zustand im Center.
   - Verify: keine Spruenge durch alte Daten + spaeteres Ersetzen.

3. EventSource Lifecycle stabilisieren.
   - Alte EventSource sofort schliessen.
   - Pending Queue fuer alte Session behalten, aber nicht auf neue View anwenden.
   - Verify: Wechsel waehrend Streaming fuehrt nicht zu Event-Mix.

## Phase 7: Raw Events Und Auto-Scroll Optimieren

1. Raw Event Kompaktierung nur bei sichtbarem Panel.
   - `compactRawEvents(...)` nur ausfuehren, wenn `showRawEvents === true`.
   - Raw Events optional in separater Komponente memoisiert halten.
   - Verify: Hidden Raw Panel verursacht keine Arbeit pro Delta.

2. Auto-Scroll nur bei Bottom-Lock.
   - Vor Update merken, ob User nahe am unteren Rand ist.
   - Nur dann nach Commit per `requestAnimationFrame` scrollen.
   - Kein Scroll-Zwang, wenn User hochgescrollt hat.
   - Verify: User kann waehrend Streaming alte Nodes lesen, ohne nach unten gezogen zu werden.

3. Streaming Indicator entkoppeln.
   - Indicator darf nicht durch jede Textaenderung neu aufgebaut werden.
   - Verify: keine Layout-Spruenge durch Indicator.

## Phase 8: Optional Virtualisierung

1. Erst nach Phase 2-7 entscheiden.
   - Wenn lange Sessions mit hunderten oder tausenden Nodes weiterhin teuer sind, Virtualisierung fuer Top-Level-Nodes einfuehren.
   - Wegen variabler Hoehen vorsichtig: `@tanstack/react-virtual` oder eigene einfache Windowing-Loesung.
   - Verify: Expand/Collapse, Auto-Scroll und Deep Nodes bleiben korrekt.

2. Nicht zu frueh virtualisieren.
   - Virtualisierung kaschiert Full-Rebuilds, behebt sie aber nicht.
   - Zuerst stabile Node-Identitaeten und Batching umsetzen.

## Phase 9: Tests Und QA

1. Unit Tests fuer Store/Patches.
   - Delta aktualisiert nur Zielnode.
   - Struktur-Events fuegen Nodes korrekt ein.
   - Tool Result und Agent Delegation behalten Reihenfolge.
   - Sessionwechsel isoliert Pending Events.

2. Integration Tests fuer Trace-Kompatibilitaet.
   - Bestehende Chat Trace Tests bleiben erhalten.
   - Neue Store-Ausgabe muss gleiche sichtbare Reihenfolge erzeugen.

3. Browser QA.
   - Persistente Browser-Use Shell mit einmalig initialisiertem Environment.
   - Authentifizierte `pibo-auth` Session.
   - Lange Session mit vielen Tool Calls.
   - Live Assistant Streaming.
   - Live Reasoning Streaming.
   - Wechsel zwischen Main Session und Subagent Session waehrend Streaming.
   - Raw Panel on/off.
   - Thinking show/hide und expand/collapse.

4. Performance Regression Guard.
   - Optional kleiner synthetischer Benchmark fuer Patch/Projection.
   - Ziel: Text-Delta darf nicht O(total nodes) rendern.
   - Verify: Benchmark ist stabil genug fuer lokale Entwicklung, nicht zwingend CI-blockierend.

## Empfohlene Umsetzungsreihenfolge

1. Phase 2: Batching.
2. Phase 6: doppelte Loads beim Sessionwechsel entfernen.
3. Phase 7: Raw Events und Auto-Scroll entlasten.
4. Phase 3: normalisierter Trace-State.
5. Phase 4 und 5: direkter Node Renderer und React Memo-Grenzen.
6. Phase 8 nur bei Bedarf.

Diese Reihenfolge liefert frueh sichtbare Verbesserungen, ohne sofort die gesamte Trace UI umzubauen.

## Nicht-Ziele

- Kein neues Persistenzmodell fuer materialisierte Trace Nodes.
- Kein Umbau von Pibo Session Store oder Pi JSONL.
- Kein Subagent-Inline-Nesting in diesem Performance-Umbau.
- Kein visuelles Redesign der Trace Cards.
- Keine vollstaendige Virtualisierung als erster Schritt.

## Risiken

- **Referenzstabilitaet wird durch Adapter gebrochen**: Deshalb langfristig direkt `PiboTraceNode` rendern.
- **Batching fuehlt sich weniger live an**: Frame-basiertes Batching zuerst testen; 30-50 ms nur falls noetig.
- **Expansion State geht beim Store-Umbau verloren**: UI State keyed by stable node id halten.
- **Sessionwechsel und Streaming racen**: Event Queues strikt pro Pibo Session ID fuehren.
- **Virtualisierung kollidiert mit variablen Hoehen**: Erst nach den strukturellen Optimierungen entscheiden.

## Abschlusscheck

- `npm run typecheck`
- `node --test test/chat-trace.test.mjs`
- `npm test`
- `npm run gateway:web`
- Browser QA mit persistenter Browser-Use Shell und `browser-use --session pibo-auth`
- Manuelle Pruefung: lange Session, laufendes Streaming, Sessionwechsel, Raw Panel, Thinking Toggle
