# Test-Review: Signal Registry und Chat-Signal-API

Lauf: 2026-05-10 15:19 Europe/Berlin  
Bereich: `src/signals/*`, Chat-Web-Signal-Endpunkte und UI-Signal-Overlay  
Ziel dieses Laufs: Bewerten, ob die vorhandenen Tests die Live-Status-Signale granular genug absichern, ohne in breite Chat-Web- oder Browser-Suites auszuweichen.

## Betrachtete Dateien

Code:

- `src/signals/registry.ts`
- `src/signals/projector.ts`
- `src/signals/aggregate.ts`
- `src/signals/types.ts`
- `src/apps/chat/web-app.ts` — Signal-Routen `/api/chat/signals/*`, Bootstrap-/Navigation-Overlay
- `src/apps/chat-ui/src/api.ts` — Signal-Fetch/SSE-Client
- `src/apps/chat-ui/src/App.tsx` — Signal-Snapshot-/Patch-Anwendung auf Navigation/Bootstrap

Tests:

- `test/signal-registry.test.mjs`
- `test/chat-signals-api.test.mjs`

Ausgeführter begrenzter Check:

```bash
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs
```

Ergebnis: 22 Tests bestanden, Dauer ca. 4,0 s.

## Kurzfazit

Die Signal-Tests sind ein gutes Beispiel für ein sinnvolles, entwicklungsnahes Subset: `test/signal-registry.test.mjs` prüft den reinen Projektor-/Registry-Kern ohne Web-Host, während `test/chat-signals-api.test.mjs` gezielt die HTTP-/SSE-Verfügbarkeit, Ownership und das Chat-Navigationsoverlay abdeckt. Das Subset ist schnell genug für lokale Iteration und deckt mehrere historisch riskante Statusdrift-Fälle ab.

Die größten Lücken liegen nicht bei Basisstatus wie `running`, `idle` und `error`, sondern bei Patch-Lücken, Cleanup-Randfällen, Subtree-Ownership und UI-Patch-Recovery. Genau dort sollte die nächste Testarbeit granular ansetzen.

## Stärken der bestehenden Tests

### 1. Gute Trennung zwischen Kernlogik und Web-Integration

`test/signal-registry.test.mjs` testet `createPiboSignalRegistry()` direkt. Dadurch bleiben Statusaggregation, Patch-Versionierung, Pruning und Event-Projektion unabhängig vom Chat-Web-Host prüfbar.

`test/chat-signals-api.test.mjs` startet dagegen einen kleinen Web-Host mit Fake-Auth, In-Memory-Session-Store und realem Chat-Web-App-Handler. Das ist breiter, aber noch kontrolliert und deutlich kleiner als eine Browser- oder Deployment-Suite.

Bewertung: Diese Aufteilung ist sinnvoll und sollte als Muster für weitere testbare Subsysteme gelten.

### 2. Relevante Statusdrift-Fälle sind bereits abgedeckt

Die Registry-Suite prüft unter anderem:

- aktive Descendants über drei Ebenen,
- aktive Tool-Calls in tiefen Child-Sessions,
- Fehlerpropagation von Child zu Root,
- Yielded-Run-Aktivität und Abschluss,
- idempotente Queue-Updates,
- monotone Patch-Versionen,
- Settlement von orphaned Tool-Signalen bei `message_finished` oder `processing=false`,
- Tool-Fehler ohne Runtime-Fehlerstatus,
- Deduplizierung identischer Fehler.

Das passt gut zum Risiko: Signal-Status ist abgeleitet, nicht die Quelle der Wahrheit. Tests müssen deshalb vor allem Drift und falsche Aggregation verhindern.

### 3. Chat-API-Test schützt wichtige Produktgrenzen

`test/chat-signals-api.test.mjs` prüft:

- Owner-Scope-Enforcement für Signal-Snapshots,
- Tree-Snapshot mit Descendants,
- SSE-Initialsnapshot plus monotone Patches,
- Bootstrap-Overlay für laufende Sessions,
- Navigation-Overlay nach Settling,
- Unread-Zählung für Fehler und fertige Nachrichten.

