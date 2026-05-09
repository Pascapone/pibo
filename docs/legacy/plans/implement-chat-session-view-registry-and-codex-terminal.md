# Implementierungsplan: Chat Session View Registry und Codex Compact Terminal View

## Ziel

Die Chat Web App erhaelt eine austauschbare Session-View-Schicht. Die aktuelle Trace-Timeline bleibt unveraendert als Default-View erhalten. Zusaetzlich entsteht eine zweite View im kompakten Codex-Terminal-Stil, beschrieben in `docs/codex-compact-terminal-design.md`.

Beide Views konsumieren dieselbe Pibo Trace View Projektion (`PiboSessionTraceView`). Die Runtime, Pibo Sessions, Chat Event Log, SSE-Streaming, Subagent-Verlinkung und Gateway Actions bleiben unveraendert.

## Annahmen

- Die bestehende `TraceTimeline` bleibt funktional und visuell stabil.
- V1 wird innerhalb des bestehenden Chat-UI-Bundles umgesetzt. Es gibt kein dynamisches Laden fremder Plugin-UI.
- Die neue View arbeitet gegen `PiboTraceNode[]`, nicht gegen raw Pi/Codex Events.
- View-Auswahl ist eine UI-Praeferenz pro Browser und optional per URL deep-linkbar.
- Erweiterbarkeit wird als `Chat Session View`-Contribution modelliert. Das kann spaeter an Pibo Plugins angeschlossen werden, muss aber in V1 nicht Teil der allgemeinen Plugin Registry sein.
- Der Begriff **Plugin** bleibt fuer statisch geladene Pibo Product Boundary Module reserviert. UI-Views sind zunaechst eine Chat-Web-spezifische Erweiterungsstelle.

## Nicht-Ziele Fuer V1

- Kein Umbau der Pibo Session Router oder Pi Coding Agent Runtime.
- Kein neues persistentes Trace-Format.
- Keine dynamische Remote-React-Component- oder JavaScript-Injection durch Plugins.
- Keine Entfernung oder Refaktorierung der bestehenden `TraceTimeline`.
- Kein vollstaendiger Codex-TUI-Port. Der Codex-Stil wird nachgebaut, nicht aus Rust/ratatui extrahiert.

## Erfolgskriterien

- User koennen im Sessions-Bereich zwischen `Trace` und `Terminal` wechseln.
- `Trace` rendert exakt ueber die bestehende `TraceTimeline`.
- `Terminal` rendert dieselbe aktive Session kompakt im Codex-Stil.
- View-Auswahl ueberlebt Reload per URL oder localStorage.
- Live-SSE-Updates erscheinen in beiden Views ohne doppeltes Datenmodell.
- Tool Calls zeigen kompakte `Calling` / `Called` / Fehler-Zeilen.
- Adjacent Read/List/Search-artige Tool Calls koennen als `Exploring` / `Explored` gruppiert werden.
- Subagent Delegations zeigen kompakte Zeilen und behalten `onOpenSession` zur Child Session.
- Fork von User Messages bleibt in beiden Views verfuegbar.
- Raw Events Panel und bestehende Session Sidebar bleiben unveraendert.
- `npm run typecheck` und der Chat-UI-Build laufen.
- Browser-Use-Screenshots pruefen beide Views in Desktop- und schmaler Breite.

## Architekturentscheidung

### V1: Interne View Registry

Die Chat Web App bekommt eine kleine, typisierte Registry im Frontend. Diese Registry entkoppelt die App Shell von konkreten Renderern.

Geplante Dateien:

```text
src/apps/chat-ui/src/session-views/types.ts
src/apps/chat-ui/src/session-views/registry.tsx
src/apps/chat-ui/src/session-views/TraceSessionView.tsx
src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx
src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts
src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx
src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx
```

Kerninterface:

