---
type: "Review Record"
title: "Beta 4.0 phase-2 research acceptance"
description: "Acceptance of the research and planning basis with open points RV-01 to RV-08; no implementation release."
tags: ["beta-4", "phase-2", "acceptance", "review"]
status: "stable"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T17:30:00Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Unchanged host original; see checkpoint provenance for path and hash"
checkpoint:
  origin_path: ".pibo/planning/beta4-phase2-20260920/checkpoint-review.md"
  origin_sha256: "87b9f91d0215ef475b49b15d9301e4f20566b4edb68d9c2768f18eb0b0b61947"
  origin_bytes: 6285
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "checkpoint-review.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# Rechercheabnahme vor dem Dokumentations-Checkpoint

Datum: 20. September 2026.
Status: ALS RECHERCHE- UND PLANUNGSGRUNDLAGE AKZEPTIERT; KEINE IMPLEMENTIERUNGSFREIGABE.
Gegenstand: Gesamtaudit und Inventar, unabhängige Legacy-Gegenprüfung, V3-Plan mit K07, vier Analyseaufträge und ihre 16 korrigierten Ergebnisdokumente, gemeinsame Sichtung.
Untersuchte historische Quellbasis der Berichte: beta/4.0-plugin-system @ ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a. Der Git-Stand für den Commit ist gesondert aktuell zu prüfen; ein Dokumentationscommit macht alte Quellbelege nicht automatisch aktuell.

## Urteil

Die Recherche erfüllt ihren Zweck: Sie benennt konkrete Quellstellen und Verbraucher, trennt aufgegebene Altimplementierungen von erhaltenen Produktfunktionen, zeigt echte Paket-/Importkopplungen und macht die K07-Anforderungen sichtbar. Die vier Übergaben dokumentieren ihre Korrekturen; Analyse, Entwurf und nicht ausgeführte Tests sind voneinander getrennt. Damit ist der Bestand als überprüfbarer Zwischenstand für Git geeignet.

Dies ist kein Fehlerfreiheitsurteil über jede Zeilenzahl, jedes Beispiel oder jede Abdeckungsbehauptung. Es wurden in dieser Abschlussprüfung die gemeinsame Sichtung und die korrigierten Vertragsabschnitte erneut gelesen; wesentliche Quellbehauptungen waren zuvor gezielt gegengeprüft worden. Kein frischer vollständiger Produktbuild, keine Produktregression und keine ausgeführten neuen Piloten werden behauptet. Die vorgeschlagenen Interfaces bleiben v0/Skizzen.

## Akzeptierte Erkenntnisse

- A: Ralph-Altinsel/TUI/Extension-Reste sind getrennt vom aktiven Loops-System, normaler CLI, Session-Webdarstellung und VS-Code-Web-Plugin zu behandeln. Vor Löschung relevante Tests übertragen; beide Loop-Modi und alte Daten erhalten.
- B: Vorhandene Runtime-/Tool-Verträge zuerst verwenden; konkrete Pi-Wertimporte und schwere Default-Verdrahtungen entkoppeln. Owner-gebundene Injektion ist die untersuchte kleinere Richtung, kein neuer globaler Secret- oder HTTP-Proxy.
- C: Web Search und VS Code Web sind Paketpiloten; Transkription ist der schwierige Erstfall. Sourcegrenze, enthaltene Bundlebytes und externe Abhängigkeiten getrennt bewerten. Die 22/21-Inkonsistenz betrifft Zusammensetzung/Gates; sie beweist keinen ausgeführten Buildfehler und blockiert nicht jeden isolierten Pilot.
- D: Dateien und Annotationen haben heute unterschiedliche Attachment-Wege. Sessiongebundener Snapshot-Draft, ein gemeinsamer JSON-Vertrag, Grid und bestätigte Kopien sind bewusst beauftragte Neuerungen. Kein zusätzlicher MCP-/WebMCP-/Tool-Layer.

## Offene Punkte: im Checkpoint erhalten, nicht still lösen

