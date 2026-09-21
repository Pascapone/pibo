---
type: "Plan"
title: "Handoff an die nächste Controller-/Chat-Session (Beta 4.0)"
description: "Einarbeitungsdokument mit Lage, Entscheidungen, Testergebnissen, offenen Schritten und Grenzen nach dem Paketbau-Abschluss."
tags: ["beta-4", "handoff", "controller", "next-session"]
status: "draft"
authority: "directive"
generated:
  by: "muse-code/start-ready-session"
  at: "2026-09-21T08:17:37Z"
sources:
  - id: "v4-plan"
    resource: "scope:docs/plans/beta4-phase2/beta4-arbeitsplan-v4.md at handoff commit"
    title: "Aktuelle Arbeitsrichtung V4"
  - id: "acceptance"
    resource: "scope:docs/reports/beta4-phase2/beta4-phase2-research-acceptance-2026-09-20.md"
    title: "Rechercheabnahme mit RV-01 bis RV-08"
  - id: "closure-report"
    resource: "scope:docs/reports/beta4-phase2/beta4-build-gate-closure.md"
    title: "Schluss-/Testbericht zum Paketbau-Abschluss"
---

# Handoff an die nächste Session (Beta 4.0, `beta/4.0-plugin-system`)

## 0. Lagebild (10 Zeilen)

1. Branch `beta/4.0-plugin-system`; Commits `9b23ef3b` (Code),
   `9730634b` (Docs), `a6ef1a2f` (Lockfix), Docs-Commit dieser
   Revision (BASE-Kandidat); kein Push.
2. Der 22-vs-21-Paketbau-Blocker ist behoben und am Fix-Commit belegt:
   frischer Build Exit 0, K06-Trio 15/15, Cutover 1/1; alle 22
   Plugins inkl. Remote Agent erhalten.
3. KEIN gebündelter `npm test`-Schlusslauf: alter Lauf (20.09.) endet
   unbelegt (23 ✖ bis Logende, kein Exitcode); isolierte Pflichtmatrix
   358/358 grün in 63 Dateien, Gateway-CLI separat 1/5 (§2).
4. Worktree `.worktrees/pibo-remote-agent` steht und bleibt live (Gateway);
   NICHT anfassen, kein Prune/Restart/Deploy.
5. V4-Plan (`beta4-arbeitsplan-v4.md`) ist die aktuelle Richtung; V3 und alte
   Berichte sind historisch und werden nicht umgeschrieben.
6. RV-01…RV-08 aus der Rechercheabnahme bleiben offen bis auf den hier
   belegten K06-Kompositionsanteil (Details §5).
7. Remote-Verhaltensfragen F1–F7 sind dokumentiert, NICHT behoben, NICHT als
   behoben ausgeben; sie gehören zu B/C-Seam/Q3.
8. Kein Refactoring, keine Piloten, keine neuen Sessions/Worker/Worktrees
   gestartet; B/C/D und merge-cleanup bleiben beendet.
9. Nächste Schritte: Controller-Prüfung, Pascal-Freigabe, erst
   danach I0-Bindung und Session-Dispatch (§8).
10. Kopierbarer Starttext für die neue Session steht in §10.

## 1. ERLEDIGT

### 1.1 Paketbau-/Testsuite-Blocker behoben

Befund (fremder Lauf, `merge-cleanup-r1/tests.md`): `npm test` brach am
`pibo4:standard`-Gate ab („exactly 21 declared plugin packages“), weil das
generierte Set 22 Einträge enthält (inkl. `pibo.remote-agent`). Die Suite
startete nie (0 Tests). Die Abweichung bestand bereits vor dem Observe-Merge.

Umsetzung (klein, aus heutiger Codebasis abgeleitet, keine
Framework-Neuentwicklung):

- Kanonische Autorität: neue exportierte Funktion
  `standardPluginCoordinates()` in `src/plugins/default-packages.ts`
  (22 Koordinaten aus `DEFAULT_PACKAGES`; `agent-delegation` bewusst nicht
  enthalten, wie schon in Builder-Tabelle und Defaults).
- Neue reine Prüffunktion `scripts/pibo4-composition-check.mjs`:
  Missing/Unexpected/Duplicate (Paket + Plugin-ID)/Version-Mismatch/Malformed
  scheitern mit benannten Einträgen.
