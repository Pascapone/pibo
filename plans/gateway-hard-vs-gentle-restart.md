# Plan: Hard Restart vs. Gentle Restart für das Pibo Gateway

> Status: Analyse abgeschlossen, wartet auf Umsetzung  
> Erstellt: 2026-05-03

---

## 1. Ziel

Zwei separate Restart-Varianten für den Gateway-Daemon:

- **Hard Restart** – Bisheriges Verhalten: Prozess wird beendet, alle Sessions werden disposed, neuer Prozess startet frisch.
- **Gentle Restart** – Sanfter Neustart: Laufende Sessions werden unterbrochen (abgebrochen), der Server startet neu, und alle betroffenen Sessions erhalten eine Benachrichtigung, dass das Gateway wieder erreichbar ist.

Die Usermeldung nach einem Gentle Restart soll lauten:

> `Gateway Outage | All Sessions Were Interrupted | Now Gateway Live and Healthy | Continue With Your Work`

---

## 2. Aktuelle Architektur (Stand der Analyse)

| Komponente | Datei | Zuständigkeit |
|---|---|---|
| `PiboGatewayServer` | `src/gateway/server.ts` | TCP-Server (Port 4789), hält `connections`, startet/stoppt Channels |
| `PiboSessionRouter` | `src/core/session-router.ts` | Verwaltet `Map<string, RoutedSession>`; erstellt Sessions lazy |
| `RoutedSession` | `src/core/routed-session.ts` | Wrapper um `AgentSessionRuntime`; hat `queue`, `processing`, `abort()`, `kill()`, `dispose()` |
| `AgentSession` | `pi-coding-agent` | Die eigentliche Pi-Session; Methoden: `abort()`, `dispose()`, `prompt()`, `isStreaming` |
| `SessionManager` | `pi-coding-agent` | Persistiert Sessions als JSONL-Dateien auf Disk |
| `PiboSessionStore` | `src/sessions/store.ts` | Metadaten-Store (SQLite oder In-Memory) für Pibo-Session-IDs, Profile, Workspace |
| `runGatewayCli` | `src/gateway/cli.ts` | CLI-Logik für `start`, `stop`, `restart`, `status` |
| Channels (z.B. Chat-Web) | `src/apps/chat/web-app.ts` | Empfangen Router-Events via `channelContext.subscribe()`; senden Nachrichten via `channelContext.emit()` |

### Aktueller Restart-Ablauf (`src/gateway/cli.ts`)

1. Prüft, ob Gateway läuft (Port erreichbar)
2. Liest PID aus `~/.pibo/gateway.pid`
3. Sendet `SIGTERM` an den Prozess
4. Wartet, bis der Port frei ist (`waitForGatewayDown`)
5. Optional: `SIGKILL` mit `--force`
6. Startet neuen Prozess via `spawn(command, args, { detached: true })`
7. Wartet, bis Port wieder erreichbar ist

Beim `SIGTERM` fängt der Server das Signal ab und ruft `server.stop()` auf:
- Stoppt alle Channels
- Zerstört alle TCP-Connections
- Ruft `router.disposeAll()` auf
- `disposeAll()` ruft für **jede** `RoutedSession` `session.dispose()` auf
- `dispose()` schließt die `AgentSession` und deren `SessionManager`

**Ergebnis:** Der aktuelle Restart disposed alle Sessions komplett. Eine Wiederherstellung des laufenden Gesprächs ist nicht vorgesehen.

---

## 3. Analyse der technischen Möglichkeiten

### 3.1 Variante A: Prozess-Neustart mit State-Persistenz (vollständiger Neustart)

Beim Gentle Restart würden wir den Prozess beenden und neu starten, **aber**:

| Schritt | Aktion |
|---|---|
| **Vor dem Stop** | Sammle alle Sessions mit `processing === true` oder `streaming === true` |
| **Unterbrechen** | Rufe für jede `session.abort()` auf (nicht `dispose()`!) → bricht den aktuellen LLM-Call sauber ab |
| **Persistieren** | Schreibe die Liste der betroffenen `piboSessionId`s in eine Datei (z.B. `~/.pibo/gateway.interrupted.json`) |
| **Stop** | Beende den Prozess (SIGTERM) **ohne** `disposeAll()` → das ist der kritische Unterschied |
| **Start** | Neuer Prozess startet normal |
| **Nach dem Start** | Lese die interrupted-Datei, sende an jede Session eine Service-Nachricht |

