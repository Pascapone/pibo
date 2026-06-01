# Test-Review: Run-Control und Reliability-Grenze

Datum: 2026-05-10 17:29 Europe/Berlin

## Untersuchter Bereich

Dieser Lauf prüft gezielt die Tests rund um Yielded Runs / Run-Control:

- `test/runs.test.mjs`
- `test/reliability-store.test.mjs` als angrenzender Persistenz-/Job-Queue-Bereich
- `test/session-router-store.test.mjs` nur die Abschnitte zu `killSession(..., { includeRuns })`
- Passender Code:
  - `src/runs/registry.ts`
  - `src/runs/tools.ts`
  - `src/core/session-router.ts`
  - `src/reliability/store.ts`

Bewusst nicht geprüft: vollständige Gateway-, Chat-UI- oder Deployment-Flows. Das wäre für diesen Lauf zu breit.

## Ausgeführte begrenzte Checks

```bash
node --test test/runs.test.mjs
node --test test/runs.test.mjs test/reliability-store.test.mjs test/session-router-store.test.mjs
```

Ergebnis: beide Checks grün. Der kombinierte Lauf hatte 26 bestandene Tests.

## Stärken der bestehenden Tests

- `test/runs.test.mjs` ist für Entwicklung gut granular: Die Datei trennt Registry-Verhalten, Tool-Wrapper und Router-Reminder. Einzelner Lauf dauert nur ca. 1,2 s und eignet sich als schnelles Feedback-Subset.
- Gute Abdeckung der wichtigsten Nutzerzustände für Run-Control:
  - tracked Runs erzeugen Benachrichtigungen bis `read`/`ack`.
  - detached Runs bleiben inspizierbar, ohne Reminder zu erzeugen.
  - `wait` behandelt Timeouts als normalen Zustand.
  - owner disposal cancelt laufende Runs und löst Waiter auf.
  - stale queued run notifications werden nach `read` aktualisiert.
- Die Router-Tests in `runs.test.mjs` verwenden bewusst kleine Fakes statt echte Runtime-/Gateway-Prozesse. Das hält die Tests schnell und zielgenau.
- `test/session-router-store.test.mjs` ergänzt sinnvoll die Semantik, dass `killSession` ohne `includeRuns` Runs nicht cancelt, mit `includeRuns` aber Parent- und Child-Runs rekursiv beendet.
- `test/reliability-store.test.mjs` prüft Job-Queue-Grundlagen wie Claim-Exklusivität, Retry, DLQ und Replay. Diese Tests sind wichtig, weil `PiboReliabilityStore.createRun()` intern einen Job erzeugt und claimt.

## Schwächen und Risiken

1. **Persistierter Run-Lifecycle ist nur indirekt getestet.**
   `src/runs/registry.ts` unterstützt einen optionalen `PiboReliabilityStore`. Der Konstruktor ruft `recoverInterruptedRuns()` auf und lädt gespeicherte Runs in Memory. `test/runs.test.mjs` nutzt aber fast ausschließlich eine In-Memory-Registry ohne Store-Fake oder echten `PiboReliabilityStore`. Dadurch bleiben folgende Pfade dünn:
   - `PiboRunRegistry` mit `options.store`
   - Wiederherstellung unterbrochener Runs
   - Persistenz von `notifiedStatus`, `acknowledgedStatus`, `consumed`, `completedAt`

2. **`recoverInterruptedRuns()` hat keine direkte Testabdeckung.**
   In `src/reliability/store.ts` unterscheidet die Methode zwischen retryable Runs (`queued`) und nicht retryable Runs (`failed` + DLQ). Die bestehenden Reliability-Tests prüfen Jobs und DLQ allgemein, aber nicht diese konkrete Run-Recovery-Semantik.

3. **Status `queued` ist im Run-Control-Verhalten kaum sichtbar.**
   `PiboRunStatus` erlaubt `queued`, und Recovery kann Runs darauf setzen. `test/runs.test.mjs` behandelt Reminder-Buckets aber praktisch als `running` für alle nicht-terminalen Zustände. Das ist technisch aktuell so implementiert, sollte aber explizit abgesichert werden, falls `queued` künftig UI- oder Agent-semantisch anders behandelt werden soll.