- `scripts/build-pibo4-artifacts.mjs` prüft die Builder-Tabelle gegen die
  Autorität; `scripts/build-pibo4-standard.mjs` und
  `scripts/build-pibo4-candidate-assembly.mjs` prüfen das generierte Set
  gegen die Autorität (Rollenzählung abgeleitet: Plugins+N plus
  Core/Cutover/Standard/2 Deps). Infotext nutzt die echte Anzahl.
- `src/compute/pool/artifacts.ts` (Laufzeit-Validator im Minimal-Core):
  feste Erwartung 22/27, begründet dokumentiert — die Core-Closure darf den
  Katalog nicht importieren; Identitätsbindung erfolgt weiter unten im
  Standard-CLI gegen das ausgelieferte Package-Set.
- Keine Prüfung gelöscht/geskippt, kein `>= 21`, kein Einzel-21→22-Ersatz
  bei stehenbleibenden 26/24/18-Annahmen.
- Cutover-Lockfix: Live-Store als `pibo.data.store`-Core-Service
  bereitgestellt und im Remote-Setup injiziert (Fallback erhalten),
  Manifest optional deklariert; Async-Disposer wartet `service.stop()`
  und schließt nur den eigenen Store, nie den geliehenen.

### 1.2 Tests

- Neu `test/pibo4-standard-composition.test.mjs`: literales 22er-Roster als
  einziger Pin (inkl. Remote Agent), Negativtests für alle
  Fehlerklassen, Konsistenz der gebauten Artefakte
  (Package-Set, Assembly-Manifest).
- `test/pibo4-executable-minimal-core.test.mjs`,
  `test/pibo4-packed-distribution.test.mjs`,
  `test/pibo4-standard-cutover.test.mjs`: feste 21/26/24/18-Annahmen auf
  abgeleitete Erwartungen umgestellt; Verhaltensassertions (z. B. Cron/
  Goal-Control installiert, Web-Search deinstalliert) unverändert.
- Neu `test/remote-agent-plugin-lifecycle.test.mjs`: 6 echte Host-
  Regressionen (Same-DB-Txn-Setup, Negativkontrolle ohne Injection,
  Disposal-Nutzbarkeit, verzögerter Stop, Stop-Fehler, Fallback) mit
  Fail-First gegen void-Disposer und Härtung (finally-Cleanup,
  Stop-Handshake, AggregateError-Nachweis).
- Direkt-Regressionen der gemeinsamen ProductRuntime mitgeprüft:
  `plugin-system-product-runtime`, `-lifecycle`, `-install` (31/31).

### 1.3 Commits und Dokumentation

- Code-Checkpoints: `9b23ef3b…` (14), Fix-Commit `a6ef1a2f…` (5),
  Test-Härtung `716847b8…` und Same-DB-Fixtur
  `26518872ed091e075db824df028712ee11103bb9` (je 1); kein `git add -A`.
  Produktionscode seit Fix-Commit unverändert (0 Zeilen).
- Uncommitteter Rest vor Docs-Commit: nur Doku-Dateien; danach Baum
  sauber (bis auf ignorierte Evidenz, kein Repo-Inhalt).
- Getesteter Stand = Fix-Commit + frischer Build daraus; kein
  gebündelter Vollsuite-Nachweis (§2).
- Schluss-/Testbericht:
  [beta4-build-gate-closure.md](../../reports/beta4-phase2/beta4-build-gate-closure.md).
- Rohlogs (ignoriert, nicht versioniert):
  `.pibo/planning/beta4-start-ready-20260921/logs/` (eigene
  Isolationsläufe 21.09.) und
  `.pibo/planning/beta4-next-session-20260920/logs/npm-test-final.log`
  (alter Lauf, unvollendet).
- Doku-Werkzeug: Skill `maintain-okf-docs` war in dieser Runtime nicht
  auflösbar; stattdessen `docs/project/documentation-profile.md` +
  Projektskripte verwendet (Gates s. Schlussbericht §5). Keine
  Profile/Validatoren abgeschwächt.

## 2. TESTERGEBNIS

> KEIN gebündelter Gesamtlauf. Belegt: frischer Build aus Fix-Commit
> `a6ef1a2f` (07:42:25→07:46:55Z, Exit 0) plus isolierte Pflichtmatrix
> daran (Runner `scripts/run-test-suite.mjs`, Node v24.21.0).

