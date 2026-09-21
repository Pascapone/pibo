---
type: "Validation Report"
title: "Beta4 build-gate closure: 22-plugin composition and isolated verification"
description: "Evidence for the 22-vs-21 build-gate repair and isolated verification runs at the code checkpoint commit."
tags: ["beta-4", "build", "test-report", "composition"]
status: "draft"
authority: "evidentiary"
generated:
  by: "muse-code/start-ready-session"
  at: "2026-09-21T08:11:10Z"
sources:
  - id: "suite-log"
    resource: "scope:ignored .pibo/planning/beta4-start-ready-20260921/logs/ at tested tree state"
    title: "Raw logs of the isolated verification runs"
  - id: "prior-run"
    resource: "scope:.pibo/planning/beta4-remote-integration-20260920/merge-cleanup-r1/tests.md"
    title: "Foreign prior run: exit 1 at the 22/21 gate, 0 tests"
  - id: "old-final-log"
    resource: "scope:ignored .pibo/planning/beta4-next-session-20260920/logs/npm-test-final.log (interrupted, no result)"
    title: "Old bundled run log without summary or exit code"
---

# Build-Gate-Abschluss: 22-Plugin-Komposition und isolierte Prüfung

> Stand: Fix-Commit `a6ef1a2f30d375f79d21e152e87a4d47f0f9bd6b`
> mit frischem Build und isolierter Pflichtmatrix daran (357/357 grün
> in 63 Dateien; Gateway-CLI separat 1/5). KEIN gebündelter Gesamtlauf.
> Keine Erfolgsbehauptung über das Gemessene hinaus.

## 1. Durchführung (serielle Isolationsläufe am Fix-Commit)

- Code-Commits: `9b23ef3b…` (14 Dateien: Komposition + Loader +
  Composer) und Fix-Commit `a6ef1a2f…` (5 Dateien: Store-Injection,
  Manifest, Async-Disposer, Lifecycle-Regression). Kein Push.
- Frischer Build exakt aus Fix-Commit (Pristine-Archivbaum, gleiche
  installierte Toolchain): 07:42:25→07:46:55Z, Exit 0
  (`fix2-build.log`). Standard-Package-Set `83c8471e…` (unverändert),
  Assembly-Manifest `608a2005…`, 27 Tarballs
  (`07-fix2-artifacts.sha256`). Ältere dist-Stände gelten NICHT als
  Buildherkunft.
- Runner: `node scripts/run-test-suite.mjs <Dateien>` (= isoliertes
  `node --test --test-concurrency=2`, eigenes HOME/PIBO_HOME/XDG).
- Umgebung: Node v24.21.0, npm 11.19.0, vorhandene `node_modules`
  (kein Install/Upgrade), 507 `test/*.test.mjs`-Dateien.
- Kurzes TMPDIR nur als Env-Workaround für eigene Prozesse (langer
  Runtime-TMPDIR sprengt das tsx-Pipe-Limit → EINVAL); kein Produktfix.
- Baum vor Docs-Commit: nur Doku-Dateien uncommittet; danach sauber
  (bis auf ignorierte Evidenz, kein Repo-Inhalt).
- Logs: `.pibo/planning/beta4-start-ready-20260921/logs/` (neue
  `fix2-*`-Logs; alte Baseline-Logs nicht überschrieben).

Läufe am Fix-Commit-Baum (UTC 21.09., frischer Build; echte Summaries):

| Lauf | Zeit | Exit | Ergebnis |
|---|---|---|---|
| frischer Build | 07:42:25→07:46:55Z | 0 | grün, 27 Tarballs |
| K06-Trio + Cutover + Lifecycle (5 Dateien) | 07:47:20→07:50:23Z | 0 | 21/21 |
| Remote-Agent (10 Dateien) | 07:50:33→07:52:09Z | 0 | 65/65 |
| Loops + Attachments (16 Dateien) | 07:52:15→07:53:33Z | 0 | 102/102 |
| Ralph/UI + Composer + Storage (13) | 07:53:39→07:53:51Z | 0 | 54/54 |
| B1/D1 + Loader + Composer-Rest (16) | 07:53:57→07:55:52Z | 0 | 84/84 |
| `typecheck` (alle 4 Schritte) | 07:55:58→07:56:39Z | 0 | 0 Fehler |
| Gateway-CLI-Nachprüfung (1 Datei) | 07:56:44→07:58:27Z | 1 | 1/5 |
| Runtime-Regressionen (3 Dateien) | 08:07:59→08:08:51Z | 0 | 31/31 |
| Lifecycle gehärtet (Repo-dist, hashgleich) | 08:07:09→08:07:52Z | 0 | 5/5 |

63 eindeutige Dateien (Liste `09-fix2-matrix-files.txt`, Duplikat-
und Existenz-geprüft); 357 ausgeführte Tests (Runner-Summaries inkl.
Subtests). Frühere Angabe „46 Dateien/326“ korrigiert (falsch summiert;
326 war die Teilsumme ohne Runtime-Regressionen bei ebenfalls falscher
Dateizahl). Die Lifecycle-Datei zählt einmal; ihre gehärtete Fassung
(`716847b8`) ist separat 5/5 auf hashgleichem dist verifiziert.

Frühere belegte Stände: 320/321 am Vor-Commit `9b23ef3b` (Cutover-Lock
dort gesperrt, Fix erst hier committen); Lock-Repro mit/ohne Injection;
Lifecycle Fail-First 3/5 auf void-Build (`lifecycle-5`), 5/5 nach Fix;
Loader-Basisvergleiche an pristine HEAD (Exit 1, vorbestehend).