RV-01: Bs Umsetzungsentwurf nennt Verbraucherdateien, die nach dem Gesamtplan C gehören. Vor Implementierung Schreibpfade disjunkt festlegen; keine parallele Änderung derselben Transkriptions-/Tooldateien.
RV-02: K07-Platzhalter und Beispielnamen sind keine abschließenden Typen. Schema, Registrierung, Revisionen, Materialisierung, Berechtigungsprüfung und Anbieter-Benachrichtigung nach Annahme gemeinsam konkretisieren. C fordert diese Benachrichtigung, Ds Skizze beschreibt ihre Signatur noch nicht.
RV-03: I0 mit aktueller Quellbasis, Testmatrix, Paketkomposition und Artefaktherkunft steht aus. Dokumentenabnahme ersetzt weder I0 noch G1.
RV-04: As Testlücken sind statische Abdeckungsbefunde, keine nachgewiesenen Laufzeitfehler. Nachfolger und echte Testläufe müssen vor Alttest-/Codelöschung nachgewiesen werden.
RV-05: Einzelne Berichtstexte sagen bei offenen K07-Details noch „vor D2“. Maßgeblich bleibt der V3-Ablauf: Benötigte Details vor dem davon abhängigen D1-/C1-Pilot klären, gemeinsamer Pilot vor G1, große Umbauten erst danach. B/C/D-Entwurfspräferenzen sind noch keine gemeinsame Architekturfreigabe.
RV-06: K01-P2s pauschale Formulierung zu Events nach abort/dispose darf nicht ungeprüft umgesetzt werden. Normales Abbruch-Abschlusssignal, Rückkehr von abort, Ende einer Generation und veraltete Ereignisse müssen anhand bestehender Implementierungen unterschieden werden. Keine Verhaltensänderung durch eine zu breite Regel.
RV-07: Der V3-Plan nennt Draft-Bytes vor Versand und Nachrichtenmaterialisierung erst beim Senden. Die Recherchen schlagen vor, bestehenden Upload-Storage als physisches Draft-Staging zu prüfen. Das ist eine technische Alternative, keine stillschweigende Änderung der Produktzusage. Genau festlegen, welche Persistenz wann passiert; Originalvorgabe und Vorschlag getrennt bewahren.
RV-08: Der Medienweg muss das tatsächlich vorhandene Verhalten je Adapter erhalten. Ein neuer nativer Prompt-Bildkanal ist nicht allein aufgrund eines Capability-Flags Pflicht; auch ein reines Manifest oder Screenshot beweist keine Laufzeitfähigkeit.

## Umfang der aktuellen Erlaubnis

Pascal hat jetzt ausdrücklich die Prüfung und, bei Akzeptanz, das Committen unserer Recherchen und Pläne erlaubt. Keine Erlaubnis für A1–D1-Implementierung, neue Sessions, Folgeaufträge für B2/C2/D2, Worktree-Löschungen, Merge anderer Featurebranches, Push, Publish oder Deployment.

Die frühere vierfache Analyse wurde vor der damals verlangten Abnahme irrtümlich gestartet. Das bleibt in der Provenienz sichtbar. Der Ordner review-r1 ist ein historischer Abnahmeentwurf und war nicht „fremde Arbeit“; die damalige approval=false-Datei darf nicht rückwirkend als Startfreigabe umgedeutet werden. Die heutige Erlaubnis ist eine neue, nur auf Dokumentensicherung begrenzte Freigabe.

## Commit-Regeln

Nur geprüfte Dokumentationspfade und die nach OKF notwendigen Indizes/Logs/Ledgeränderungen stagen. Vorhandene fremde Änderungen, Produktcode, Tests, Paketmanifeste und Lockfiles bleiben unberührt. Kein pauschales git add -A, kein Erzwingen des gesamten ignorierten .pibo-Verzeichnisses und kein unkontrollierter Checkout/Reset.

Originale, HTML und Skillquellen nachvollziehbar mit Quellpfad/Hash archivieren; kuratierte Dokumente haben klare Rollen als Plan, Research/Review oder Historical Record. Keine nie ausgeführten Tests grün erklären. Fehler dokumentationsbezogener Prüfungen ehrlich benennen; keine Validatorregeln abschwächen. Gegebenenfalls vorbestehende fremde Prüffehler bleiben als solche sichtbar und werden nicht nebenbei repariert.
