# Test-Review: Local Routed TUI

**Datum:** 2026-05-10 15:49 Europe/Berlin  
**Bereich:** Lokaler gerouteter Terminal-Adapter (`pibo tui:routed`)  
**Ziel dieses Laufs:** Prüfen, ob die bestehende Testsuite die Produktgrenze des Local Routed TUI granular abdeckt, ohne einen breiten Build- oder E2E-Lauf auszuführen.

## Betrachtete Dateien

- `GLOSSARY.md`
- `AGENTS.md`
- `package.json`
- `src/cli.ts`
- `src/local/tui.ts`
- `src/local/client.ts`
- `src/local/extension.ts`
- `src/core/events.ts`
- `docs/specs/capabilities/local-routed-tui.md`
- `test/local-routed-tui.test.mjs`

## Ausgeführte Checks

```bash
node --test test/local-routed-tui.test.mjs
npm run --silent dev -- tui:routed --help
npm run --silent dev -- --help | head -80
```

Ergebnis:

- `node --test test/local-routed-tui.test.mjs`: 8/8 bestanden in ca. 1,3 s.
- `npm run --silent dev -- tui:routed --help`: druckt Usage, beendet aber mit Code 1 und `error: unknown option '--help'`.
- Top-Level `--help` beendet mit Code 0 und verweist auf `pibo <command> --help`.

## Stärken der vorhandenen Tests

- `test/local-routed-tui.test.mjs` ist ein gutes granuläres Subset: Es läuft schnell und vermeidet Gateway-, Browser- und Provider-Abhängigkeiten.
- Die Extension wird mit Fakes für Pi-Extension-API, TUI-Kontext und Local Client getestet. Dadurch sind Routing-Entscheidungen, Widget-Lifecycle und Slash-Command-Filter isoliert prüfbar.
- Die Tests decken wichtige Local-Routed-TUI-Risiken ab:
  - normales User-Input-Routing über `client.sendMessage`,
  - erlaubte Gateway-Actions als Slash Commands,
  - Blockieren gefährlicher Pi-TUI-Kommandos wie `/fork`, `/clone`, `/tree`,
  - Assistant-Streaming-Widget und Finalisierung,
  - Thinking-Anzeige und `/thinking-show`,
  - Tool-Call-/Tool-Execution-Rendering über Pi-Komponenten,
  - Shutdown-Cleanup des Submit-Guards,
  - Client-Erzeugung mit Profilalias `codex` und `thinkingLevel`.
- Die Testfälle korrespondieren eng mit `docs/specs/capabilities/local-routed-tui.md`; die Spec ist damit für diesen Bereich bereits relativ gut rückverfolgbar.

## Schwächen und Risiken

### 1. Tests importieren `dist`, prüfen aber Source-Änderungen nur nach Build

`test/local-routed-tui.test.mjs` importiert:

```js
import { createLocalRoutedTuiClient, createLocalRoutedTuiExtension } from "../dist/local/tui.js";
```

Das ist konsistent mit dem allgemeinen `npm test`-Flow (`npm run build && node --test ...`), aber für ein schnelles Entwicklungs-Subset riskant: `node --test test/local-routed-tui.test.mjs` prüft den zuletzt gebauten Stand, nicht zwingend die aktuellen Dateien unter `src/local/`.

**Empfehlung:** Für lokale Entwicklung ein explizites Subset dokumentieren oder ergänzen, z. B. erst minimal bauen und dann den Einzeltest ausführen. Alternativ könnten Test-Imports langfristig über `tsx`/Source laufen, wenn das Projekt bewusst schnellere Unit-Subsets ohne Build will.

### 2. `tui:routed --help` widerspricht der CLI-Discovery-Regel

Die Top-Level-Hilfe sagt `pibo <command> --help`. Für `pibo tui:routed --help` wird aber `unknown option '--help'` mit Exit-Code 1 ausgegeben, obwohl Usage erscheint. Das ist besonders relevant, weil `AGENTS.md` progressive CLI-Discovery als Grundregel definiert.

**Betroffene Dateien:**

- `src/cli.ts` für die Registrierung von `tui:routed`.
- Potenziell CLI-Testbereich, bisher nicht sichtbar in `test/local-routed-tui.test.mjs`.

