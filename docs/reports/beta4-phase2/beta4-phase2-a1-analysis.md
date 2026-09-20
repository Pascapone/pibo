---
type: "Research"
title: "Beta 4.0 phase-2 A1 analysis (archived research)"
description: "Worker A1 analysis from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "a1", "analysis"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/A1/analysis.md"
  origin_sha256: "7070056a023009cf3dbdc27f29222e4fefec48bf966da1468f6dc476ab6eac77"
  origin_bytes: 19609
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/A1/analysis.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# A1 – Analyse: Altlasten und Funktionsschutz

## 1. Baseline und Methode

- Branch: `beta/4.0-plugin-system`, HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a` (Start und Ende identisch, keine Abweichung vom Dispatch).
- Start: 2026-09-20T14:49:16Z, Workspace `/mnt/c/Users/pasca/Coding/pibo`.
- `git status --short` (Start und Ende): fremd und unangetastet: `M docs/log.md`, `M docs/project/okf-migration-ledger.json`, `M docs/reports/index.md`, `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20-inventory.md`, `?? docs/reports/beta-4-0-core-plugin-bloat-audit-2026-09-20.md`. Eigene Dateien liegen unter `.pibo/` (git-ignoriert) und ändern den Index nicht.
- Gelesene Basis: `BASE/README.md`, `inputs/source-verification.json` (Status `verified`), `inputs/pibo-beta4-arbeitsplan-v3.md` (923 Zeilen), `inputs/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md`, Quellen-Nachweis (222 Zeilen), `AGENTS.md`, `GLOSSARY.md`, Specs `docs/specs/orchestration/loops-goals-and-ralph.md` (ORCH-LOOP-001..004), `docs/specs/web/composer-delivery-files-and-media.md` (WEB-COMPOSER-*), `docs/specs/web/web-annotations.md` (WEB-ANNOTATION-*), `docs/specs/vscode/*.md` (beide `deprecated`).
- Methode: Erreichbarkeit ab aktiven Einstiegen nachgewiesen (CLI-Dispatch in `src/cli.ts`, Plugin-Registrierung in `src/plugins/packaged-goal-loops.ts`, Web-Routen, UI-Routen, `src/index.ts`-Exporte), nicht per Namensvorkommen. Importgraph per `grep`/Ripgrep über `src/` und `test/` (ohne `dist/`, ohne `docs/legacy/`-Historie); dynamische Registrierung (`context.register`, `registerApiRoute`, Commander-Dispatch, TanStack-Routen) von Test-only-Importen (`test/*.test.mjs` → `dist/...`) getrennt. Keine Ausführung von Tests/Builds (Analyseauftrag; Laien-Laufzeitnachweise aus `dist/` nicht als Beleg verwendet).
- Nenner: 3024 getrackte Dateien, davon 900 unter `src/`, 547 unter `test/`.

## 2. Zusammenfassung

Die alte Ralph-Insel (`src/ralph/*`, alte Ralph-API/UI/CLI) ist produktiv vollständig unerreicht: kein Channel-Start, kein CLI-Dispatch, kein Web-Routenaufruf, keine UI-Verwendung. Alle belebten Pfade laufen über `src/loops/*` mit dokumentierten Ralph-Aliassen (CLI-Name, API-Pfade, UI-Route, Moduswert, Tabellen-/Dateinamen, deprecated Katalogfelder). Der TUI-Einstieg `runPiboTui` und seine ausschließlich interaktive Verdrahtung sind aufruferlos; `src/session-ui/*` ist dagegen aktiv eingebunden und bleibt. Die alte VS-Code-Extension ist aus HEAD/Index entfernt; übrig sind nur ignorierte Buildreste, drei tote Packausschlüsse und bereits als `deprecated` markierte Docs. Kritischer Pfad vor jeder Löschung: zehn Loops-Testlücken (Timeout-Abbruch, Unknown-Profile, Stop/Cancel/Cleanup, Evaluator-Komposition, Template-Inhalte, Runtime-Overrides, Resource-Validierung) müssen zuerst mit direkten `PiboLoopService`-/`PiboLoopStore`-Tests geschlossen werden — heute belegen nur Ralph-Seam-Tests dieses Verhalten. Attachment-Verhalten ist über WEB-COMPOSER-*/WEB-ANNOTATION-*-Tests geschützt; AT-01–AT-22 sind neue Abnahmeziele, keine erfüllten Tests.

