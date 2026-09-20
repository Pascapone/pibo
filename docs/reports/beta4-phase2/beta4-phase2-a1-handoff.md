---
type: "Research"
title: "Beta 4.0 phase-2 A1 handoff summary (archived research)"
description: "Worker A1 handoff summary from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "a1", "handoff"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T17:30:00Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/A1/handoff.md"
  origin_sha256: "ef98ab78fa1539a329af486d1215279175559fe6457c5288e92dd913b2213b8d"
  origin_bytes: 3310
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/A1/handoff.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# Übergabe: A1 Analyse – Altlasten und Funktionsschutz

Status: ANALYSIS_COMPLETE
Baseline: `beta/4.0-plugin-system` @ `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`, 2026-09-20, Workspace `/mnt/c/Users/pasca/Coding/pibo`. Fremde `docs/`-Änderungen benannt, unangetastet. Kein Branchwechsel/Commit/Build.

Dokumente (alle unter `BASE/results/A1/`):

- `analysis.md` — Befunde A1-01..A1-16, Delete/Keep/Migrate-Matrix, Risiken/Grenzen
- `contracts.md` — K01/K05/K07-Zusagen, Alias-Matrix, TUI-Übergabe, Anforderungen an B/C/D/I
- `implementation-plan.md` — Pakete LP-01..LP-05, Testalt→Testneu, Gates, Rollback

Fünf wichtigste Befunde:

1. Ralph-Insel (`src/ralph/*`, alte API/UI/CLI, 1744 Zeilen) produktiv unerreicht — DELETE nach Testablösung.
2. Alle Ralph-Aliase (CLI-Name, `/ralph`-Pfade, Modus, Tabellen, Katalogfelder) + `pibo-ralph.sqlite` bleiben — KEEP.
3. `runPiboTui` + 72 Zeilen TUI-Verdrahtung aufruferlos — DELETE, Datei danach an B; `src/session-ui/*` aktiv — KEEP.
4. Zehn Loops-Testlücken (Timeout, Unknown-Profile, Stop/Cancel/Cleanup, Overrides u. a.) zuerst schließen — sonst unbelegter Delete.
5. Extension aus HEAD/Index entfernt (nur ignorierte 964K-Reste + 3 tote Packausschlüsse); Attachments via WEB-*-Tests geschützt, AT-01–AT-22 sind NEU.

Entscheidungen/Anfragen: C bestätigt LP-01-Loops-Tests + Schreibschutz Loop-Dateien; B prüft Löschungen + übernimmt TUI-Datei (inkl. `adapter.ts:199,811`-Feld); D hält Composer/Annotation-Dateien stabil, AT-01–AT-22 als neue Tests; I patcht Packausschlüsse separat, entscheidet G1. Vorgeschlagene Reihenfolge: LP-01 → LP-02+LP-03 → LP-04 → LP-05 → G1.

Ausgeführte Checks (alle lesend, Ergebnis): Importgraph src/ralph (0 prod. Verbraucher); CLI-Dispatch (`pibo ralph`→`runLoopCli`); Routenregistrierung (`/ralph`→Loop-Handler); UI-Routen (`/ralph`→Loops, `RalphArea` 0 Nutzer); Store-Schema/Migration (`loop_mode`, gleiche Tabellen); TUI-Aufrufersuche (0); `git ls-files`/`check-ignore` chat-vscode (0 getrackt, dist ignoriert); Spec-/Test-Matrix (ORCH-LOOP, WEB-*); Zeilenzählung aller Bündel.

NICHT ausgeführt: keine Test-/Build-/Typcheck-Läufe, keine Laufzeit-/Gateway-Prüfung, keine `dist/`-Belege, keine Typfluss-Analyse jenseits grep, keine Doku- oder Codeänderung.

Explizit: noch keine implementierte A1-Freigabe, keine G1-Abnahme. I0/G1 nicht bestanden.

Korrekturen R-A1-01..04 (reine Doku, keine Produktänderung):

- R-A1-01: Annotationsauswahl heute global geteilt (`web-annotation-storage.ts:122-143`), nur Overlay sessionbezogen; Sessiondraft/Snapshot/Sessionbesitz = K07-NEU. `chat-files.ts` liefert textuelle Pfadreferenzen; Medienparität = Funktion pro Adapter. Korrigiert in `contracts.md` §3, `analysis.md` A1-16.
- R-A1-02: K07-Pilot D1→I→C1 VOR G1; diese Runde nur getrennte Analysen, keine Worktrees. Korrigiert in `contracts.md` §6, `implementation-plan.md` §Voraussetzungen.
- R-A1-03: A-Gate = eigene Entfernliste (`pi/runtime.ts`, `index.ts`); `adapter.ts:199,811` = explizite B-Restliste; globaler Grep-Gate erst nach B-Bereinigung. Korrigiert in `contracts.md` §5, LP-04.
- R-A1-04: Rollback = eigene Commits selektiv revertieren / eigene Hunks einzeln zurücknehmen; nie pauschal `git checkout --`; Nutzerarbeit erhalten. Korrigiert in LP-03.