```ts
export type ChatSessionViewId = "trace" | "terminal";

export type ChatSessionViewProps = {
	traceView: PiboSessionTraceView | null;
	selectedTrace: Trace | null;
	isLoading: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	sessionAgentProfile?: string;
	sessionBreadcrumbs: readonly SessionBreadcrumbItem[];
	originSession?: SessionOriginLink;
	derivedSessions: readonly SessionDerivationLink[];
	agentProfiles: readonly AgentProfile[];
	sessionProfileChangeDisabled: boolean;
	onSessionAgentProfileChange(profile: string): void;
	onFork(entryId: string): void;
	onOpenSession(piboSessionId: string): void;
};

export type ChatSessionView = {
	id: ChatSessionViewId;
	label: string;
	description?: string;
	render(props: ChatSessionViewProps): ReactNode;
};
```

`TraceSessionView` ist nur ein Adapter um die bestehende `TraceTimeline`. `CompactTerminalSessionView` nutzt `traceView.nodes` direkt.

### V2: Deklarative View Contributions

Wenn die V1-Struktur sitzt, kann die Registry um deklarative Contributions erweitert werden:

```ts
export type ChatSessionViewContribution = {
	id: string;
	label: string;
	description?: string;
	source: "builtin" | "plugin";
	viewKind: "trace-view";
};
```

Eine spaetere Server-API koennte diese Contributions aus der Plugin Registry in Bootstrap-Daten aufnehmen. Fuer V2 sollten nur Views akzeptiert werden, die im Chat-UI-Bundle bereits bekannt sind. Das schuetzt Build, CSP, Auth-Kontext und Frontend-Sicherheit.

### V3: Plugin-Registrierung

Falls echte Plugin-UI gebraucht wird, dann als explizite Erweiterung der Pibo Plugin API:

```ts
registerChatSessionView(contribution: PiboChatSessionViewContribution): void;
```

Dabei sollte V3 weiterhin keine beliebigen Remote-Komponenten ausfuehren. Moegliche sichere Formen:

- Plugin registriert eine vorhandene Builtin-View mit anderer Konfiguration.
- Plugin registriert einen same-origin Web App Link als separate App, nicht inline.
- Plugin registriert deklarative Render-Regeln fuer bekannte `PiboTraceNode`-Typen.

## Datenmodell Fuer Die Terminal View

Die Terminal View fuehrt ein internes Row-Modell ein. Es ist ein reines UI-Modell und wird nicht persistiert.

```ts
export type CompactTerminalRowStatus = "running" | "done" | "error" | "neutral";

export type CompactTerminalRowKind =
	| "message.user"
	| "message.assistant"
	| "reasoning"
	| "tool.call"
	| "tool.group.exploring"
	| "agent.delegation"
	| "agent.async"
	| "yielded.run"
	| "execution.command"
	| "error";

export type TerminalInlineToken = {
	text: string;
	tone?: "default" | "dim" | "cyan" | "green" | "red" | "magenta";
	weight?: "normal" | "semibold" | "bold";
	italic?: boolean;
};

export type CompactTerminalLine = {
	prefix?: "bullet" | "detail" | "continuation" | "prompt" | "none";
	tokens: TerminalInlineToken[];
};

export type CompactTerminalRow = {
	id: string;
	kind: CompactTerminalRowKind;
	status: CompactTerminalRowStatus;
	lines: CompactTerminalLine[];
	sourceNodeIds: string[];
	linkedPiboSessionId?: string;
	forkEntryId?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	expandable?: boolean;
};
```

## Umsetzungsschritte

### Phase 1: View Registry Skeleton

1. `session-views/types.ts` anlegen.
   - Definiert `ChatSessionView`, `ChatSessionViewProps`, `ChatSessionViewId`.
   - Verify: TypeScript kompiliert ohne UI-Aenderung.

2. `TraceSessionView.tsx` als Wrapper um `TraceTimeline` anlegen.
   - Props 1:1 durchreichen.
   - Keine visuelle Aenderung.
   - Verify: Sessions-Bereich rendert wie vorher.

3. `registry.tsx` mit Builtin-Views anlegen.
   - Zunaechst nur `trace`.
   - Verify: `App.tsx` kann die Default-View aus Registry rendern.

### Phase 2: App Integration Und View-Auswahl