4. **Tool-Cancel bricht das zugrunde liegende Tool nicht aktiv ab.**
   `createRunToolController().cancelRun()` markiert die Registry als cancelled. Der gestartete `execute()`-Promise läuft aber weiter; ein späteres `complete()` wird wegen terminalem Status ignoriert. Diese Idempotenz ist gut, aber nicht explizit getestet. Ein kleiner Test könnte verhindern, dass spätere Änderungen cancelled Runs wieder überschreiben.

5. **Die Tool-Wrapper-Tests prüfen nur Happy Path und `isError`.**
   `src/runs/tools.ts` hat relevante Agent-facing Oberflächen für `pibo_run_list/status/wait/read/cancel/ack`. Aktuell testet `test/runs.test.mjs` vor allem `pibo_run_start`. Die anderen Tool-Definitionen werden über Registry/Router indirekt abgedeckt, aber nicht als Tool-Ausgabe mit `content`/`details`.

## Fehlende oder anzupassende Tests

Empfohlene kleine Ergänzungen, jeweils als einzelne `node:test`-Fälle:

1. **Registry + Store: persistierte Terminal-Consumption**
   - Datei: `test/runs.test.mjs` oder neue kleine Datei `test/runs-persistence.test.mjs`
   - Setup: `PiboReliabilityStore(":memory:")` an `PiboRunRegistry({ store })` übergeben.
   - Prüfen: start -> complete -> read -> neue Registry mit demselben Store -> Run ist mit `consumed: true` und Resultat sichtbar, wenn `includeConsumed` gesetzt ist.

2. **Recovery nicht retryable Run**
   - Datei: `test/reliability-store.test.mjs`
   - Setup: `store.createRun({ retryable: false })`, Claim künstlich ablaufen lassen oder Job-Claim freigeben/ablaufen lassen.
   - Prüfen: `recoverInterruptedRuns()` setzt Run auf `failed`, schreibt `completedAt`, verschiebt Job in DLQ.

3. **Recovery retryable Run**
   - Datei: `test/reliability-store.test.mjs`
   - Setup: `store.createRun({ retryable: true, maxAttempts: 2 })` mit abgelaufenem Claim.
   - Prüfen: `recoverInterruptedRuns()` setzt Run auf `queued` und Job wird wieder claimbar.

4. **Cancel gewinnt gegen spätes Complete**
   - Datei: `test/runs.test.mjs`
   - Setup: Run starten, `cancel`, danach `complete(runId, ...)` aufrufen.
   - Prüfen: Status bleibt `cancelled`, Result überschreibt den Cancel nicht.

5. **Tool-Oberflächen klein testen**
   - Datei: `test/runs.test.mjs`
   - Setup: leichter Controller-Fake.
   - Prüfen: `pibo_run_read`, `pibo_run_wait`, `pibo_run_ack` geben erwartete `details` zurück und formatieren Text nicht irreführend.

## Empfohlene granulare Test-Kommandos

Für schnelle Entwicklung am Run-Control-Code:

```bash
node --test test/runs.test.mjs
```

Für Änderungen an Run-Persistenz oder Recovery:

```bash
node --test test/runs.test.mjs test/reliability-store.test.mjs
```

Für Änderungen am Zusammenspiel mit Session-Router-Kill/Dispose:

```bash
node --test test/runs.test.mjs test/session-router-store.test.mjs
```

Erst später im Flow, nach gezielten grünen Subsets:

```bash
npm run typecheck
npm test
```

## Konkrete nächste Schritte

1. Zuerst zwei Recovery-Tests in `test/reliability-store.test.mjs` ergänzen: nicht retryable -> failed/DLQ, retryable -> queued/reclaimbar.
2. Danach einen Store-gebundenen Registry-Test ergänzen, damit `PiboRunRegistry({ store })` nicht nur über Code-Review, sondern auch über Verhalten abgesichert ist.
3. Anschließend einen Cancel-vs-late-complete-Test in `test/runs.test.mjs` hinzufügen.
4. Die Tool-Oberflächen (`pibo_run_read/wait/ack`) separat testen, aber klein halten; keine Gateway- oder Runtime-Prozesse dafür starten.

