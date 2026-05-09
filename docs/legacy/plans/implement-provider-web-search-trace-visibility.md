# Implement Provider Web Search Trace Visibility

## Ausgangslage

Provider-backed `web_search` funktioniert funktional, ist aber in den Pibo/Chat-Web-Traces nicht sichtbar. In der Testsession:

- Pibo Session: `ps_5ee14c39-b987-4b67-b5ff-75f5a97cb711`
- Pi Session: `380ca3ac-a716-4599-aa7d-33d48aa6b3a1`
- Profil: `codex-compat-openai-web`
- Provider/Model: `openai-codex` / `gpt-5.4`
- Anfrage: `Fuehre eine Websuche zu honker einem SQL Event System durch.`

Die Antwort war fachlich plausibel und enthielt externe Quellen. Es gab keine lokalen `tool_execution_started` / `tool_execution_finished` Events fuer `web_search`, was zum provider-backed Design passt. Die persistierte Pi-Session enthielt aber keine sichtbaren `web_search_call` Trace-Nodes und keine eigenen Tooloutput-/Sources-Nodes.

## Ziel

Provider-hosted Web Search Calls muessen als first-class Trace-Inhalte sichtbar werden:

- im Chat Web Trace View,
- im Compact Terminal Session View,
- in `pibo debug trace`,
- optional als raw/debuggable Provider-Tool-Daten in `--json` Trace/Event-Ausgaben.

Der Model-facing Toolname bleibt `web_search`; die Sichtbarkeit ist reine Trace-/Debug-Normalisierung.

## Nicht-Ziele

- Kein Rueckbau des provider-backed nativen `web_search` Tools.
- Keine Rueckkehr zum lokalen DuckDuckGo Search Tool.
- Kein neues dauerhaft materialisiertes Trace-Storage-Modell.
- Keine Aenderung des User-facing Search Tool Interfaces.

## Vermutete Ursache

Pibo injiziert fuer OpenAI Responses `tools: [{ type: "web_search", ... }]` und `include: ["web_search_call.action.sources"]`. Pi Coding Agent speichert im aktuellen JSONL aber nur reasoning/text content und keine eigenen provider-hosted `web_search_call` Items. Dadurch hat `src/apps/chat/trace.ts` keine Datenbasis, um Search Calls als Nodes zu projizieren.

## Umsetzungsschritte

### 1. Provider-Stream- und Persistenzpfad untersuchen

Zu pruefen:

- `<HOME>/code/pi-mono/packages/ai/src/stream.ts`
- `<HOME>/code/pi-mono/packages/coding-agent/src/core/agent-session.ts`
- OpenAI/Codex Responses Stream Normalisierung in `pi-mono`
- ob `web_search_call` Items im Provider Response/Stream vorhanden sind, aber verworfen werden
- ob `web_search_call.action.sources` durch `include` geliefert wird

Ergebnis:

- dokumentieren, an welcher Schicht `web_search_call` sichtbar ist,
- entscheiden, ob Pi oder Pibo den Provider-Event in persistierbare Content Parts normalisiert.

### 2. Persistierbares Provider-Tool-Event modellieren

Minimaler persistierter Shape fuer provider-hosted Tools:

```ts
{
  type: "provider_tool_call",
  provider: "openai",
  toolName: "web_search",
  providerType: "web_search_call",
  callId?: string,
  status?: "running" | "completed" | "failed",
  query?: string,
  action?: unknown,
  sources?: Array<{ title?: string; url?: string; snippet?: string }>,
  raw?: unknown
}
```

Der Shape sollte generisch genug fuer spaetere provider-hosted Tools bleiben, aber in dieser Aufgabe nur `web_search_call` umsetzen.

### 3. Pibo Trace Node Typ einfuehren

In `src/apps/chat/trace.ts`:

- `PiboTraceNodeType` um z. B. `provider.tool.call` oder `tool.provider_call` erweitern.
- Provider-Web-Search-Parts aus Pi transcript entries in Trace Nodes projizieren.
- stabile IDs und Order Keys aus entry id + provider call id/content index ableiten.
- Sources/URLs im Node `output` oder `summary` ablegen.

Akzeptanz:

- Die Testsession-Art zeigt mindestens einen sichtbaren `web_search`/`web_search_call` Node zwischen User Message/Reasoning und finaler Assistant Message.
- Der Node hat klare Quelle `transcript` oder `event-log`, stabilen `stableKey`, `orderKey`, Status `done`.

### 4. Chat Web Rendering erweitern

In Chat UI:

- Trace Timeline und Compact Terminal View sollen provider-hosted `web_search` als Tool/Provider-Call anzeigen.
- Minimal sichtbare Inhalte:
  - Toolname `web_search`
  - Provider `OpenAI`
  - Status
  - verwendete Quellen/URLs, wenn vorhanden
  - optional Query/Action, falls der Provider sie liefert

Kein grosses Redesign; bestehendes Tool-Node-Layout wiederverwenden, wenn moeglich.

### 5. Debug CLI erweitern

`pibo debug trace <session>` soll provider-hosted Search Nodes ausgeben.

Optional:

- `pibo debug events` muss nicht zwingend neue Events zeigen, wenn die Daten aus dem Pi transcript kommen.
- Wenn neue Pibo Output Events eingefuehrt werden, muessen sie mit `--fields` inspectable sein.

### 6. Tests

Ergaenzen:

- `test/chat-trace.test.mjs`
  - transcript fixture mit provider-hosted `web_search_call`
  - Node wird korrekt sortiert und nicht dupliziert
  - Sources erscheinen in output/summary
- `test/debug-cli.test.mjs`
  - `pibo debug trace` zeigt provider search node
- falls Pi-seitige Normalisierung angepasst wird:
  - fokussierte Tests im betroffenen `pi-mono` Package

### 7. Regression gegen echte Session

Nach Implementierung:

```bash
npm run dev -- debug trace ps_5ee14c39-b987-4b67-b5ff-75f5a97cb711 --json
npm run dev -- debug session ps_5ee14c39-b987-4b67-b5ff-75f5a97cb711 --events --limit 200 --json
```

Erwartung:

- `debug trace` enthaelt sichtbaren provider-hosted `web_search` Node.
- Keine lokalen DuckDuckGo Tool Result Details.
- Keine Fehler-Events.

## Verifikation

- `npm run build`
- `node --test test/chat-trace.test.mjs`
- `node --test test/debug-cli.test.mjs`
- `node --test test/codex-compat.test.mjs`
- `npm run typecheck`
- manuelle Browserpruefung der Testsession in Chat Web

## Offene Designfrage

Wenn Pi Coding Agent `web_search_call` nicht persistiert, ist vermutlich eine kleine Pi-seitige Erweiterung noetig. Dann sollte Pibo keine rohen Provider-Payloads hackig aus Logs rekonstruieren, sondern eine normalisierte Pi Transcript Part Form bekommen.