1. `App.tsx` auf Registry-Rendering umstellen.
   - Bestehendes `selectedTrace` bleibt fuer die Trace-View erhalten.
   - `currentTraceView` wird ebenfalls in Props gegeben.
   - Verify: Keine sichtbare Regression in der Default-View.

2. Route/Search-State fuer View-Auswahl einfuehren.
   - URL: `?view=terminal` oder `?view=trace`.
   - localStorage: `pibo.chat.sessionView`.
   - Ungueltige View IDs fallen auf `trace` zurueck.
   - Verify: Reload und Deep Link behalten View.

3. Kompakter Toggle in der Sessions-Header-Leiste.
   - `Trace` / `Terminal`.
   - Kein neuer Top-Level-App-Area.
   - Verify: Raw Events Toggle, Fork Buttons, Thinking Controls bleiben erreichbar.

### Phase 3: Terminal Row Adapter

1. `terminalRows.ts` implementieren.
   - Input: `PiboSessionTraceView | null`.
   - Output: `CompactTerminalRow[]`.
   - Sortierung folgt vorhandener Trace-Order.
   - Verify: Unit Tests mit Fixture-Nodes.

2. Basismapping implementieren.
   - `user.message` -> prompt row.
   - `assistant.message` -> assistant block.
   - `model.reasoning` -> reasoning row, respektiert `showThinking`.
   - `tool.call` / `tool.result` -> compact tool row.
   - `agent.delegation` / `agent.async` -> subagent rows.
   - `yielded.run` -> yielded-run summary.
   - `execution.command` -> command/status row.
   - `error` -> error row.
   - Verify: Snapshot-/unit-nahe Tests fuer jeden Node-Typ.

3. Output-Truncation.
   - Default: ca. 5 sichtbare Zeilen.
   - Lange Zeilen werden gekuerzt oder soft-wrapped.
   - Full payload bleibt im Detail-Drawer.
   - Verify: Test mit langem Tool Output.

### Phase 4: Exploring-Gruppierung

1. Read/List/Search-Erkennung einfuehren.
   - Aus Tool-Namen und Args konservativ ableiten.
   - Beispiele: `read`, `open`, `list`, `search`, `rg`, `find`.
   - Keine Gruppierung fuer mutierende Tools.
   - Verify: Tests fuer gruppierbare und nicht-gruppierbare Tool Calls.

2. Adjacent Tool Rows gruppieren.
   - Nur innerhalb eines zusammenhaengenden Agent Turns.
   - Nicht ueber Assistant Text, User Message, Error oder Delegation hinweg.
   - Status `running`, wenn mindestens ein Kind running ist.
   - Verify: Fixture mit gemischten Tool Calls.

3. Gruppierte Detailzeilen erzeugen.
   - `Read path`
   - `List path`
   - `Search query in path`
   - Verify: Rendering bleibt kurz und stabil.

### Phase 5: Compact Terminal Renderer

1. `CompactTerminalSessionView.tsx` anlegen.
   - Shell: monospaced, black terminal background, bottom-lock scroll.
   - Leerer Zustand und Loading-Zustand.
   - Verify: Render ohne Trace, mit Trace, mit Streaming.

2. `TerminalLine.tsx` anlegen.
   - Rendert Prefixe: bullet, detail `  └`, continuation `   `, prompt `›`.
   - Rendert Token-Tones aus Design-Dokument.
   - Verify: Kompakte Zeilen ohne Layout-Shift.

3. Row Actions.
   - Hover/Focus Actions fuer:
     - open child session
     - fork user message
     - expand details
     - copy row/output optional
   - Hit Areas mindestens 28px, visuell kompakt.
   - Verify: Keyboard und Mouse funktionieren.

4. Details Drawer.
   - Inline unter Row, terminal-styled.
   - Zeigt Input/Output/Error strukturiert.
   - Kann bestehenden `JsonRenderer` wiederverwenden, aber kompakter stylen.
   - Verify: Tool Input/Output voll inspizierbar.

### Phase 6: Styling

1. CSS/Tailwind-Klassen nach `docs/codex-compact-terminal-design.md`.
   - Keine Card-Optik im Haupttranscript.
   - Monospace komplett innerhalb Terminal View.
   - ANSI-Tones: dim/default/cyan/green/red/magenta.
   - Verify: Screenshot Review.