## 3. Befunde

### A1-01 — `src/ralph/*` (7 Dateien, 1254 Zeilen): produktiv unerreicht, DELETE nach Testablösung
Belege: `createPiboRalphChannel` (`src/ralph/channel.ts:8`) hat keinen Aufrufer in `src/`; einziger Verbraucher von `getPiboRalphService` ist der ebenfalls aufruferlose Handler `handleChatRalphApiRequest` (`src/apps/chat/ralph-api.ts:35`, Aufrufer nur `test/ralph-resource-visibility.test.mjs`). `runRalphCli` (`src/ralph/cli.ts:87`) und `formatRalphResourceSummary` (`src/ralph/cli.ts:71`) haben null Code-Importeure (nur Erwähnung in Spec/Audit-Docs). `src/index.ts` exportiert kein Ralph-Symbol. Verbraucher der Insel beschränken sich auf `test/*.test.mjs` (siehe A1-14/A1-15).
Vertrauen: hoch. Risiko bei Entfernung nach Ablösung: niedrig.

### A1-02 — `handleChatRalphApiRequest` (`src/apps/chat/ralph-api.ts`, 50 Zeilen): dead handler, DELETE
Belege: einziger registrierter API-Routenpfad für `/api/chat/ralph*` ist `src/plugins/packaged-goal-loops.ts:50-57` → `handleChatLoopApiRequest`, das Legacy-Pfade per `legacyRalphRequest` (`src/apps/chat/loop-api.ts:43-45`, Rewrite auf `/loops`, POST-Default `mode: 'ralph'` in Zeile 58) bedient. `ralph-api.ts` wird von keiner Route aufgerufen.
Vertrauen: hoch.

### A1-03 — `RalphArea.tsx` (352 Zeilen) + `api-ralph.ts` (88 Zeilen): tote UI-Schicht, DELETE
Belege: `RalphArea` hat null Importeure in `src/apps/chat-ui/src/` (nur `test/chat-ui-ralph-area.test.mjs`). `api-ralph.ts` wird nur von `RalphArea.tsx` und der Barrel-Zeile `src/apps/chat-ui/src/api.ts:26` referenziert. Aktive UI: `LoopArea.tsx` via `src/apps/chat-ui/src/plugins/loops-view.tsx`; `/ralph`-Route führt auf die Loops-Ansicht (`src/apps/chat-ui/src/app-routes.ts:65`, `main.tsx:73-76`, Modusauswahl `LoopArea.tsx:203`). Keine Exportnamenskollision mit `api-loops.ts` (saubere `Ralph*`-/`Loop*`-Präfixe; Loops ist funktionale Obermenge inkl. `getLoopSessionGoal`, `reopenLoopJob`).
Vertrauen: hoch.