Zählhinweis: Alle Zahlen sind echte Node-Summaries (`ℹ
tests/pass/fail`). Die `SUMS:`-Annotationszeilen in älteren Rohlogs zählen
Markierungszeilen und sind dort falsch; Mapping im Nachtrag
`.pibo/planning/beta4-start-ready-20260921/SUMS-CORRECTION.md`,
Rohlogs unverändert erhalten.

## 2. Ergebnis

- Am Fix-Commit: 357/357 Tests grün (63 Dateien), Build + Typen grün.
  Cutover-Lücke geschlossen: gepackte Strecke 1/1, Lifecycle 5/5
  (gehärtet: finally-Cleanup, Stop-Handshake, AggregateError-Nachweis).
- Separat rot: Gateway-CLI 1/5 (4× ~20-s-Timeout, 1× Pass bei 18,2 s).
- Buildkette frisch grün: Standard mit 22 Paketen, Candidate-Assembly
  mit 27 Artefakten (22 Plugins + Core/Cutover/Standard/2 Deps).
- Rotklassifikation (je belegt):
  - Gateway-CLI: 20-s-Readiness-Waits gegen ~18–50-s-Boot auf dieser
    Maschine; ein Grenz-Pass belegt Timing-Sensitivität. Plausibler
    Timingzusammenhang, kein universeller Ursachenbeweis, keine
    Timeouts/Assertions geändert. Owner I (Baseline), Pfad
    `test/gateway-web-cli.test.mjs`, Repro `fix2-7-gateway-cli.log`.
  - Loader-tsx-Defekt: Tests per dist-Import grün (6/6); der Defekt
    im tsx-Hook selbst bleibt Toolchain-Befund (I/B).
- Alter Lauf (20.09.): Start 17:29:57Z, Log endet 18:27Z mitten im Run
  (4424 Zeilen, 2990 ✔ / 23 ✖ bis Logende), keine Summary, kein
  Exitcode; Abbruchgrund unbekannt, kein Signal behauptet.
- NICHT geprüft: übrige ~460 Suite-Dateien (kein Gesamtlauf), F1–F7-
  Verhalten; daher kein `npm test grün`-Anspruch.

## 3. Geprüfte Komposition

- `standardPluginCoordinates()` (22) = literales Roster im Test
  `test/pibo4-standard-composition.test.mjs`, inkl. `pibo.remote-agent`.
- Gebautes `standard-package-set.json`: 22 Einträge, exakt gegen Autorität
  geprüft (frischer Hash `83c8471e…`); Standard mit 22 gebündelten
  Paketen; Candidate-Assembly mit 27 Tarballs (Manifest `608a2005…`).
- Negativtests: missing/unexpected/duplicate (Paket + Plugin-ID)/
  Version-Mismatch/malformed scheitern; Reihenfolge-unabhängiger
  Trefferfall besteht.
- Verhaltensassertions der Cutover-/Executable-Tests unverändert
  (Cron/Goal-Control installiert, Web-Search deinstalliert, Rest aktiv).

## 4. Zusatzbefunde (alle geschlossen oder echt geprüft)

- Cutover-Lock: BEHOBEN — Live-Store als `pibo.data.store` injiziert,
  Manifest deklariert, Async-Disposer wartet `service.stop()` ab und
  schließt nur den eigenen Store; Regression 5/5 mit Fail-First.
- TS2322 `composer-send.ts`: BEHOBEN per Owner-Guard + Regression;
  Typen am Fix-Commit Exit 0.
- `PIBO_TRACE_COMMIT` (`specs/data/storage-maintenance.md`): ECHT
  GEPRÜFT — alle 7 Evidenzpfade + 8 Symbole + 7 Testnamen vorhanden,
  Storage-Tests 10/10; `traceability.commit` auf geprüften Commit
  `9b23ef3b…` gebunden (Evidenzdateien dort identisch; alter Verweis
  `730cf01f…` existiert nicht, s. Update-Log).
- Datei-unverändert allein gilt nicht als Unabhängigkeitsbeweis; echte
  Ursache/Log/Test/Phase/Codebasis sind in §2 getrennt benannt.

## 5. Doku-Gates und Commits

- Gates (08:11:27→08:11:45Z): `docs:validate` Exit 0,
  `docs:indexes:check` Exit 0, `docs:log:check` Exit 0,
  `docs:validator:test` 87/87 Exit 0.
- Code-Checkpoints: `9b23ef3b…` (14 Dateien), Fix-Commit
  `a6ef1a2f30d375f79d21e152e87a4d47f0f9bd6b` (5 Dateien) und Test-
  Härtung `716847b800f168a35209dc9b736ca317a2eeecf2` (1 Datei);
  kein `git add -A`, kein Amend/Reset.
- Doku-Commit: dieser Commit (docs-only nach Fix-Commit; Baum-
  Identität Fix→Docs unten bestätigt). Er kann BASE sein.
- Uncommitteter Rest nach Docs-Commit: keiner (bis auf ignorierte
  Evidenz, kein Repo-Inhalt).

## 6. Einordnung

- Dieser Abschluss belegt den K06-Kompositionsanteil von RV-03
  (Paketkatalog/Standardauswahl prüfbar, Kompositionstests grün); kein
  I0-Gesamtnachweis, kein G1, keine F1–F7-Verhaltensänderung.
- Fremder Vorlauf (`merge-cleanup-r1/tests.md`, Exit 1, 0 Tests) bleibt
  als historischer Beleg bestehen und wird nicht umgeschrieben.