- Build Exit 0; Matrix 357 (darin Lifecycle-alt 5/5) − 5 + 6
  (aktuelle Same-DB-Fassung, FIX2-Module) = 358 grün in 63 Dateien
  (Liste im Bericht); Typen Exit 0.
- Cutover-Lücke geschlossen: Lockfix committen, gepackte Strecke 1/1,
  Lifecycle 5/5 mit Fail-First gegen void-Disposer.
- Loader-tsx-Defekt: Tests per dist-Import grün (Assertions identisch);
  Defekt im tsx-Hook bleibt Toolchain-Befund (I/B).
- `gateway-web-cli` 1/5 am Fix-Commit (4× ~20-s-Timeout, 1× Pass bei
  18,2 s): Timing-Grenze belegt, kein universeller Ursachenbeweis;
  keine Timeouts geändert. Owner I (Baseline).
- Composer-TS2322 per Owner-Guard behoben + Regression grün; Storage-
  Spec per echter Prüfung neu gebunden (10/10).
- Alter Lauf (20.09.): 17:29:57Z bis Logende 18:27Z (4424 Zeilen,
  2990 ✔ / 23 ✖ bis Logende), keine Summary, kein Exitcode;
  Abbruchgrund unbekannt, kein Signal behauptet.
- Details, Zeiten, Exits, Hashes: Schlussbericht (§1.3) + neue Logs.

Historisch (NICHT frisch, NICHT als aktuelle Suite ausgeben):

- 87/87 Doku-Validator-Tests (Vor-Session; frischer Stand s. §5 Gates).
- Fremder `npm test` @84101adc, 16:28–16:32Z, Exit 1 am 22/21-Gate,
  0 Tests (`merge-cleanup-r1/tests.md` + `logs/npm-test-full.log`).

## 3. OFFEN

- RV-01…RV-08 (Quelle: Research-Acceptance, s. §5): bis auf den
  belegten K06-Kompositionsanteil alle offen; RV-03 nur teilweise
  bedient — Commits + Build + Matrix liegen vor, aber kein Vollsuite-
  Lauf, keine Worktrees, keine B/C/D-Eingangsbestätigung.
- Gateway-CLI-Timing (1/5, Owner I), tsx-Defekt (I/B), F1–F7 und
  443 exakt ungeprüfte Suite-Dateien (64/507 ausgeführt): dokumentierte
  offene Befunde (§2), kein erfundenes Grün. Cutover/Composer/Storage
  geschlossen.
- Nächste inhaltliche Schritte: §8.

## 4. NICHT BEAUFTRAGT (nicht begonnen)

- Kein F1–F7-Verhaltensfix (nur dokumentiert, §6).
- Kein Refactoring, keine Altlastenlöschung, keine Piloten (A1/B1/C1/D1),
  kein G1, keine B2/C2/D2, keine neuen Sessions/Worker/Worktrees.
- Keine Gateway-/Deploy-/Release-Aktionen, keine Pushes, keine
  History-Rewrites, keine Worktree-Aktionen, keine Prozesskills.
- Keine V4-Planänderung, keine Spec-Umschreibung, keine
  Historien-Revision (V3/alte Berichte bleiben historisch).
- Kein K07-Interfacebau, kein neues MCP/Tool-Protokoll.
- Keine Timeout-/Assertion-/Skip-Anpassungen zum Grünfärben, keine
  Dependency-/Node-Änderung, kein Produktumbau über den Buildfix hinaus.

## 5. Ziel, Phasen, Owner, Verträge (V4-Stand)

- Ziel (Pascal): Beta für 4.0 schlanker, sauberer, verständlicher;
  Dependencies beim zuständigen Paket; kleiner schneller Kern; bewusste
  optionale Plugininstallation. Tiefe Module, kleine vollständige
  Interfaces nach Codebase-Design-Skill; keine Abstraktionen auf Vorrat.
  Funktionalität erhalten, Tests nicht schwächen. Ausnahmen nur explizit
  aufgegebene Altoberflächen + beauftragtes Attachment-Feature.
- Reihenfolge: geprüfte Baseline/I0 + v0-Verträge → A1/B1/C1/D1 in
  getrennten Worktrees mit implementierten Piloten → gemeinsamer
  Review/Nachbesserung G1 (v1 erst mit Code+Tests) → B2/C2/D2 (B/C/D),
  A Gegenprüfung/Doku, Integrator frühe Zusammenführung → I2/Q3.
  K07-Abhängigkeit D1-Core-Pilot → Integrator → C1-Annotations-Anbieter
  VOR G1. 16 Forschungsberichte ≠ Vorbereitung ≠ G1.
