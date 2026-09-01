---
type: "Research"
title: "Cron Scheduler Core Follow-up Test Review"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/cron-test-reports/2026-05-10-1718-cron-scheduler-core.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "2ef7c2744db2e35783bd8c3258e14935cc2ab29c"
  source_bytes: 8884
  source_sha256: "ac89e6fc3d25a6c0abafa1218bdf48045c8de3e63a48ae8d15b2215444e9689c"
  source_body_sha256: "ac89e6fc3d25a6c0abafa1218bdf48045c8de3e63a48ae8d15b2215444e9689c"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Cron Scheduler Core Follow-up Test Review

Datum: 2026-05-10 17:18 Europe/Berlin  
Bereich: Cron-Scheduler-Kern nach dem API-/Schedule-Erstreview: `PiboCronStore`, `PiboCronService`, Status-/Recovery-Flows und Granularität der vorhandenen Cron-Tests

## Untersuchte Dateien

- `GLOSSARY.md`
- `package.json`
- `test/cron-schedule-store.test.mjs`
- `src/cron/schedule.ts`
- `src/cron/store.ts`
- `src/cron/service.ts`
- `src/cron/cli.ts`
- `src/cron/types.ts`
- Frühere Reports:
  - `docs/reports/cron-test-reports/2026-05-10-1338-cron-schedule-store.md`
  - `docs/reports/cron-test-reports/2026-05-10-1438-chat-cron-api.md`

## Ausgeführter begrenzter Check

```bash
node --test test/cron-schedule-store.test.mjs
```

Ergebnis: 7 Tests bestanden in ca. 0,41 s. Kein Komplettlauf, weil dieser Lauf gezielt den Cron-Scheduler-Kern bewertet und keine Build-/Deployment-Suite validieren soll.

## Was bereits gut funktioniert

- `test/cron-schedule-store.test.mjs` ist klein, schnell und deckt die wichtigste Smoke-Kette ab: Schedule-Berechnung, Store-Erzeugung, Fälligkeitsreservierung, Abschluss eines `at`-Jobs und CLI-Erzeugung/-Editierung.
- Die Store-Tests nutzen `PiboCronStore({ path: ":memory:" })`; das ist ein gutes Muster für schnelle, isolierte SQLite-Tests ohne globale `.pibo`-Seiteneffekte.
- Die CLI-Tests verwenden temporäre Store-Dateien und `--json`. Dadurch prüfen sie reale Command-Parsing- und Persistenzpfade, nicht nur interne Hilfsfunktionen.
- `src/cron/store.ts` kapselt Reservierung und Abschluss transaktional mit `BEGIN IMMEDIATE`; genau diese Logik ist wertvoll, weil sie Doppelstarts verhindern soll.
- `src/cron/service.ts` ist fachlich klar getrennt: Tick/Reservierung, Zielauflösung, Session-Erzeugung und Abschlusslogik liegen in unterscheidbaren Methoden. Das erleichtert spätere schmale Tests mit Fake-`PiboChannelContext`.

## Schwächen und Risiken

1. **Der aktuelle Cron-Test ist ein kombinierter Smoke-Test statt ein echtes TDD-Subset.**  
   Eine Datei mischt pure Schedule-Logik, SQLite-Store und `dist`-CLI. Für schnelle Entwicklung an `src/cron/schedule.ts` ist das unnötig breit; für CLI-Sicherheit ist es dagegen sinnvoll. Diese Rollen sollten in den Empfehlungen getrennt bleiben.

2. **`dist`-Abhängigkeit kann Source-Änderungen verdecken.**  
   `test/cron-schedule-store.test.mjs` importiert `../dist/cron/schedule.js`, `../dist/cron/store.js` und startet `dist/bin/pibo.js`. Ohne vorheriges `npm run build` testet der Check potentiell alten Code. Das ist als Paket-Smoke gut, aber als unmittelbarer Entwicklungscheck riskant.

