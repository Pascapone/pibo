# Report: Ink-basierte Pibo CLI Session UI

**Status:** Investigation / Draft  
**Created:** 2026-05-16  
**Source:** User request in Pibo session `ps_ac3087f2-c9dc-4d4e-92a3-2da43199bed7`  
**Primary goal:** Grundlage für spätere Specs zur nativen Shell-/SSH-CLI von Pibo

## Kurzfazit

Eine Ink-basierte CLI ist für Pibo sinnvoll und technisch gut machbar. Sie sollte nicht versuchen, die bestehende Web UI zu ersetzen. Die Web UI bleibt das vollständige Control Center. Die CLI sollte ein robustes, reduziertes Session-Interface für SSH, Server-Setups, Recovery-Fälle und schnelle lokale Nutzung sein.

Die größte Schnittmenge entsteht nicht durch Wiederverwendung der bestehenden DOM-Components, sondern durch Wiederverwendung der bestehenden Daten-, Trace- und View-Model-Schichten. Besonders `buildCompactTerminalRows()` ist ein guter Kern für beide Welten: Web und TUI können dieselben Terminal-Rows verwenden, aber unterschiedliche Renderer besitzen.

Empfehlung: Eine neue Ink-Präsentationsschicht bauen, die dieselben `PiboSessionTraceView`- und `CompactTerminalRow`-Daten nutzt. Die bestehende Web UI bleibt unverändert.

## Zielbild

Pibo bekommt eine native CLI Session UI, die direkt in einer Shell läuft:

```bash
pibo tui:sessions
# oder perspektivisch
pibo chat
```

Die CLI ermöglicht:

- Sessions anzeigen und wechseln
- neue Sessions starten
- Nachrichten an den Agenten senden
- laufende Antworten, Tool Calls und Ergebnisse live verfolgen
- Agent/Profile wechseln
- einfache Slash Commands ausführen
- minimale lokale Einstellungen anzeigen oder ändern
- ohne Web Gateway oder Browser nutzbar bleiben

Die CLI ist ein Subset der Web UI. Sie enthält ausdrücklich keine vollständige Admin-/Control-Center-Funktionalität.

## Nicht-Ziele

Die CLI soll in der ersten Ausbaustufe **nicht** enthalten:

- Projects
- Workflows
- Workflow/XState-Visualisierung
- Cron Jobs
- Ralph Jobs
- Agent Designer / Agent Editor
- vollständiges Settings UI
- vollständiges Context-/Knowledge-Management
- Web-spezifische Panels
- grafische Diagramme
- Browser-ähnliche Tabellen, Modals oder Drag-and-Drop

Diese Bereiche bleiben im Web Control Center.

## Bestehender Stand im Code

### Relevante bestehende CLI-Einstiege

- `src/bin/pibo.ts`
- `src/cli.ts`
- `src/local/tui.ts`
- `src/core/runtime.ts`
- `src/core/session-router.ts`

Aktuell gibt es bereits:

- `pibo tui` — startet die direkte Pi TUI über `runPiboTui()`
- `pibo tui:routed` — startet lokale routed Pibo TUI über `runLocalRoutedTui()`
- `pibo client` — einfacher Gateway Client
- Debug-/Datenkommandos für Trace- und Store-Inspection

Die neue Ink-CLI sollte diese vorhandene Runtime-/Router-Arbeit nicht ersetzen, sondern eine besser strukturierte Session-UI darauf aufbauen.

### Relevante Web-Session-Views

- `src/apps/chat-ui/src/session-views/registry.tsx`
- `src/apps/chat-ui/src/session-views/types.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx`
- `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`
- `src/apps/chat-ui/src/tracing/adapt.ts`

Die Web UI nutzt aktuell DOM-/Browser-Components, `react-virtuoso`, Tailwind-Klassen, `lucide-react`, `react-markdown` und `@uiw/react-json-view`. Diese Components sind nicht direkt in Ink nutzbar.

### Relevante gemeinsame Trace-Schicht

- `src/shared/trace-types.ts`
- `src/shared/trace-engine.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalValue.ts`