### A1-04 — Kompat-Aliase der Loops-Authorität: alle KEEP
Belegte Aliasfläche (Vorschlag: unverändert lassen, Tests in A1-15 schützen sie): CLI `pibo ralph` → `runLoopCli` mit Ralph-Defaults (`src/cli.ts:237-239,396-404`, Hilfetext Zeile 570); API `/api/chat/ralph*` + `/api/chat/loop*` → Loop-Handler (A1-02); UI-Route `/ralph` → Loops (A1-03); Moduswert `'ralph'` (`src/apps/chat-ui/src/types.ts:894`, `src/loops/types.ts`); deprecated Katalogfläche `getRalphStopConditionInfos` (`src/channels/types.ts:112-113`, `src/core/capability-host.ts:657`, `src/gateway/server.ts:741`) und `ralphStopConditions` (`src/plugins/types.ts:155-156`, `src/core/capability-host.ts:780`, Fallback `src/apps/chat/web-app.ts:1950`); Stop-Typ-Mapping `pibo.ralph.*` → `pibo.loop.*` (`src/loops/stopping.ts:127-128`); Session-Metadaten `ralphJobId`/`ralphRunId` für Ralph-Modus (`src/loops/service.ts:608,611`, gelesen u. a. von `src/compute/cli.ts:279,298-299,338,362-363`, Typ `src/compute/docker.ts:462`); DB-Datei `pibo-ralph.sqlite` + Tabellen `pibo_ralph_*` (A1-05).
Vertrauen: hoch.

### A1-05 — Gemeinsamer Store `pibo-ralph.sqlite` / `pibo_ralph_*`: KEEP, kein Tabellenumbau
Belege: beide Stores defaulten auf `piboHomePath('pibo-ralph.sqlite')` (`src/ralph/store.ts:167`, `src/loops/store.ts:227`) und nutzen dieselben Tabellen. Loops-Fresh-Schema: `loop_mode TEXT NOT NULL DEFAULT 'goal'` (`src/loops/store.ts:681`, inkl. `ON DELETE CASCADE` für Runs/Facts); Migration auf Alt-DBs: `ensureJobColumn('loop_mode', "TEXT NOT NULL DEFAULT 'ralph'")` (Zeile 665); defensiver Lese-Default `normalizeLoopMode(row.loop_mode, 'ralph')` (Zeile 111). Test: `test/loop-goal-mode.test.mjs` „new loops default to goal while legacy rows load as ralph“. Spec: ORCH-LOOP-003 (Alias über gemeinsamem Store; keine zweite Authorität). Die Ralph-Storeklasse stirbt mit der Insel; Datei/Tabellen/Zeilen bleiben.
Vertrauen: hoch.

### A1-06 — `runPiboTui` + ausschließlich interaktive Verdrahtung: DELETE (exakte Zeilen), Datei danach an B
Belege: `runPiboTui` (`src/agent-runtimes/pi/runtime.ts:656-681`, Dateiende) hat null Aufrufer in `src/`/`test/`; kein CLI-TUI-Kommando (`src/cli.ts` ohne `tui`/`interactive`-Treffer; restliche `tui`-Treffer in `src/` sind `getuid`/`setUint32`/`chatUi`-Artefakte). Ausschließlich TUI-genutzt: `InteractiveMode`-Import (Zeile 10, einzige Verwendung Zeile 673), `installPiboContextGuardTuiQueueOrdering` (Zeilen 616-654, einziger Aufruf Zeilen 452-453 hinter `options.contextGuardTuiQueueOrdering === true`), Option `contextGuardTuiQueueOrdering` (Zeilen 124-125, einziger Setter `true` ist Zeile 658; Adapter-Passthrough `src/agent-runtimes/pi/adapter.ts:811` erhält vom einzigen Compatibility-Lieferanten `src/core/session-router.ts:1889-1902` nie einen Wert), Helper-Import `isPiboAssistantContextGuardRecoveryPending` (Zeile 46, nur in Zeilen 625/634/647 verwendet), Reexport `src/index.ts:255` (nur `runPiboTui` streichen; `createPiboRuntime`, `inspectPiboProfile` bleiben — letzterer aktiv in `src/cli.ts:457` + Tests). Summe: 72 Löschzeilen in `pi/runtime.ts` + 1 Editzeile in `index.ts`. `src/core/runtime.ts` (5-Zeilen-`export *`-Shim) bleibt unverändert.
Vertrauen: hoch. Risiko: niedrig (kein Aufrufer, kein Test).

