---
type: "Research"
title: "Beta 4.0 phase-2 D1 handoff summary (archived research)"
description: "Worker D1 handoff summary from the analysis-only round, archived as non-approved research with an OKF envelope."
tags: ["beta-4", "phase-2", "d1", "handoff"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/results/D1/handoff.md"
  origin_sha256: "4da72f53b7ef7421b8de9bd74fb9c9ac8fee357bab1de443da31105c6f3409fe"
  origin_bytes: 3200
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "results/D1/handoff.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# D1 – Handoff (Analyse)

Status: ANALYSIS_COMPLETE (Korrektur R-D1-01–R-D1-06 eingearbeitet)
Basis: Branch `beta/4.0-plugin-system`, HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`,
Workspace `/mnt/c/Users/pasca/Coding/pibo`. G1-Freigabe steht aus.
Zeiten (UTC): Initial 2026-09-20T14:48:52Z–~15:00Z; Korrektur ab 15:01:51Z, Ende s. Chat.

## Links

- `results/D1/analysis.md` — Belege D1-01–D1-15, Callgraph, Limits, Risiken
- `results/D1/contracts.md` — K04/K05/K07-Entwürfe v0 + Alternativen
- `results/D1/implementation-plan.md` — D1/D2-Folge, AT-01–AT-22-Mapping, Rollback

## Wichtigste Befunde

1. Workflows: Core-Implementierung in `src/apps/chat/`; `packaged-workflows` ist
   View-only-Stub (`register("view", {})`). Kein zweiter Sessiontyp (Link-Modell).
2. Attachments heute zweigleisig: Dateien direkt in `sendChatMessage`, Annotations
   via Augmenter; Upload-Auswahl flüchtig (max 10), Annotations-Auswahl global
   (max 5, folgt Sessions) — kein Snapshot, kein Grid/X/Copy/Revisionen.
3. Server-Annahme durable (`admissionVersion: 2`, Receipt-Pflicht, `clientTxnId`
   max 160, Idempotenz via Txn-Key, `acceptanceUnknown`-Pfad) — K07 baut darauf auf.
4. Prism-Duplikat belegt (2 identische `prism-client.ts` mit echten Verbrauchern);
   sonst kein belegter Web-Helper-Duplikat (Negativbefund).
5. Fünf Coreansichten korrigiert: 3 Workspace-Areas + 2 Session-Tools (R-01 aufgelöst).

## Entscheidungen (Vorschlag)

- K04: kleine Fassade (validate/publish/start/actions/cancel); Port-Variante dokumentiert.
- K05: nur `highlightCode`-Zusammenführung neu; Verträge sonst unverändert.
- K07: `SessionAttachmentDraft` (add/update/remove) + Provider-Vertrag; Convenience-
  Wrapper optional bei C; Event-Sourcing verworfen.

## Anfragen

- B (R-02/R-04/R-06/R-08): K07-Exportdatei? Prüftrennung Berechtigung/Draftbindung?
  Medien-Scope? Schema-/Typ-/Materialisierungsgrenze? (D/B-Owner beibehalten)
- C (R-03/R-07): Anbieter liefert Schema/Payload/Renderer/Größen; kein eigener Store/Sendepfad?
- I (R-05): Paketgrenze Prism-Shared-Modul? (R-01 aufgelöst, keine Frage mehr)

## R-D1-Auflösung (kurz)

- R-D1-01: 5 Ansichten = Settings/Agent Designer/Kontext + Session Inspector/Raw Events.
- R-D1-02: Upload = physisches Staging, Materialisierung erst beim Senden; Upload-Store
  als Draft-Ressource prüfen; browserlokal vs. serverseitig = technische Alternativen.
- R-D1-03: App Context geteilt; Leseberechtigung ≠ Draft-Sessionbindung; Kopie erlauben.
- R-D1-04: Heutige textuelle Pfadprojektion ist Baseline; keine Pflicht-Kanäle ohne Scope.
- R-D1-05: `clientRequestId` + „427“ aus K04-Kern gestrichen; Idempotenz = separate Option.
- R-D1-06: K07-Typen sind Skizzen (`unknown`/Platzhalter); R-08 dokumentiert Lücken.

## Tests/Checks

- Ausgeführt (read-only): git branch/rev-parse/status, date, ls/find/grep-Inventur,
  ripgrep-Suchen, Datei-Lektüre. Keine Builds/Testläufe/Installs/Provideraufrufe.
- Geplant: vorhandene Suites unverändert + neue K07-Contract-Tests je AT-01–AT-22.
- Keine Pilotstände, keine G1-Checks, keine Browsernachweise behauptet. I0→A1–D1→G1
  wird durch diesen Review weder ersetzt noch übersprungen.