Diese Teile sind vielversprechend für Wiederverwendung.

## Ink-Eignung

Ink ist ein React-Renderer für Terminals. Es unterstützt:

- React Components, State, Effects und Hooks
- Flexbox-Layout über Yoga
- `Box`, `Text`, `Static`, `Transform`
- Farben, Border, Padding, Margin, Width/Height
- Keyboard Input über `useInput`
- Focus Management
- `renderToString()` für Tests und Snapshots
- interaktive und nicht-interaktive Ausgabe
- alternate screen mode

Ink rendert aber nicht ins DOM. Deshalb funktionieren HTML-Elemente wie `<div>`, `<button>`, `<span>`, `<pre>`, CSS-Klassen, SVG-Icons und Browser-Events nicht direkt.

## Wiederverwendung: möglich vs. nicht möglich

### Direkt oder fast direkt wiederverwendbar

Diese Teile können als Kern der CLI genutzt werden:

- `PiboSessionTraceView`
- `PiboTraceNode`
- `buildTraceViewFromEvents()`
- `buildTraceView()`
- `buildCompactTerminalRows()`
- `CompactTerminalRow`
- `CompactTerminalLine`
- `TerminalInlineToken`
- `terminalTextValue()` / `renderableTerminalValue()`
- `adaptTrace()` für spätere Trace-/Span-Ansichten
- `processSpanTree()` für spätere reduzierte Span-Tree-Ansichten

### Mit kleinen Anpassungen wiederverwendbar

- Token-/Tone-Mapping aus `TerminalLine.tsx`
- JSON/Text-Normalisierung aus `TerminalDetails.tsx`
- Teile der Preview-/Truncation-Logik aus `terminalRows.ts`
- Session-/Trace-Fetching- und Store-Zugriff, sofern in eine UI-unabhängige API gekapselt

### Nicht direkt wiederverwendbar

Diese Web Components müssen für Ink neu gebaut werden:

- `CompactTerminalSessionView`
- `TerminalLine`
- `TerminalDetails`
- `TerminalStatusCard`
- `TerminalThinkingCard`
- `TerminalLoginCard`
- `TerminalModelCard`
- `TraceTimeline`
- `SpanNode`
- `JsonRenderer`
- `MarkdownRenderer`

Grund: Sie hängen an DOM, CSS, Browser-Events, SVGs oder Web-only Libraries.

## Empfohlene Architektur

### Prinzip

Die Web UI und die CLI teilen sich Datenlogik und View Models. Sie teilen sich nicht die Presentation Components.

```text
Pibo stores / runtime / router / event stream
        ↓
PiboSessionTraceView
        ↓
buildCompactTerminalRows()
        ↓
 ┌────────────────────────────┬────────────────────────────┐
 │ Web renderer               │ Ink renderer                │
 │ React DOM + Tailwind       │ React Ink + Box/Text        │
 │ bestehende Web UI          │ neue Shell UI               │
 └────────────────────────────┴────────────────────────────┘
```

### Mögliche Modulstruktur

```text
src/session-ui/
  terminalRows.ts              # aus chat-ui extrahieren oder re-exportieren
  terminalValue.ts             # aus chat-ui extrahieren oder re-exportieren
  terminalTypes.ts             # UI-unabhängige Row-/Token-Typen

src/apps/chat-ui/...
  # nutzt weiterhin dieselben Rows, aber DOM Renderer bleibt unverändert

src/apps/cli-ui/
  InkSessionApp.tsx
  InkTerminalView.tsx
  InkTerminalRow.tsx
  InkTerminalLine.tsx
  InkDetailsPanel.tsx
  InkSlashCommandPalette.tsx
  InkSessionPicker.tsx
  InkAgentPicker.tsx
  InkStatusBar.tsx
  inkColors.ts
  inkMarkdown.ts
  inkJson.ts

src/cli-session/
  controller.ts                # Session-Auswahl, Runtime-Anbindung, Commands
  commands.ts                  # Slash Command Parser
  sessionSource.ts             # lokale Stores / Gateway / Runtime-Abstraktion
```

