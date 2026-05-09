# Implementierungsplan: Web Chat Trace UI

## Ziel

Die bestehende minimale Chat Web App wird zu einer TanStack-Start/React/Tailwind Web App ausgebaut, die Pibo Sessions, Subagent Sessions, Toolcalls, Thinking, Execution Commands, Errors, Fork/Clone und nested Trace-Ansichten sichtbar und bedienbar macht.

Der Plan setzt `spec/spec-design-web-chat-trace-ui.md` und `DESIGN.md` um.

## Annahmen

- Pibo bleibt Product Boundary für Auth, Session Routing, Gateway Actions, Profile und Agent Execution.
- TanStack Start wird als eigene Chat-Web-App-Projektstruktur umgesetzt und konsumiert Pibo APIs.
- `.pibo/web-chat.sqlite` speichert Session-Index und raw Pibo Events.
- Pi JSONL bleibt Source of Truth für Agent Transcript, Thinking, Toolcalls, Tool Results und Session Tree.
- Materialisierte Trace Nodes werden in V1 nicht dauerhaft gespeichert.
- Neue UI außerhalb der portierten Trace-Komponenten folgt `DESIGN.md`.

## Erfolgskriterien

- `npm run gateway:web` lädt die neue Web Chat App.
- Authentifizierte User sehen die `Sessions`, `Agents` und `Settings` App-Bereiche.
- Main Sessions und nested Subagent Sessions erscheinen in der Sidebar.
- Die ausgewählte Session rendert User Messages, Assistant Messages, Thinking, Toolcalls, Tool Results, Execution Commands und Errors.
- Subagent Delegations sind inline aufklappbar und verlinken zur Subagent Session.
- Alle Trace Nodes sind initial eingeklappt; Expand All, Collapse All und Expand To Depth funktionieren.
- `/status`, `/clear`, `/abort`, `/thinking`, `/thinking-show`, `/session-current`, `/sessions`, `/fork-candidates` und `/clone` funktionieren im Command Menu.
- `/clone` wechselt nach Erfolg zur geklonten Session.
- Fork über User Message zeigt ein Wechsel-Modal; nur bei Bestätigung wird die geforkte Session geladen.
- Thinking ist default hidden; `/thinking-show` macht auch historische Thinking-Blöcke sichtbar.
- Tests decken Read Model, Event-Rekonstruktion, Session Tree, Commands, Fork/Clone und Kern-UI-Flows ab.

## Phase 1: Web-App-Struktur Und Build-Integration

1. TanStack Start als eigene Chat-App-Struktur anlegen.
   - Vorschlag: `src/apps/chat-ui/` für TanStack-Start-App-Code.
   - Bestehende Plugin/Web-App-Registration bleibt in Pibo.
   - Verify: TypeScript kann neue App-Struktur erfassen oder separat bauen.

2. Build- und Dev-Scripts ergänzen.
   - Ziel: Chat UI kann lokal gebaut und vom Pibo Web Host ausgeliefert werden.
   - Bestehende `npm run gateway:web` UX bleibt erhalten.
   - Verify: `npm run typecheck` und neuer Chat-UI-Build laufen.

3. Web Host Adapter definieren.
   - Pibo Web Host serviert die TanStack Start App, ohne Pibo Auth/Session-Routing an TanStack abzugeben.
   - Pibo API bleibt unter `/api/chat/*`.
   - Verify: `/apps/chat` liefert die neue App; `/api/chat/session` bleibt Pibo-owned.

## Phase 2: Web Chat SQLite Read Model

1. Neue SQLite-Komponente für `.pibo/web-chat.sqlite` einführen.
   - Session index.
   - Raw Pibo event log.
   - Keine durable materialized trace nodes.
   - Verify: Unit Tests für Migration, Insert, Query, Close.

2. Event-Indexing an Pibo Output Events anbinden.
   - Events pro `piboSessionId`, Event-Typ, Timestamp und Payload speichern.
   - Raw Events behalten, solange die zugehörige Pi Session existiert.
   - Verify: Integration Test emittiert Events und liest sie aus `.pibo/web-chat.sqlite`.

