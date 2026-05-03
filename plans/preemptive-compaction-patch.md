# Preemptive Compaction Patch

## Problem

Auto-Compaction im `pi-coding-agent` triggert nur bei `agent_end` (nach Assistant-Antwort). Zwischen Tool-Calls (`agent.continue()`) läuft **keine** Compaction-Prüfung. Bei langen Sessions mit vielen Tool-Calls wächst der Kontext ungebremst über das Limit hinaus → `400 exceeded model token limit`.

## Session-Beispiel (ps_b7fa2b7e)

| Index | StopReason | Tokens | Größe |
|---|---|---|---|
| 160 | `toolUse` | 261.951 | 5 KB |
| 161 | toolResult | — | 0,3 KB |
| 162 | `toolUse` | 262.124 | 5 KB |
| 163 | toolResult | — | 7 KB |
| → | **continue() ohne Prüfung** | | |
| 164 | **`error`** | 0 | 400 exceeded |

Threshold: `262.144 - 16.384 = 245.760`. Bei Index 160/162 bereits überschritten, aber kein `agent_end` → keine Compaction.

## Lösung

Monkey-Patch `agent.continue()` in `RoutedSession`, um vor jedem `continue()` eine Token-Schätzung zu machen und proaktiv zu compacten.

## Datei: `src/core/routed-session.ts`

### 1. Import hinzufügen (oben)

```ts
import { SessionManager, type AgentSessionRuntime, shouldCompact } from "@mariozechner/pi-coding-agent";
```

### 2. Methode `patchAgentContinue` hinzufügen (in `RoutedSession`)

```ts
private patchAgentContinue(): void {
    const agent = this.runtime.session.agent;
    const originalContinue = agent.continue.bind(agent);
    const session = this.runtime.session;

    agent.continue = async () => {
        const model = session.model;
        if (!model) return originalContinue();

        const contextWindow = model.contextWindow ?? 0;
        const settings = session.settingsManager.getCompactionSettings();
        if (!settings.enabled) return originalContinue();

        // getContextUsage() already handles the stale-usage-after-compaction
        // check internally. If tokens is null, the last assistant usage predates
        // the latest compaction and we should skip until the next LLM response.
        const contextUsage = session.getContextUsage();
        if (!contextUsage || contextUsage.tokens === null) return originalContinue();

        if (shouldCompact(contextUsage.tokens, contextWindow, settings)) {
            await session.compact();
        }

        return originalContinue();
    };
}
```

> **Hinweis zur Implementierung:** Der ursprüngliche Plan wollte `estimateContextTokens()` und `getLatestCompactionEntry()` direkt aus `pi-coding-agent/dist/core/...` importieren. Unter `NodeNext`-Modul-Auflösung sind diese internen Pfade aber blockiert, da sie nicht in der `package.json` `exports` stehen. Stattdessen wird `session.getContextUsage()` verwendet, die **intern exakt dieselbe Logik** abdeckt (Token-Schätzung + Prüfung, ob die letzte Assistant-Usage vor der letzten Compaction liegt).

### 3. Aufruf im Konstruktor (nach `bindRuntimeSession`)

```ts
constructor(...) {
    this.bindRuntimeSession();
    this.patchAgentContinue(); // ← NEU
    this.runtime.setRebindSession(async () => {
        this.bindRuntimeSession();
        this.patchAgentContinue(); // ← NEU: Re-patch nach Rebind
    });
}
```

## Testplan

1. **Unit-Test** (optional): Session mit 250k+ Tokens simulieren, Tool-Call auslösen, prüfen dass `compact()` vor `continue()` aufgerufen wird.
2. **Manueller Test**: Lange Session mit vielen `read`/`edit`/`grep`-Tool-Calls. Bei ~245k Tokens muss Compaction **vor** dem nächsten LLM-Request passieren (kein 400er).
3. **Regression**: Normale Kurz-Session mit 1–2 Turns → keine ungewollte Compaction.

## Risiken & Abwägungen

| Risiko | Wahrscheinlichkeit | Mitigation |
|---|---|---|
| `session.compact()` ruft intern `abort()` auf → könnte laufenden Agent unterbrechen | Niedrig | Agent ist zwischen Tool-Calls idle (`activeRun = undefined`). `abort()` ist no-op. |
| Race: Compaction läuft, User sendet gleichzeitig Nachricht | Niedrig | `session.compact()` blockiert; Pibo-Queue verhindert parallele Messages. |
| Doppelte Compaction (Framework + Patch) | Niedrig | `getContextUsage()` returned `tokens: null` nach Compaction → Patch überspringt. Zusätzlich: `prepareCompaction` returned `undefined` wenn letzter Eintrag schon `compaction` ist. |
| Monkey-Patch geht bei Framework-Update kaputt | Mittel | Patch ist klein (~20 Zeilen), leicht anzupassen. |

## Alternative (sauber, aber Framework-Change)

```ts
// In pi-coding-agent: agent-session.js, vor agent.continue()
const lastAssistant = this._findLastAssistantMessage();
if (lastAssistant) {
    await this._checkCompaction(lastAssistant, false);
}
```

→ 3-Zeiler-PR an `pi-coding-agent`. Wenn angenommen, kann dieser Patch wieder entfernt werden.

## Decision Log

- **Kein Framework-Fork**: Patch bleibt im Pibo-Code, `pi-coding-agent` bleibt Dependency.
- **Kein neuer Extension-Event**: `turn_end` ist asynchron, Agent macht sofort `continue()`. Extension kann nicht blockieren.
- **Monkey-Patch auf `agent.continue()`**: Einzige Stelle, die synchron vor dem nächsten LLM-Call greift.
- **Keine internen Imports**: `NodeNext`-Modul-Auflösung blockiert Pfade außerhalb der `package.json` `exports`. Stattdessen wird `session.getContextUsage()` genutzt, die dieselbe Logik intern kapselt.
