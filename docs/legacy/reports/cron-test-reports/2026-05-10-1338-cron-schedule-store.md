# Cron Schedule/Store Test Review

Datum: 2026-05-10 13:38 Europe/Berlin  
Bereich: Cron-Scheduling, Store-Reservierung und CLI-Basisflüsse

## Untersuchte Dateien

- `test/cron-schedule-store.test.mjs`
- `src/cron/schedule.ts`
- `src/cron/store.ts`
- `src/cron/cli.ts`
- `src/cron/service.ts`
- `src/cron/types.ts`
- `src/apps/chat/cron-api.ts`
- `package.json`

## Ausgeführter begrenzter Check

```bash
node --test test/cron-schedule-store.test.mjs
```

Ergebnis: 7 Tests bestanden in ca. 0,48 s. Das ist ein guter granularer Entwicklungs-Check für reine Cron-Domain-Änderungen, sofern `dist/` aktuell gebaut ist.

## Was die vorhandenen Tests gut abdecken

- `computeNextRunAt` wird für einmalige `at`-Schedules und anchored `every`-Schedules gezielt geprüft.
- `parseFriendlySchedule` hat mindestens einen Daily-Preset-Test, der die UI-nahe Eingabe in eine Cron-Expression übersetzt.
- `PiboCronStore.reserveDueRuns()` wird für einen wichtigen Kernfall geprüft: noch nicht fällig, einmalige Reservierung, keine Doppelreservierung, Abschluss eines `at`-Jobs.
- Owner-Scope-Isolation ist im Store-Basistest und in CLI-Erzeugungsflüssen sichtbar.
- Die CLI-Tests sind praxisnah: sie laufen über `node dist/bin/pibo.js`, temporäre SQLite-Dateien und JSON-Ausgaben statt nur über interne Funktionen.

## Schwächen und Risiken

1. **Cron-Expression-Logik ist untertestet.**  
   `src/cron/schedule.ts` enthält eigene Parser-/Matcher-Logik für Felder, Ranges, Steps, Wochentag `7 -> 0`, Zeitzonen und einen bis zu fünf Jahre langen Minuten-Scan. `test/cron-schedule-store.test.mjs` prüft aktuell keinen echten `computeNextRunAt({ kind: "cron" })`-Fall. Risiko: kleine Änderungen an Parser oder `Intl.DateTimeFormat`-Handling können erst in Produktion auffallen.

2. **Fehler- und Validierungsfälle fehlen fast vollständig.**  
   Beispiele: ungültige Dauer `< 1m`, ungültige Zeit `24:00`, ungültige Zeitzone, ungültiger Cron-Step, leerer Prompt/Profile/Target. Diese Regeln liegen in `src/cron/schedule.ts` und `src/cron/store.ts`, sind aber kaum explizit abgesichert.

3. **Store-Lifecycle nach Fehlern ist nur teilweise abgedeckt.**  
   `completeRun()` behandelt `ok`, `error`, `skipped`, `consecutiveErrors`, `lastError`, `lastPiboSessionId`, Delete-after-run und Re-Scheduling. Der Test prüft nur den erfolgreichen `at`-Abschluss ohne Delete-after-run. Besonders wichtig wären Error-Recovery und wiederkehrende Jobs, weil diese den Scheduler langfristig stabil halten.

4. **Service- und Web-API-Verhalten fehlt als eigene schmale Suite.**  
   `src/cron/service.ts` enthält kritische Produktintegration: Zielauflösung, Raumarchiv-Checks, Session-Erzeugung, Prompt-Building, Timeout/Error-Abschluss. `src/apps/chat/cron-api.ts` enthält Same-Origin-/Content-Type-Schutz, Profilauflösung, Zugriffsprüfung und Schedule-Normalisierung. Dafür wurde in der betrachteten Testsammlung kein dedizierter Cron-API- oder Cron-Service-Test gefunden.

5. **CLI-Tests hängen an `dist/`.**  
   Das ist für Paket-/Build-Nähe wertvoll, aber für schnelle TDD an `src/cron/*` riskant: Nach Source-Änderungen testet `node --test test/cron-schedule-store.test.mjs` ohne vorherigen Build potenziell alten Code. Diese Datei ist deshalb eher ein post-build Smoke-/Regressionstest als ein reiner Source-TDD-Test.

## Fehlende oder anzupassende Tests

Empfohlene kleine Tests, nicht als große Pauschalsuite:

1. **`test/cron-schedule.test.mjs` oder Erweiterung des bestehenden Tests**
   - Cron: `*/15 * * * *` berechnet die nächste Viertelstunde.
   - Cron: `0 8 * * 7` behandelt Sonntag wie `0`.
   - Cron: Range/Step, z. B. `10-20/5 8 * * 1-5`.
   - Zeitzone: Daily 08:30 `Europe/Berlin` ergibt für einen UTC-Referenzzeitpunkt den erwarteten nächsten UTC-Zeitpunkt.
   - Invalid cases mit `assert.throws`: `24:00`, `0m`, `*/0 * * * *`, falsche TZ.