### A1-07 — `src/session-ui/*` (10 Dateien): aktiv, KEEP — kein Bündel
Belege: produktive Importeure `src/apps/chat-ui/src/app-signal-status.ts:1`, `components/AgentDelegationCard.tsx:9`, `hooks/useSessionActivity.ts:2`, `tool-call-reference.ts:1` sowie 10+ Testdateien (`buildCompactTerminalRows`, `resolveSessionActivity` u. a.). Namensnähe zu „TUI“ ist kein Löschgrund (V3-Leitplanke bestätigt).
Vertrauen: hoch.

### A1-08 — Alte VS-Code-Extension: aus HEAD/Index entfernt, verifiziert; Rest = Hygiene-Menge
Belege: `git ls-files src/apps/chat-vscode` leer; `src/apps/chat-vscode/dist/*` ist ignoriert (`.gitignore:2:dist/`); kein `src/vscode/`, kein `pibo vscode`-CLI (`src/cli.ts` ohne Treffer), kein `vscode:package`-Script. Verbleib: (a) ignorierte Buildreste `src/apps/chat-vscode/dist/` (4 Dateien, 964K, Maschinen-lokal, kein Commit-Effekt); (b) drei tote Packausschlüsse `package.json:37,42,43` (`!dist/apps/chat-vscode-web/**`, `!dist/plugins/chat-vscode-web.*`, `!dist/vscode/**`) — kein Build/Script erzeugt diese Pfade mehr; (c) Docs bereits `deprecated` mit `superseded_by: /plans/unified-plugin-system-rebuild.md` (`docs/specs/vscode/*.md`, `docs/project/guides/pibo-vscode-ext-quickstart.md`, Release-Runbook) — nicht umschreiben, Historie bleibt. Packausschluss `package.json:51` (Release-Runbook) bleibt sinnvoll. `!dist/apps/cli-ui/**` u. a. sind weitere tote Ausschlüsse ohne A1-Auftrag (nur Hinweis an I).
Vertrauen: hoch.

### A1-09 — `pibo.vscode-web` + Suchwerkzeuge: aktiv, KEEP
Belege: `VSCODE_WEB_PLUGIN_ID` (`src/plugins/default-packages.ts:20`), Registrierung mit `backendExport: "setupVscodeWeb"` (Zeile 491), `src/plugins/packaged-vscode-web.ts` (Route `/api/chat/vscode-web`), UI `src/apps/chat-ui/src/plugins/vscode-view.tsx`. `@vscode/ripgrep` nutzen `src/bin/rg.ts` und `src/subagents/observation-text-regex.ts` (Suchwerkzeuge, extensionsunabhängig).
Vertrauen: hoch.

### A1-10 — Zwei-Loop-Modi im aktiven Service: KEEP, Verzweigung belegt
Belege: `src/loops/service.ts:580` (`reusableSessionId = job.mode === 'goal' ? job.state.lastPiboSessionId : undefined`), Fortsetzung (Zeilen 581-582) vs. `createLoopSession` (Zeilen 596-598); Goal-Session-Ops `set/pause/resumeSessionGoal` (Zeilen 181/212/222), `reopenGoal` mit Bestätigung+Akteur (Zeile 162), `stopJob`/`cancelJob` (Zeilen 155/176), Shutdown-Drain (`stop()`, Zeile 111). Tests: „goal mode reuses one Pibo Session while Ralph mode creates fresh sessions“, „Loop service shutdown drains an active run before closing its stores“, Reopen-/Provenance-Matrix (`loop-goal-reopen`, `loop-turn-provenance`). Lücken: siehe A1-12.
Vertrauen: hoch.

