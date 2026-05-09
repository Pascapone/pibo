# Implementationsplan: Chat Notifications und Session-Signale härten

Datum: 2026-05-06

## Ziel

Pibo braucht ein zuverlässiges Notificationssystem, das Chat Web, spätere Push-Notifications und weitere Clients aus denselben produktsemantischen Events bedienen kann.

Die Session-Lampe und Unread-Zustände dürfen nicht von technischen Runtime-Details abhängen. Sie müssen aus stabilen Gateway-/Chat-Events abgeleitet werden:

- Assistant-Turn gestartet
- Assistant-Turn abgeschlossen
- Assistant-Turn fehlgeschlagen
- Antwort wurde gelesen

## Problemzusammenfassung

Die bisherigen Fehler hatten drei Ursachen:

1. **Falsche Statusquelle:** Die Session-Lampe nutzte Runtime-Status wie `processing`, Queue-Zustand und aktive Tools. Diese Signale beschreiben den Agent-Prozess, nicht den sichtbaren Assistant-Turn.
2. **Defekte Turn-Korrelation:** `assistant_message` und `message_finished` wurden im Chat Event Log mit unterschiedlichen Event-IDs gespeichert. Dadurch konnte das System abgeschlossene Antworten nicht zuverlässig als unread erkennen.
3. **Zu grobes Mark-as-read:** Bootstrap mit `markRead=true` markierte ganze Räume und alle Raum-Sessions gelesen. Hintergrund-Antworten konnten dadurch sofort wieder verschwinden.

## Architekturentscheidung

Notification-Zustand wird produktsemantisch geführt.

Primäre Events:

- `message_started` -> Session läuft
- `assistant_message` + passendes `message_finished` -> abgeschlossene Assistant-Antwort
- `message_finished` -> Session nicht mehr running
- `session_error` -> Session error
- explizites Mark-as-read -> unread löschen

Runtime-Status bleibt Debug- und Operator-Information. Er darf die sichtbare Notification-Semantik nicht dominieren.

## Phase 1: Server-Statusquelle korrigieren

### Änderungen

- `buildSessionNodes()` entfernt Runtime-Status aus der Statusberechnung.
- `sessionNodeStatus()` gibt nur noch den Read-Model-Status zurück.
- Gateway-/Runtime-Status bleibt weiterhin über Status-Actions und Debug-Pfade verfügbar.

### Dateien

- `src/apps/chat/trace.ts`
- `src/apps/chat/web-app.ts`

### Akzeptanzkriterien

- Nach `message_finished` ist die Session `idle`, auch wenn `runtimeStatus.processing` noch kurz `true` ist.
- `session_error` bleibt rot.
- Queue-/Tool-Status macht die Sidebar nicht dauerhaft grün.

### Tests

- Unit-Test: Session mit `message_started` + `message_finished` bleibt `idle`, obwohl Runtime-Status `processing=true` meldet.

## Phase 2: Turn-Korrelation für Unread reparieren

### Änderungen

- `ChatEventLog.appendOutputEvent()` speichert Events eines Turns mit derselben Korrelations-ID:
  - vorher: `pibo:<session>:<eventId>:<eventType>`
  - nachher: `pibo:<session>:<eventId>`
- `countUnreadMessages()` zählt `assistant_message` nur, wenn ein passendes `message_finished` existiert.

### Dateien

- `src/apps/chat/event-log.ts`
- `test/chat-rooms-event-log.test.mjs`

### Akzeptanzkriterien

- Eine unfertige Assistant-Antwort zählt nicht als unread.
- Eine fertige Assistant-Antwort zählt genau einmal als unread.
- Mark-as-read löscht den unread-Zustand für diese Session.

### Tests

- `assistant_message` ohne `message_finished` -> unread `0`
- `assistant_message` mit passendem `message_finished` -> unread `1`
- nach `markSessionRead()` -> unread `0`

## Phase 3: Mark-as-read enger schneiden

### Änderungen

- Bootstrap mit `markRead=true` markiert nur die ausgewählte Session gelesen.
- Room-Unread wird aus Session-Unread aggregiert, nicht aus einem unabhängigen Room-Cursor.
- Hintergrund-Sessions behalten ihre unread Notification, bis der Nutzer sie öffnet.

### Dateien

- `src/apps/chat/web-app.ts`
- `test/web-channel.test.mjs`

### Akzeptanzkriterien

- Öffnen von Session A löscht nicht die unread Notification von Session B.
- Raum-Badge zeigt die Summe unread Sessions.
- Auswahl von Session B löscht deren unread Zustand.

### Tests

- Parent geöffnet, Child erhält zwei fertige Antworten.
- Bootstrap mit Parent als selected session lässt Child unread bestehen.
- Room unread bleibt `2`.

## Phase 4: Client-Signal vereinfachen

### Ziel