3. **Store-Lifecycle nach Fehlern ist weiter untertestet.**  
   `completeRun()` setzt `runningAt`, `nextRunAt`, `lastStatus`, `lastError`, `lastPiboSessionId`, `consecutiveErrors`, deaktiviert erfolgreiche `at`-Jobs und löscht optional `deleteAfterRun`-Jobs. Der bestehende Test prüft nur den erfolgreichen `at`-Abschluss. Besonders Scheduler-Stabilität hängt aber an Fehler- und Wiederholungsfällen.

4. **Aktivierte `at`-Jobs ohne zukünftigen Lauf bleiben als Randfall unklar.**  
   `createJob()` lehnt aktivierte vergangene `at`-Schedules ab. `updateJob()` kann dagegen bei einem `at`-Schedule mit vergangenem Zeitpunkt einen enabled Job mit `state.nextRunAt === undefined` erzeugen, weil die Fehlerbedingung nur Nicht-`at`-Schedules betrifft. Das kann bewusst sein, sollte aber getestet oder geklärt werden, damit Status und UI keine scheinbar aktiven, nie laufenden Jobs anzeigen.

5. **Recovery ist kritisch, aber nicht getestet.**  
   `recoverInterruptedRuns()` soll alte laufende Jobs nach Gateway-Restart als Fehler abschließen. Ohne Test kann ein Refactor unbemerkt Jobs dauerhaft in `runningAt` hängen lassen. Das wäre für wiederkehrende Cron-Jobs schwerwiegender als ein einzelner CLI-Fehler.

6. **Service-Abschluss hängt an Event-Korrelation.**  
   `emitMessageAndWait()` wartet auf `message_finished` oder `session_error` mit passendem `piboSessionId` und internem Message-`eventId`. Diese Korrelation ist gut, aber fragil: Falsche Event-IDs müssen ignoriert werden, passende Fehler müssen den Run abschließen, Timeouts müssen deterministisch greifen. Dafür gibt es derzeit keine eigene Service-Suite.

## Fehlende oder anzupassende Tests

### 1. Neue schmale Source-nahe Schedule-Suite

Empfohlen: `test/cron-schedule.test.mjs`, idealerweise mit direktem Source-/tsx-Mechanismus oder nach klar dokumentiertem Build-Schritt. Fälle:

- `computeNextRunAt({ kind: "cron", expr: "*/15 * * * *" })` berechnet den nächsten Viertelstunden-Tick.
- Wochentag `7` wird wie Sonntag `0` behandelt.
- Range/Step-Ausdruck wie `10-20/5 8 * * 1-5`.
- Zeitzonenfall für `Europe/Berlin`, damit UTC-Ergebnis und lokale Wandzeit explizit sind.
- Invalid Cases: `24:00`, `0m`, `*/0 * * * *`, ungültige Zeitzone.

### 2. Neue Store-Lifecycle-Suite

Empfohlen: `test/cron-store-lifecycle.test.mjs` mit `:memory:`:

- Wiederkehrender `every`-Job: Reservierung + `completeRun(ok)` setzt neues `nextRunAt`, leert `runningAt`, lässt `enabled === true`.
- Fehlerabschluss: `completeRun(error)` setzt `lastStatus: "error"`, `lastError`, erhöht `consecutiveErrors` und räumt `runningAt`.
- Erfolgreicher Lauf nach Fehlern setzt `consecutiveErrors` wieder auf `0`.
- `deleteAfterRun` löscht nur erfolgreiche one-shot `at`-Jobs; Fehlerfälle bleiben sichtbar.
- `recoverInterruptedRuns()` markiert alte laufende Runs als Fehler und blockiert den Job nicht dauerhaft.
- `updateJob()` für vergangene `at`-Schedules: entweder erwartetes Ablehnen testen oder bewusst dokumentieren, dass enabled Jobs ohne `nextRunAt` erlaubt sind.

