---
type: "Plan"
title: "Beta 4.0 phase-2 analysis assignment A1 (archived original)"
description: "Original German work order for worker A1 covering legacy cleanup and behavior protection analysis."
tags: ["beta-4", "phase-2", "assignment", "a1"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/assignments/A1.md"
  origin_sha256: "a0e17731ea959969ac3ec1e3b56102aefb7f3256e63851b8f26c0910546f0c5f"
  origin_bytes: 5761
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "assignments/A1.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# A1 – Altlasten und Funktionsschutz: Analyseauftrag

## Auftrag und Grenze dieser Runde

Du bist Worker A. Erstelle die belastbare Vorbereitung für A1, NICHT schon den Lösch-/Implementierungsstand des Gesamtplans. Pascal will zuerst vier Analysen lesen und gemeinsam reviewen. Analysiere eigenständig bis zu einer vollständigen schriftlichen Übergabe. Keine Produktdateien, Tests, Manifeste oder kanonische docs ändern. Keine Löschungen, Installs, Builds, Commits, Branchwechsel, neuen Worktrees, Gateways, Deployments oder Provideraufrufe. Leseoperationen und eigene Auswertungsskripte im Ergebnisverzeichnis sind erlaubt. Vier Analyse-Sessions lesen denselben Stand und schreiben getrennt; Implementierungs-Worktrees folgen erst nach Freigabe.

## Gemeinsame Basis

Ablage relativ zum Repository: `.pibo/planning/beta4-phase2-20260920/` (im Folgenden BASE).

Lies zuerst `BASE/README.md`, `BASE/inputs/source-verification.json`, den vollständigen `BASE/inputs/pibo-beta4-arbeitsplan-v3.md` sowie die drei Originale unter `BASE/inputs/codebase-design/`: `SKILL.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md`. Lies `AGENTS.md`, `GLOSSARY.md` und relevante aktuelle Specs. V3 ist die maßgebliche Originalfassung; HTML ist eine Planskizze, kein produktives Feature. K07 ist ausschließlich das einheitliche Core-Attachment-System. Keine zusätzliche MCP-/WebMCP-/Tool-Schicht.

Erwartet: `beta/4.0-plugin-system`, bei Dispatch HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`. Erfasse zu Beginn und Ende tatsächlichen Branch, HEAD, UTC-Zeit, Workspace und `git status --short`; fremde Änderungen nur benennen und nicht anfassen. Abweichungen explizit melden. Alte Auditwerte und dist-Artefakte sind kein aktueller Laufzeitnachweis. I0/G1 sind nicht als bestanden anzunehmen.

## Untersuchung

1. Belege Erreichbarkeit ab aktiven CLI-/Gateway-/Plugin-/UI-Einstiegen, nicht bloß Namensvorkommen. Prüfe `src/ralph/*`, alte `ralph-api.ts`, `RalphArea.tsx`, `api-ralph.ts`, Reexports und Test-only-Verbraucher. Trenne klar die alte Insel vom aktiven Loops-System.
2. Beide Loop-Modi bleiben: gleiche logische Session mit bestehendem Kontext und frische Session pro Iteration. Prüfe Pfade, Datenbank-/Tabellen-/ID-Kompatibilität, Altzeilen, Ralph-Aliasse, Stoppen, Abbruch, Wiederaufnahme und Ressourcenfreigabe. Zeige konkret, welcher Test welche Zusage schützt und wo ein Nachweis fehlt.
3. Prüfe verbliebenen `runPiboTui`-Einstieg samt ausschließlich interaktiver Verdrahtung. Normale CLI, Pi-Runtime und aktive Web-Renderer bleiben. Markiere exakte spätere Dateiübergabe A1 → B2. Keine pauschale Löschung von `session-ui` anhand des Namens.
4. Alte VS-Code-Extension wurde laut Vorprüfung bereits entfernt. Verifiziere HEAD/Index getrennt von ignorierten Buildresten und historischen Dateien. Aktives `pibo.vscode-web` und Suchwerkzeuge bleiben ausdrücklich erhalten. Alte Anleitungen und Packausschlüsse als eigene Hygiene-Menge behandeln, historische Evidenz nicht umschreiben.
5. Weitere belegte tote Exporte/Weiterleitungen und echte Duplikate im Umfang suchen. D besitzt gemeinsame Web-Helfer, C aktive Loops-/Plugin-Dateien. Für diese nur Hinweise liefern, keine parallele Bearbeitung.
6. Relevante bestehende Attachment-Tests als Schutzmatrix für D/C erfassen; AT-01–AT-22 des Plans als NEUE Abnahmeziele markieren, nicht als heute erfüllte Tests. Snapshot, Medienparität, Sessionbesitz und Versandidentität bleiben Kernzusagen.
7. Erstelle realistische Löschbündel mit Verbraucherbeleg und Risiko. Getrackter Sourcecode, Tests, Dokumentation und ignorierte Artefakte getrennt zählen. Keine Prozentersparnis ohne Nenner. Alter Code ist nicht allein wegen seines Alters entbehrlich.

## Pflichtdokumente – feste Pfade

Schreibe ausschließlich in `BASE/results/A1/`:

- `analysis.md`: Baseline/Methode, kurze Zusammenfassung, Befunde mit IDs `A1-01...`, aktuelle Belege `Pfad:Zeile` und Symbole, Delete/Keep/Migrate/Unklar-Matrix, erreichbare Verbraucher, Risiko/Vertrauen und Grenzen. Suchmethoden müssen dynamische Registrierung und Test-only-Importe unterscheiden.
- `contracts.md`: zu bewahrende K01/K05/K07-Verhaltenszusagen, Loop-Modus-/Daten-/Alias-Matrix, geplante TUI-Dateiübergabe an B und Anforderungen an C/D. Aktueller Vertrag und Vorschlag strikt trennen. Kein neues Interface erfinden, wenn der vorhandene Pfad reicht.
- `implementation-plan.md`: wenige zusammenhängende Arbeitspakete für denselben Worker, Reihenfolge Verhalten absichern → entfernen → Weiterleitungen bereinigen; konkrete Dateien, Abhängigkeiten, Schreib-Owner, Prüfkommandos/Testnamen, Testalt→Testneu-Matrix und Rücknahme. Kein Testskip/Assertionabbau für grüne Tests. Benenne I0- und Implementierungsvoraussetzungen.
- `handoff.md`: maximal ca. 120 Zeilen; Status `ANALYSIS_COMPLETE` oder `BLOCKED`, Baseline, Links auf die drei Dokumente, fünf wichtigste Befunde, Entscheidungen/Anfragen an B/C/D/I, vorgeschlagene Reihenfolge, tatsächlich ausgeführte Checks mit Ergebnis sowie NICHT ausgeführte Prüfungen. Explizit: noch keine implementierte A1-Freigabe/G1-Abnahme.

Keine kanonischen OKF-Indizes/Logs parallel bearbeiten. Spätere Übernahme nach docs/plans und docs/reports ist Aufgabe der Integration. Fehlende Befunde oder Werkzeuge ehrlich benennen, sinnvolle Teilanalyse trotzdem ablegen. Lies deine Dokumente abschließend auf Widersprüche und prüfe, dass die angegebenen Pfade existieren.

## Abschluss

Keine Ergebnisse als langen Chattext. Antworte erst nach Schreiben und Prüfen der Dateien, höchstens 400 Zeichen:
`A1 ANALYSE FERTIG | <absoluter Pfad zu handoff.md> | <ein echter Blocker oder keiner>`.
Danach stoppen. Keine B2/C2/D2-Umsetzung, keine weitere Agentensession und keine Selbstfreigabe.
