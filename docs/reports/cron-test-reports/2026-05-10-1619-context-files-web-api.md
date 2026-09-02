---
type: "Research"
title: "Test-Review: Context-Files Web API und Revisionen"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/cron-test-reports/2026-05-10-1619-context-files-web-api.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "37cabcdb33554816c024b57bfb4fc356cac3a04e"
  source_bytes: 6987
  source_sha256: "62918b5b392ec8aa0662d918faab00a8ff18e9099cc85115efba33fdff885809"
  source_body_sha256: "62918b5b392ec8aa0662d918faab00a8ff18e9099cc85115efba33fdff885809"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Test-Review: Context-Files Web API und Revisionen

Datum: 2026-05-10 16:19  
Bereich: `src/plugins/context-files.ts`, `src/plugins/context-files-store.ts`, `src/apps/context-files-ui/src/api.ts`, `test/context-files-web.test.mjs`

## Fokus dieses Laufs

Geprüft wurde der schmale Web-API-/Store-Pfad für Context Files: Plugin-Dateien auflisten/lesen, in verwaltete Arbeitskopien linken, Revisionen erzeugen, Reset/Restore/Diff ausführen und Legacy-Indexdaten migrieren. Nicht geprüft wurden UI-Rendering, Browser-Interaktion und vollständige Web-Gateway-Deployments.

Ausgeführter begrenzter Check:

```bash
node --test test/context-files-web.test.mjs
```

Ergebnis: 2 Tests bestanden in ca. 0,3 s.

## Was die vorhandenen Tests gut abdecken

- `test/context-files-web.test.mjs` baut einen echten `createWebHostChannel` mit Fake-Auth und Plugin-Registry auf. Dadurch testet es mehr als reine Unit-Logik, bleibt aber klein und schnell.
- Der erste Test deckt einen wertvollen End-to-End-API-Fluss ab: Plugin-Datei listen, `link-from-plugin`, Arbeitskopie per `PUT` ändern, Plugin-Original unverändert lesen, Revision finden, Plugin-Quelle ändern, `linked-stale` erkennen, `reset-to-source`, `restore-revision` und `diff` prüfen.
- Der zweite Test prüft die Legacy-Migration aus `index.json` nach SQLite sowie das Orphan-Verhalten, wenn eine Plugin-Quelle verschwindet.
- Die Tests validieren zentrale Produktbegriffe aus dem Glossar sinnvoll: Context File, Plugin Context File, Managed Context File, Capability Catalog und Web App.

## Schwächen und Risiken

- Der Test ist als Web-App-Integrationstest nützlich, aber relativ breit. Es gibt keine kleinere Store-/Diff-Unit-Suite für `ContextFileMetadataStore`, `hashContextFileContent` und `buildContextFileDiff`. Entwickler müssen für reine Diff- oder Migrationsänderungen aktuell den Web-Host mitstarten.
- Viele API-Endpunkte aus `src/plugins/context-files.ts` und `src/apps/context-files-ui/src/api.ts` bleiben ungetestet:
  - `POST /api/context-files` für neu erstellte managed Dateien,
  - `PATCH /api/context-files/:key` für Label-/Scope-/Agent-Metadaten und Dateiverschiebung,
  - `DELETE /api/context-files/:key` mit `deleteFile: true/false`,
  - `POST /adopt-source`,
  - `GET /events` und Produkt-Event-Emissionen,
  - Fehlerpfade für ungültige Payloads, unbekannte Keys, fehlende Authentifizierung und Versionskonflikte.
- Optimistic-Concurrency ist nur indirekt sichtbar. `update()` liefert bei abweichendem `expectedVersion` einen `409` mit aktuellem Dokument; dafür fehlt ein gezielter Regressionstest.
- Der Watcher-/SSE-Pfad ist ein Risikobereich: `startWatcher()` wird bei vielen API-Aufrufen gestartet, `eventStream()` abonniert Produkt-Events, und `poll()` unterscheidet `context-file.source_orphaned` von `context-file.external_updated`. Aktuell gibt es keinen kleinen Test, der Event-Abmeldung, Heartbeat-freie Produkt-Events oder externe Dateiänderungen deterministisch prüft.
- Die Tests importieren aus `dist/`. Das ist konsistent mit vielen Projekt-Tests, bedeutet aber: nach Änderungen an `src/plugins/context-files*.ts` braucht man vor dem Subset einen Build oder mindestens einen aktuellen `dist`-Stand. Sonst kann ein grüner Test veralteten Build-Code prüfen.