### 3. Service-Suite erst nach Store-Lifecycle, aber klein halten

Empfohlen: `test/cron-service.test.mjs` mit Fake-`PiboChannelContext` und temporärem Data-Store:

- `runJobNow()` reserviert einen manuellen Run und erzeugt eine Session mit `kind: "cron"`, `cronJobId`, `cronRunId` und `chatRoomId`.
- Passendes `message_finished` markiert den Run als `ok` und speichert `piboSessionId`.
- Passendes `session_error` markiert den Run als `error`.
- Events mit falschem `eventId` oder falschem `piboSessionId` werden ignoriert.
- Timeout mit sehr kleinem `runTimeoutMs` ist deterministisch und räumt `runningAt` über `completeRun(error)`.

## Empfohlene granulare Test-Kommandos/Subsets

Aktuell sinnvoll, aber als post-build/Smoke zu verstehen:

```bash
npm run build && node --test test/cron-schedule-store.test.mjs
```

Für die nächste Entwicklungsgranularität nach Aufteilung:

```bash
node --test test/cron-schedule.test.mjs
node --test test/cron-store-lifecycle.test.mjs
```

Für Cron-Produktintegration vor Web-/Gateway-Flows:

```bash
npm run build && node --test \
  test/cron-schedule-store.test.mjs \
  test/cron-service.test.mjs \
  test/chat-cron-api.test.mjs
```

Später im Flow, wenn Gateway oder Chat-Web betroffen sind:

```bash
npm run build && node --test test/web-http.test.mjs test/web-gateway.test.mjs test/chat-ui-integration.test.mjs
```

## Konkrete nächste Schritte

1. `test/cron-store-lifecycle.test.mjs` als nächste Investition anlegen. Der größte ungedeckte Produktionswert liegt in Fehlerabschluss, Recovery und wiederkehrender Neuplanung.
2. Danach `test/cron-schedule.test.mjs` von CLI/SQLite trennen, damit Schedule-Änderungen ein sehr schnelles Unit-Subset haben.
3. Den Randfall `updateJob()` + vergangenes `at`-Schedule fachlich entscheiden: ablehnen wie `createJob()` oder in UI/Status klar als enabled ohne nächste Ausführung behandeln. Anschließend einen Test dafür ergänzen.
4. `test/cron-schedule-store.test.mjs` behalten, aber im Namen oder in Kommentaren als Build-/CLI-Smoke einordnen, nicht als alleinigen Cron-TDD-Check.
5. `test/cron-service.test.mjs` erst nach Store-Lifecycle ergänzen, damit Service-Tests nicht die Store-Details doppelt absichern müssen.

## Bewertung

Die Cron-Tests haben eine gute Basis, aber die Granularität ist noch nicht dort, wo Entwickler sie für sichere kleine Änderungen brauchen. Der nächste sinnvolle Schritt ist keine breite End-to-End-Suite, sondern zwei klare Subsets: pure Schedule-Unit-Tests und Store-Lifecycle-Tests. Danach kann eine kleine Service-Suite die Event-Korrelation und Zielauflösung absichern.

## Umgesetzt am 2026-05-11 15:18 Europe/Berlin

- Bereich: Neue Store-Lifecycle-Suite für Cron-Jobs mit wiederkehrender Neuplanung, Fehlerzähler-Reset, `deleteAfterRun`-Semantik und Recovery unterbrochener Läufe.
- Geänderte Dateien: `test/cron-store-lifecycle.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1718-cron-scheduler-core.md`
- Ausgeführte Kommandos: `npm run build && node --test test/cron-store-lifecycle.test.mjs`
- Ergebnis: Build erfolgreich; 4/4 Tests bestanden.
- Verbleibende offene Punkte: Service-Event-Korrelation und der Randfall `updateJob()` mit vergangenem `at`-Schedule sind weiterhin offen.
