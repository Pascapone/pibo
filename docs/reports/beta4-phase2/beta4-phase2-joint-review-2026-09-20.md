---
type: "Review Record"
title: "Beta 4.0 phase-2 joint review of four analyses"
description: "Dispatcher review confirming 16 delivered analysis documents with corrections; eight links retargeted to archive paths."
tags: ["beta-4", "phase-2", "review"]
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
  origin_path: ".pibo/planning/beta4-phase2-20260920/review.md"
  origin_sha256: "c2831033500f5c3093fa486b7452b11e121215cc743a672bd896269c0ce44423"
  origin_bytes: 10681
  archive: "docs/reports/artifacts/beta4-phase2/beta4-phase2-originals-20260920.zip"
  archive_path: "review.md"
  transformations:
    - "Added this OKF frontmatter envelope; body bytes after frontmatter are unchanged from the origin."
    - "Retargeted 1x link target '](assignments/A1.md)' to '](/plans/beta4-phase2/beta4-phase2-assignment-a1.md)' (archive path)."
    - "Retargeted 1x link target '](results/A1/handoff.md)' to '](/reports/beta4-phase2/beta4-phase2-a1-handoff.md)' (archive path)."
    - "Retargeted 1x link target '](assignments/B1.md)' to '](/plans/beta4-phase2/beta4-phase2-assignment-b1.md)' (archive path)."
    - "Retargeted 1x link target '](results/B1/handoff.md)' to '](/reports/beta4-phase2/beta4-phase2-b1-handoff.md)' (archive path)."
    - "Retargeted 1x link target '](assignments/C1.md)' to '](/plans/beta4-phase2/beta4-phase2-assignment-c1.md)' (archive path)."
    - "Retargeted 1x link target '](results/C1/handoff.md)' to '](/reports/beta4-phase2/beta4-phase2-c1-handoff.md)' (archive path)."
    - "Retargeted 1x link target '](assignments/D1.md)' to '](/plans/beta4-phase2/beta4-phase2-assignment-d1.md)' (archive path)."
    - "Retargeted 1x link target '](results/D1/handoff.md)' to '](/reports/beta4-phase2/beta4-phase2-d1-handoff.md)' (archive path)."
---
# Phase 2 – vier Analysen: gemeinsame Sichtung

Stand: 20. September 2026. Status: **4/4 ANALYSEN VORHANDEN · 16/16 ERGEBNISDOKUMENTE · IMPLEMENTIERUNG NICHT GESTARTET**.

Diese Sichtung bestätigt die Dokumentenübergabe und hält wesentliche Korrekturen und offene Integrationspunkte fest. Sie ersetzt weder I0 noch die implementierten Vorbereitungspiloten oder G1. Analyseberichte allein geben keine neuen SDK-Verträge oder Schreibrechte auf Produktdateien frei.

## 1. Ablage und gemeinsame Quelle

Hostbasis: `/mnt/c/Users/pasca/Coding/pibo/.pibo/planning/beta4-phase2-20260920/`.

Die Originale liegen unter `inputs/pibo-beta4-arbeitsplan-v3.md` und `inputs/pibo-beta4-arbeitsplan-v3.html`. Beide wurden unverändert übertragen und auf dem Host per SHA-256 geprüft. Der originale Codebase-Design-Skill und der Quellenbericht liegen daneben. Einzeldateiprüfung: `inputs/source-verification.json`.

- V3 Markdown: 98.949 Bytes; SHA-256 `1d8f923b09b241a88ae0449d81a4cc204c485c7ac0522f87c66de6daa1633d18`.
- V3 HTML: 256.966 Bytes; SHA-256 `6d4e0a8d1438e18f4d5e4e4e1673ae8cd6073c345149d8b987fef2749c965879`.

Branch: `beta/4.0-plugin-system`. Von allen vier Arbeitern benannter Quellstand: `ece5f18cffe3f96f8f5dd8c241aac1d439c67b9a`. Bereits vorhandene Änderungen an Audit-Dokumentation blieben unberührt. Die Planungsablage ist persistent auf dem Host, aber unter `.pibo/` gitignoriert und nicht als Commit oder kanonisches OKF-Dokument veröffentlicht.