**Probleme dieser Variante:**

1. **Keine Pause-Funktion in `AgentSession` / `SessionManager`**
   - Es gibt kein `session.pause()` oder `session.serializeState()`
   - `abort()` bricht den aktuellen Turn ab, aber die Session ist danach "idle"
   - Die Session-Daten (JSONL) sind zwar auf Disk, aber der **laufende Zustand** (Queue, aktive Message, etc.) geht verloren
   - Nach dem Neustart muss die Session lazy neu erstellt werden

2. **In-Memory-Session-Store verliert Daten**
   - Wenn der User den `InMemoryPiboSessionStore` nutzt (Default, wenn keine DB-Path angegeben), sind alle `PiboSession`-Metadaten nach dem Neustart weg
   - Nur mit `SqlitePiboSessionStore` bleiben die Session-Metadaten erhalten
   - Das müssten wir entweder erzwingen (Gentle Restart nur mit SQLite erlauben) oder anders lösen

3. **Queued Messages gehen verloren**
   - `RoutedSession.queue` ist ein In-Memory-Array
   - Beim Prozess-Neustart geht die Queue verloren
   - Das wäre inkonsistent mit der Erwartung "sanfter Neustart ohne Gespräche zu beenden"

4. **Subagent-Sessions**
   - Subagenten haben eigene `RoutedSession`s im Router
   - Diese müssten ebenfalls erfasst und abgebrochen werden

### 3.2 Variante B: In-Process Gentle Restart (Server neu starten, Prozess bleibt)

Statt den Prozess zu beenden, nur den internen Server-Stack neu aufbauen:

| Schritt | Aktion |
|---|---|
| **Sammeln** | `router.getPiboSessionIds()` + `session.getStatus()` um laufende zu finden |
| **Unterbrechen** | `abort()` für jede laufende Session |
| **Persistieren** | Liste der unterbrochenen Sessions im Speicher halten |
| **Server-Teardown** | `server.stop()` aber **ohne** `router.disposeAll()` |
| **Server-Startup** | `server.start()` neu |
| **Benachrichtigung** | Service-Nachricht an alle unterbrochenen Sessions |

**Vorteile:**
- Sessions bleiben im Speicher (Queue, Zustand)
- Kein Problem mit In-Memory-Store
- Sehr viel schneller
- Technisch sauberer

**Nachteile:**
- Der Prozess wird nicht "frisch" — Memory-Leaks, Extension-Reload-Probleme, etc. bleiben bestehen
- Wenn der User explizit einen **Prozess-Neustart** will (z.B. um Code-Updates zu laden), funktioniert das nicht

### 3.3 Variante C: Prozess-Neustart mit Queue-Persistenz (aufwendig)

Wir könnten vor dem Stop auch die Queues persistieren:

1. Für jede `RoutedSession`: Speichere `queue` + `activeMessage` + `processing` Zustand
2. Nach dem Neustart: Rekonstruiere `RoutedSession` mit diesem Zustand
3. Starte `drain()` neu

**Problem:** Die `AgentSession` und `SessionManager` können nicht einfach serialisiert werden. Die Queue enthält `PiboMessageEvent`s — die sind serialisierbar, aber die `AgentSessionRuntime` müsste neu aufgebaut werden. Das ist komplex und fehleranfällig.

---

## 4. Empfohlene Lösung

**Kombination aus Variante B (In-Process) für Gentle Restart und dem bestehenden Verhalten für Hard Restart.**

### Hard Restart (`pibo gateway restart --hard` oder `pibo gateway hard-restart`)
- Exakt das, was aktuell `restart` macht: SIGTERM → warten → neuen Prozess starten
- Sessions werden komplett disposed

### Gentle Restart (`pibo gateway restart --gentle` oder `pibo gateway gentle-restart`)
- In-Process: Der Prozess bleibt bestehen
- Server wird gestoppt (Connections geschlossen, Channels gestoppt)
- Allen laufenden Sessions wird `abort()` aufgerufen
- Server wird neu gestartet
- An alle abgebrochenen Sessions wird eine Service-Nachricht gesendet:
  > "Gateway Outage | All Sessions Were Interrupted | Now Gateway Live and Healthy | Continue With Your Work"

