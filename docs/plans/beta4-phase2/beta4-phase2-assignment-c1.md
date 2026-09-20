---
type: "Plan"
title: "Beta 4.0 phase-2 analysis assignment C1 (archived original)"
description: "Original German work order for worker C1 covering packaged pilots and annotation provider analysis."
tags: ["beta-4", "phase-2", "assignment", "c1"]
status: "draft"
authority: "directive"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/assignments/C1.md"
  origin_sha256: "04ae854fe708b83422976ce3589c19e9b33e693ac8e064c3283d98d9915098e0"
  origin_bytes: 6259
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "assignments/C1.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# C1 – Plugin-Piloten und Abhängigkeiten: Analyseauftrag

## Auftrag und Grenze

Du bist Worker C. Erstelle die Analyse und ausführungsreifen Pilot-/Paketentwürfe für C1; noch KEINE Paketverschiebungen oder Implementierung. Der Nutzer will erst die vier Analysen gemeinsam reviewen. Nur lesen; Schreiben ausschließlich in deinem Ergebnisordner. Keine Produkt-/Test-/Manifest-/Lockfile-/docs-Änderungen, Löschungen, Installs, Builds, Commits, Branchwechsel, neuen Worktrees, Gateways, Deployments oder Provideraufrufe. Eigene statische Auswertungsskripte im Ergebnisordner erlaubt. Getrennte Implementierungs-Worktrees werden nach Review eingerichtet, nicht für diese Leseanalyse.

## Gemeinsame Basis

BASE = `.pibo/planning/beta4-phase2-20260920/` relativ zum Repo. Lies `BASE/README.md`, `BASE/inputs/source-verification.json`, vollständigen `BASE/inputs/pibo-beta4-arbeitsplan-v3.md`, die Originale `BASE/inputs/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md`, `AGENTS.md`, `GLOSSARY.md`, `DESIGN.md` und relevante aktuelle Specs. K07 ist ausschließlich das Core-Attachment-System; alle älteren MCP-/WebMCP-Interaktionsvorschläge sind verworfen. Bestehende Plugin-Tools bleiben der Weg für fachliche Agentenfunktionen.