## 2. Sessions, Aufträge und Ergebnisse

Alle Sessions nutzen `muse-native-full` im bestehenden Raum `room_3dd92882-ca07-4e83-ad53-1bf0ccedf00c`.

| Paket | Session-ID | Auftrag | Ergebnisübersicht |
|---|---|---|---|
| A1 | `ps_d6e27f3f-505c-44d3-acca-81bac3008b5f` | [A1.md](/plans/beta4-phase2/beta4-phase2-assignment-a1.md) | [A1/handoff.md](/reports/beta4-phase2/beta4-phase2-a1-handoff.md) |
| B1 | `ps_c034fdc7-7283-427a-9faf-a0d56e36d3a2` | [B1.md](/plans/beta4-phase2/beta4-phase2-assignment-b1.md) | [B1/handoff.md](/reports/beta4-phase2/beta4-phase2-b1-handoff.md) |
| C1 | `ps_e8438ad4-8ee8-46ff-bae7-a4ec269fa26d` | [C1.md](/plans/beta4-phase2/beta4-phase2-assignment-c1.md) | [C1/handoff.md](/reports/beta4-phase2/beta4-phase2-c1-handoff.md) |
| D1 | `ps_c289a1e2-2ebe-45de-b213-f5d76508b2e8` | [D1.md](/plans/beta4-phase2/beta4-phase2-assignment-d1.md) | [D1/handoff.md](/reports/beta4-phase2/beta4-phase2-d1-handoff.md) |

Jeder Ergebnisordner enthält `analysis.md`, `contracts.md`, `implementation-plan.md` und `handoff.md`. Die kurze Chatmeldung ist nur die Benachrichtigung, nicht der Bericht. `dispatch.json` und `dispatch-receipts.json` belegen die tatsächlich beauftragten Sessions; B/C/D wurden gemeinsam angenommen, A analysierte anschließend überlappend. Ein vorhandener fremder Entwurfsordner `review-r1/` wurde nicht als aktuelle Dispatchquelle benutzt oder verändert.

## 3. Wichtigste Ergebnisse

### A1 – Verhalten absichern, dann Altlasten entfernen

Die alte Ralph-Insel ist nach der statischen Prüfung nicht über aktuelle Produkt-Einstiege erreichbar. Der aktive Loops-Service besitzt beide Kontextmodi und liest die bestehende Datenbank. Vor Entfernung sind zehn Bereiche mit fehlender oder nur teilweise direkter Loops-Testabdeckung zu prüfen beziehungsweise mit passenden Tests zu sichern. Das sind statische Abdeckungsbefunde, keine nachgewiesenen Laufzeitfehler. Aliasse, Datenformate und Modi bleiben.

TUI-Einstieg und interaktive Verdrahtung sind eigene Löschkandidaten. Aktive Webrenderer und das aktuelle VS-Code-Web-Plugin bleiben. Alte Extension-Buildreste sind keine noch zu erzielende große getrackte Sourceersparnis.

Belege: `results/A1/analysis.md`, A1-01–A1-16; `results/A1/implementation-plan.md`, LP-01–LP-05.

### B1 – vorhandene Verträge und gebundene Zugänge nutzen

K01 und K02 besitzen bereits brauchbare Implementierungsgrenzen. Eine zweite Tool-/Runtimewelt ist nicht begründet. Konkrete Entkopplungspunkte bleiben Pi-Wertimporte in allgemeinen Modulen und Pi-gekoppelte Transkriptions-Defaults.

K03 beginnt mit der kleinsten vom bestehenden Credential-Owner gebundenen Injektion. Ein frei gewählter Scope-String verleiht keine Autorität; ein allgemeiner authentifizierter HTTP-Proxy ist nicht Teil des Auftrags. API-Key- und OAuth-Verhalten sowie aktuelle Fehler-/Konfigurationssemantik bleiben.