**Warum In-Process für Gentle?**
- Ein Prozess-Neustart mit vollständiger Session-Erhaltung ist in der aktuellen Architektur **nicht möglich** ohne massive Änderungen am `pi-coding-agent` Package (kein Serialize/Resume für AgentSession)
- Der In-Process-Restart erreicht das Ziel "Gespräche nicht beenden" vollständig
- Der Hard Restart steht weiterhin für "wirklich alles neu starten" zur Verfügung

---

## 5. Wo müssen wir anfassen?

| Datei | Änderung |
|---|---|
| `src/gateway/cli.ts` | Neue Subcommands: `restart --hard` und `restart --gentle` (oder `hard-restart` / `gentle-restart`) |
| `src/gateway/server.ts` | Neue Methode `gentleStop()` oder `stop({ disposeSessions: boolean })` |
| `src/core/session-router.ts` | Neue Methode `interruptAll(): InterruptedSession[]` — sammelt laufende Sessions, ruft `abort()` auf, gibt Liste zurück |
| `src/core/routed-session.ts` | Neue Methode `interrupt(): Promise<void>` — ruft `abort()` auf, merkt sich dass sie unterbrochen wurde |
| `src/gateway/pidfile.ts` oder neuer Store | Persistenz für die Liste unterbrochener Sessions (für Variante A, falls gewünscht) |
| `src/gateway/protocol.ts` oder Events | Ggf. neuer Event-Typ `gateway_outage_notice` (optional) |
| `src/apps/chat/web-app.ts` | Die Service-Nachricht wird automatisch als `TEXT_MESSAGE_START/CONTENT/END` gerendert, wenn wir ein `message`-Event mit `source: "service"` senden |

---

## 6. Arbeitspunkte und geschätzter Aufwand

| Arbeitspunkt | Datei(en) | Aufwand |
|---|---|---|
| **1. CLI Commands erweitern** | `src/gateway/cli.ts` | Klein — bestehende `restart` Logik duplizieren/anpassen, `--hard` / `--gentle` Flags hinzufügen |
| **2. Server Stop-Modus** | `src/gateway/server.ts` | Klein — `stop()` akzeptiert Option `{ gentle?: boolean }`, bei `gentle` kein `disposeAll()` aufrufen |
| **3. Session-Interruption** | `src/core/session-router.ts`, `src/core/routed-session.ts` | Mittel — `interruptAll()` im Router, `interrupt()` in `RoutedSession` (abort + Status-Tracking) |
| **4. Benachrichtigung nach Restart** | `src/gateway/server.ts` | Klein — nach `start()` die Liste der unterbrochenen Sessions iterieren und Service-Message emitieren |
| **5. Event-Typ für Outage** (optional) | `src/core/events.ts` | Klein — neuer `PiboOutputEvent`-Typ, falls UI das speziell stylen soll |
| **6. Testing** | | Mittel — Unit-Tests für Interruption, Integrationstest für Restart-Flow |

**Geschätzter Gesamtaufwand:** 1–2 Tage für einen erfahrenen Entwickler am Projekt.

---

## 7. Offene Entscheidungen vor der Umsetzung

1. **Soll Gentle Restart wirklich den Prozess neu starten?**
   - Wenn ja: Wir müssen akzeptieren, dass Queues verloren gehen und nur SQLite-Sessions überleben. Oder wir bauen Queue-Persistenz.
   - Wenn nein (In-Process reicht): Deutlich einfacher, Sessions bleiben komplett erhalten.

2. **Soll die Usermeldung als normale Service-Message erscheinen oder als spezieller System-Event?**
   - Normale Message: Funktioniert sofort in allen Channels (Chat-Web, TUI, etc.)
   - Spezieller Event: Bräuchte UI-Anpassungen, wäre aber visuell markierbar

3. **Sollen auch Subagent-Sessions benachrichtigt werden oder nur Haupt-Sessions?**
   - Subagenten laufen oft im Hintergrund und haben keinen direkten User-Kontakt

---

## 8. Verwandte Dokumente

- `plans/gateway-restart-review.md` – Review des bereits implementierten Basis-Restarts