## Umgesetzt am 2026-05-11 10:17 Europe/Berlin

- Bereich: Run-Registry-Idempotenz für `cancel` gegen spätes `complete`.
- Geänderte Dateien: `test/runs.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `node --test test/runs.test.mjs` (zunächst fehlgeschlagen, weil `dist/` fehlte), `npm run build`, `node --test test/runs.test.mjs`.
- Ergebnis: Nach gezieltem Build grün; 12 Tests bestanden.
- Verbleibende offene Punkte: Persistenz-/Recovery-Tests für `PiboRunRegistry({ store })` und `recoverInterruptedRuns()` bleiben offen.

## Umgesetzt am 2026-05-11 11:34 Europe/Berlin

- Bereich: `recoverInterruptedRuns()` für nicht retrybare Runs mit abgelaufenem Job-Claim.
- Geänderte Dateien: `test/reliability-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `node --test test/reliability-store.test.mjs`.
- Ergebnis: Grün; 7 Tests bestanden.
- Verbleibende offene Punkte: Retryable-Recovery (`queued`/reclaimbar), Store-gebundener Registry-Roundtrip und Tool-Oberflächen-Tests bleiben offen.

## Umgesetzt am 2026-05-11 11:40 Europe/Berlin

- Bereich: `recoverInterruptedRuns()` für retrybare Runs mit abgelaufenem Job-Claim.
- Geänderte Dateien: `test/reliability-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `node --test test/reliability-store.test.mjs`.
- Ergebnis: Grün; 8 Tests bestanden.
- Verbleibende offene Punkte: Store-gebundener Registry-Roundtrip und Tool-Oberflächen-Tests bleiben offen.

## Umgesetzt am 2026-05-11 12:19 Europe/Berlin

- Bereich: Store-gebundener Registry-Roundtrip für konsumierte terminale Runs.
- Geänderte Dateien: `test/runs.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `npm run build`; `node --test test/runs.test.mjs`.
- Ergebnis: Grün; 13 Tests bestanden. Abgedeckt ist, dass `PiboRunRegistry({ store })` einen completed+read Run inklusive `consumed: true`, Resultat und unterdrückter Notification wiederherstellt.
- Verbleibende offene Punkte: Tool-Oberflächen-Tests für `pibo_run_read`/`wait`/`ack` bleiben offen.

## Umgesetzt am 2026-05-11 12:23 Europe/Berlin

- Bereich: Tool-Oberflächen für `pibo_run_read`, `pibo_run_wait` und `pibo_run_ack`.
- Geänderte Dateien: `test/runs.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `node --test test/runs.test.mjs`.
- Ergebnis: Grün; 16 Tests bestanden. Abgedeckt sind terminaler Read-Text mit Details, Wait-Timeout als normaler Zustand und Ack-Snapshot-Details.
- Verbleibende offene Punkte: Weitere Tool-Oberflächen wie `pibo_run_list`/`status`/`cancel` können bei Bedarf noch separat abgesichert werden.

## Umgesetzt am 2026-05-11 12:38 Europe/Berlin

- Bereich: Weitere Tool-Oberflächen für `pibo_run_list`, `pibo_run_status` und `pibo_run_cancel`.
- Geänderte Dateien: `test/runs.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1729-run-control-reliability.md`.
- Ausgeführte Kommandos: `node --test test/runs.test.mjs`.
- Ergebnis: Grün; 17 Tests bestanden. Abgedeckt sind Listenoptionen für konsumierte/detached Runs, Status-Text und Details sowie Cancel-Text mit konsumiertem Snapshot.
- Verbleibende offene Punkte: Keine priorisierten kleinen Tool-Oberflächen aus diesem Report bleiben offen; weitere Persistenz- oder Router-Szenarien wären separate neue Verbesserungsbereiche.

## Fazit

Das Run-Control-Testsubset ist aktuell eines der besseren granularen Subsets im Projekt: schnell, fokussiert und nah am Verhalten. Das größte Risiko liegt nicht in den In-Memory-Run-Zuständen, sondern an der Grenze zur Persistenz und Recovery. Genau dort sollten die nächsten Tests ergänzt werden, bevor größere Integrations- oder Deployment-Suites erweitert werden.