Wichtig: Die Extraktion von `terminalRows.ts` sollte die Web UI nicht funktional verändern. Die bestehenden Web-Imports können zunächst über Re-Exports stabil gehalten werden.

## CLI UX: empfohlener Funktionsumfang

### Hauptscreen

Der Hauptscreen sollte aus drei Bereichen bestehen:

```text
┌──────────────────────────────────────────────┐
│ Statusbar: room/session/agent/model/state    │
├──────────────────────────────────────────────┤
│ Terminal transcript / trace rows             │
│ - user messages                              │
│ - assistant responses                        │
│ - tool calls                                 │
│ - tool results                               │
│ - errors                                     │
│ - yielded runs                               │
├──────────────────────────────────────────────┤
│ Input line: message or /command              │
└──────────────────────────────────────────────┘
```

### Navigation

Minimaler Keyboard-Support:

- `Enter`: Nachricht senden oder Auswahl bestätigen
- `Esc`: Picker/Details schließen
- `Ctrl+C`: App verlassen oder laufende Eingabe abbrechen
- `↑/↓`: Auswahl in Pickern oder Row-Auswahl
- `PageUp/PageDown`: Transcript scrollen
- `Tab` / `Shift+Tab`: Fokusbereich wechseln, falls mehrere Bereiche aktiv sind

### Slash Commands

Empfohlene erste Commands:

- `/help` — verfügbare Commands anzeigen
- `/new` — neue Session erstellen
- `/session` — Raum auswählen, dann Session auswählen
- `/agent` — Agent/Profile auswählen
- `/model` — aktives Modell anzeigen oder wechseln, falls unterstützt
- `/thinking` — Thinking-Level anzeigen/ändern, begrenzte Option
- `/status` — aktuelle Session-/Runtime-Infos anzeigen
- `/clear` — lokale Anzeige leeren, nicht Session löschen
- `/exit` oder `/quit` — CLI verlassen

Später möglich:

- `/fork` — neue Session ab aktueller/ausgewählter User Message
- `/details` — Details zur ausgewählten Row öffnen
- `/copy` — nur falls Terminal/OS sinnvoll unterstützt

### Session-Wechsel

Gewünschter Ablauf:

```text
/session
  → Raum auswählen
  → Session auswählen
  → Transcript laden
  → Live-Updates abonnieren
```

Neue Session:

```text
/new
  → Raum auswählen
  → optional Agent auswählen
  → neue Session öffnen
```

Wenn Rooms in lokaler CLI nicht verfügbar sind, braucht die erste Spec eine klare Datenquelle:

- lokale Stores
- Gateway API, falls erreichbar
- Runtime/Router direkt im Prozess
- Hybrid-Modus mit Fallback

## Daten- und Runtime-Anbindung

Es gibt drei denkbare Betriebsmodi.

### Modus A: rein lokal / direkt

Die CLI startet oder nutzt die lokale Pibo Runtime direkt im Prozess.

Vorteile:

- funktioniert ohne Web Gateway
- gut für Erstsetup und Recovery
- weniger bewegliche Teile

Nachteile:

- muss Store-/Session-Logik sauber selbst bedienen
- Gefahr, Web-Gateway-Logik zu duplizieren

### Modus B: Gateway Client

Die CLI verbindet sich mit einer laufenden Gateway/Web API.

Vorteile:

- nutzt vorhandene Chat-Web APIs
- konsistent mit Web UI
- weniger lokale Store-Direktzugriffe

Nachteile:

- hilft nicht, wenn Gateway/Web nicht läuft
- weniger geeignet für Bootstrap-/Recovery-Ziel

### Modus C: Hybrid mit Fallback

Die CLI versucht zuerst eine lokale direkte Session-Quelle und kann optional eine Gateway-Quelle nutzen.

Empfehlung für Zielbild: Hybrid.  
Empfehlung für erste Implementierung: lokal/direkt, aber mit Interfaces so bauen, dass Gateway später möglich bleibt.

## Beziehung zur Web UI

Die Web UI bleibt:

- vollständiges Control Center
- primärer Ort für Projects, Workflows, Cron, Ralph, Agent Designer, Settings
- visuelle und administrative Oberfläche

