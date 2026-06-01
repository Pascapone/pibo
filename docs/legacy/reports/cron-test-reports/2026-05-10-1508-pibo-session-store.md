# Test-Review: Pibo Session Store und Router-Store-Kopplung

Datum: 2026-05-10 15:08 Europe/Berlin  
Bereich: `PiboSessionStore`-Implementierungen, Persistenz-Migration und ausgewählte `PiboSessionRouter`-Store-Flows

## Untersuchte Dateien

- Code:
  - `src/sessions/store.ts`
  - `src/sessions/sqlite-store.ts`
  - `src/sessions/pibo-data-store.ts`
  - `src/core/session-router.ts`
- Tests:
  - `test/session-store.test.mjs`
  - `test/session-router-store.test.mjs`
  - `test/pibo-data-session-store.test.mjs`
- Projekt-/Kontext:
  - `GLOSSARY.md`
  - `package.json`
  - `docs/reports/cron-test-reports/README.md`

## Ausgeführte granulare Checks

```bash
node --test test/session-store.test.mjs test/session-router-store.test.mjs
node --test test/pibo-data-session-store.test.mjs
```

Ergebnis: Beide Subsets liefen erfolgreich durch. Das erste Subset bestand 14/14 Tests in ca. 5,5 s, das zweite 2/2 Tests in ca. 0,17 s.

## Was gut abgedeckt ist

1. **Produktidentität vs. Pi-Identität**  
   `test/session-store.test.mjs` prüft, dass `createPiboSession` eine opake `ps_...`-Produkt-ID und eine separate Pi-Session-ID erzeugt. Das passt zur Glossar-Trennung von Pibo Session ID und Pi Session ID.

2. **Basisvertrag des In-Memory-Stores**  
   Create, Update, `find`, Parent-Filter und Metadaten-Teilfilter sind klein und schnell getestet. Die Duplicate-Pi-Session-Abwehr ist explizit abgedeckt.

3. **SQLite-Basispersistenz**  
   `SqlitePiboSessionStore` wird gegen echte temporäre SQLite-Dateien getestet. Der PIBO_HOME-Test ist besonders wertvoll, weil er verhindert, dass Produkt-Sessions versehentlich an `cwd` gebunden werden.

4. **Router-Store-Integration an kritischen Stellen**  
   `test/session-router-store.test.mjs` prüft praxisnahe Flüsse: Profilauswahl pro Pibo Session, Default-Workspace, Produkt-Model-Defaults, Pi-Package-Auswahl, Clone/Switch-Operationen und Kill-Verhalten für Child-Sessions und Runs.

5. **V2-Session-Store-Migration als eigenes kleines Subset**  
   `test/pibo-data-session-store.test.mjs` prüft strukturierte Felder und die Idempotenz von `pibo data migrate sessions-to-v2`. Das ist ein guter granularer Check für Migrationen, ohne die gesamte Data-V2-Suite zu starten.

## Schwächen und Risiken

1. **Store-Vertrag wird nicht systematisch zwischen Implementierungen verglichen**  
   Die drei Store-Implementierungen (`InMemoryPiboSessionStore`, `SqlitePiboSessionStore`, `PiboDataSessionStore`) teilen den `PiboSessionStore`-Vertrag, werden aber nicht mit einer gemeinsamen Contract-Testmatrix geprüft. Dadurch können Unterschiede unbemerkt bleiben. Beispiele:
   - `InMemoryPiboSessionStore.update` prüft Duplicate-`piSessionId` vor dem Update und liefert eine gezielte Fehlermeldung.
   - `SqlitePiboSessionStore.update` verlässt sich auf den SQLite-Unique-Constraint; das Verhalten und die Fehlermeldung sind nicht getestet.
   - `PiboDataSessionStore.update` hat wieder eine eigene Duplicate-Prüfung.

2. **`activeModel`-Filter ist nur indirekt und ungleichmäßig abgedeckt**  
   `SqlitePiboSessionStore.find` und `PiboDataSessionStore.find` pushen bei `activeModel` nur `IS NULL`/`IS NOT NULL` in SQL und filtern anschließend mit `matchesFindInput`. Das ist korrekt, aber regressionsanfällig. Der V2-Store testet Persistenz von `activeModel`, aber es fehlt ein gezielter Contract-Test für:
   - `find({ activeModel: { provider, id } })`
   - `find({ activeModel: null })`
   - Update von einem Modell auf ein anderes und anschließendem Filter.

3. **Null-/Unset-Semantik ist nicht vollständig abgesichert**  
   Die Stores verwenden `null` in `UpdatePiboSessionInput`, um Felder wie `parentId`, `originId`, `workspace`, `title` und `activeModel` zu löschen. Der aktuelle Test prüft das nur punktuell (`activeModel: null` im V2-Store). Besonders wichtig wären `parentId: null` und `originId: null`, weil die Router- und Trace-Hierarchie von dieser Semantik abhängt.

4. **`PiboDataSessionStore.delete` passt nicht sichtbar zur `deleted_at`-Filterlogik**  
   `PiboDataSessionStore.get/list/find` filtern `deleted_at IS NULL`, `delete` führt aber ein physisches `DELETE FROM sessions` aus. Das kann beabsichtigt sein, ist aber im Test nicht dokumentiert. Ein Test sollte klären, ob harte Löschung oder Soft-Delete der gewünschte Vertrag ist. Ohne Test bleibt ein späterer Wechsel riskant für Chat-Web-Read-Model, Migration und Debug-CLI.

5. **Router-Tests sind wertvoll, aber teilweise breit und runtime-nah**  
   `test/session-router-store.test.mjs` startet echte Runtimes und dauert dadurch mehrere Sekunden. Für Entwicklungs-Feedback ist das akzeptabel als mittleres Subset, aber nicht ideal als kleinster Store-Check. Einige Fälle könnten zusätzlich als reine Store-/Operation-Unit-Tests abgebildet werden, z. B. Derived-Session-Feldkopie bei Clone/Fork.

