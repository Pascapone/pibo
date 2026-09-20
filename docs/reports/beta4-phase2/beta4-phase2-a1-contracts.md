---
type: "Research"
title: "Beta 4.0 phase-2 A1 contract draft (archived research)"
description: "Worker A1 contract draft from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "a1", "contracts"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/A1/contracts.md"
  origin_sha256: "a5d414f20c290ddb324bc6e326e9eee18ad9b02029a41247b4cb8dcc7ea0182d"
  origin_bytes: 7180
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/A1/contracts.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# A1 – Verträge: zu bewahrende Zusagen

Status: Analyse (v0-Sicht von A). Aktueller Vertrag = heute implementiert und belegt. Vorschlag = erst nach A1-Umsetzung gültig. Kein neues Interface — alle Einstiege existieren.

## 1. K01 – Runtime und Session (Ausschnitt Loops)

Aktuell (Owner B/C, A prüft): `PiboLoopService` (`src/loops/service.ts:97`) mit `startJob`/`stopJob`/`cancelJob`/`removeJob`/`reopenGoal`/Session-Goal-Ops (Zeilen 135/155/156/162/176/181/212/222); Annahme ≠ Abschluss (Reserve→Ausführung→Abschluss, `reserveAdmittedRun`, `completeRun`); höchstens ein terminales Ergebnis; unbekanntes Profil ist fatal statt Endlosschleife (ORCH-LOOP-001); Shutdown drainiert aktive Runs (`loop-service-shutdown`); Retry exponentiell 5s..5min mit Jitter; Interrupted-Recovery nach 5 Minuten (`recoverInterruptedRuns`). Session-Identität: Goal wiederverwendet `state.lastPiboSessionId`, Ralph erzeugt frische Sessions (`service.ts:580-582/596-598`). Zu bewahren über A1: keine Änderung an Session-IDs, Bindings, Protokollen (V3-K01-Nicht-Ziele).

## 2. K05 – Gemeinsames Web-Interface (Ausschnitt Loops/Ralph-UI)

Aktuell (Owner D, A prüft): Plugin-Views über registrierte Routen; `/loops` + Alias `/ralph` → Loops-Ansicht (`app-routes.ts:65`, `main.tsx:69-76`); Loop-Moduswahl inkl. Legacy-Ralph (`LoopArea.tsx:203`); Session-Ownership und Deep-Link-Verhalten unverändert. Zu bewahren: keine zweite Ralph-Ansicht, keine neue UI-Fläche durch A1; `RalphArea`-Delete ändert keine erreichbare Route (A1-03).

## 3. K07 – Attachment-Zusagen (aktuell, vor K07-Umbau)

Aktuell (Owner D, C für Annotations-Anbieter, A prüft gegen): Upload-Limits mit Overflow-Abweisung vor Verzeichnisanlage, private PIBO_HOME-Ablage (`chat-file-security`); Symlink-/Root-Boundary bei Previews (`chat-image-file-boundary`); per-Session-Upload-Auswahl (`chat-ui-upload-attachments`) — dagegen Annotationsauswahl heute GLOBAL geteilt (`WEB_ANNOTATIONS_SELECTED_STORAGE_KEY`, alte Sessionschlüssel werden hineinmigriert und gelöscht, `web-annotation-storage.ts:122-143`); nur der Overlay-State ist sessionbezogen (`:105-120`); Composer-Send mit clientTxnId/Receipt, Optimistic-Planung, unknown-vs-rejected-Unterscheidung (`chat-ui-composer-send`, `chat-indexed-admission`, `chat-ui-pending-message-delivery`, WEB-COMPOSER-ADMISSION-006/-DELIVERY-002); Datei-Download mit Progress, Drop-Pipeline, Preview-Dialog; Annotation-Bindings/Store/Tools/CDP/Scope/Validierung (`web-annotations-*`, WEB-ANNOTATION-001..005). Aktuell liefert `chat-files.ts` textuelle konsumierbare Pfadreferenzen; Medienparität schützt die tatsächliche Bild-/Dateifunktion pro Adapter und erzwingt keinen neuen nativen Promptkanal. Sessiondraft, Snapshot und Sessionbesitz der Auswahl sind K07-NEU (nicht aktuell), ebenso Grid 12×3/3×3, JSON-Vertrag, Copy-Ablage, AT-01–AT-22 — neue Abnahmeziele für D1-Pilot/D2/C2, keine erfüllten Tests.

## 4. Loop-Modus-/Daten-/Alias-Matrix (aktuell, bleibt)