3. Session-Index aktualisieren.
   - Aus Pibo Sessions, `parentId` und Pi Session Metadaten.
   - Titel-Fallback: `session_info.name`, sonst erste User Message gekürzt, sonst Pibo Session ID.
   - Pibo Session ID bleibt als Secondary Text oder Tooltip sichtbar.
   - Verify: Test mit Main Session und nested Subagent Session.

## Phase 3: API Surface Für Die Web App

1. Session APIs erweitern.
   - Liste der Session Nodes.
   - Aktuell ausgewählte Session laden.
   - Transcript/Trace View Model für eine Session laden.
   - Verify: API Tests für Main Session, Subagent Session, leere Session.

2. Message und Action APIs session-fähig machen.
   - Composer sendet immer an die aktuell ausgewählte Session.
   - Main Session bleibt Ziel, auch wenn inline Subagent Nodes aufgeklappt sind.
   - Direkt ausgewählte Subagent Session wird eigenes Composer-Ziel.
   - Verify: Test für Main vs. Subagent Composer Target.

3. Fork/Clone API-Verhalten absichern.
   - `/clone` ruft `session.clone` auf und gibt die Zielsession zurück.
   - Fork von User Message ruft `session.fork` mit Entry ID auf und gibt die Zielsession zurück.
   - Verify: Integration Tests für Clone und Fork Result.

## Phase 4: Trace-Rekonstruktion

1. Aggregator für Pi JSONL + raw Pibo Events bauen.
   - Input: Pi Session Entries, Pibo Session Tree, raw Pibo Events.
   - Output: `PiboTraceNode[]`.
   - Keine Persistenz der Trace Nodes.
   - Verify: Unit Tests für User/Assistant/Thinking/Tool/Execution/Error.

2. Tool Lifecycle rekonstruieren.
   - `tool_call`, `tool_execution_started`, `tool_execution_updated`, `tool_execution_finished`.
   - Running, done, error Status.
   - Partial Results, Args, Results.
   - Verify: Test mit normalem Tool, fehlerhaftem Tool, partial updates.

3. Subagent Delegation rekonstruieren.
   - `pibo_subagent_*` Toolcalls als `agent.delegation`.
   - Child Session über `parentId` und Pibo Session ID verlinken.
   - Inline Child Trace bei Expansion nachladen oder lazy rekonstruieren.
   - Verify: Test für nested Subagent Sessions mit mehreren Tiefen.

4. Thinking-Rekonstruktion.
   - Thinking aus Pi Assistant Message Content plus raw Events für Live-Zustände.
   - Display hidden by default, aber historisch sichtbar bei `/thinking-show`.
   - Verify: Test schaltet Thinking Display nachträglich ein.

## Phase 5: Trace UI Port

1. Relevante Tracing-Komponenten kopieren und Pibo-spezifisch adaptieren.
   - `SpanNode` -> Pibo Trace Node Renderer.
   - `JsonRenderer`.
   - Timeline/Trace Flow Layout.
   - Noise-filtering/hoisting Pattern aus `traceTree.ts`.
   - Verify: Komponenten rendern Fixture-Traces.

2. Styling aus `DESIGN.md` anwenden.
   - Farben, Typography, Density, Borders, Dark-first Shell.
   - Keine abweichende Marketing-/Dashboard-Optik.
   - Verify: Desktop/Mobile Screenshots gegen Designanforderungen prüfen.

3. Expand/Collapse Controls.
   - Default: alles collapsed.
   - Collapse All.
   - Expand All.
   - Expand To Depth.
   - Browser-lokaler Zustand.
   - Verify: Component Tests für Expand-State.

## Phase 6: App Shell Und Navigation

1. Drei-Bereich-Layout bauen.
   - Top Bar.
   - Left Sidebar.
   - Center Chat + Trace View.
   - Optional Right Inspector/Raw Events Panel.
   - Verify: Responsive Layout Screenshots.

2. App Areas einführen.
   - `Sessions`: vollständig funktional.
   - `Agents`: Profil-Inventar aus Plugin Registry anzeigen, keine Persistenz.
   - `Settings`: Mock/Placeholder nach `DESIGN.md`.
   - Verify: Navigation zwischen Bereichen ohne Runtime-Bruch.