- Owner: B neutrale Verträge/Core/Pi/Credential-Ownerbindung; C Plugin-/
  Transkriptions-/Remote-/Tool-Verbraucher, Nicht-Pi-Runtimes; D Web/
  Workflows/K07; Integrator Rootmanifest/Lockfile/Builder/Katalog;
  A TUI-Datei sauber an B übergeben. KEINE parallelen B/C-Schreibrechte
  auf Verbraucherdateien (RV-01). Vier feste Worker, kein Dauer-Zusatz.
- Verträge K01 Runtime/Session, K02 Tools/Ressourcen, K03 begrenzter
  Zugang, K04 Workflow/Host, K05 Web, K06 Paket/Build, K07 Attachments.
- Dieser Buildfix belegt von RV-03 den K06-Kompositionsanteil
  (Paketkatalog/Standardauswahl/Versionen prüfbar, Kompositionstests
  grün); RV-01, RV-02, RV-04…RV-08 sowie Rest-RV-03 (I0-Doku,
  Worktrees, Artefaktherkunft, Schlusslauf) bleiben offen.

## 6. Erhalt / Entfernung / Remote-Risiken

- ERHALTEN (frisch 21.09. belegt): beide Loops-Modi (95/95),
  Ralph-Modus/CLI-/Routenaliase/Bestandsdaten (43/43),
  Remote-Agent-Plugin Sessions/Observe/Dateien/Bash (65/65),
  Attachments-Bestand (7/7); normales CLI, VS-Code-Web-IDE als Plugin,
  Core-Webansichten (Settings/Agent Designer/Kontext/Session Inspector/
  Raw Events), alle Sessions/Historie/Auth-/Runtime-Fähigkeiten.
- ENTFERNUNG (später, NICHT umgesetzt): belegte alte Ralph-Doppel-
  implementation, TUI-Einstieg, tote Extension-Reste, doppelte Hilfslogik
  nach Verbraucher-/Testprüfung. Zehn statische Loops-Abdeckungsbereiche
  vor Löschung übertragen; keine Bugs behauptet.
- F1–F7 (unabhängige Prüfung + Controller, dokumentiert in Spec
  [remote-agent-plugin-contract.md](../../specs/resources/remote-agent-plugin-contract.md)
  und V4-Anhang R): F1 Positions-Cursor bei ms-Gleichstand (Häufigkeit
  unbekannt); F2 `roles:user`-Superset; F3 Vollscan/Payloadlesen vor
  Begrenzung; F4 gewollte Brüche (neueste-zuerst, nur-Neues, Volltexte,
  Textformat); F5 Fallback-/Tie-Testlücken; F6 gemeinsamer Cursor-LRU;
  F7 Cursor an Session+Query, nicht Token/Client. Keine pauschale
  Gleichheit `remote_session_observe` = `pibo_agents_observe`.
- Neue Kopplung Remote → `subagents/observation-query.ts`,
  `observations.ts`, `tool.ts` + Cursorstore: bei Trennung nicht doppeln
  oder löschen. K01/K03/K04/K05/K07 durch Observe-Delta ungeändert.

## 7. K07 ausschließlich Attachments (kein neues Protokoll)

Snapshot beim Anhängen; Widget-Toggles ändern lokale Draftrevision, nicht
Quelle. JSON-Payload getrennt von UI-State; Core-Rahmen/Sessionbesitz/
Persistenz/Senden. Bilder+Dateien Core-Anbieter, Web Annotations
Plugin-Anbieter. Leiste über Chatinput volle Breite, max 12×3 (mobil 3×3),
technischer Default 6 Zwischenspalten, Überlaufseiten. Core-X je Anhang;
Übernahmemodus nur Core-Auswahltoggles. Persistenter Draft pro Session
(reloadfest); Senden friert IDs/Revisionen/JSON an `clientTxnId` ein;
Materialisierung erst bei Annahme; nur bestätigte Revisionen verbrauchen.
Bestätigte Kopierablage über Sessionwechsel mit neuen IDs. Scope =
bestehender App Context. Speichertechnik vor Pilot präzisieren (RV-07).
Medienparität = heutiger Adapterweg (RV-08). AT-01–AT-22 vollständig als
Abnahmeziele mitführen (V4 §12.14); keine Implementation.