### A1-11 — Duplikat-Paare Ralph↔Loops: lösen sich durch Insel-Delete, kein D/C-Eingriff nötig
Quantifiziert (Diffzeilen, semantisch geprüft): `stopping` 104 (Loops = Obermenge: +`goal-status`-Condition, +`pibo.ralph.*`-Kompat-Mapping), `templates` 104 (Loops = Obermenge: +`goal-objective`, +`mode`), `ralph-api`↔`loop-api` 115 (nahezu wortgleiche Normalize-Helfer; Loop-API zusätzlich `reopen`, Token-Budgets, Session-Goal), `api-ralph`↔`api-loops` 102 (Obermenge, A1-03), `RalphArea`↔`LoopArea` 294, `ralph/cli`↔`loops/cli` 134 (Loop-CLI zusätzlich Modus-/Budget-/Reopen-Pfade). Alle Loops-Module haben produktive Verbraucher (extern: `loop-api.ts`, `packaged-goal-loops.ts`, `default-packages.ts`; intern: Service/Store/Tools/CLI). Kein separates Deduplizierungs-Bündel erforderlich.
Vertrauen: hoch.

### A1-12 — Zehn Loops-Testlücken müssen VOR Insel-Delete geschlossen werden (MIGRATE/ADD, kein Skip)
Heute schützen nur Ralph-Seam-Tests (`PiboRalphService`/`PiboRalphStore`) folgendes auch im Loop-Service vorhandenes Verhalten (Spec ORCH-LOOP-004 nennt die Lücke explizit): (1) Timeout-Abbruch + Job-Disable bei fehlgeschlagenem Abort (`ralph-run-timeout`, 6 Tests); (2) Unknown-Profile-Disable statt Endlosschleife (`ralph-stop-conditions`, Verhalten in `loops/service.ts:407` vorhanden); (3) Stop-graceful nach aktivem Run (`ralph-resource-cleanup`); (4) Cancel-Abbruch + Lease-Freigabe (`ralph-resource-cleanup`; Scheduler-Ebene via `loop-admission-cancellation`/`loop-turn-provenance` teilweise abgedeckt); (5) Dirty-Markierung bei unsicherem Cleanup; (6) Prompt kann Cleanup-Policy nicht abschalten; (7) Evaluator-Komposition any/all/stateful + `pibo.ralph.*`-Kompat + `goal-status` (Loops-Evaluator wird in Tests nur als Fixture benutzt); (8) Ralph-Modus-Template-Inhalte (`pibo.loop.*`-Typen, PRD-Prompts); (9) Runtime-Overrides Persistenz→Session (`loops/service.ts:589,604` vorhanden, null Loop-Tests); (10) Resource-Metadaten-Validierung (`normalizeLoopResourceMetadata`, null Loop-Tests). Planbefehle und Datei-Matrix in `implementation-plan.md`.
Vertrauen: hoch (Vollständigkeit der Lückenliste: mittel — dynamische Aufrufe jenseits grep nicht völlig ausschließbar).

### A1-13 — Alias-schützende Tests: KEEP (teils mit LoopStore-Umsaat)
`test/ralph-cli-profile-default.test.mjs` (28 Zeilen, via `dist/bin/pibo.js ralph` → schützt Alias + Basisprofil-Default); CLI-Hälften von `ralph-resource-visibility` (52-111) und `ralph-runtime-overrides` (CLI-Tests, via Real-Binary → schützen Loop-CLI über Alias); `loop-api` „Loop API defaults to goal and the Ralph alias defaults to legacy mode“; `chat-ui-loop-area` „exposes legacy Ralph mode“. Umsaat `PiboRalphStore` → `PiboLoopStore` (gleiche Tabellen) in den CLI-Hälften erhält alle Assertions.
Vertrauen: hoch.

### A1-14 — Tote Weiterleitungen: 2 Stellen, beide im Bündel
`src/apps/chat-ui/src/api.ts:26` (`export * from "./api-ralph"`, einzige Ralph-Weiterleitung außerhalb der Insel) und `src/index.ts:255` (`runPiboTui` im Named-Reexport). `src/core/runtime.ts`-Shim bleibt (fällt automatisch sauber). Keine weiteren Ralph-Reexports in `src/`.
Vertrauen: hoch.