Das ist produktnah, ohne echte Auth, echte Gateway-Prozesse oder Browser-Automation zu benötigen.

## Schwächen und Risiken

### 1. Patch-Recovery im UI ist nur indirekt abgedeckt

`src/apps/chat-ui/src/App.tsx` verwirft einen Patch, wenn `current.rootPiboSessionId` nicht passt oder `current.version !== patch.fromVersion`. Danach lädt es per `fetchSignalTree()` neu. Diese Recovery ist für SSE-Verbindungsabbrüche oder verpasste Patches wichtig.

Aktuell sehe ich keinen gezielten Test für:

- Version-Gap im Client,
- falscher Root im Patch,
- erfolgreicher Re-Snapshot nach Gap,
- keine doppelte oder stale Bootstrap-Aktualisierung nach Recovery.

Das Risiko liegt im UI-Verhalten, nicht im Registry-Kern. Ein kleiner Unit-Test für `applySignalPatch` wäre ideal, aber die Funktion ist derzeit in `App.tsx` lokal und nicht separat exportiert.

Empfehlung: Die pure Patch-Anwendungslogik in ein kleines UI-Hilfsmodul auslagern und mit einem schnellen UI-Unit-Test prüfen. Keine Browser-Suite nötig.

### 2. Tree-Snapshot-Ownership prüft nur Root-Ownership, nicht gemischte Subtrees

Die API verlangt `requireOwnedSession(context, webSession, rootPiboSessionId)`. `snapshotSignalTree(root)` gibt dann den ganzen Registry-Tree zurück. Normalerweise sollte die Session-Hierarchie keine fremden Child-Sessions unter einem eigenen Root enthalten. Wenn aber Store-/Router-Daten inkonsistent werden, wäre unklar, ob die API fremde Descendants ausliefern würde.

Aktueller Test: fremder User auf Root erhält 404.  
Fehlender Test: eigener Root mit versehentlich fremdem Child im Tree.

Das muss nicht zwingend im Handler gefiltert werden, aber das erwartete Verhalten sollte festgelegt werden. Wenn die Invariante „ein Root-Tree hat immer einen Owner“ gilt, sollte ein Store-/Router-Test diese Invariante schützen.

### 3. `signal_node_pruned` kann entfernte Nodes nur über `removedNodeBelongsToRoot` zuordnen

`pruneTerminalNodes()` ruft `project({ type: "signal_node_pruned", nodeId })` auf. Der Patch enthält `removes`, und `registry.ts` muss nach dem Entfernen noch wissen, zu welchem Root der Node gehörte. Es gibt einen guten Test für einen normalen `turn`-Node.

Fehlende Randfälle:

- Pruning eines terminalen Child-Session-nahen Nodes in einem mehrstufigen Tree,
- Pruning eines Fehler-Nodes nach Error-TTL,
- Pruning darf Session-Snapshot-Aggregate nicht versehentlich stale lassen.

Empfehlung: In `test/signal-registry.test.mjs` 2-3 kleine Pruning-Tests ergänzen, nicht über Chat-Web.

### 4. Phase-Prioritäten sind nicht direkt getestet

`src/signals/aggregate.ts` enthält `phaseForStatus()`. Die vorhandenen Tests prüfen Aggregatstatus und Aktivität, aber kaum explizit die UI-relevante `phase`:

- Tool-Phase,
- Subagent-Phase,
- Yielded-Run-Phase,
- Compaction-Phase,
- Queue-vs-Running-Priorität.

Wenn UI später granularere Statusindikatoren anzeigt, kann eine Regression in `phaseForStatus()` unbemerkt bleiben, obwohl `running` weiter stimmt.

Empfehlung: Kleine reine Tests für `phase` im Registry-Test ergänzen. Das ist besser als ein breiter UI-Test.

### 5. SSE-Test prüft Happy Path, aber nicht Cleanup und Fehlerfälle

Der aktuelle SSE-Test liest zwei Events und cancelt den Reader. Das ist gut als Smoke-Test. Nicht geprüft werden:

- ob `unsubscribe` bei `cancel()` wirklich aufgerufen wird,
- ob fehlender `rootPiboSessionId` 400 liefert,
- ob fehlende Signal-Registry 503 liefert,
- ob Owner-Scope auch beim SSE-Endpunkt greift.

Diese Fälle sind klein und API-nah. Sie gehören in `test/chat-signals-api.test.mjs`, nicht in eine Browser-Suite.

## Fehlende oder anzupassende Tests

### A. Registry-Unit-Tests ergänzen

Empfohlene neue Tests in `test/signal-registry.test.mjs`:

1. `phase reflects active tool, subagent, run, and compaction nodes`
   - Eingaben: `message_started`, `tool_execution_started`, `subagent_session`, `run_changed`, `compaction_start` getrennt oder in kleinen Subtests.
   - Erwartung: `snapshot.sessions[root].phase` entspricht der stärksten aktiven Arbeitsart.

2. `pruning terminal child node recomputes ancestor snapshots`
   - Tree `root -> child`, Child erzeugt terminalen Turn/Tool-Node.
   - Nach Prune: Node entfernt, Root-/Child-Snapshots bleiben konsistent.

3. `error ttl pruning keeps session error until explicit session recovery or new lifecycle event`
   - Klärt gewünschtes Verhalten: Entfernt Pruning nur alte Node-Details oder auch sichtbare Error-Aggregate?
   - Falls der aktuelle Code anders arbeitet, Test als Designentscheidung nutzen.

### B. Chat-Signal-API-Tests ergänzen

Empfohlene neue Tests in `test/chat-signals-api.test.mjs`:

1. `signal SSE rejects missing rootPiboSessionId`
   - Erwartung: 400.

2. `signal SSE enforces root ownership`
   - Eigene Session anlegen, Request mit anderem `x-test-user`, Erwartung 404.

3. `signal routes return 503 when registry functions are unavailable`
   - Minimaler Host-Kontext ohne `snapshotSignalTree`/`subscribeSignalTree`.
   - Erwartung: 503 für Snapshot/SSE.

4. `SSE cancel unsubscribes listener`
   - Dafür müsste der Test-Helper Zugriff auf `signals.diagnostics()?.subscriberCount` nutzen.
   - Ablauf: EventSource/Fetch öffnen, Snapshot lesen, Reader canceln, kurzen Tick warten, SubscriberCount 0 erwarten.

### C. UI-Patch-Anwendung als eigenes Subset testbar machen

Derzeit sind `applySignalSnapshotToBootstrap`, `applySignalPatchToBootstrap` und `applySignalPatch` lokale Funktionen in `App.tsx`. Sie sind pure Transformationslogik, aber schwer gezielt testbar.

Empfehlung ohne große Refaktorierung:

- kleines Modul `src/apps/chat-ui/src/signal-state.ts` für diese Funktionen,
- Testdatei z. B. `test/chat-ui-signal-state.test.mjs` oder ein Vitest-/Node-kompatibles TS-Test-Setup, falls für UI-Helpers etabliert,
- Fälle: Snapshot aktualisiert Nested-Child, Patch-Version-Gap bleibt unverändert, Patch-Remove löscht Node, Patch-Upsert ersetzt Node, Statusmapping `error/running/idle`.

Das wäre ein sehr wertvolles granuläres Frontend-Subset und vermeidet Browser-E2E für reine Datenlogik.

## Empfohlene granulare Test-Kommandos

Für schnelle Entwicklung an der Signal-Registry:

```bash
npm run build -- --pretty false
node --test test/signal-registry.test.mjs
```

Wenn nur `dist` aktuell ist und keine TypeScript-Änderung stattfand:

```bash
node --test test/signal-registry.test.mjs
```

Für Chat-Web-Signal-Endpunkte ohne Browser:

```bash
node --test test/chat-signals-api.test.mjs
```

Für den kombinierten, noch kleinen Signal-Check:

```bash
node --test test/signal-registry.test.mjs test/chat-signals-api.test.mjs
```

Für spätere Absicherung nach Änderungen an `src/apps/chat-ui/src/App.tsx` oder `src/apps/chat-ui/src/api.ts` zusätzlich:

```bash
npm run chat-ui:typecheck
```

Nicht als Standard-Subset für diese Arbeit verwenden:

```bash
npm test
```

Begründung: `npm test` baut alles inklusive Web-UIs und startet alle Tests. Das ist als Integrations-/Pre-merge-Suite sinnvoll, aber für Signal-Registry-Iteration zu breit.

## Konkrete nächste Schritte

1. In `test/signal-registry.test.mjs` zuerst Phase-Tests ergänzen. Das ist die kleinste Lücke mit hohem Nutzen.
2. Danach in `test/chat-signals-api.test.mjs` SSE-Negativfälle ergänzen: fehlender Root, falscher Owner, fehlende Registry.
3. Anschließend prüfen, ob `signals.diagnostics()` im SSE-Cleanup-Test stabil genug ist, um Subscriber-Leaks granular zu testen.
4. UI-Patch-Transformationslogik aus `App.tsx` nur dann extrahieren, wenn ein kleiner Test dafür direkt mitkommt. Nicht als allgemeines UI-Refactoring starten.
5. Gemischte Owner-Subtrees als Produktinvariante klären: entweder Router/Store verhindert sie explizit, oder Signal-API filtert/verwahrt Descendants. Danach gezielten Test an der passenden Schicht schreiben.

## Bewertung der aktuellen Granularität

- `test/signal-registry.test.mjs`: sehr granular, schnell, sinnvoll für Kernlogik.
- `test/chat-signals-api.test.mjs`: mittlere Breite, aber noch entwicklungsfreundlich; guter API-Integrationscheck.
- Fehlendes Frontend-Subset: pure Signal-State-Transformationen in `App.tsx` sind aktuell nur über breitere App-Pfade indirekt geschützt.
- Browser-/Deployment-Checks sind für diesen Bereich erst nach UI-Änderungen nötig, nicht für Registry-/API-Kernarbeit.

## Umgesetzt am 2026-05-11 14:03 Europe/Berlin

- Bereich: Kleiner Registry-Unit-Subset für UI-relevante Signal-Phasen.
- Geänderte Dateien: `test/signal-registry.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1519-signal-registry.md`.
- Ausgeführte Kommandos: `node --test test/signal-registry.test.mjs`.
- Ergebnis: 21/21 Tests bestanden; abgedeckt sind Tool-, Subagent-, Yielded-Run-, Compaction- und Running-vs-Queued-Phasen.
- Verbleibende offene Punkte: Pruning-Randfälle, Chat-Signal-SSE-Negativfälle, SSE-Cleanup und UI-Patch-Transformationslogik bleiben offen.

## Umgesetzt am 2026-05-11 14:48 Europe/Berlin

- Bereich: Kleine Chat-Signal-SSE-Negativtests für fehlende Root-Session und Owner-Scope-Enforcement.
- Geänderte Dateien: `test/chat-signals-api.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1519-signal-registry.md`.
- Ausgeführte Kommandos: `node --test test/chat-signals-api.test.mjs`.
- Ergebnis: 9/9 Tests bestanden; abgesichert ist, dass `/api/chat/signals/events` ohne `rootPiboSessionId` mit 400 antwortet und fremde Roots mit 404 ablehnt.
- Verbleibende offene Punkte: Fehlende-Registry-503-Fälle, SSE-Cleanup/Unsubscribe, Pruning-Randfälle und UI-Patch-Transformationslogik bleiben offen.

## Umgesetzt am 2026-05-11 15:23 Europe/Berlin

- Bereich: Kleine Chat-Signal-API-Negativtests für fehlende Signal-Registry-Funktionen.
- Geänderte Dateien: `test/chat-signals-api.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1519-signal-registry.md`.
- Ausgeführte Kommandos: `node --test test/chat-signals-api.test.mjs`.
- Ergebnis: 10/10 Tests bestanden; abgesichert ist, dass Tree-Snapshot- und SSE-Endpunkt bei fehlender Signal-Registry mit 503 antworten.
- Verbleibende offene Punkte: SSE-Cleanup/Unsubscribe, Pruning-Randfälle und UI-Patch-Transformationslogik bleiben offen.