6. **Subagent-Session-Reuse mit `chatRoomId`-Backfill ist nicht gezielt getestet**  
   `src/core/session-router.ts` enthält in `resolveSubagentSession` eine Legacy-Kompatibilität: vorhandene Subagent-Sessions ohne `chatRoomId` werden mit dem Parent-`chatRoomId` aktualisiert. Dieser Migrations-/Kompatibilitätspfad ist wichtig für Chat Web, aber in den betrachteten Tests nicht direkt abgedeckt.

## Fehlende oder anzupassende Tests

### 1. Gemeinsame Store-Contract-Tests

Empfehlung: Eine kleine Helper-Funktion, die gegen Store-Factories läuft:

- `InMemoryPiboSessionStore`
- `SqlitePiboSessionStore(':memory:')` oder temp-file SQLite
- `PiboDataSessionStore(tempDbPath)`

Konkrete Contract-Fälle:

- create/get/list sortiert nach `updatedAt`
- duplicate `id`
- duplicate `piSessionId` bei create und update
- `parentId: null`, `originId: null`, `workspace: null`, `title: null`, `activeModel: null`
- `find` mit `ids: []`, `parentId: null`, `metadata`-Teilmatch, `activeModel` exakt und `activeModel: null`
- `delete`-Vertrag eindeutig: nach `delete` darf `get/find/list` die Session nicht mehr sehen; optional zusätzliche Prüfung, ob der Row physisch oder weich gelöscht werden soll.

### 2. Spezifischer SQLite-Migrations-/Schema-Test

`SqlitePiboSessionStore.ensureActiveModelColumn` ist vorhanden, aber nicht isoliert gegen ein altes Schema ohne `active_model_json` getestet. Ein gezielter Test sollte eine Legacy-Tabelle ohne Spalte anlegen, den Store öffnen und anschließend `activeModel` schreiben/lesen.

### 3. Router-Subagent-Session-Reuse-Test

Ein kleiner Router-Test sollte eine Parent-Session mit `metadata.chatRoomId` und eine existierende Legacy-Subagent-Session ohne `chatRoomId` vorbereiten. Danach sollte ein Subagent-Aufruf oder eine direkt testbare Extraktion prüfen, dass die bestehende Session wiederverwendet und mit `chatRoomId` aktualisiert wird. Falls `resolveSubagentSession` privat bleiben soll, kann der Test über ein Profil mit Subagent-Tool laufen; alternativ wäre eine kleine pure Funktion extrahierbar, aber das wäre eine Code-Design-Entscheidung für einen späteren Implementierungslauf.

### 4. Derived-Session-Feldkopie bei Fork/Clone granularer machen

Der bestehende Clone-Test ist gut, aber `session.fork` ist im betrachteten Subset nicht symmetrisch sichtbar. Ein zusätzlicher Test sollte prüfen, dass Fork und Clone beide `originId`, `originPiSessionId`, `ownerScope`, `workspace`, `title`, `activeModel` und Parent-Verhalten bei Subagent-Quellen korrekt setzen.

## Empfohlene granulare Test-Kommandos

Kleinster Store-Loop während Entwicklung:

```bash
node --test test/session-store.test.mjs
node --test test/pibo-data-session-store.test.mjs
```

Router-Store-Integrationsloop, wenn Session-Operationen, Profile oder Runtime-Session-ID betroffen sind:

```bash
node --test test/session-router-store.test.mjs
```

Gezielter kombinierter Check vor PR für diesen Bereich:

```bash
node --test \
  test/session-store.test.mjs \
  test/pibo-data-session-store.test.mjs \
  test/session-router-store.test.mjs \
  test/session-model-source-of-truth.test.mjs
```

Vollständige Suite erst später im Flow, weil `npm test` vorher baut und zusätzlich Web-UI-Builds ausführt.

## Konkrete nächste Schritte

1. Einen `PiboSessionStore`-Contract-Test-Helper anlegen und zuerst nur die bereits existierenden Fälle aus `test/session-store.test.mjs` darüber laufen lassen.
2. Danach die fehlenden Null-/Unset- und `activeModel`-Filterfälle ergänzen.
3. Das gewünschte Delete-Verhalten von `PiboDataSessionStore` explizit entscheiden und mit einem Test festhalten.
4. Einen schmalen Router-Test für Subagent-Session-Reuse mit Parent-`chatRoomId` hinzufügen.
5. `session-router-store` langfristig in schnellere pure Store-/Operationstests und wenige echte Runtime-Integrationstests aufteilen.

## Umgesetzt am 2026-05-11 15:39 Europe/Berlin

- Bereich: Gemeinsamer Store-Contract für Null-/Unset-Semantik und `activeModel`-Filter über In-Memory- und SQLite-Session-Stores.
- Geänderte Dateien: `test/session-store.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1508-pibo-session-store.md`.
- Ausgeführte Kommandos: `npm run build && node --test test/session-store.test.mjs`; `node --test test/session-store.test.mjs`.
- Ergebnis: Grün; 7 Tests bestanden. Abgedeckt sind `parentId`/`originId`/`workspace`/`title`-Clearing, `activeModel`-Setzen/Clearing sowie `find({ activeModel })`, `find({ activeModel: null })` und `find({ parentId: null })` für beide Stores.
- Verbleibende offene Punkte: `PiboDataSessionStore`-Contract-Matrix, Duplicate-`piSessionId`-Update-Verhalten, Delete-Vertrag, SQLite-Legacy-Schema-Migration und Router-Subagent-Session-Reuse bleiben offen.