2. Responsive Verhalten.
   - Full-width transcript.
   - Raw Events Panel bleibt wie bisher.
   - Bei schmaler Breite keine Ueberlaeufe durch lange Tool Namen oder IDs.
   - Verify: Browser-Use Desktop und schmale Breite.

### Phase 7: Optional Bootstrap Fuer View Contributions

Diese Phase erst nach V1-Abnahme umsetzen.

1. Serverseitigen Typ fuer Chat View Contributions definieren.
   - Noch keine dynamischen Renderer.
   - Nur deklarative Liste bekannter View IDs.

2. `BootstrapData` um `chatSessionViews?: ChatSessionViewContribution[]` erweitern.
   - Fallback: Builtins lokal.
   - Verify: Alte Serverantworten brechen nicht.

3. Plugin Registry nur bei echter Notwendigkeit erweitern.
   - API-Namen bewusst spezifisch: `registerChatSessionView`.
   - Nicht mit `registerWebApp` vermischen.
   - Verify: Registry Tests fuer doppelte IDs und unbekannte Builtin Views.

## Tests Und Verifikation

### Unit / Component

- Terminal Row Adapter fuer alle `PiboTraceNode`-Typen.
- Gruppierung fuer Exploring/Explored.
- View-ID Parsing und Fallback.
- localStorage/URL-Praeferenz.
- Detail Drawer mit JSON und Text Output.

### Typecheck / Build

```bash
npm run typecheck
npm run chat-ui:build
```

Falls der Projekt-Scriptname abweicht, den vorhandenen Chat-UI-Build aus `package.json` verwenden.

### Browser-Use QA

Nach Frontend-Implementierung gemaess AGENTS:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
npm run dev -- tools guide browser-use
```

Bei authentifizierter Chat-Web-Pruefung bevorzugt:

```bash
eval "$(npm run --silent dev -- tools browser-use lease acquire --app pibo-chat --owner "$USER")"
```

Pruefen:

- Default `Trace` View laedt unveraendert.
- `Terminal` View laedt dieselbe Session.
- Toggle wechselt ohne Datenverlust.
- Reload mit `?view=terminal`.
- Streaming Tool Call wird live aktualisiert.
- Child Session Link aus Delegation oeffnet die Child Session.
- Schmale Breite ohne Textueberlappung.

## Risiken

- `App.tsx` ist bereits gross. Die Registry sollte neue Logik auslagern statt die Datei weiter aufzublaehen.
- Gruppierung kann semantisch falsch sein, wenn Tool-Namen uneindeutig sind. V1 muss konservativ gruppieren.
- URL Search Params duerfen bestehende Canonical Chat URLs nicht brechen.
- localStorage und Route-State koennen auseinanderlaufen. Route hat Vorrang, localStorage ist Fallback.
- Raw Event und live Trace Update Duplikate duerfen durch die zweite View nicht neu entstehen. Die View darf nur rendern, nicht eigene Event-Merges ausfuehren.

## Offene Entscheidungen Zur Abnahme

- Soll der URL-Parameter `view=terminal` oder `traceView=terminal` heissen?
- Soll `Terminal` neben `Trace` im Session Header stehen oder im globalen Header?
- Soll die Terminal View einen eigenen Bottom Composer im Codex-Stil bekommen, oder in V1 nur das Transcript ersetzen und den bestehenden Composer behalten?
- Soll die V2 Contribution-Schicht direkt geplant werden, oder erst nach erfolgreicher V1-Nutzung?

## Empfohlene V1-Schnittlinie

V1 sollte nur diese Aenderungen enthalten:

1. interne Chat Session View Registry
2. View Toggle mit URL/localStorage
3. `TraceSessionView` Wrapper
4. `CompactTerminalSessionView`
5. Terminal Row Adapter mit konservativer Gruppierung
6. Tests und Browser-Use-Screenshots

Alles Plugin-/Contribution-bezogene bleibt im Plan dokumentiert, aber wird erst nach Abnahme und echter Notwendigkeit implementiert.