## Fehlende oder anzupassende Tests

Empfohlene zusätzliche kleine Subsets:

1. **Store-/Diff-Unit-Test** `test/context-files-store.test.mjs`
   - `buildContextFileDiff()` für identische Inhalte, reine Additions, reine Removals, ersetzte mittlere Zeilen und trailing-newline-Fälle.
   - `ContextFileMetadataStore` mit temporärer SQLite-Datei: `createFile`, `appendRevision`, `listRevisions`, `deleteFile`, Legacy-Migration mit agent-scope und fehlender Datei.

2. **API-Fehlerpfade** als Erweiterung von `test/context-files-web.test.mjs`
   - `PUT` mit falschem `expectedVersion` ergibt `409` und gibt das aktuelle Dokument zurück.
   - Agent-scope ohne `agentProfileName` ergibt `400` für `POST`, `PATCH` und `link-from-plugin`.
   - Nicht-authentifizierter Request auf `/api/context-files` ergibt Auth-Fehlerstatus.

3. **Managed-Datei-Lifecycle** als eigener Test im bestehenden Web-Test
   - `POST /api/context-files` erstellt eine managed-unlinked Datei.
   - `PATCH` benennt sie um oder verschiebt sie in einen agent-spezifischen Ordner.
   - `DELETE` mit `deleteFile:false` entfernt Registry-/Store-Eintrag, lässt die Datei aber auf Disk.

4. **Event-/Watcher-Subset** separat und klein halten
   - Nicht als Browser-E2E beginnen. Besser einen Web-Host starten, `subscribeProductEvents` instrumentieren, Datei auf Disk ändern und nach einem kurzen Poll-Fenster genau ein `context-file.external_updated` oder `context-file.source_orphaned` prüfen.
   - Falls Polling im Test zu fragil wird, sollte die Watcher-Logik zuerst über eine injizierbare Poll-Funktion testbarer gemacht werden; das wäre aber eine spätere Code-Änderung, nicht Teil dieses Cron-Laufs.

## Empfohlene granulare Test-Kommandos

Schnell während Entwicklung am Context-Files-API-Pfad:

```bash
npm run build
node --test test/context-files-web.test.mjs
```

Falls ein dedizierter Store-Test ergänzt wird:

```bash
npm run build
node --test test/context-files-store.test.mjs test/context-files-web.test.mjs
```

Für UI-API-Typänderungen zusätzlich, aber erst nach dem schnellen API-Subset:

```bash
npm run context-files-ui:typecheck
```

Breitere Prüfung erst später im Flow:

```bash
npm run typecheck
npm test
```

## Konkrete nächste Schritte

- Einen kleinen `context-files-store.test.mjs` ergänzen, damit Diff- und SQLite-Migrationslogik ohne Web-Host geprüft werden kann.
- `context-files-web.test.mjs` um einen Versionskonflikt-Test erweitern; das ist der wichtigste fehlende API-Regressionsschutz, weil der Editor in der UI mit `expectedVersion` speichert.
- Danach Lifecycle-Abdeckung für `POST`/`PATCH`/`DELETE` hinzufügen, aber als separaten Testfall, damit der bestehende Plugin-Link-Test lesbar bleibt.
- Event-/Watcher-Abdeckung erst angehen, wenn eine deterministische Strategie vorliegt; Polling-Tests dürfen nicht zu einem fragilen Standard-Subset werden.

## Umgesetzt am 2026-05-11 14:59 Europe/Berlin

- Bereich: API-Fehlerpfad für Optimistic-Concurrency beim Speichern verwalteter Context Files.
- Geänderte Dateien: `test/context-files-web.test.mjs`, `docs/reports/cron-test-reports/2026-05-10-1619-context-files-web-api.md`.
- Ausgeführte Kommandos: `npm run build && node --test test/context-files-web.test.mjs` (zunächst wegen zu strenger Fehlermeldungs-Erwartung fehlgeschlagen); danach `node --test test/context-files-web.test.mjs`.
- Ergebnis: Der neue `PUT`-Konfliktfall erwartet `409`, die aktuelle Datei im Response-Body und keine Überschreibung der bestehenden Arbeitskopie; final 2/2 Tests bestanden.
- Verbleibende offene Punkte: Store-/Diff-Unit-Test, Agent-Scope-Validierungsfehler, unauthentifizierte Requests, Managed-Datei-Lifecycle und Event-/Watcher-Subset bleiben offen.
