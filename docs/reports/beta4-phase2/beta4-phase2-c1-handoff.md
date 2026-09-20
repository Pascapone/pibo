---
type: "Research"
title: "Beta 4.0 phase-2 C1 handoff summary (archived research)"
description: "Worker C1 handoff summary from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "c1", "handoff"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/C1/handoff.md"
  origin_sha256: "c35e73361fd3a373c33378ae08f1c2f414a763715ecbe8f4835dd7f6fcc9b93a"
  origin_bytes: 4115
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/C1/handoff.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# C1 – Handoff: Plugin-Piloten-Analyse

Status: `ANALYSIS_COMPLETE` (Analyse fertig; keine Piloten gebaut, keine G1-Freigabe).
Review-Runde R-C1-01…R-C1-06 eingearbeitet; nur Docs korrigiert, kein Code.

## Baseline

- Branch `beta/4.0-plugin-system`, HEAD `ece5f18…b9a` (Anfang = Ende, = Dispatch).
- UTC: 2026-09-20T14:48:30Z → Dateien geschrieben nach 14:54:52Z-Baseline.
- Workspace `/mnt/c/Users/pasca/Coding/pibo`; fremde Diffs (nicht korrigiert):
  `M docs/log.md`, `M docs/project/okf-migration-ledger.json`,
  `M docs/reports/index.md`, 2× `?? docs/reports/beta-4-0-*.md`.
- V3/Skill-Hashes gegen `source-verification.json` geprüft: alle 6 Treffer ok.

## Links (diese Analyse)

- `BASE/results/C1/analysis.md` (C1-01…C1-11, Owner-Matrix, Blocker B-21GATE…B-RETIRED)
- `BASE/results/C1/contracts.md` (K02/K03/K05/K06/K07, 2 Pilotmanifeste, K07-Anbieter)
- `BASE/results/C1/implementation-plan.md` (Bündel P/T/F/R/W/K, Tests, Rücknahme)
- `BASE = .pibo/planning/beta4-phase2-20260920/`

## Wichtigste Befunde

1. 22 Artefaktregeln vs drei 21-Gates + Cutover-Test: Gates blockieren den
   vollständigen Standard-/Candidate-/Compute-Pfad (nicht logisch jeden
   isolierten Pilot-Artefaktbau); Ursache `a3472458` (remote-agent als 22.
   Paket). I-Entscheid + prüfbare SDK-/Paketbasis nötig; Vorbereitung läuft
   weiter (R-C1-01).
2. Piloten tragfähig: web-search (laufzeit-dependenzfrei, aber Pi-exklusiv via
   Provider-Tool-Extension) und vscode-web (ein Hostdienst, sauberste
   Browser-Fläche) — beide werden als C1-Implementierungspiloten gebaut,
   nicht erst C2 (R-C1-06).
3. Schwierige Fälle gewählt: Transkription (K03, Pi-Credential-Defaults mit
   Injektions-Seam) primär, File Editing (K02, Pi-Read-Wrap) sekundär; K03
   als Vergleich owner-gebundener Optionen, kein General-Fetch (R-C1-03).
4. Häufigster Aufrufer (7× Session-Tool-Provider): schlanker C-Einstieg nur
   ein Kandidat (kein Pflicht-Wrapper; nichts wird nebenbei portabel,
   R-C1-04); B-Alternative bleibt G1-Entscheid.
5. Annotations-Ist lückenlos belegt (Composer→Augmenter→Live-Read→XML→Commit);
   K07-Deltas (Snapshot, JSON, Commit-Benachrichtigung, Screenshot-Bytes)
   als C-Anforderungen formuliert, Umsetzung erst nach D1-Pilot→I→C1.
6. Browser-Bundles duplizieren Core-UI (9× ToolFamily-Shell) → K05-Entscheid D.
   Bundling je Dependency nach (a)–(d) bewerten, kein Pauschalurteil (R-C1-02).
   Versionen/Artefaktprüfungen bleiben getrennt, Werte aus I-Katalog (R-C1-05).

## Anfragen an B/D/I (+A)

- B: K02-Lesezusage, K03-Option (kein General-Fetch ohne Security-Review),
  Codex-Refresh-Besitz, Provider-Tool-Grenze, SDK-Kandidaten,
  builtin-profiles-Besitz (RQ-B1…B6).
- D: K05-Shell (Bridge vs Duplikation), `PiboWebApp`-Versionierung,
  K07-Commit-Benachrichtigung + Ressourcen/Receipt (RQ-D1…D3).
- I: 21-vs-22 (Builder + Cutover-Test + Compute-Gate), Paketmuster,
  C2-Testumgebung (RQ-I1/I2).
- A: agent-delegation-Reste löschbar? Attachment-Gegenprüfungsmatrix?

## Auflösung R-C1-01…R-C1-06 (knapp)

- R-C1-01 Gates≠Pilotblockade: analysis C1-01/C1-10, contracts §4.2, plan P/Messung.
- R-C1-02 Bundling-(a)–(d): analysis C1-03, contracts §4.2, plan Messung.
- R-C1-03 kein General-Fetch: contracts §2.2, analysis C1-06, plan T1.
- R-C1-04 nur Kandidat: contracts §1.2/§1.4, analysis C1-08, plan F.
- R-C1-05 Versionen/Vendoring: contracts §4.2, analysis C1-03/C1-10.
- R-C1-06 C1-Piloten + headful: plan Phasen/P/T, handoff Befund 2.

## Test-/Messlücken

- Ausgeführt (statisch, lesend): Hashprüfung, Regelzählung 22/21,
  Importkanten-Auszug, Historiennachweis — keine Builds/Tests/Installs
  (gilt auch für diese Review-Runde: nur Docs).
- Geplant (C1-Piloten P/T nach Review + I0, C2-Rest nach G1; nicht ausgeführt):
  isolierte Pilot-Builds/Installs, Durchstich-Tests mit kontrollierter
  Gegenstelle, AT-C-Anteil, echte headful VS-Code-Abnahme (kein Mock-Ersatz),
  Byte-Messung.
- Alle Einsparungsaussagen sind Hypothesen; bestehende Tests nur benannt,
  keine geschwächt/entfernt; keine fertigen Pilotpakete behauptet.