Belege: `results/B1/handoff.md:14-33`; `results/B1/implementation-plan.md:18-30`.

### C1 – eigenständige Quellpakete mit realen Piloten beweisen

Web Search und VS Code Web bleiben die leichten C1-Piloten. Transkription ist der primäre schwierige Verbraucher, File Editing ein zusätzlicher Kandidat. Die 22/21-Abweichung betrifft den vollständigen Standard-/Candidate-/Compute-Pfad, nicht logisch jede unabhängige Pilotvorbereitung gegen eine belegte SDK-Basis.

Bundling, Source-Abhängigkeiten und externe Auflösung sind getrennt zu bewerten. Kein neuer Pflichtwrapper, keine unbeauftragte Portierung Pi-exklusiver Funktionen und keine erfundenen gemeinsamen Paketversionen.

Belege: `results/C1/handoff.md:22-44`; `results/C1/implementation-plan.md:24-60`.

### D1 – Attachments über einen Core-Draft zusammenführen

Heute laufen Dateien und Annotationen über unterschiedliche Versandwege. Die Annotationsauswahl verwendet einen globalen Storage-Schlüssel; der neue sessiongebundene Snapshot-Draft ist eine bewusst beauftragte Änderung. Serveruploads können physisches Draft-Staging sein, ohne bereits eine angenommene Gesprächsnachricht darzustellen.

D schlägt ein gemeinsames Draftmodul mit Provideranschluss vor. K07-Typen, Schema und Materialisierungsgrenze bleiben Entwürfe, keine ausführbar geprüfte SDK-v1-Freigabe. Die 22 Abnahmefälle sind bestehenden Prüfungen und neu erforderlichen Fixtures zugeordnet.

Belege: `results/D1/handoff.md:16-49`; `results/D1/implementation-plan.md:40-79`; direkt gegengeprüft: `src/apps/chat-ui/src/web-annotation-storage.ts:122-130`.

## 4. Dokumentkorrekturen aus der ersten Gegenprüfung

Die Worker erhielten dokumentierte Korrekturen und beantworteten sie in ihren Übergaben: A vier Punkte (R-A1-01–04), B sechs (R-B1-01–06), C sechs (R-C1-01–06), D sechs (R-D1-01–06). Dies ist kein pauschales Fehlerfreiheitsurteil über alle Berichte.

Wesentliche Klärungen:

- Der Router wartet auf den Abschluss von `prompt()`; das ist nicht bloß die Nachrichtenannahme.
- Uploads werden heute als konsumierbare textuelle Dateireferenzen projiziert. Medienparität schützt tatsächliche Funktion je Adapter. Ein neuer nativer Prompt-Ressourcenkanal ist keine automatische K07-Voraussetzung.
- Shared App Context, Zugriffsberechtigung und Besitz eines Sessiondrafts unterscheiden. Berechtigte explizite Kopien bleiben möglich.
- Die fünf Coreansichten bleiben Settings, Agent Designer, Kontext, Session Inspector und Raw Events.
- D1-Core-Pilot und C1-Annotations-Verbraucher werden VOR G1 geprüft, nicht gegen einen erst dadurch entstehenden v1-Stand blockiert.
- A prüft seine TUI-Entfernliste plus explizite B-Restliste; globaler Suchlauf erst nach Bs abgestimmter Bereinigung.
- Rücknahme verwirft keine fremde uncommittete Arbeit per pauschalem Checkout.

## 5. Offene technische Punkte vor Implementierungsfreigabe

### RV-01 – ein Schreib-Owner je Verbraucherdatei

Bs Umsetzungsentwurf führt `src/transcription/*` und Tool-Entkopplung mit auf; C bearbeitet dieselben Verbraucher. Für die nächsten Aufträge gilt: **B liefert Owner-Bindung, SDK und Ressourcenanschlüsse; C ändert die Plugin-/Transkriptions-/File-Editing-/Remote-Agent-Verbraucherdateien**. Gemeinsame Verdrahtung erhält vor Start genau einen benannten Owner. Übergabe und Tests ersetzen gleichzeitige Dateibearbeitung.

