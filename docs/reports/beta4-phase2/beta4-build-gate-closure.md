---
type: "Validation Report"
title: "Beta4 build-gate closure: 22-plugin composition and isolated verification"
description: "Evidence for the 22-vs-21 build-gate repair and isolated verification runs at the code checkpoint commit."
tags: ["beta-4", "build", "test-report", "composition"]
status: "draft"
authority: "evidentiary"
generated:
  by: "muse-code/start-ready-session"
  at: "2026-09-21T06:15:27Z"
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

> Stand: Code-Checkpoint `9b23ef3b126de71a9292f5fb4685eeed9a280246`
> mit frischem Build und isolierter Pflichtmatrix daran. KEIN gebündelter
> Gesamtlauf abgeschlossen. Keine Erfolgsbehauptung über das Gemessene hinaus.

## 1. Durchführung (serielle Isolationsläufe am Code-Commit)

- Code-Commit: `9b23ef3b126de71a9292f5fb4685eeed9a280246` (14 Dateien:
  Kompositionsfix + Helper/Kompositionstest + 2 Loader-Importe +
  Composer-Guard + Regression). Kein Push.
- Frischer Build exakt aus diesem Commit (Pristine-Archivbaum, gleiche
  installierte Toolchain): 05:57:17→06:01:47Z, Exit 0
  (`build-3-fresh-commit.log`). Standard-Package-Set `83c8471e…`,
  Assembly-Manifest `e0a51d3a…`, 27 Tarballs
  (`04-fresh-artifacts.sha256`). Ältere wiederverwendete dist-Stände
  gelten NICHT als Buildherkunft.
- Runner: `node scripts/run-test-suite.mjs <Dateien>` (= isoliertes
  `node --test --test-concurrency=2`, eigenes HOME/PIBO_HOME/XDG).
- Umgebung: Node v24.21.0, npm 11.19.0, vorhandene `node_modules`
  (kein Install/Upgrade), 506 `test/*.test.mjs`-Dateien.
- Kurzes TMPDIR nur als Env-Workaround für eigene Prozesse (langer
  Runtime-TMPDIR sprengt das tsx-Pipe-Limit → EINVAL); kein Produktfix.
- Uncommitteter Rest (Review ausstehend, NICHT im Commit): 4-Dateien-
  Cutover-Lockfix (Store-Injection + Manifest) sowie diese Doku-Dateien.
- Logs: `.pibo/planning/beta4-start-ready-20260921/logs/`.

Läufe am Commit-Baum (UTC 21.09., frischer Build; echte Node-Summaries):

| Lauf | Zeit | Exit | Ergebnis |
|---|---|---|---|
| frischer Build | 05:57:17→06:01:47Z | 0 | grün, 27 Tarballs |
| K06-Trio (Composition/Minimal-Core/Packed) | 06:02:10→06:04:25Z | 0 | 15/15 |
| Cutover (gepackte Strecke, ohne Lockfix) | 06:04:34→06:05:32Z | 1 | 0/1, Lock |
| Remote-Agent (10 Dateien) | 06:05:42→06:07:17Z | 0 | 65/65 |
| Loops + Attachments (16 Dateien) | 06:07:31→06:08:47Z | 0 | 102/102 |
| Ralph/UI + Composer-Send + Storage (13) | 06:08:57→06:09:09Z | 0 | 54/54 |
| B1/D1-Eingänge (7 Dateien) | 06:09:21→06:10:41Z | 0 | 63/63 |
| Loader-Dateien (2) | 06:10:56→06:11:06Z | 0 | 6/6 |
| Composer-Rest (7 Dateien) | 06:11:55→06:12:03Z | 0 | 15/15 |
| `typecheck` (alle 4 Schritte) | 06:12:12→06:12:52Z | 0 | 0 Fehler |

Frühere belegte Baum-Läufe (nicht am Commit, weiter gültig als Diagnose):
Kompositions-Repros, Loader-Basisvergleiche an pristine HEAD (Exit 1),
Gateway-CLI 0/5 mit separater ~50-s-Boot-Probe (plausibler
Timingzusammenhang, kein universell bewiesener Ursachenbefund),
Cutover-Lock-Repro mit/ohne Injection, Cutover-Regression 1/1 NACH
Lockfix (Baum, `repro-11`, 05:43:51→05:44:55Z).

Zählhinweis: Alle Zahlen sind echte Node-Summaries (`ℹ
tests/pass/fail`). Die `SUMS:`-Annotationszeilen in älteren Rohlogs zählen
Markierungszeilen und sind dort falsch; Mapping im Nachtrag
`.pibo/planning/beta4-start-ready-20260921/SUMS-CORRECTION.md`,
Rohlogs unverändert erhalten.

## 2. Ergebnis