**Empfehlung:** Ein kleiner CLI-Discovery-Test sollte sicherstellen, dass `pibo tui:routed --help` mit Code 0 endet und die Optionen `--show-thinking` und `--thinking <level>` enthält. Diese Prüfung gehört eher in ein CLI-Subset als in die TUI-Extension-Unit-Tests.

### 3. Fehlerpfade der Extension sind nur teilweise abgedeckt

`src/local/extension.ts` behandelt Fehler bei `client.sendMessage` und `client.sendExecution` mit `Local routed request failed: ...`. Dieser Pfad ist aktuell nicht in `test/local-routed-tui.test.mjs` sichtbar abgedeckt.

**Risiko:** Bei späteren Änderungen an async Input-Handling oder Fake-Client-Form kann die TUI Fehler verschlucken oder trotzdem `handled` melden, ohne dass ein Test auslöst.

**Empfehlung:** Ein gezielter Unit-Test mit ablehnendem Fake-Client für `sendMessage` und `sendExecution`.

### 4. `execution_result`-Formatierung ist untergetestet

`formatExecutionResult` hat spezielle Pfade für:

- `status`,
- `thinking`,
- `clear_queue`,
- generische Actions.

Die aktuelle lokale Testsuite prüft das Senden von `/status` und `/thinking`, aber nicht die Darstellung eingehender `execution_result`-Events.

**Risiko:** Nutzer sehen falsche oder wenig hilfreiche Kontrollausgaben im Terminal, obwohl Routing funktional bleibt.

**Empfehlung:** Ein eigener Testblock für `execution_result`-Rendering mit je einem Status-, Thinking-unsupported-, Clear-Queue- und Custom-Action-Event.

### 5. `session_error`-Cleanup ist spezifiziert, aber nicht gezielt geprüft

Die Spec nennt: `session_error` clears live widgets, displays the error, and marks status as error. Der Test prüft Streaming-Finalisierung und Tool-Finalisierung, aber kein Fehlerereignis während aktiver Widgets.

**Empfehlung:** Ein kleiner Test: erst `message_started`, `assistant_delta`, `tool_call`; dann `session_error`; anschließend prüfen, dass Streaming- und Tool-Widgets entfernt sind, eine Error-Message ausgegeben wurde und Status `local error` ist.

### 6. Client-Eventfilter und Close-Idempotenz sind nur indirekt geprüft

`LocalRoutedTuiClient` filtert Router-Events nach `piboSessionId` und `close()` ist idempotent. Der vorhandene Client-Test prüft Session-Erstellung und `router.options.thinkingLevel`, aber nicht Eventfilter und doppeltes Close.

**Empfehlung:** Als separates Client-Unit-Subset mit minimalem Fake-Router testen, statt die Extension-Fakes weiter aufzublähen.

## Fehlende oder anzupassende Tests

1. **CLI-Discovery-Subset**
   - `pibo tui:routed --help` muss Code 0 liefern.
   - Output enthält kurze Beschreibung und beide Optionen.
   - Keine TUI starten, keine Gateway-Abhängigkeit.

2. **Extension-Fehlerpfad-Subset**
   - `sendMessage` rejectet → sichtbare Error-Message, Input bleibt `handled`.
   - `sendExecution` rejectet → sichtbare Error-Message für Slash Command.

3. **Execution-Result-Rendering-Subset**
   - Status-/Thinking-/Clear-/Custom-Ergebnisse als eingehende Events.
   - Prüfen, dass Status nach Execution Result wieder `local connected` ist.

4. **Session-Error-Cleanup-Subset**
   - Aktive Streaming- und Tool-Widgets werden bei `session_error` entfernt.
   - Error-Message und Status `local error` werden gesetzt.

5. **Source-vs-Dist-Entwicklungs-Subset klären**
   - Entweder Subset-Befehl immer mit vorherigem Build dokumentieren.
   - Oder bewusst einen Source-basierten Testlauf einführen.

## Empfohlene granulare Test-Kommandos

Für schnelle lokale Prüfung nach Änderungen an `src/local/*`:

```bash
npm run build
node --test test/local-routed-tui.test.mjs
```

Wenn nur CLI-Discovery betroffen ist:

```bash
npm run --silent dev -- --help
npm run --silent dev -- tui:routed --help
```

Nach Ergänzung eines CLI-Tests sollte ein noch kleineres Subset möglich sein, z. B.:

```bash
node --test test/local-routed-tui.test.mjs test/<cli-discovery-test>.test.mjs
```