3. Session Sidebar.
   - Main Sessions top-level.
   - Subagent Sessions nested.
   - Beliebige Tiefe unterstützen.
   - Status, Profil, Last Activity, Titel, Pibo Session ID.
   - Verify: Test mit tief verschachteltem Session Tree.

## Phase 7: Composer Und Slash Commands

1. Composer mit Command Menu bauen.
   - Öffnet bei `/`.
   - Keyboard Navigation mit Pfeiltasten und Enter.
   - Command-Beschreibungen aus Pibo capabilities.
   - Verify: UI Test für Keyboard Flow.

2. V1 Commands implementieren.
   - `/status`
   - `/clear`
   - `/abort`
   - `/thinking`
   - `/thinking <level>`
   - `/thinking-show`
   - `/session-current`
   - `/sessions`
   - `/fork-candidates`
   - `/clone`
   - Verify: API/Component Tests für Dispatch und Rendering.

3. Inline Execution Rendering.
   - Execution Commands erscheinen im Transcript.
   - Results als strukturierte Cards.
   - Errors inline als Error Cards.
   - Verify: Fixture und live Event Tests.

## Phase 8: Fork, Clone Und Session-Wechsel

1. `/clone` Flow.
   - Nur Slash Command.
   - Nach Erfolg automatisch zur geklonten Session wechseln.
   - Transcript und Trace View neu laden.
   - Verify: Integration/E2E Test.

2. Fork Button an User Message Nodes.
   - Kleiner Button im User Message Header.
   - Nach erfolgreichem Fork kleines Modal: Wechseln? Ja/Nein.
   - Ja: geforkte Session auswählen und neu laden.
   - Nein: aktuelle Ansicht unverändert lassen.
   - Verify: E2E Test für beide Modal-Antworten.

## Phase 9: Live Streaming Und Reload-Verhalten

1. SSE/Event Handling an neue View Models anbinden.
   - Live Events in raw event log schreiben.
   - UI inkrementell aktualisieren.
   - Auto-scroll nur wenn passend.
   - Verify: Streaming Test mit Assistant Delta und Tool Lifecycle.

2. Reload aus Persistenz.
   - Pi JSONL + raw Pibo Events + Session Index rekonstruieren.
   - Thinking Display Toggle wirkt auch auf Historie.
   - Verify: Server-Neustart simulieren und Session erneut laden.

## Phase 10: Tests, QA Und Polishing

1. Unit Tests.
   - Read Model.
   - Trace Aggregator.
   - Session Tree Builder.
   - Slash Command Mapping.
   - Title fallback/truncation.

2. Integration Tests.
   - Chat APIs.
   - Event persistence.
   - Clone/Fork.
   - Subagent navigation.

3. E2E/Visual Checks.
   - `gateway:web` smoke test.
   - Desktop and mobile screenshots.
   - Deep nesting.
   - Long JSON payloads.
   - Command menu.
   - Fork modal.
   - Design consistency with `DESIGN.md`.

4. Final verification.
   - `npm run typecheck`
   - `npm test`
   - Chat UI build command
   - Manual `npm run gateway:web`

## Nicht-Ziele Für V1

- Keine Team-/Multi-User-Sessions.
- Kein vollständiger Agentprofil-Builder.
- Keine Agent Template Persistenz.
- Kein Cron-/Job-Management.
- Keine vollständige Session Tree Editor UI.
- Keine persistierten materialisierten Trace Nodes.
- Kein pydantic-tracing als Runtime Dependency.

## Risiken Und Gegenmaßnahmen

- **TanStack Start übernimmt zu viel Server-Verantwortung**: Pibo APIs bleiben authoritative; Start konsumiert sie nur.
- **Trace-Rekonstruktion wird komplex**: Aggregator strikt testen und zunächst nur bekannte Pibo/Pi-Events mappen.
- **JSONL + raw Events divergieren zeitlich**: Events mit Timestamp/Event ID speichern und Aggregator tolerant machen.
- **Deep nesting wird visuell unbrauchbar**: Default collapsed, expand-to-depth, horizontal overflow im Center.
- **SQLite Writer-Kollisionen**: Separate `.pibo/web-chat.sqlite` und kleine, transaktionale Writes.
- **Design Drift**: `DESIGN.md` als harte Referenz in Visual Checks verwenden.