## 8. Nächste Schritte für die neue Session

1. Dieses Handoff + Schlussbericht (§1.3) + V4-Plan + Startpaket (§9) lesen.
2. Controller-Prüfung und Pascal-Freigabe abwarten; KEINE Sessions,
   Worktrees oder Dispatches vor ausdrücklicher Freigabe.
3. Erst nach Freigabe: I0-Bindung (BASE, Claims, Worktrees,
   Eingangsbestätigungen) gemäß `launch-control.json`-Ablauf.
4. Offene Befunde aus §3 übernehmen und neu zuordnen.

## 9. Historie und Belege (nicht als frisch ausgeben)

- Auditbasis `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (enthält `a3472458`
  Remote-Basis). Forschung `f46d2185` + UTC-Fix `48a485e9`.
- Source `feature/pibo-remote-agent` @
  `175afcfa553ee34254414d2b444688fd96dda3cc`, integriert via Merge
  `84101adce730983641bc4421c1e3cae982e129b7` (4 Dateien, 0 Konflikte).
- V4-Doku `d204fa35`/`e64ee324`/`8a6ce7da`/`47342db6`.
- Backup-Refs: `refs/backup/pre-remote-merge-beta-20260920` (→48a485e9),
  `refs/backup/pre-remote-merge-source-20260920` (→175afcfa).
- Worktree `.worktrees/pibo-remote-agent` live (Gateway); historische PIDs
  sind Momentaufnahmen, keine Zusicherung. Keine Pushes.
- Historische Session-IDs sind reine Quellen, KEINE Dispatch-Ziele;
  vier NEUE Sessions erst nach Pascal-Freigabe (s. Startpaket unten).
- Startpaket (ignoriert, gehasht 08:09:50Z, nicht versendet):
  `assignments/A1.md` (`89d49b44…`), `B1.md` (`744918c0…`), `C1.md`
  (`5d8171e3…`), `D1.md` (`92eded14…`), `ownership.json` (`ea0f1b26…`,
  60 exact, valide) und `START-PROTOCOL.md` (`d062bb0f…`); Ablauf in
  `launch-control.json` (separat veränderlich, Freigaben false).
  Der versionierte Startpunkt ist dieser Handoff + BASE-Commit.
- Lesereihenfolge: `AGENTS.md`, `GLOSSARY.md`,
  `docs/project/documentation-profile.md`, V4-Plan + HTML-Asset,
  Research-Acceptance, Joint-Review + 16 Phase-2-Berichte, Bloat-Audit +
  Inventar, Codebase-Design-Referenzen, Remote-Contract-Spec, Entwurf
  Kap. 15, Baseline-Recount, `.pibo/planning/beta4-remote-integration-20260920/`
  (`final.md`, `independent-review.md`, `impact.md`, `docs-review.md`,
  `merge-cleanup-r1/*`), `.pibo/planning/beta4-phase2-20260920/` +
  Originals-ZIP.

## 10. Starttext für die neue Session (kopieren)

```text
Bitte orientiere dich auf Branch beta/4.0-plugin-system am BASE-Kandidaten.
Lies zuerst docs/plans/beta4-phase2/next-session-handoff.md vollständig
(Lagebild, ERLEDIGT/TESTERGEBNIS/OFFEN/NICHT BEAUFTRAGT, nächste Schritte)
sowie den dort verlinkten Schlussbericht
docs/reports/beta4-phase2/beta4-build-gate-closure.md. Fix-Commit a6ef1a2f
ist gebaut und isoliert geprüft (358 grün in 63 Dateien, Gateway-CLI 1/5 separat,
kein Gesamtlauf, siehe §2); keine Sessions/Worktrees/Dispatches ohne
Pascals ausdrückliche Freigabe. Worktree .worktrees/pibo-remote-agent
NICHT anfassen (live Gateway).
```

## 11. Grenzen dieses Handoffs

- Ergebnisstand bezieht sich auf Fix-Commit `a6ef1a2f` plus frischen
  Build und isolierte Matrix daran (§1.3, §2); gebündelter Schlusslauf
  steht aus und wird nicht behauptet.
- Alle Zeitangaben sind echte UTC-Zeiten, keine Schätzungen.
- Dieses Dokument ersetzt nicht die verlinkten Quellen; „siehe Chat“ wird
  nirgends als Beleg verwendet.