| Zusage | Beleg | Schutztest |
|---|---|---|
| Neue Jobs defaulten `goal`, Altzeilen laden `ralph` | `loops/store.ts:665,681,111` | `loop-goal-mode` „new loops default to goal while legacy rows load as ralph“ |
| Goal = gleiche logische Session, Ralph = frische Session/Run | `loops/service.ts:580-582,596-598` | `loop-goal-mode` „goal mode reuses one Pibo Session while Ralph mode creates fresh sessions“ |
| `pibo ralph` = Alias mit Ralph-Defaults | `src/cli.ts:237-239,396-404` | `ralph-cli-profile-default`, CLI-Hälften, `startWithCli` in `loop-max-iterations-admission` |
| `/api/chat/ralph*` + `/api/chat/loop*` → Loop-Handler, POST defaultet `ralph` | `packaged-goal-loops.ts:50-57`, `loop-api.ts:43-45,58` | `loop-api` „Loop API defaults to goal and the Ralph alias defaults to legacy mode“ |
| `/ralph`-Route → Loops-UI mit Moduswahl | `app-routes.ts:65`, `LoopArea.tsx:203` | `chat-ui-loop-area` „exposes legacy Ralph mode“ |
| Datei `pibo-ralph.sqlite`, Tabellen `pibo_ralph_*`, FK-Cascade (fresh) | `loops/store.ts:227,681` | `loop-cascade-delete` (4 Tests), `loop-goal-mode` Legacy-Test |
| `maxIterations`-Zulassung inkl. Reopen/Restart | `loops/store.ts` Reserve-Pfad | `loop-max-iterations-admission` (4 Loops-Tests; 5. wird migriert) |
| Moduswechsel bei aktivem Run abgewiesen | Store/CLI/API | `loop-mode-edit-ownership` (5 Tests) |
| `pibo.ralph.*`-Stop-Typen weiter auflösbar | `loops/stopping.ts:127-128` | LÜCKE — neu zu testen (A1-12.7), heute nur implizit |
| `ralphJobId`/`ralphRunId`-Metadaten bei Ralph-Modus | `loops/service.ts:608,611` | implizit via Compute-Pfad; kein direkter Test (hinnehmen, dokumentiert) |
| Deprecated `getRalphStopConditionInfos`/`ralphStopConditions` | `capability-host.ts:657,780`, `channels/types.ts:112-113`, `plugins/types.ts:155-156` | `ralph-stop-conditions` „capability host exposes registered loop stop conditions“ (wandert mit) |

## 5. TUI-Dateiübergabe A1 → B (Vorschlag, nach A1-Delete)

Datei: `src/agent-runtimes/pi/runtime.ts` (681 Zeilen). A1 entfernt exakt: Import `InteractiveMode` (Zeile 10), Helper-Import `isPiboAssistantContextGuardRecoveryPending` (Zeile 46), Option + Kommentar (Zeilen 124-125), Verzweigung (Zeilen 452-454), Guard (Zeilen 616-654) + Leerzeile (655) + `runPiboTui` (Zeilen 656-681); dazu `runPiboTui` aus `src/index.ts:255`. Danach: Datei an B übergeben (B2), inklusive offenem Punkt `contextGuardTuiQueueOrdering`-Feld in `src/agent-runtimes/pi/adapter.ts:199,811` (B-eigene Datei, nie gesetzt, von B zu entfernen). A-Gate (eigene Entfernliste): `grep -rn "runPiboTui\|InteractiveMode\|TuiQueueOrdering" src/agent-runtimes/pi/runtime.ts src/index.ts` leer; `createPiboRuntime`-/`inspectPiboProfile`-Tests grün; kein `pibo`-CLI-Verhalten geändert. Explizite B-Restliste: `adapter.ts:199,811` verbleibt bewusst bis zu Bs vereinbarter Bereinigung; erst danach gilt der globale Gate (`grep` über `src test` leer).

## 6. Anforderungen an C und D

- An C (Loops/Plugins, aktiv): `src/loops/*`, Tabellen, Aliase, Modus-Semantik nicht anfassen, solange A1 läuft (Schreibschutz Loop-Dateien beidseitig einhalten); A1-Delete-Bündel gegenprüfen (C bestätigt Loops-Verhaltensverträge, V3-A1-Gegenprüfung); `pibo.ralph.*`-Kompat-Mapping und Ralph-Templates in `loops/` nicht „säubern“; neue Loops-Tests aus LP-01 reviewen.
- An D (Web/Workflow/K07): `Composer`, Annotation-, Upload-, Preview-Dateien nicht parallel ändern; `ralph-api.ts`-Delete zur Kenntnis (keine D-Route betroffen); K07-Pilot läuft D1→I→C1 VOR G1 (D bereitet parallel im abgetrennten Bereich vor): WEB-COMPOSER-*-/WEB-ANNOTATION-*-Tests müssen ab Pilot bis D2 grün bleiben; AT-01–AT-22 als neue Tests anlegen, nicht als erfüllt referenzieren.
- An B (Core/Runtime): TUI-Übergabe übernehmen (Abschnitt 5); `RuntimeRoutedSession.runtime` (`agent-runtime/routed-session.ts:292-293,329`) typbewusst prüfen; A1-Löschungen gegenprüfen (V3: B prüft A).
- An I: Packausschluss-Hygiene (`package.json:37,42,43`) als eigener Patch nach A1; kein Lockfile-/Manifest-Eingriff durch A1; G1-Gate: LP-01-Tests grün + A1-13-Alias-Tests grün + keine offenen TODOs im benötigten Pfad.
