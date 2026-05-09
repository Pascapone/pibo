# Implementation Plan: `kill` und `kill_all` Commands

## Ziel

Zwei Gateway-Execution-Commands zur Verfügung stellen:

1. **`kill`** (bereits existierend, aber erweitern):  
   Bricht den Main-Agenten ab, leert die Message-Queue und killt **rekursiv alle Subagent-Sessions** (alle hierarchisch untergeordneten Sessions). Yielded Runs (Hintergrund-Jobs via `pibo_run_*`) laufen derzeit weiter – das bleibt beim bestehenden `kill` so.

2. **`kill_all`** (neu):  
   Macht das Gleiche wie `kill`, **plus** das rekursive Abbrechen **aller yielded Runs** (sowohl im Main-Agenten als auch in allen Subagent-Sessions).  
   Das heißt: Agent-Inference stoppt, Subagents sterben, **und** jeder laufende `pibo_run_start`-Hintergrund-Job wird über `runRegistry.cancelOwnerRuns()` gekillt.

## Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| **Agent/Session** | Die Pi Coding Agent Session (`AgentSession`), die mit dem Provider kommuniziert (Inference). |
| **Subagent** | Eine separate `RoutedSession`, die als Kind einer Parent-Session über `sessionStore.parentId` verknüpft ist. |
| **Yielded Run** | Ein Hintergrund-Job, der über `pibo_run_start` gestartet wurde. Lebt im `PiboRunRegistry` pro `ownerPiboSessionId`. |
| **PiboSessionId** | Die externe ID einer Session im Router (`ps_…`). |

## Aktueller Stand

- `kill` ist als Gateway Action in `builtin.ts` registriert.
- `RoutedSession.kill()` leert die Queue und ruft `runtime.session.abort()` auf → bricht die **Provider-HTTP-Stream ab** (keine weiteren Kosten).
- `PiboSessionRouter.killSession()` ruft `killChildSessions()` auf, das rekursiv über `sessionStore.list()` + `parentId` alle Kind-Sessions findet und killt.
- `PiboRunRegistry.cancelOwnerRuns()` existiert bereits und bricht alle yielded Runs einer Session ab, wird aber beim Kill **nicht** aufgerufen.

## Lücken

1. `kill` bricht yielded Runs **nicht** ab.
2. Es gibt keinen `kill_all` Befehl, der yielded Runs rekursiv abbrechen würde.
3. Die Chat Web App hat keine dedizierten REST-Endpunkte für Kill-Operationen.
4. Nach einem `kill` bleibt die Session im `PiboSessionRouter.sessions`-Map aktiv (im Gegensatz zu `dispose`, wo sie explizit entfernt wird).

## Dateien, die angefasst werden müssen

### 1. `src/core/events.ts`
`kill_all` als neuer `BuiltinPiboExecutionAction` hinzufügen.

### 2. `src/runs/registry.ts`
`cancelOwnerRuns()` existiert, gibt aber nur `PiboRunSnapshot[]` zurück.  
Für `kill_all` brauchen wir konsistente Rückgabe der **cancelled Run IDs**.

### 3. `src/core/session-router.ts`
- `killSession()` erweitern: optionales `options: { includeRuns?: boolean }`.
- `killChildSessions()` erweitern: gleiches Options-Objekt durchreichen.
- Wenn `includeRuns === true`: `runRegistry.cancelOwnerRuns(sessionId)` für jede getroffene Session aufrufen.
- Rückgabetyp erweitern auf `{ killed: string[]; cancelledRuns: string[] }`.

### 4. `src/core/routed-session.ts`
- `onKillChildren`-Callback-Signatur erweitern, um `options` durchzureichen.
- Im `runAction`-`kill`-Handler: bleibt wie bisher (nur Agent + Subagents).
- Neuer `killAll`-Handler im `runAction`, der `includeRuns: true` an `onKillChildren` weitergibt.
- Nach Kill: Session nicht aus dem Router entfernen (sie bleibt aktiv für neue Messages), aber ggf. ein `session_error`-Event emitten, damit das UI weiß, dass abgebrochen wurde.