Erwartet: Branch `beta/4.0-plugin-system`, Dispatch-HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`. Anfang/Ende Branch, HEAD, UTC-Zeit, Workspace, git status --short protokollieren. Abweichungen/fremde Änderungen benennen, nicht korrigieren. I0/G1 nicht als bestanden annehmen; kein vorhandenes dist als frisch geprüfte Quelle behandeln.

## Untersuchung

1. Inventar der tatsächlichen First-Party-Pluginfamilien und des Paketbaus: Backend, UI, Ressourcen/Skills/Kontext, Manifeste, Tests, Abhängigkeiten, Einstiegspunkte. Root als privater Buildworkspace von installierten Paketen unterscheiden. Die historisch gefundenen 22 vs 21 Paketregeln aktuell prüfen; Paketkatalog, Standard-Auswahl und Zahlengates nicht vermischen. Root/Lock/Builder gehören später I.
2. Zwei konkrete Piloten vollständig planen: Web Search und das ausdrücklich zu erhaltende `pibo.vscode-web`. Für beide genaue Quelldateien, minimale öffentliche Hostdienste, Browser-/Backendexports, Ressourcen, package.json-Entwurf und isolierte Build-/Installtests beschreiben. Keine neuen Repositories. Keine privaten src-Querimporte und kein zufälliges Root-node_modules als versteckter Laufzeitlieferant.
3. Zusätzlich einen schwierigen echten Tool-/Auth-Fall aus File Editing oder Transkription auswählen. Heutigen schweren Importpfad, nötige Aufrufzusage, kleinstmögliche Entkopplung und geplanten Durchstichtest erklären. Pi gehört B, andere Runtimes/Plugins C, Workflow-Funktion D. Einzelne Runtimebibliotheken nicht nur wegen weniger Importe entfernen; vendorte/dynamische Zugriffe berücksichtigen.
4. K02/K03 aus Sicht des häufigsten Plugin-Aufrufers bewerten. Liefere eine konkrete alternative Interfaceform samt Beispiel, Fehler-/Abbruchverhalten und Begründung nach Depth/Locality. Keine zusätzliche Frameworkschicht und keine neuen globalen Credentialrechte. Widersprüche zu B/D sind Reviewfragen, keine Gründe, diese Analyse unvollständig liegenzulassen.
5. Web Annotations als realen K07-Anbieter vorbereiten. Aktuellen Weg von Auswahl/ID/Medien über Composer und Nachrichtenaugmenter bis Modellinhalt ermitteln. Festgehaltene JSON-Fassung, fachliche Toggleoptionen, UI-State getrennt vom Payload, versioniertes Schema, Preview/Fallback, Kachelspannweiten und Ressourcenabhängigkeiten beschreiben. Zukunftsvertrag benutzt Ds Core-Draft und öffentliche Registrierung; kein eigener Attachmentstore/Sendepfad.
6. K07-Rahmen aus V3 vollständig bewahren: Grid über Input max 12×3, schmal 3×3, Overflowseiten; Core-X; im Kopiermodus nur Core-Auswahl-Toggles bedienbar, X deaktiviert; persistenter Sessiondraft; bestätigte Kopier-Snapshots mit neuen Ziel-IDs; Materialisierung erst beim Senden; bestehende Bild-/Dateifähigkeit bewahren. Pluginpayload legt keine Systemrolle/Berechtigung fest.
7. Die echte spätere Abhängigkeit benennen: D1-Core-Pilot → I-Integration → C1-Annotations-End-to-End → G1. In dieser Analyse ist weder ein Pilot verlangt noch ein Warten auf D nötig: konkrete Verbraucheranforderungen und Fixtures als Markdown/JSON-Beispiele liefern, fehlende Entscheidungen sichtbar halten.
8. Restliche Familien zu wenigen sinnvollen Umsetzungsbündeln ordnen; keine Mikro-Aufteilung in einen Agent pro Plugin. Quelle/Bundle/Installgewicht unterscheiden; per-Plugin-Einsparung ohne neue Metafiles als Hypothese markieren.

## Pflichtdokumente

Nur `BASE/results/C1/`:

- `analysis.md`: Baseline/Methode, IDs `C1-01...`, Plugin-/Dependency-Ownermatrix mit aktuellen Quellbelegen, heutige Pilotpfade, konkrete Entkopplungsblocker und Grenzen. Externe Plugins sind bereits grundsätzlich unterstützt; nur First-Party-Paketquellen bewerten.
- `contracts.md`: K02/K03/K05/K06/K07-Verbraucheranforderungen und Beispiele; zwei Pilotmanifest-Entwürfe, schwieriger Fall und Annotationprovider-Entwurf; vorhandene vs vorgeschlagene Exporte markieren. Klare Owner/Fehler-/Lifecycle-/Copy-Regeln. Kein als umgesetzt ausgegebener SDK-v1-Stand.
- `implementation-plan.md`: wenige große C1/C2-Bündel mit Dateien, Abhängigkeiten, geplanten isolierten Tests und Benennung bestehender Prüfungen. Web Annotations erst nach Ds integriertem Stand umstellen; vorher unabhängige Piloten bearbeiten. Reihenfolge/Review/Integration und Rücknahme samt Datenerhalt erklären.
- `handoff.md`: höchstens ca. 120 Zeilen; `ANALYSIS_COMPLETE`/`BLOCKED`, Baseline, Links, wichtigste Befunde, Anfragen an B/D/I und Test-/Messlücken. Tatsächlich ausgeführte Checks von geplanten Tests trennen. Keine fertigen Pilotpakete oder G1-Freigabe behaupten.

Keine Tests schwächen oder neue Skips empfehlen. Aktives VS-Code-Web, beide Loop-Modi, aktuelle Tools/Namespaces und Benutzerdaten erhalten. Keine Secrets. Keine parallelen OKF-Indizes/Logs. Ergebnisdateien auf Widersprüche prüfen.

## Abschluss

Erst Dateien fertigstellen, dann höchstens 400 Zeichen:
`C1 ANALYSE FERTIG | <absoluter handoff.md-Pfad> | <Blocker oder keiner>`.
Danach stoppen; keine weiteren Sessions, keine C2-Umsetzung ohne Folgeauftrag.
