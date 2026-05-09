# Chat Statuslampen / Notifications – Analyse-Report

Datum: 2026-05-05

## Problem

Die Chat-Web-Session-Lampe verhält sich weiterhin falsch:

- Nach einer fertigen Assistant-Antwort pulsiert die Session teilweise weiter grün.
- Wenn man nicht auf der Session ist, wird die fertige Antwort nicht zuverlässig dauerhaft blau angezeigt.
- Wenn man auf der Session ist, soll sie höchstens kurz blau werden und dann wieder grau.
- Das Verhalten wirkt so, als ob der UI-Code zwar geladen ist, aber die zugrundeliegende Statusquelle nicht zuverlässig zur gewünschten Semantik passt.

## Was bereits verifiziert wurde

- Der aktuelle Fix wurde committed und gepusht:
  - `862f611 Fix chat session status lamps`
- Der Host-Gateway wurde deployed und läuft gesund:
  - `GET http://127.0.0.1:4788/health` → `{"status":"ok","mode":"main"}`
- Die ausgelieferte Chat-Web-App servt den neuen Bundle:
  - `assets/index-CSeZznIr.js`
- Im Docker-Worker konnte der Fehlerpfad getestet werden:
  - Bei fehlendem API-Key wurde die Lampe korrekt rot (`session-signal-error`).
- Ein erfolgreicher echter Modelllauf konnte im Docker-Worker nicht vollständig getestet werden, weil dort kein Provider/API-Key verfügbar war.

## Wichtige Erkenntnisse

### 1. Die aktuelle Architektur mischt zwei verschiedene Bedeutungen von „running“

Es gibt mindestens zwei verschiedene Konzepte:

1. **Runtime/Agent-Prozess läuft noch**
   - z.B. `processing`, `streaming`, `activeTools`, Queue-Zustand.
2. **User-visible Assistant-Turn läuft noch**
   - aus Chat-/SSE-Events: `message_started`, `assistant_delta`, `message_finished`, `RUN_FINISHED`, `RUN_ERROR`.

Die UI-Lampe soll eigentlich das zweite Konzept anzeigen: Ist der sichtbare Assistant-Turn noch aktiv?

Aktuell wird aber auch Runtime-Status in die Session-Nodes gemerged. Wenn dieser länger auf `processing`/`running` bleibt oder nicht sauber zurückgesetzt wird, überschreibt er den eigentlich gewünschten UI-Zustand. Das erklärt, warum die Lampe nach fertiger Antwort weiter grün bleiben kann.

### 2. `runtimeStatus.streaming` war besonders verdächtig

Es wurde bereits versucht, `runtimeStatus.streaming` nicht mehr als grünes Signal zu verwenden, weil es nach Fehlern/Turns hängen bleiben kann. Trotzdem kann `processing` noch ähnlich problematisch sein.

### 3. Read-Model-Status kann durch Bootstrap/Indexing überschrieben werden

Es gab Hinweise, dass `upsertSession()` beim Bootstrap/Indexing den gespeicherten Status wieder auf `idle` setzen kann, auch wenn vorher `error` oder ein anderer Status gesetzt wurde. Das wurde teilweise verbessert, aber es zeigt, dass Status über mehrere Wege geschrieben wird und dadurch fragil ist.

### 4. Unread-Counting wurde schon korrigiert, aber löst nicht das grüne Pulsieren

Unread Assistant Messages sollen nur zählen, wenn eine passende `message_finished` existiert. Diese Logik wurde wiederhergestellt. Das hilft gegen premature Notifications, erklärt aber nicht allein das dauerhaft grüne Signal.

## Vermutung zur Hauptursache

Die Hauptursache ist wahrscheinlich, dass die Session-Lampe eine zu niedrige/technische Statusquelle nutzt:

> Live Runtime Status wird als „grün/running“ interpretiert, obwohl die gewünschte Produktsemantik „sichtbarer Assistant-Turn läuft“ ist.

Wenn der Runtime-Status nicht exakt synchron zum Ende der Chat-Antwort ist, bleibt die Lampe grün.

## Empfohlene Vereinfachung

Die Statuslampe sollte client-/eventbasiert und produktsemantisch geführt werden:

- Grün ab:
  - `message_started` / `RUN_STARTED`
- Grün aus bei:
  - `message_finished` / `RUN_FINISHED` / `RUN_ERROR`
- Rot bei:
  - `RUN_ERROR` / `session_error`
- Blau bei:
  - fertiger Assistant-Antwort nach `message_finished`, wenn Session nicht gelesen ist
- Wenn die Session gerade offen/aktiv ist:
  - Blau nur kurz, z.B. 3 Sekunden, danach grau
- Wenn die Session nicht aktiv ist:
  - Blau dauerhaft bis Mark-as-read / Auswahl der Session

Wichtig: Runtime-Prozessstatus sollte dafür nicht mehr die primäre Quelle sein. Er kann separat als Debug-Info bleiben, aber nicht die Lampe dominieren.

## Nächster sinnvoller Schritt

Eine kleine, explizite UI-State-Maschine einführen:

```text
idle -> running -> recent-completed/read-unread -> idle
               \-> error
```

Diese State-Machine sollte aus den Chat/SSE-Terminalevents aktualisiert werden und nicht direkt aus `RoutedSession.getStatus()` abgeleitet werden.

## Offene Fragen

- Gibt es bei erfolgreichen Modellläufen tatsächlich immer ein zuverlässiges `message_finished` oder `RUN_FINISHED` Event?
- Wird `markRead=true` beim aktiven Session-Wechsel und Bootstrap zuverlässig ausgelöst?
- Soll blau für aktive Sessions exakt 3 Sekunden sichtbar bleiben oder nur bis zum nächsten Bootstrap-Refresh?