### A1-15 — Hinweise an Fremd-Owner (nicht im A1-Bündel, keine parallele Bearbeitung)
- An B: `PiAgentRuntimeCompatibilityServices.contextGuardTuiQueueOrdering` (`src/agent-runtimes/pi/adapter.ts:199`) + Passthrough (Zeile 811) nie gesetzt (einziger Lieferant `session-router.ts:1889` setzt es nicht) — nach A1-TUI-Delete mit der Dateiübernahme entfernen. `RuntimeRoutedSession.runtime` (`src/agent-runtime/routed-session.ts:292-293`, deprecated, geschrieben Zeile 329, null Leser in `src/`/`test/`) — typbewusst verifizieren, dann entfernen.
- An C: keine toten Stellen in `src/loops/*` gefunden (alle Module produktiv verdrahtet); deprecated Ralph-Aliase (A1-04) und `pibo.ralph.*`-Tabellen (A1-05) nicht „säubern“.
- An D: keine Aktion — die `ralph-api`↔`loop-api`-Helferdopplung stirbt mit der Insel; gemeinsame Web-Helfer (Prism u. a.) sind D-eigene Baustelle ohne A1-Befund. `Composer`/Annotation-Dateien unangetastet (A1-16).
- An I: tote Packausschlüsse `package.json:37,42,43` + optional `!dist/apps/cli-ui/**`, `!dist/cli-session/**`, `!dist/local/**`, `!dist/pi-packages/**` (kein `src/`-Gegenstück) als Hygiene-Patch; Root-Manifest-Ownership beachten.
Vertrauen: mittel (Fremddateien nur lesend, grep-basiert).

### A1-16 — Attachment-Schutzmatrix vorhanden; AT-01–AT-22 sind NEUE Ziele
Bestehende Zusagen mit Tests (alle KEEP, Owner D/C — Details in `contracts.md`): Upload-Limits/Overflow (`chat-file-security`, 2 Tests), PIBO_HOME-Ablage, Symlink-/Root-Boundary (`chat-image-file-boundary`, 2), per-Session-Upload-Auswahl (`chat-ui-upload-attachments`), Composer-Overflow vor Request, Download-Progress (`chat-ui-download-files`), File-Drop-Pipeline (`chat-ui-terminal-file-drop`, 2), Preview-Dialog (`chat-ui-terminal-image-preview`, 2), Composer-Send/Optimistic/Overlays (`chat-ui-composer-send`, `chat-ui-pending-message-delivery` 4, `chat-indexed-admission` 4 inkl. Idempotenz/Konvergenz), Session-Guards (`chat-ui-optimistic-session-composer`, 2), Annotation-IDs/Bindings/Store/Tools/CDP/API (`web-annotations-*`, 18 Tests), GETEILTE Annotationsauswahl (globaler Key, Sessionschlüssel werden hineinmigriert, `web-annotation-storage.ts:122-143`; nur Overlay sessionbezogen, `:105-120`), Panel-A11y (`chat-ui-web-annotations-panel` + 2 Dialog/Toggle-A11y). Normativ: WEB-COMPOSER-ADMISSION-006/-DRAFTS-001/-DELIVERY-002/-COMMANDS-003/-FILES-004/-MEDIA-005, WEB-ANNOTATION-BINDING-001/-STORE-002/-TOOLS-003/-SELECTION-004/-HOST-005. `chat-files.ts` liefert heute textuelle Pfadreferenzen; Medienparität = tatsächliche Funktion pro Adapter, kein neuer nativer Kanal. K07-Sessiondraft/Snapshot/Sessionbesitz/Grid/Copy/JSON-Vertrag existiert heute nicht — AT-01–AT-22 daher als neue Abnahmeziele markiert, nicht als erfüllt.
Vertrauen: hoch (Matrix), mittel (Vollständigkeit — keine Testausführung).

