---
type: "Plan"
title: "Beta 4.0 phase-2 analysis assignment B1 (archived original)"
description: "Original German work order for worker B1 covering runtime and tool interfaces analysis."
tags: ["beta-4", "phase-2", "assignment", "b1"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/assignments/B1.md"
  origin_sha256: "b036bf5accba3e5749d4c57aeb585127321b57fe3fa572527b43e8baecfa0fdb"
  origin_bytes: 6123
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "assignments/B1.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# B1 – Kernverträge und Runtimegrenzen: Analyseauftrag

## Auftrag und Grenze

Du bist Worker B. Liefere die quellengeprüfte Analyse und ausformulierte Vertragskandidaten für B1. Diese Runde ist die vom Nutzer angeforderte Analysevorbereitung, NICHT die Implementierung der im V3-Plan beschriebenen Piloten/Host-Dienste. Keine Änderungen an Produktcode, Tests, Manifeste, Lockfile oder docs; keine Löschungen, Installs, Builds, Commits, Branchwechsel, neuen Worktrees, Gateways, Deployments oder Provideraufrufe. Statische Leseanalysen und eigene Skripte nur im Ergebnisverzeichnis sind erlaubt. Spätere Implementierung in separaten Worktrees bleibt Pflicht, wird jetzt noch nicht gestartet.

## Gemeinsame Basis

BASE = `.pibo/planning/beta4-phase2-20260920/` relativ zum Repo. Pflichtlektüre: `BASE/README.md`, `BASE/inputs/source-verification.json`, vollständiger `BASE/inputs/pibo-beta4-arbeitsplan-v3.md`, die Originale `BASE/inputs/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md`, `AGENTS.md`, `GLOSSARY.md`, relevante heutige Specs. Keine alte K07-MCP-Recherche verwenden: K07 ist nur das einheitliche Core-Attachment-System, kein zusätzlicher Server/Tool-Layer.

Erwarteter Branch `beta/4.0-plugin-system`, Dispatch-HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`. Anfang/Ende: Branch, HEAD, UTC-Zeit, Workspace, `git status --short` dokumentieren. Fremde Änderungen nicht anfassen. I0/G1 und vorhandene dist-Artefakte nicht als frisch geprüfte Baseline ausgeben.

## Untersuchung

1. Aktuelle öffentliche SDK-/Host-/Runtime-, Tool-, Ressourcen- und Provider-Auth-Verträge inventarisieren. Für K01–K03 den vorhandenen Export, heutigen Aufrufer und tatsächlichen Owner zuordnen. Vorhandenes zuerst; nur konkrete Lücken schließen, keine neue Runtime-/Tool-/Credentialwelt.
2. Aktive Runtime-Session- und Nachrichtenannahmewege nachvollziehen: Annahme vs Abschluss, Queue, Capabilitykontrollen, semantische Ereignisse, Bindings, Revisionen, Generationen, Abbruch, verspätete Events, Dispose/Cleanup, Wiederaufnahme und fehlende native Daten. Funktionen und Fehler anhand aktueller Tests beschreiben, nicht anhand alter Doku verallgemeinern.
3. K01, K02, K03 als vollständige Vertragskandidaten liefern: konkrete TypeScript-Exports/Signaturen (CURRENT/PROPOSED markieren), Eingaben/Ergebnisse, Aufrufbeispiele, Invarianten, Reihenfolge, Fehler, Abbruch, Nebenläufigkeit, Ressourcenbesitz, Konfiguration, Limits und erlaubte Imports. Keine `any`-Mega-Objekte oder pauschale Weitergabe des gesamten Hosts an Plugins.
4. Pi-Wertimporte über neutrale Corepfade prüfen, besonders compaction-prompt/provider-recovery und breite reexports. Type-only-Importe sind keine Laufzeitabhängigkeit; esbuild inputs sind kein Beleg ausgelieferter Bytes. Vorhandene Metafiles nur mit Herkunft auswerten und `bytesInOutput` beachten. Neue Builds nicht ausführen. Klare Aufteilung allgemeine Konfiguration vs Pi-spezifische Durchführung vorschlagen. As TUI-Dateibereich ist bis zur späteren geprüften Übergabe gesperrt.
5. Einen schwierigen konkreten Verbraucher (File Editing/Remote Agent oder Transkription) auf K02/K03 abbilden. Bereits injizierbare Zugänge nutzen; statisch importierte schwere Default-Implementierungen getrennt betrachten. Credential-Owner und Scope bleiben unverändert, keine Credentialkopien/Secrets in Browser/Logs.
6. Für eine kritische tatsächliche Seam drei unterscheidbare Entwürfe vergleichen: kleinste vollständige API, häufigster Plugin-Aufruf, Workflow-/Erweiterungssicht. Nach Depth, Locality und notwendiger Austauschbarkeit bewerten; eine Empfehlung, keine Summe aller Varianten. C/D verfassen unabhängig ihre Verbrauchersicht; eventuelle Unterschiede im Review klären, nicht auf ihre fertigen Dokumente warten.
7. K07: D besitzt JSON-/Draft-/Grid-/Copy-/Sendesemantik. B besitzt ausschließlich nötige neutrale Exporte, bestehende Registrierung sowie Ressourcen-/Runtime-Anschlüsse. Verfolge heute mindestens einen Bild- und Dateipfad bis zur tatsächlichen Modellzustellung. JSON-Umschlag darf native Medienfähigkeit nicht in unbrauchbaren Text/Pfad degradieren. Aufnahmen bleiben sessiongebunden, Rollen/Berechtigungen nicht aus Plugin-Payload ableiten. Konkrete Anforderungen und Testfälle an D/C formulieren, keinen zweiten Attachmentkern entwerfen.

## Pflichtdokumente

Schreibe ausschließlich `BASE/results/B1/`:

- `analysis.md`: Baseline/Methode, aktuelle Export-/Verbraucherkarte, Belegstellen und IDs `B1-01...`, Lücken, Import-/Paketgrenzen und Risikobewertung; historische/eigene Analyse/ungeprüfte Annahme klar markieren.
- `contracts.md`: detaillierte K01–K03-Kandidaten plus B-Anschlüsse von K04/K07; aktueller Vertrag vs Veränderung, kleine Aufrufbeispiele, Fehler-/Lifecycle-/Scope-Tabellen, alternative Entwürfe und Entscheidung. Bestehende öffentliche Namen erhalten. Ungeprüfte Signaturen nicht als freigegeben v1 bezeichnen.
- `implementation-plan.md`: zusammenhängende B1/B2-Schritte, benötigte Dateien, Contract-Testplan mit konkreten vorhandenen Testnamen/Kommandos, geplante reale Gegenstellen, Abhängigkeiten an A/C/D/I, übergebbare Zwischenstände. Prüfen der Produktionsadapter nicht durch pauschale Mocks ersetzen. Root-/Lock-/Builderänderungen als Auftrag an I, zentrale Webdateien als Auftrag an D.
- `handoff.md`: höchstens ca. 120 Zeilen, `ANALYSIS_COMPLETE`/`BLOCKED`, Basis, Links, wichtigste Befunde, Schnittstellenanforderungen und Konflikte, echte Checks vs nicht ausgeführte Tests, genaue nächste Freigaben. Explizit keine benutzbare neue Implementierung und keine G1-Abnahme behaupten.

Dokumente mit Pfad:Zeile/Symbol belegen, keine Secrets. Prüfsätze nicht abschalten/verwässern. Fehlende Tools oder Blocker ehrlich festhalten; keine Verbraucher durch private Querimporte umgehen. Keine kanonischen OKF-Dateien schreiben. Abschließend eigene Dokumente lesen und Pfade prüfen.

## Abschluss

Nur höchstens 400 Zeichen im Chat:
`B1 ANALYSE FERTIG | <absoluter handoff.md-Pfad> | <Blocker oder keiner>`.
Dann stoppen; keine Folgeimplementierung und keine zusätzlichen Agentensessions.