Belege: `results/B1/implementation-plan.md:18-24,41-42,52-64`; C1-Bündel T/F/W.
Fertigkriterium: disjunkte Schreibpfade und ein integrierbarer B1/C1-Übergabe-Commit. Durch dieses Review wurde keine Umsetzung ausgeführt.

### RV-02 – K07 zu einem typisierten Pilotvertrag konkretisieren

D besitzt die Semantik, B die Exporte in seinen Dateien und C den realen Annotationsanbieter. Vor dem Pilotbau müssen Schema-/Typversion, Snapshot/Revisionen, Providerregistrierung, Draftressourcen und Materialisierung gemeinsam konkret sein. Vorhandenen Upload-Store zuerst prüfen, keinen zweiten Bytepfad zwingend erfinden. Die Quelle wird beim Anhängen gesichert; ein bewusster Widget-Toggle erzeugt eine lokale neue Payloadrevision, Vorschauzustand bleibt getrennt.

Fertigkriterium: eindeutig typisierter Kandidat, ein Core-Bild-/Dateibeispiel und ein Annotation-Beispiel mit Fehler-/Receipt-/Copy-/Ressourcenfällen. Danach echte Implementierung und Tests, erst damit G1. Keine neue MCP-Schicht.

### RV-03 – I0-Ausgangsstand und Paketkomposition belegen

Branch und HEAD wurden geprüft; ein frisch gebauter Ausgangskandidat wurde in dieser reinen Analyserunde nicht erzeugt. Vor Umsetzung sind Paketkatalog/Standardauswahl/Versionen, Pflichtprüfungen, isolierte Worktrees und Quellen-/Artefaktherkunft festzuhalten. Die 22/21-Regeln über Builder und Compute-Zugänge gemeinsam behandeln, nicht nur eine Zahl ersetzen.

Fertigkriterium: nachprüfbarer Start-Commit, explizite Vorfehler ohne pauschalen Grünstempel und funktionsfähige Basis für die betroffenen Pfade. Kein Release oder Gatewayumbau als Nebenwirkung.

### RV-04 – Testübertragung vor Altlastenlöschung

As statische Lückenliste gegen tatsächliche Tests verifizieren. Relevante Assertions auf die aktive Loops-Implementierung übertragen oder ergänzen. Alttests erst nach nachvollziehbarer Verhaltenszuordnung und Review entfernen, keine Skips oder Abschwächung.

Fertigkriterium: Alt-Test → erhaltene Zusage → Nachfolger → ausgeführtes Ergebnis. Beide Loop-Modi, Bestandsdaten, CLI-Aliasse und das VS-Code-Web-Plugin bleiben geschützt.

## 6. Nächste Abfolge

**Analysen gemeinsam besprechen → I0 abschließen und Schreibgrenzen präzisieren → echte A1/B1/C1/D1-Vorbereitung in eigenen Worktrees → D1-Pilot integrieren → C1-Anbieter dagegen prüfen → G1 mit Nachbesserung → B2/C2/D2.**

Die vier angelegten Sessions können ihre Bereiche weiterführen, benötigen aber ausdrückliche Folgeaufträge. A übernimmt danach Gegenprüfung/Dokumentation; B/C/D bleiben die drei Umbau-Spuren. Noch keine solchen Folgeaufträge erteilt.

## 7. Grenzen

Alle vier Übergaben und die wesentlichen Analyse-/Vertrags-/Umsetzungsabschnitte wurden gelesen. Zentrale strittige Aussagen wurden direkt im Code zurückgeprüft und Korrekturen angefordert. Kein vollständiges neues Codeaudit, kein Build, kein Produkt-Testlauf, keine Browserabnahme, keine implementierten Piloten. Der zusätzliche kurze A-Statuscheck durch B war lesend; fehlende Telemetrie führte nicht zu einem zweiten Start oder Abbruch. Geschrieben wurden Planungs-, Auftrags-, Ergebnis- und Reviewdateien, kein Produktcode.
