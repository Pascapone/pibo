# Bug: Compaction reduziert Agent-Kontext, aber nicht den Assistant-Kontext

## Status
**Open** — Root-Cause identified, Lösungsansatz erforderlich

## Zusammenfassung

Wenn ein User in einer Pibo-Session `compact()` aufruft (via `/compact` Slash-Command oder Auto-Compaction), wird der **Agent-Kontext** (die Messages im `pi-coding-agent`, die an das LLM für Tool-Calls gehen) korrekt gekürzt. Der **Assistant-Kontext** (der Conversation-History, auf die der Coding Assistant zugreift) bleibt jedoch unverändert.

**Resultat:** Der Coding Assistant sieht nach der Compaction weiterhin die vollständige Historie statt nur der Zusammenfassung. Die Compaction spart Tokens beim Agent-LLM, aber nicht beim Assistant-LLM, was das ursprüngliche Ziel (Vermeidung von Context-Overflow in der gesamten Session) untergräbt.

---

## Reproduktion

### Setup
- Session mit langer Historie (>100 Turns oder >200k Tokens)
- Compaction ist aktiviert

### Schritte
1. User führt mehrere Tool-Calls durch (read, edit, grep, bash, etc.)
2. Tokens nähern sich dem Limit
3. User führt `/compact` aus (oder Auto-Compaction triggert)
4. Compaction-Ende-Event wird emitted
5. **Erwartet:** Assistant sollte nur noch Compaction-Summary + recent Messages sehen
6. **Tatsächlich:** Assistant sieht weiterhin die komplette Historie vom Session-Start

### Beobachtung
- In der Session-Datei (`~/.pi/agent/sessions/...`) ist das `compaction`-Entry vorhanden
- `buildSessionContext()` im `pi-coding-agent` liefert korrekt gekürzte Messages
- Der Coding Assistant (im Pibo-Chat) hat aber keinen Zugriff auf diesen gekürzten Kontext

---

## Root Cause Analysis

### Architektur

Pibo hat zwei getrennte Kontext-Ebenen:

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                        │
│              (Pibo Chat Web App / TUI)                   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Pibo Core (RoutedSession)                   │
│  ┌─────────────┐          ┌──────────────────────────┐  │
│  │  Assistant  │◄────────►│  Conversation History    │  │
│  │  (You/Me)   │          │  (volle Historie)        │  │
│  └─────────────┘          └──────────────────────────┘  │
│                                                         │
│  ┌─────────────┐          ┌──────────────────────────┐  │
│  │  Agent      │◄────────►│  AgentSession (pi-ca)    │  │
│  │  (Tool LLM) │          │  ├─ sessionManager        │  │
│  │             │          │  ├─ agent.state.messages  │  │
│  │             │          │  └─ buildSessionContext() │  │
│  └─────────────┘          └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Was passiert bei Compaction

1. `AgentSession.compact()` wird aufgerufen
2. `sessionManager.appendCompaction()` → neues Entry in Session-Datei
3. `buildSessionContext()` → Messages werden neu aufgebaut (Summary + kept)
4. `agent.state.messages = sessionContext.messages` → Agent-Kontext ist gekürzt
5. **Assistant-Seite:** Kein Code reagiert auf `compaction_end` und kürzt die Conversation History

### Code-Paths

**Agent-Kontext (wird gekürzt):**
```ts
// pi-coding-agent: agent-session.js
this.sessionManager.appendCompaction(summary, firstKeptEntryId, ...);
const sessionContext = this.sessionManager.buildSessionContext();
this.agent.state.messages = sessionContext.messages;  // ← Gekürzt
```

**Assistant-Kontext (wird NICHT gekürzt):**
```ts
// Pibo: Der Assistant hat seine eigene Conversation-History
// Diese wird nie von der Compaction berührt.
// Die History wird vermutlich in PiboCore oder dem Gateway verwaltet
// und an das Assistant-LLM übergeben.
```

---

## Erwartetes Verhalten

Nach einer erfolgreichen Compaction sollte der Coding Assistant (im Chat) nur noch sehen:

1. **Die Compaction-Summary** als System-/Context-Message
2. **Die "kept messages"** (die nach `firstKeptEntryId` beibehalten wurden)
3. **Neue Messages** seit der Compaction

Alles davor sollte für den Assistant nicht mehr sichtbar sein — genau wie es der Agent-LLM sieht.

---

## Tatsächliches Verhalten

Der Coding Assistant sieht weiterhin:
- Alle User-Nachrichten seit Session-Start
- Alle Assistant-Antworten seit Session-Start
- Alle Tool-Call-Ergebnisse seit Session-Start

Die Compaction-Summary existiert als Event, aber die Conversation-History wird nicht davon beeinflusst.

---

## Impact