### 5. `src/plugins/types.ts`
- `PiboGatewayActionContext` um `killAll(): Promise<{ killed: string[]; cancelledRuns: string[] }>` erweitern.

### 6. `src/plugins/builtin.ts`
- Gateway Action `kill` anpassen (bleibt funktional wie bisher, aber mit konsistenterem Rückgabeformat).
- Neue Gateway Action `kill_all` mit Slash-Command `kill-all` registrieren.

### 7. `src/apps/chat/web-app.ts`
Neue REST-Routen registrieren, die über den Channel Context ein `execution` Event emitten:
- `POST /api/chat/sessions/{id}/kill`
- `POST /api/chat/sessions/{id}/kill-all`

### 8. Tests
- `test/subagents.test.mjs` oder neuer Test: Prüfen, dass `kill_all` Subagents + yielded Runs rekursiv cancelt.

## Implementierungsschritte

### Schritt 1: Typerweiterung
- `src/core/events.ts`: `"kill_all"` zu `BuiltinPiboExecutionAction` hinzufügen.
- `src/plugins/types.ts`: `killAll()` zu `PiboGatewayActionContext` hinzufügen.

### Schritt 2: Run-Registry anpassen
- `src/runs/registry.ts`: Sicherstellen, dass `cancelOwnerRuns()` die Liste der tatsächlich abgebrochenen Run-IDs zurückgibt (nicht nur Snapshots).

### Schritt 3: Session-Router erweitern
- `killSession(piboSessionId, options?)` implementieren.
- `killChildSessions(parentId, options?)` implementieren.
- Bei `includeRuns === true` für jede Session `this.runRegistry.cancelOwnerRuns(sessionId)` aufrufen und gesammelte Run-IDs zurückgeben.

### Schritt 4: RoutedSession erweitern
- `onKillChildren`-Typ anpassen.
- `runAction` um `killAll`-Handler ergänzen.
- `kill`-Handler belassen (ruft `this.kill()` + `onKillChildren` ohne Runs).

### Schritt 5: Plugin-Registrierung
- `src/plugins/builtin.ts`: `kill_all` Gateway Action registrieren.

### Schritt 6: Chat Web App Routes
- `src/apps/chat/web-app.ts`: Handler für `POST …/kill` und `POST …/kill-all` hinzufügen.
- Beide emitten ein passendes `PiboExecutionEvent` via `context.channelContext.emit()`.

### Schritt 7: Verifizierung
- Gateway Protocol-Frame `{ type: "execution", action: "kill_all", piboSessionId: "..." }` senden.
- Erwarten: `{ killed: ["ps_...", "ps_..."], cancelledRuns: ["run_...", "run_..."] }`.
- Subagent-Subagent (Tiefe > 1) wird ebenfalls gekillt.
- Yielded Run, der in einem Subagent gestartet wurde, wird abgebrochen.

## Risiken / Offene Fragen

1. **Soll `kill` selbst auch yielded Runs abbrechen?**  
   → Nein. Der Nutzer hat explizit zwei separate Befehle gewünscht. `kill` = nur Agent-Hierarchie. `kill_all` = Agent-Hierarchie + Runs.

2. **Was passiert mit Runs, die gerade im `pending`-Zustand sind (noch nicht gestartet)?**  
   `cancelOwnerRuns` setzt sie auf `cancelled`. Das ist korrekt.

3. **Soll `kill_all` auch detached Runs abbrechen?**  
   Ja. `cancelOwnerRuns` bricht alle nicht-terminalen Runs ab, unabhängig von der Completion-Policy.

4. **Rückwärtskompatibilität des Gateway Protocols?**  
   `kill` ändert sich nur minimal im Rückgabeformat (könnte `cancelledRuns: []` hinzufügen). Das ist akzeptabel, da es sich um ein Objekt handelt.

5. **Web-UI-Integration?**  
   Der Plan umfasst nur die Backend-Routes. Die Frontend-Buttons für Kill/Kill-All sind ein separater Schritt.