Die CLI wird:

- robustes Session-Minimum
- SSH-first Interface
- Recovery-/Bootstrap-Werkzeug
- schneller Shell-Zugang zum Agenten
- keine Konkurrenz zur Web UI

Wichtig: Die CLI darf keine Web UI Refactors erzwingen. Änderungen an gemeinsamen View Models sollten klein und rückwärtskompatibel erfolgen.

## Rendering-Strategie für Ink

### Terminal Rows

`CompactTerminalRow` passt gut zu Ink. Ein Row Renderer kann abhängig von `kind` und `status` farbig rendern:

- `message.user` → Prompt-Zeile mit `›`
- `message.assistant` → Markdown-Text als vereinfachter Plaintext/ANSI-Text
- `tool.call` → `• Calling <tool>(...)`
- `execution.command` → Shell-Command farbig tokenisiert
- `agent.delegation` / `agent.async` → Kind-Session-/Agent-Hinweise
- `yielded.run` → Run-Status
- `error` → rote Fehlerzeile

### Details

Details sollten als togglebares Panel gerendert werden:

- Input
- Output
- Error
- Linked session id
- Event id / Run id optional in Debug-Modus

JSON kann zuerst als pretty-printed Text gerendert werden. Eine interaktive JSON-Baumansicht ist nicht nötig für V1.

### Markdown

Markdown sollte für V1 reduziert werden:

- Paragraphen als Text
- Codeblocks als eingerückte Blöcke
- Listen als `-`
- Links als `text (url)`
- Tabellen optional als Plaintext

Kein Prism/Web-HTML-Highlighting in V1.

### Icons

`lucide-react` wird in Ink nicht verwendet. Stattdessen Unicode/ASCII:

- running: `◌` oder `…`
- done: `✓`
- error: `✕`
- branch/session: `↳`
- tool: `•`
- prompt: `›`

## Minimale V1-Schnittmenge

V1 sollte nur diese Capabilities enthalten:

1. CLI startet eine Session UI.
2. CLI kann eine neue Session erstellen.
3. CLI kann vorhandene Sessions auswählen.
4. CLI kann Agent/Profile vor oder während der Session wechseln.
5. CLI sendet User Messages.
6. CLI zeigt Assistant Responses live an.
7. CLI zeigt Tool Calls, Tool Results und Errors als Compact Terminal Rows an.
8. CLI unterstützt `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`.
9. CLI funktioniert ohne Web UI.
10. Web UI bleibt unverändert.

## Phasenvorschlag

### Phase 0: Spec und Schnittstellen klären

Deliverables:

- Capability Spec für CLI Session UI
- Design Spec für Runtime-/SessionSource-Abstraktion
- Task Plan für V1

Zu klären:

- Soll der Command `pibo tui:sessions`, `pibo chat`, oder ein anderer Name sein?
- Welche Datenquelle ist V1: direkt lokal, Gateway, oder Hybrid?
- Wie werden Rooms in der CLI zuverlässig geladen?
- Welche Profile/Agents sind in der CLI auswählbar?

### Phase 1: View-Model extrahieren

Deliverables:

- `terminalRows.ts` und `terminalValue.ts` in einen shared UI-neutralen Ort verschieben oder re-exportieren
- Web UI Imports minimal anpassen
- Tests, dass `buildCompactTerminalRows()` identisch bleibt

Risikoarm, weil Presentation unverändert bleibt.

### Phase 2: statischer Ink Renderer

Deliverables:

- Ink Components für Rows, Lines, Details, Statusbar
- `renderToString()` Tests für Beispiel-Traces
- Keine Live Runtime nötig

Ziel: Beweisen, dass die CLI-Darstellung aus bestehenden Trace Views funktioniert.

### Phase 3: interaktive Session App

Deliverables:

- Input Line
- Slash Command Parser
- Session Picker
- Agent Picker
- Message send flow
- Live Row Updates

### Phase 4: Stabilisierung für SSH/Recovery

Deliverables:

- Non-TTY Fallback
- Fehlerzustände: keine Sessions, Store fehlt, Auth fehlt, Modell fehlt
- Sauberes Ctrl+C / Exit-Verhalten
- Dokumentation

## Risiken

### Risiko: Logik wandert in Renderer

Wenn Web und CLI separate Mapping-Logik bekommen, divergieren sie schnell. Deshalb sollte das Row View Model geteilt bleiben.

Mitigation: `buildCompactTerminalRows()` als Contract testen.

### Risiko: Web UI wird durch Extraktion beschädigt

Die Web UI ist das Haupt-Control-Center und darf nicht beeinträchtigt werden.

Mitigation: Erst Re-Exports oder sehr kleine Verschiebung. Keine visuellen Web-Änderungen in V1.

### Risiko: Ink und React-Version

Ink `master` ist aktuell auf React 19 ausgelegt. Pibo nutzt ebenfalls React 19. Trotzdem sollte die konkrete npm-Version geprüft werden, bevor Ink als Dependency eingeführt wird.

Mitigation: Version pinnen und Typecheck/Build testen.

### Risiko: Terminal-Scrolling und große Traces

Ink hat kein Browser-Virtual-Scrolling wie `react-virtuoso`. Große Sessions können Performance-Probleme erzeugen.

Mitigation V1:

- nur Tail der Rows rendern
- Scrollback-Limit
- Details nur für ausgewählte Row
- später eigener viewport/windowing Renderer

### Risiko: Runtime-/Gateway-Duplizierung

Wenn die CLI eigene Session-Logik baut, kann sie von Chat Web abweichen.

Mitigation: Eine `SessionSource`-Schnittstelle definieren und bestehende Runtime-/Trace-Funktionen nutzen.

## Offene Fragen

1. Wie soll der finale CLI-Command heißen?
2. Muss V1 komplett ohne Gateway funktionieren, oder reicht lokaler Gateway optional?
3. Wie werden Rooms ohne Web UI geladen und angezeigt?
4. Gibt es Auth-Anforderungen in der lokalen CLI, oder läuft sie im lokalen Owner Scope?
5. Welche Agent/Profile-Liste ist V1-kanonisch?
6. Soll `/model` in V1 enthalten sein oder erst später?
7. Soll `/fork` in V1 enthalten sein?
8. Sollen bestehende `pibo tui` und `pibo tui:routed` ersetzt, ergänzt oder nur intern weiterverwendet werden?
9. Wie viele Trace Rows sollen maximal aktiv gerendert werden?
10. Sollen CLI Sessions dieselben Stores und Event Streams verwenden wie Chat Web?

## Konkrete Spec-Empfehlungen

Aus diesem Report sollten mindestens drei Specs entstehen:

1. `docs/specs/capabilities/cli-session-ui.md`  
   Dauerhafter Capability Contract für die native CLI Session UI.

2. `docs/specs/changes/ink-cli-session-ui/design.md`  
   Technisches Design: Ink App, SessionSource, View-Model-Reuse, Runtime-Integration.

3. `docs/specs/changes/ink-cli-session-ui/tasks.md`  
   Schrittweiser Implementierungsplan mit Tests.

Optional zusätzlich:

4. `docs/specs/capabilities/shared-terminal-view-model.md`  
   Contract für `CompactTerminalRow` als gemeinsame Web-/CLI-Darstellung.

## Empfehlung

Die beste Umsetzung ist eine Ink-basierte CLI als eigenständiger Renderer auf bestehenden Pibo Session-/Trace-Daten.

Nicht empfohlen:

- Web DOM Components in Ink wiederverwenden wollen
- Web UI für CLI umbauen
- Workflows/Projects/Ralph/Cron in V1 aufnehmen
- eigene Trace-Mapping-Logik nur für CLI schreiben

Empfohlen:

- Web UI unverändert lassen
- `buildCompactTerminalRows()` als gemeinsame Schicht stärken
- Ink Components neu, klein und terminalgerecht bauen
- V1 auf Session Chat, Session-Wechsel, Agent-Wechsel und Compact Terminal View begrenzen
- erst statisch rendern, dann interaktiv machen