| Metrik | Vorher | Nachher (erwartet) | Nachher (tatsächlich) |
|--------|--------|-------------------|----------------------|
| Agent-Kontext-Größe | ~250k Tokens | ~50k Tokens | ~50k Tokens ✅ |
| Assistant-Kontext-Größe | ~250k Tokens | ~50k Tokens | ~250k Tokens ❌ |
| Context-Overflow-Risiko (Agent) | Hoch | Niedrig | Niedrig |
| Context-Overflow-Risiko (Assistant) | Hoch | Niedrig | **Hoch** |
| Token-Kosten (Assistant-LLM) | Hoch | Niedrig | **Hoch** |

---

## Lösungsansätze

### Option A: Compaction-Event konsumieren und Assistant-History kürzen (Empfohlen)

Im `RoutedSession` auf `compaction_end` hören und die interne Conversation-History des Assistant entsprechend kürzen.

```ts
// In RoutedSession.bindRuntimeSession()
this.runtime.session.subscribe(async (event) => {
  if (event.type === "compaction_end" && event.result && !event.aborted) {
    // Die Compaction war erfolgreich
    // Jetzt müssen wir den Assistant-Kontext synchronisieren
    await this._syncAssistantContextWithCompaction(event.result);
  }
});
```

**Challenge:** Die Pibo-Conversation-History muss wissen, welche Messages "gehören" zu welchen Session-Entries, um korrekt zu kürzen. Das erfordert vermutlich ein Mapping zwischen Chat-Messages und Session-Entries.

### Option B: Assistant nutzt denselben `buildSessionContext()`-Mechanismus

Statt eine eigene Conversation-History zu führen, könnte der Assistant den Kontext direkt aus `AgentSession.buildSessionContext()` beziehen.

**Challenge:** Der Assistant braucht historische Messages für seinen eigenen Kontext (System-Prompt, vorherige Gedanken, etc.), der sich vom Agent-Kontext unterscheidet. Einfaches Teilen funktioniert nicht 1:1.

### Option C: Compaction-Summary in Assistant-History einfügen und alte Messages markieren

Bei `compaction_end`:
1. Füge die Compaction-Summary als eine Art "System-Reset"-Message in die Assistant-History ein
2. Markiere oder entferne alle Messages vor der Compaction

```ts
// Pseudocode
this.assistantHistory = [
  systemPrompt,
  { role: "system", content: `[Context Compacted]\n${compactionSummary}` },
  ...recentMessagesSinceCompaction,
];
```

**Challenge:** Wenn der User zu einem alten Message springt (Branching), muss die History wieder vollständig werden — oder das Branching muss auch den Assistant-Kontext berücksichtigen.

### Option D: Beide Kontexte über denselben SessionManager verwalten

Refactor: Der Assistant sollte nicht seine eigene isolierte History haben, sondern den Kontext über denselben `SessionManager` / `AgentSession` beziehen wie der Agent.

**Challenge:** Große Architektur-Änderung. Assistant und Agent haben unterschiedliche Rollen und Prompting-Anforderungen.

---

## Offene Fragen

1. **Wo wird die Assistant-Conversation-History in Pibo verwaltet?**
   - `PiboCore`? Gateway? Ein separater Message-Store?
   - Gibt es ein Mapping zwischen Chat-Messages und Session-Entries?

2. **Wie handhabt Pibo Branching/Navigation?**
   - Wenn der User zu einem alten Entry navigiert, wird der Assistant-Kontext zurückgesetzt?
   - Falls ja, gibt es bereits Mechanismen, die wir für Compaction wiederverwenden können?

3. **Hat der Assistant Zugriff auf `sessionManager.getEntries()`?**
   - Wenn ja, könnte er `buildSessionContext()` selbst aufrufen
   - Wenn nein, müssen wir einen Weg finden, den Compaction-Status zu exposen

4. **Wie wird der System-Prompt des Assistant gehandhabt?**
   - Wenn die History gekürzt wird, muss der System-Prompt erhalten bleiben
   - Wo wird der System-Prompt gespeichert? Inline in der History oder separat?

---

## Nächste Schritte

1. **Code-Analyse:** Finden, wo in Pibo die Assistant-Conversation-History verwaltet wird
2. **Design-Decision:** Welcher Lösungsansatz (A, B, C oder D) passt zur Architektur?
3. **Proof of Concept:** Minimaler Prototyp für den gewählten Ansatz
4. **Regression-Tests:** Sicherstellen, dass Branching, Forking und Session-Switch weiterhin funktionieren

---

## Related

- `feat/preemptive-compaction` Branch (Preemptive Compaction Patch)
- `pi-coding-agent`: `AgentSession.compact()`, `buildSessionContext()`
- `pi-coding-agent`: Events `compaction_start`, `compaction_end`