## 4. Delete/Keep/Migrate/Unklar-Matrix

| Gegenstand | Urteil | Zeilen/Umfang |
|---|---|---|
| `src/ralph/*` (7 Dateien) | DELETE nach Ablösung | 1254 getrackte Sourcezeilen |
| `src/apps/chat/ralph-api.ts` | DELETE nach Ablösung | 50 |
| `src/apps/chat-ui/src/api-ralph.ts` + `api.ts:26` | DELETE | 88 + 1 Editzeile |
| `src/apps/chat-ui/src/RalphArea.tsx` | DELETE | 352 |
| `src/apps/chat-ui/src/types.ts:912-920` (PiboRalph*-Aliase) | DELETE (Teilzeilen) | 9 |
| TUI in `pi/runtime.ts` (:10, :46, :124-125, :452-454, :616-681) + `index.ts:255` | DELETE | 72 + 1 Editzeile |
| Ralph-Aliase, Store-Datei/Tabellen, Modi (A1-04/05/10) | KEEP | — |
| `src/session-ui/*`, `src/loops/*`, `src/core/runtime.ts`-Shim | KEEP | — |
| `pibo.vscode-web`, `@vscode/ripgrep`-Suche, deprecated VSCode-Docs | KEEP | — |
| 10 Loops-Testlücken (A1-12) | MIGRATE/ADD zuerst | neue Tests, dann Delete |
| `ralph-cli-profile-default`, CLI-Hälften, Alias-Tests (A1-13) | KEEP (+Umsaat) | 28 + Split-Dateien |
| `package.json:37,42,43` tote Ausschlüsse | HYGIENE via I | 3 Zeilen |
| `src/apps/chat-vscode/dist/*` ignorierte Reste | OPTIONAL lokal löschen | 964K, 4 Dateien, kein Commit |
| `adapter.ts` Compat-Feld, `routed-session.ts:293` | HINWEIS an B (Unklar bis typgeprüft) | 0 A1-Zeilen |

Summen (A1-Bündel, ohne Fremd-Owner): Source-Delete 1744 + 10 Teil-/Editzeilen, TUI-Delete 72 + 1 Editzeile, Test-Delete ~596 Vollzeilen + 3 Split-Dateien + 4 Anpassungsdateien, Doku-Delete 0, Hygiene 3 Zeilen (via I).

## 5. Risiko, Vertrauen, Grenzen

- Höchstes Risiko: Insel-Delete vor geschlossenen Lücken (A1-12) würde Timeout-/Cancel-/Cleanup-/Override-Verhalten unbelegt lassen. Gegenmaßnahme: strikte Reihenfolge absichern → entfernen (Paket LP-01 vor LP-02, siehe `implementation-plan.md`); kein Testskip, kein Assertionsabbau.
- Zweitriskio: stille Alias-Brüche (CLI-Name, `/ralph`-Pfade, Modus-Default, Tabellen). Gegenmaßnahme: A1-13-Tests bleiben grün über den gesamten Umbau; `loop-api`-Alias-Test + CLI-Real-Binary-Tests als Gates.
- Vertrauen: Erreichbarkeitsbefunde hoch (mehrfach gegenläufig gesucht: Definition→Verbraucher und Einstieg→Tiefe). Lückenvollständigkeit mittel (grep-basiert, keine Typfluss-Analyse, keine Testausführung).
- Grenzen: keine Test-/Build-Ausführung (Auftrag); keine Laufzeitverifikation (Gateway nicht angetastet); `dist/`-Artefakte nicht als Beleg; dynamische `import()`-Pfade und `export *`-Kollisionen nur statisch geprüft; Fremd-Owner-Dateien nur lesend.
- I0/G1: nicht bestanden, nicht behauptet. Dies ist Analyse, keine Freigabe.