- Am Commit: 320/321 Tests grün (45 Dateien), Build + Typen grün.
  Einzige rote Datei: Cutover mit `database is locked` → klar
  gesperrter Pfad (Owner I, Fix reviewbedürftig uncommittet, Abnahme
  `repro-11` auf Fixbaum belegt).
- Buildkette frisch grün: Standard mit 22 Paketen, Candidate-Assembly
  mit 27 Artefakten (22 Plugins + Core/Cutover/Standard/2 Deps).
- Rotklassifikation (je belegt):
  - Cutover-Lock am Commit:.Remote-Setup öffnet unter äußerer
    Migrationstransaktion zwei neue `pibo.sqlite`-Connections (5-s-
    Timeout). Fix (Core-Service-Injection + Manifest, Fallback
    erhalten) existiert uncommittet und macht die echte gepackte
    Strecke grün; Commit-Entscheidung beim Review.
  - Gateway-CLI 0/5: je ~20-s-Timeout bei separat ~50-s-Bootdauer →
    plausibler Timingzusammenhang auf langsamer Maschine, keine
    Timeouts geändert, kein universeller Ursachenbeweis.
  - Loader-tsx-Defekt: Tests per dist-Import grün (6/6); der Defekt
    im tsx-Hook selbst bleibt Toolchain-Befund (I/B).
- Alter Lauf (20.09.): Start 17:29:57Z, Log endet 18:27Z mitten im Run
  (4424 Zeilen, 2990 ✔ / 23 ✖ bis Logende), keine Summary, kein
  Exitcode; Abbruchgrund unbekannt, kein Signal behauptet.
- NICHT geprüft: übrige ~460 Suite-Dateien (kein Gesamtlauf), daher
  kein `npm test grün`-Anspruch.

## 3. Geprüfte Komposition

- `standardPluginCoordinates()` (22) = literales Roster im Test
  `test/pibo4-standard-composition.test.mjs`, inkl. `pibo.remote-agent`.
- Gebautes `standard-package-set.json`: 22 Einträge, exakt gegen Autorität
  geprüft (frischer Hash `83c8471e…`); Standard mit 22 gebündelten
  Paketen; Candidate-Assembly mit 27 Tarballs (Manifest `e0a51d3a…`).
- Negativtests: missing/unexpected/duplicate (Paket + Plugin-ID)/
  Version-Mismatch/malformed scheitern; Reihenfolge-unabhängiger
  Trefferfall besteht.
- Verhaltensassertions der Cutover-/Executable-Tests unverändert
  (Cron/Goal-Control installiert, Web-Search deinstalliert, Rest aktiv).

## 4. Zusatzbefunde (alle geschlossen oder echt geprüft)

- TS2322 `composer-send.ts`: BEHOBEN per Owner-Guard (1 Zeile, keine
  Casts/Pflichtfeldänderung) + Regression (Draft ohne Send leeren →
  kein Owner); Typen am Commit Exit 0.
- `PIBO_TRACE_COMMIT` (`specs/data/storage-maintenance.md`): ECHT
  GEPRÜFT — alle 7 Evidenzpfade + 8 Symbole + 7 Testnamen vorhanden,
  Storage-Tests 10/10; `traceability.commit` auf tatsächlich geprüften
  Code-Commit `9b23ef3b…` gebunden (alter Verweis `730cf01f…`
  existiert nicht, s. Update-Log).
- Datei-unverändert allein gilt nicht als Unabhängigkeitsbeweis; echte
  Ursache/Log/Test/Phase/Codebasis sind in §2 getrennt benannt.

## 5. Doku-Gates und Commits

- Gates (06:16:37→06:16:55Z): `docs:validate` Exit 0,
  `docs:indexes:check` Exit 0, `docs:log:check` Exit 0,
  `docs:validator:test` 87/87 Exit 0.
- Code-Checkpoint: `9b23ef3b126de71a9292f5fb4685eeed9a280246`
  (14 Dateien, kein `git add -A`, kein Amend/Reset).
- Doku-Commit: dieser Commit (docs-only nach Code-Checkpoint; Baum-
  Identität Code→Docs unten bestätigt). Er kann BASE sein.
- Uncommitteter Rest nach Docs-Commit: 4 Lockfix-Dateien (Review),
  ignorierte Evidenz (kein Repo-Inhalt).

## 6. Einordnung

- Dieser Abschluss belegt den K06-Kompositionsanteil von RV-03
  (Paketkatalog/Standardauswahl prüfbar, Kompositionstests grün); kein
  I0-Gesamtnachweis, kein G1, keine F1–F7-Verhaltensänderung.
- Fremder Vorlauf (`merge-cleanup-r1/tests.md`, Exit 1, 0 Tests) bleibt
  als historischer Beleg bestehen und wird nicht umgeschrieben.