Die Sidebar-Lampe soll nur noch folgende Zustände anzeigen:

1. `error` -> rot
2. `running` -> grün
3. `unreadCount > 0` -> blau
4. `lastActivityAt` innerhalb kurzem Fenster -> kurz blau
5. sonst -> grau

### Änderungen

- UI bleibt dünn und konsumiert Serverprojektion.
- Kein lokales Mischen mit Runtime-Status.
- SSE dient nur zum zeitnahen Refresh und zur Live-Trace-Aktualisierung.

### Dateien

- `src/apps/chat-ui/src/App.tsx`

### Akzeptanzkriterien

- Aktive Session: nach fertiger Antwort höchstens kurz blau, dann grau.
- Inaktive Session: nach fertiger Antwort dauerhaft blau bis Auswahl/Mark-as-read.
- Fehlerpfad bleibt rot.

## Phase 5: Debug- und Inspektionspfade ergänzen

### Ziel

Notifications müssen mit CLI und Gateway-Daten prüfbar sein, ohne Browser-Raten.

### Vorschlag

Neue Debug-Kommandos:

```text
pibo debug notifications <pibo-session-id>
pibo debug chat-unread <pibo-session-id>
pibo debug chat-events <pibo-session-id> --types assistant_message,message_finished,session_error
```

Ausgabe soll zeigen:

- aktueller Read-Model-Status
- Runtime-Status als Debug-Vergleich
- letzte relevanten Events
- unread cursor
- gezählte unread Nachrichten
- Grund für aktuellen Lampenstatus

### Akzeptanzkriterien

- Ein Operator kann erklären, warum eine Session grau, grün, blau oder rot ist.
- Debug-Ausgabe unterscheidet klar zwischen Produktstatus und Runtime-Status.

## Phase 6: Allgemeines Notification-Modell vorbereiten

### Ziel

Chat Web ist der erste Consumer. Das Modell soll später Push-Notifications, Desktop-Notifications, Mobile-Clients und weitere Services bedienen.

### Vorschlag

Eine zentrale Notification-Projektion einführen:

```ts
type PiboNotificationKind =
  | "assistant.completed"
  | "assistant.failed"
  | "run.completed"
  | "run.failed"
  | "handoff.requested";

type PiboNotification = {
  id: string;
  kind: PiboNotificationKind;
  ownerScope: string;
  piboSessionId: string;
  roomId?: string;
  eventId?: string;
  createdAt: string;
  readAt?: string;
  payload: Record<string, unknown>;
};
```

Diese Projektion sollte aus Gateway-/Chat-Events aufgebaut werden. Clients lesen daraus ihren Notification-Zustand. Transports wie Push oder WebSocket können denselben Zustand abonnieren.

### Akzeptanzkriterien

- Eine abgeschlossene Assistant-Antwort erzeugt genau eine Notification.
- Mehrere Clients sehen denselben Zustand.
- Read-State ist pro Principal/User getrennt.
- Push-Adapter kann später ohne Änderung der Chat-Logik angebunden werden.

## Verifikation

### Pflichtchecks

```bash
npx tsc -p tsconfig.json
node --test --test-name-pattern "chat event log counts only completed|session nodes use chat turn status|chat web app exposes unread|chat web app marks only the selected" \
  test/chat-rooms-event-log.test.mjs \
  test/chat-trace.test.mjs \
  test/web-channel.test.mjs
```

### Docker-Check

```bash
pibo compute spawn --name notifications-debug
curl http://127.0.0.1:<webPort>/health
pibo compute release notifications-debug
```

### Browser-E2E

1. Session A öffnen.
2. Session B erzeugen.
3. In Session B Antwort fertigstellen lassen, während Session A aktiv bleibt.
4. Erwartung: Session B blau, Session A nicht blau.
5. Session B öffnen.
6. Erwartung: Session B wird grau.
7. Fehlerlauf auslösen.
8. Erwartung: Session rot.

## Risiken

- Alte Events ohne konsistente Turn-ID können nicht immer korrekt nachträglich korreliert werden.
- Bei fehlendem `message_finished` bleibt unread absichtlich aus. Das vermeidet falsche Notifications, kann aber echte Antworten ohne Finish-Event verschlucken.
- Wenn ein Provider-/Runtime-Pfad kein `message_finished` emittiert, muss der Gateway dort ein Terminalevent erzwingen.

## Offene Folgearbeit

1. Debug-CLI für Notification-Erklärung bauen.
2. Browser-E2E mit echtem Providerlauf ergänzen.
3. Zentrale Notification-Projektion entwerfen und migrieren.
4. Push-/Multi-Client-Adapter erst nach stabiler Projektion anbinden.
5. Bestehende TypeScript-Fehler in `TerminalModelCard.tsx` separat beheben, damit `npm run typecheck` wieder vollständig grün wird.