2. **`test/cron-store-lifecycle.test.mjs`**
   - Wiederkehrender Job: `completeRun(ok)` setzt `nextRunAt` neu und lässt Job enabled.
   - Error-Fall: `completeRun(error)` räumt `runningAt`, setzt `lastStatus`, `lastError`, erhöht `consecutiveErrors` und plant wiederkehrende Jobs weiter.
   - Delete-after-run: erfolgreicher `at`-Job mit `deleteAfterRun` wird gelöscht.
   - `recoverInterruptedRuns()` markiert alte laufende Runs als Error.

3. **`test/cron-cli.test.mjs` gezielter aufsplitten**
   - Beibehalten: aktueller CLI-Smoke über `dist/bin/pibo.js`.
   - Ergänzen: schnelle Source-nahe Tests für reine Parser-/Store-Funktionen, damit Entwickler nicht immer Build + dist benötigen.

4. **`test/chat-cron-api.test.mjs` als schmale HTTP-Unit-Suite**
   - POST/PATCH ohne `Origin` oder mit falschem Content-Type schlägt fehl.
   - Personal target mit fremdem Principal gibt 403.
   - Room target ruft `requireRoomAccess(..., "write")` auf und lehnt archivierte Räume ab.
   - `GET /cron/runs?jobId=...` leakt keine fremden Jobs.

5. **`test/cron-service.test.mjs` mit Fake-ChannelContext**
   - `runJobNow()` reserviert manuell und erzeugt eine `kind: "cron"` Session mit `cronJobId`/`cronRunId`-Metadata.
   - `session_error` führt zu `completeRun(error)`.
   - Timeout kann über sehr kleines `runTimeoutMs` deterministisch geprüft werden.

## Empfohlene granulare Test-Kommandos/Subsets

Für schnelle Entwicklung an Cron-Schedule/Store:

```bash
npm run build && node --test test/cron-schedule-store.test.mjs
```

Nach Einführung source-naher Cron-Tests:

```bash
node --test test/cron-schedule.test.mjs
node --test test/cron-store-lifecycle.test.mjs
node --test test/chat-cron-api.test.mjs
```

Vor Integration in Web/Gateway-Flows:

```bash
npm run build && node --test test/cron-schedule-store.test.mjs test/web-http.test.mjs test/web-gateway.test.mjs
```

Gesamtlauf nur spät im Flow:

```bash
npm test
```

## Konkrete nächste Schritte

1. Einen kleinen `cron-schedule`-Testblock für echte Cron-Expressions und Invalid Cases ergänzen. Das ist die höchste Rendite, weil `computeNextCronRunAt()` aktuell viel Logik ohne direkte Regressionstests enthält.
2. Store-Lifecycle-Tests für wiederkehrende Jobs und Fehlerabschlüsse ergänzen. Das schützt die langfristige Stabilität geplanter Jobs.
3. Danach API-Tests für `src/apps/chat/cron-api.ts`, vor allem Same-Origin und Owner-Scope/Principal-Checks.
4. Optional den bestehenden `test/cron-schedule-store.test.mjs` in kleinere Dateien aufteilen: `schedule`, `store`, `cli`. Das macht TDD-Subsets klarer und verhindert, dass CLI-/dist-Abhängigkeiten reine Schedule-Tests verlangsamen.

## Bewertung

Die vorhandene Cron-Testdatei ist sinnvoll und schnell, aber noch eher ein kombinierter Smoke-Test. Für das Ziel granularer Entwicklungs-Subsets sollte der Bereich in drei Ebenen getrennt werden:

- pure Schedule-Unit-Tests ohne SQLite und ohne `dist`,
- Store-Lifecycle-Tests mit `:memory:` SQLite,
- CLI/API/Service-Integrationstests als spätere, etwas breitere Subsets.

## Umgesetzt am 2026-05-11 13:03 Europe/Berlin

- Bereich: Source-nahe Cron-Schedule-Regressionstests für echte Cron-Expressions und Validierungsfehler.
- Geänderte Dateien: `test/cron-schedule.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1338-cron-schedule-store.md`
- Ausgeführte Kommandos: `npm run build && node --test test/cron-schedule.test.mjs`
- Ergebnis: Build erfolgreich; 6 Cron-Schedule-Tests bestanden.
- Verbleibende offene Punkte: Store-Lifecycle-, Chat-Cron-API- und Cron-Service-Subsets aus diesem Report sind weiterhin offen.

## Umgesetzt am 2026-05-11 15:53 Europe/Berlin

- Bereich: Cron-Store-Validierung für Pflichtfelder und abgelaufene One-Shot-Schedules.
- Geänderte Dateien: `test/cron-store-lifecycle.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1338-cron-schedule-store.md`
- Ausgeführte Kommandos: `node --test test/cron-store-lifecycle.test.mjs`
- Ergebnis: Grün; 5 Cron-Store-Lifecycle-Tests bestanden.
- Verbleibende offene Punkte: Chat-Cron-API- und Cron-Service-Subsets aus diesem Report sind weiterhin offen; weitere Store-Lifecycle-Fälle können bei Bedarf separat ergänzt werden.