Für spätere Integrations-/Deployment-Phase, nicht für jeden lokalen Edit:

```bash
npm run typecheck
npm test
```

## Konkrete nächste Schritte

1. Einen gezielten CLI-Test für `tui:routed --help` hinzufügen oder einen bestehenden CLI-Test erweitern.
2. `test/local-routed-tui.test.mjs` um drei kleine Event-/Fehlerpfadtests ergänzen: `execution_result`, `session_error`, rejected client calls.
3. In der Entwicklerdokumentation oder im Testnamen klarstellen, dass der aktuelle Einzeltest gegen `dist` läuft und daher einen Build voraussetzt.
4. Falls Source-basierte schnelle Unit-Tests gewünscht sind, ein bewusstes Muster für `tsx`-basierte Test-Imports etablieren, statt einzelne Tests ad hoc umzustellen.

## Umgesetzt am 2026-05-11 12:49 Europe/Berlin

- Bereich: CLI-Discovery für `pibo tui:routed --help` mit Exit-Code 0 und sichtbaren Local-Routed-Optionen.
- Geänderte Dateien: `src/cli.ts`, `test/local-routed-tui-cli.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1549-local-routed-tui.md`.
- Ausgeführte Kommandos: `npm run --silent dev -- tui:routed --help` zur Reproduktion; `npm run build`; `node --test test/local-routed-tui-cli.test.mjs`.
- Ergebnis: Vorher reproduziert mit `unknown option '--help'` und Exit-Code 1; nach gezielter Help-Option für den `tui:routed`-Subcommand ist der neue CLI-Discovery-Test grün.
- Verbleibende offene Punkte: Extension-Fehlerpfade, `execution_result`-Rendering, `session_error`-Cleanup und Client-Eventfilter/Close-Idempotenz bleiben offen.

## Umgesetzt am 2026-05-11 14:08 Europe/Berlin

- Bereich: Extension-Fehlerpfad-Subset für abgelehnte `sendMessage`- und `sendExecution`-Requests.
- Geänderte Dateien: `test/local-routed-tui.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1549-local-routed-tui.md`.
- Ausgeführte Kommandos: `node --test test/local-routed-tui.test.mjs` (zunächst wegen fehlender `node_modules/@mariozechner/pi-coding-agent`-Installation fehlgeschlagen), `npm install`, danach erneut `node --test test/local-routed-tui.test.mjs`.
- Ergebnis: 9/9 Local-Routed-TUI-Tests bestanden; neue Abdeckung stellt sicher, dass fehlgeschlagene geroutete Nachrichten und Slash-Commands eine sichtbare Error-Message erzeugen und der Input weiter als `handled` gilt.
- Verbleibende offene Punkte: `execution_result`-Rendering, `session_error`-Cleanup, Client-Eventfilter/Close-Idempotenz und Source-vs-Dist-Entwicklungs-Subset bleiben offen.

## Umgesetzt am 2026-05-11 14:38 Europe/Berlin

- Bereich: `execution_result`-Rendering für geroutete Kontrollaktionen im Local Routed TUI.
- Geänderte Dateien: `test/local-routed-tui.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1549-local-routed-tui.md`.
- Ausgeführte Kommandos: `node --test test/local-routed-tui.test.mjs`.
- Ergebnis: 10/10 Local-Routed-TUI-Tests bestanden; neue Abdeckung prüft Status-, Thinking-unsupported-, Clear-Queue- und generische Execution-Result-Ausgaben sowie den Status `local connected`.
- Verbleibende offene Punkte: `session_error`-Cleanup, Client-Eventfilter/Close-Idempotenz und Source-vs-Dist-Entwicklungs-Subset bleiben offen.

## Gesamtbewertung

Der Local-Routed-TUI-Bereich hat bereits eine starke, schnelle und fachlich gut geschnittene Unit-Suite. Die größten Verbesserungen liegen nicht in breiteren Tests, sondern in wenigen zusätzlichen Randfalltests und in einer klareren Trennung zwischen `dist`-basiertem Release-Test und schnellem Source-nahen Entwicklungs-Subset. Der konkrete Fund zu `tui:routed --help` ist ein kleines, aber wichtiges CLI-Discovery-Risiko, weil die Projektregel Agenten ausdrücklich zur schrittweisen Hilfe-Navigation anleitet.
