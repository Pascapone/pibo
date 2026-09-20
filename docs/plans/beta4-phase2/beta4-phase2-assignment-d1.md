---
type: "Plan"
title: "Beta 4.0 phase-2 analysis assignment D1 (archived original)"
description: "Original German work order for worker D1 covering web workflows and attachments analysis."
tags: ["beta-4", "phase-2", "assignment", "d1"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/assignments/D1.md"
  origin_sha256: "ed8ced425cfdec786f1db026dbc1d0aaccce68baa28045b6260975013b62ae97"
  origin_bytes: 8409
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "assignments/D1.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
---
# D1 – Web, Workflows und Core-Attachments: Analyseauftrag

## Auftrag und Grenze

Du bist Worker D. Liefere die quellengeprüfte Vorbereitung für D1 und konkrete K04/K05/K07-Vertragskandidaten. Diese Runde ist ANALYSE, kein Auftrag für Produktcode, Pilotimplementation oder neue Oberflächen. Pascal will zuerst die vier Ergebnisse gemeinsam reviewen. Keine Änderungen an Source, Tests, Manifeste/Lockfile oder kanonischen docs; keine Löschungen, Installs, Builds, Commits, Branchwechsel, neuen Worktrees, Gateways, Deployments oder Provideraufrufe. Nur lesen und eigene Dokumente/statistische Skripte im Ergebnisverzeichnis schreiben. Spätere Implementierungs-Worktrees werden nach Freigabe eingerichtet.

## Basis und Pflichtlektüre

BASE = `.pibo/planning/beta4-phase2-20260920/` relativ zum Repo. Lies `BASE/README.md`, `BASE/inputs/source-verification.json`, vollständigen `BASE/inputs/pibo-beta4-arbeitsplan-v3.md` insbesondere das vollständige K07-Kapitel und AT-01–AT-22. Lies `BASE/inputs/codebase-design/{SKILL,DEEPENING,DESIGN-IT-TWICE}.md`, `AGENTS.md`, `GLOSSARY.md`, `DESIGN.md`, relevante aktuelle Specs. Keine veraltete MCP-Interaktionsidee übernehmen: K07 ist ausschließlich Attachment-Vereinheitlichung im Core, KEIN MCP-Server/Tool-Protokoll und kein neues Pluginframework. Das HTML ist eine Planskizze, kein Beweis implementierten Verhaltens.

Branch erwartet `beta/4.0-plugin-system`, Dispatch-HEAD `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`. Zu Beginn/Ende Branch, HEAD, UTC-Zeit, Workspace und git status --short dokumentieren; Abweichungen/fremde Änderungen nicht bearbeiten. I0/G1 nicht als bestanden annehmen. Historische Tests/Builds und gemischtes dist nicht als frische Prüfung ausgeben.

## Untersuchung 1: Web und Workflows

- Konkrete Workflow-Wege und ihre heutigen Owner über Backend/UI/Store ermitteln: Entwurf, Veröffentlichung, Ausführung, Benutzeraktion, Sessionlink, Abbruch/Cleanup und gespeicherte Daten. Prüfe view-only Pluginstub vs Core-Implementierung, bestehende gemeinsame Hostdienste und tatsächlich erforderliche Übergaben an B.
- K04 als tiefes Modul planen: zusammengehörige Regeln verbergen, keine orchestrierende Mega-Fassade und keine kosmetische Ordneraufteilung. K05: vorhandene Tab-/View-Identität, Fokus, Deep Links, Sessionzustand und fünf feste Coreansichten bleiben. Doppelten Prism-/Webhilfscode mit echten Verbrauchern belegen, keinen neuen allgemeinen Helper-Katalog erfinden.
- Für eine kritische Seam eine alternative kleine Schnittstelle aus Workflow-/Erweiterungssicht beisteuern, mit Beispiel/Fehler/Lifecycle/Depth/Locality. Bestehende Regeln behalten. Das aktive VS-Code-Web-Plugin ist Cs Bereich, alte Ralph-Oberfläche As Bereich.

## Untersuchung 2: K07 – ein Core-Attachment-System

Führe heutige Annotation-/Bild-/Dateipfade zusammenhängend nach: Tabauswahl → lokaler Draft/Storage → ComposerSendPlan/clientTxnId → Requestnormalisierung → Augmenter/Dateivorbereitung → durable Annahme/Receipt → Runtime-/Medienkontext. Benenne jede Sonderpipeline, Quelle von Zustand, Ownership und heutigen Test. Bestehende Persistenz bevorzugen, kein zusätzlicher Sessiontyp und kein zweiter Store aus Gewohnheit.

Diese Produktregeln sind fest, nicht neu zu diskutieren:

1. Beim Anhängen Quelle als Snapshot festhalten; spätere Quellenänderung verändert ihn nicht. Ein bewusster fachlicher Toggle IM Widget darf eine neue lokale JSON-Draftrevision erzeugen. Reiner Vorschauzustand bleibt getrennt vom Modellpayload. Beim Senden exakt die dann ausgewählte Fassung einfrieren.
2. Attachmentleiste über dem Chatinput, volle Breite des Terminalcontainers. Maximal 12 Spalten × 3 Zeilen, schmal 3 × 3, containerbezogen. Widgets deklarieren begrenzte Spannweiten, Inhalt/Checkboxen/Previews nach Pluginlogik. Overflow über weitere Seiten als Plan-Default; alle Seiten mitsenden. Core kontrolliert Rahmen, Layout und Fehlerfallback.
3. Jedes Widget hat Core-X oben rechts, auch bei defektem/fehlendem Renderer. Im Übernahmemodus sind Widgetinteraktionen und X ausgesetzt, nur Core-Auswahl-Toggles bedienen die Auswahl; Bestätigen/Abbrechen außerhalb bleiben erreichbar. Fokus/Preview/Keyboard müssen mitbedacht werden.
4. Sessiongebundene Drafts sind persistent und survive Sessionwechsel/Reload. Vor Versand keine materialisierte Gesprächsnachricht. Benötigte lokale Datei-/Bildbytes dürfen und müssen sicher als Draft gestaged werden; Blob-URL allein ist nicht persistent. Speicherfehler dürfen keinen falschen Erfolgsstatus erzeugen.
5. Bestätigte Übernahmeauswahl ist eigener persistenter Snapshot. Nach Wechsel lädt der Nutzer explizit in eine Zielsession; neue IDs und eigene Revisionen, Quelle/Zielbestand unverändert. Default alle ausgewählten Kopien gemeinsam oder konkreter Fehler. Retry derselben Ladeaktion nicht duplizieren. Scope/ACL/Portabilität beim Ziel neu prüfen; keine Tokens oder Livehandles kopieren.
6. Fachlicher Anhang ist JSON, Plugin liefert Schema/Payload/Renderer, Core einen kleinen versionierten Umschlag. Bilder/Dateien sind Coreanbieter und behalten native Medienfähigkeit durch sichere Referenzen/Projektion. Plugin-JSON wählt weder Systemrolle noch beliebige Serverpfade oder fremde Zugriffsrechte.
7. Sendesnapshot bindet Session, Text, Reihenfolge, IDs/Revisionen, Payload/Medien an clientTxnId. Materialisierung verwendet diesen Stand. Ressourcen/DB haben nicht automatisch eine globale Transaktion: Staging, Recovery und Cleanup konkret planen. Eindeutige Annahme verbraucht nur passende Draftrevisionen. Neue Entwurfsarbeit während Versand bleibt. Unklare ACKs/Reloads über bestehende Receipts abgleichen, niemals dieselbe ID mit geändertem Payload.
8. Fehlender Provider/Schema/Bytes: Payload erhalten, Corefallback/Entfernen verfügbar, notwendige Validierung blockiert Versand statt stilles Weglassen/Autoenable. Alte Nachrichten bleiben lesbar. Multi-Browser-Tab-Revisionskonflikt und Logout/Anmeldekontext explizit behandeln; keine neue geräteübergreifende Synchronisation.

Lege als Entwurf konkrete Typen, Methoden und Fehlertypen fest, aber erfinde keine bereits vorhandenen Exporte. Reale Codewerte für Limits benennen; neue vorgeschlagene Budgets separat markieren, keine Funktionsbeschneidung verstecken. Haltereferenzen und Cleanup für Source-Draft, Kopierablage, Zielkopien, Sendestaging und angenommene Nachrichten erklären.

## Deliverables – ausschließlich BASE/results/D1/

- `analysis.md`: Baseline/Methode, IDs `D1-01...`, Workflow-/Web-/Attachment-Callgraph mit Pfad:Zeile/Symbol und Tests, aktuelle Persistenz/Medienpfade, Duplikate, Lücken und Risiken. Gegenwärtiges vs historisches vs vorgeschlagenes Verhalten trennen.
- `contracts.md`: vollständige K04/K05/K07-Entwürfe mit kleinen TS-/JSON-Beispielen, Statusübergängen, Fehler-/Abort-/Revision-/Scope-/Ownership-Regeln, Grid-/Providergrenzen, Copy-/Materialisierungsszenarien und K07-Alternativen nach Design-Skill. D besitzt K07-Semantik, B die nötigen Exporte in seinen SDK-/Ressourcendateien; C ist Annotation-Verbraucher. Keine zweite Attachmentimplementierung im Plugin.
- `implementation-plan.md`: zusammenhängende D1/D2-Schritte und exakte Dateizuständigkeiten. Erster späterer Core-Anhang-Pilot → I integrieren → C Annotation-Anschluss → gemeinsames G1. Danach K07 vollständig, erst getrennt anschließend große Workflow-/Webumzüge in derselben Spur. Testmapping AT-01–AT-22 zu vorhandenen Prüfungen/neu benötigten Fixtures/konkreten Kommandos; bestehende Pflichtsuite unverändert. Versionierungs-/Rollbackplan und echte I0-Voraussetzungen.
- `handoff.md`: höchstens ca. 120 Zeilen; `ANALYSIS_COMPLETE`/`BLOCKED`, Basis, Links, wichtigste Befunde/Entscheidungen, konkrete Anfragen an B/C/I, Tests ausgeführt/geplant sauber getrennt. Keine implementierten Pilotstände, bestandenen G1-Checks oder echten Browsernachweise behaupten.

Du musst nicht auf B/C-Dokumente warten, um eine konsistente Verbrauchersicht vorzuschlagen. Konflikte als gezielte Reviewfragen ausweisen. Keine new agent sessions. Keine kanonische OKF-Verwaltung. Abschließend Berichte lesen, Widersprüche und Pfade prüfen.

## Abschluss

Höchstens 400 Zeichen im Chat, erst nachdem die vier Dateien vorliegen:
`D1 ANALYSE FERTIG | <absoluter handoff.md-Pfad> | <ein Blocker oder keiner>`.
Danach stoppen. Keine D2-Implementierung ohne Folgeauftrag.
