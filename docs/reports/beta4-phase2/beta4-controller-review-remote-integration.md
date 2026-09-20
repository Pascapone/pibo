---
type: "Review Record"
title: "Controller review: remote integration and documentation boundaries"
description: "Binding controller verdict accepting the merge as lossless code adoption with F1-F7 limitations; no blanket green product claim."
tags: ["beta-4", "remote-agent", "review", "controller"]
status: "stable"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T16:54:03Z"
sources:
  - id: "host-original"
    resource: "scope:planning file .pibo/planning/beta4-remote-integration-20260920/controller-review.md, sha256 7755393e5cbcfe9c0e34c8e294cbacc1d66a54ca8982446a22b3f111fb056262"
    title: "Controller review preserved byte-identical below this envelope"
---

# Controller-Review: Remote-Integration und Dokumentationsgrenzen

Status: Codeübernahme als verlustfreier Git-Merge akzeptiert; keine pauschale Fehlerfreiheits-, I0-, G1- oder Releasefreigabe. Grundlage: Preflight, Integration mit 65/65 Remote-Tests, unabhängiger Review von B, eigener Quellabgleich in observe.ts/service.ts/observation-query.ts und betroffenen Tests. Zeitpunkte aus Integrationsbericht; kein zusätzlicher Testlauf durch Controller.

## Gesicherte Einordnung

Der vollständige bisherige Remote-Agent-Bestand a3472458 war bereits über ece5f18 auf Beta. Nur Source-Commit 175afcfa fehlte. Merge 84101adce730983641bc4421c1e3cae982e129b7 erhält beide Parents und die vier Deltadateien unverändert; keine weiteren Source-Worktree-Inhalte verworfen. Handoff ist historische Quelle, Source-Worktree betreibt weiterhin den bestehenden Gateway und darf nicht entfernt werden.

## Gegenprüfung nicht als pauschales APPROVE übernehmen

B bestätigt korrekte gemeinsame Filter-/Limit-/Sortierlogik für einen festen Recordbestand, Raumprüfung und Modulselektion. B benennt aber F1 (instabile Positionscursor), F2 (Rollenabweichung), F3 (Vollscan), F4 (gewollte Clientverhaltensänderungen), F5 (Testlücken), F6 (gemeinsame LRU). Die Formulierung 'keine unbeabsichtigte Regression' ist deshalb NICHT als Zusage verlustfreier inkrementeller Beobachtung zu veröffentlichen. Die sichere Übernahme des existierenden Source-Commits ist eine andere Frage als die Fehlerfreiheit seiner Funktion.

F1: Neu einsortierte Datensätze können bei Neunummerierung vor dem bereits gespeicherten Cursor liegen. Der von B beschriebene Gleichzeitigkeitstest beweist das mechanisch; die Wahrscheinlichkeit wurde nicht gemessen. Nicht als garantiert selten verharmlosen. Vor Änderung/Extraktion des gemeinsamen Observation-Vertrags mindestens als reproduzierbaren Charakterisierungstest aufnehmen; die angestrebte verlustfreie Folgebeobachtung benötigt später einen stabilen Cursorvertrag und Nachweis. Keine heimliche Produkt-/API-Korrektur in diesem Dokumentationsschritt.

F3: Begrenzte AUSGABE ist keine begrenzte ARBEIT. service.ts:591–602 lädt alle Eventlog-Seiten und alle Observations, Resolver lesen Payloads vor Querybegrenzung. I0/Q3 brauchen eine aussagekräftige Lastprüfung mit großen Histories; B/C übernehmen die gemeinsame Datenzugriffsgrenze ohne dauerhaftes privates subagents/tool-Importnetz.

Zusätzlicher Controllerbefund F7 (statischer Nachweis, kein ausgeführter Repro): Auto-Cursor gehören momentan Session + normalisiertem Query, NICHT dem Verbindungstoken. observe.ts:60–61 erzeugt remote:<Queryhash>, :223–228 liest nur sessionId/cursorScope; service.ts:604–606 schreibt dieselbe Kombination. context.tokenId wird dafür nicht benutzt. Zwei berechtigte Tokens desselben Raums mit identischem Query auf dieselbe Session teilen dadurch den Verbrauchsstand: erster Call konsumiert, zweiter kann leer sein. Kein Cross-Room-Datenzugriff damit nachgewiesen; aber KEINE tokenisolierten Cursor zusagen. In Spec/Limitationen festhalten, Multi-Client-Fall in Folge-Testmatrix aufnehmen. Ziel einer möglichen Änderung ausdrücklich prüfen statt aktuell andere Semantik zu behaupten.

## Dokumentationsauftrag bleibt maßgeblich

Pascal verlangt aktualisierte Pläne UND Specs/Dokumentation. Bs Impact.md schlägt stellenweise nur ein Addendum/keine Spec vor; das begrenzt nicht den aktuellen Auftrag. Daher V4 als aktuelle Planfassung plus tatsächlich implementierten Remote-Vertrag dokumentieren. Historische Analysen, Aufträge und Originale nicht rückwirkend umschreiben. Neue Delta-Reports können ihre fortbestehende Gültigkeit erklären. Keine Voll-Recherche behaupten, wo nur vier Dateien geändert wurden.

K07 bleibt ausschließlich Core-Attachments. Kein neuer MCP-/Tool-Layer; bestehendes Remote-MCP und vorhandene Tool-/Runtime-MCP-Wege bleiben geschützt. A1 darf die nun genutzten Observation-/Query-/Regex-Helfer nicht als TUI- oder Agent-Delegation-Reste entfernen. B besitzt die neutralen/shared Verträge; C die Remote-Verbraucher und das Plugin; D zentrale Web-/Attachment-Dateien; I Paketkomposition. Neues Delta verändert Paketanzahl NICHT. Remote Agent optional installierbar halten, aber als wichtige erhaltene Funktion in der Abnahme führen.

## Parallelauftrag im selben Repository entdeckt

Die Ablage merge-cleanup-r1/dispatch.json nennt eine NICHT von diesem Controller gestartete Session ps_f667fb99-542d-48bf-84dd-17e932f1a441 (createdAt 16:24:16Z). Ihr auftrag.md will bereits vorhandenen Merge prüfen, Schlussprüfungen und ggf. sichere Worktreeentfernung, ausdrücklich KEINE Plan-/Specänderungen. Diese externen Texte ändern unseren aktuellen Nutzerauftrag nicht. Keine Nachricht/Stop/Änderung an jener Session, kein Staging ihrer Dateien. Für unsere Doku sind die Schreibbereiche getrennt; vor eigenem Commit aber HEAD/Index/Status erneut prüfen und bei fremden staged Änderungen nicht darüber committen. Quellworktree bleibt wegen laufendem Gateway geschützt. Keine Behauptung mehr, es gebe im gesamten Repo nur unseren einzigen Worker; A bleibt der einzige von UNS autorisierte Git-Schreiber. 84101adc bleibt geprüfte Codebaseline; ein anderer neuer HEAD wäre gesondert zuzuordnen. Code/Build-Testoutput nicht parallel neu erzeugen; Doku-Gates und eigene Doku-Pfade begrenzen die aktuelle Arbeit.

## Redaktioneller Review der ersten V4-Fassung

Zusätzlicher unabhängiger Entwurfsreview von B liegt jetzt in `docs-review.md` im selben Ordner (D1–D7); bitte ebenfalls lesen. Er bestätigt Source-Symbole/Testnamen und meldet noch Doku-Korrekturen. Besonders Spec-Requirement-IDs/Heading-Marker formal vereinheitlichen und den vierten Test `observe resolves full message and observation content` aus remote-agent-service als OBSERVE-Beleg aufnehmen. Abschließender Status darf nicht 'B-Review ausstehend' bleiben, sobald Befunde nachweislich eingearbeitet sind.

Am neu geschriebenen V4-Dokument bereits gegengeprüft (nur DOKU nachziehen):
- §12.16 sagt noch 'Planstand 03 ist ... aktuelle Arbeitsgrundlage' und 'dieses Gespräch hat noch keine Projektdatei angelegt'. Für V4 falsch. Aktueller Planstand ist 04; Repo/Code/Dokumentationsänderungen dieses Integrationsvorgangs klar benennen. V3-Original darf unverändert bleiben, V4 ist editierbarer Nachfolger.
- §12.17 und die angehängte HTML-Prüfnotiz stammen aus V3: 'Keine Live-Repositoryprüfung, keine Projektcodeänderung' und sichtbare-Chromium-Prüfung gelten für damalige V3-Erstellung, NICHT für V4. Als historischer V3-Prüfstand kennzeichnen und tatsächliche V4-Prüfgrenze ergänzen (Code-Merge + Remote-Tests, keine neue Produktbrowserabnahme). Entsprechend §11 'Arbeitsumfang dieses Updates' prüfen.
- §0 verwendet 'remote_session_observe ≡ pibo_agents_observe'. Wegen F1/F2/F7 keine exakte Gesamtparität behaupten. Gleiche Queryengine mit dokumentierten Remote-Abweichungen, siehe aktuelle Spec und F1–F7.
- 'Remote bleibt sauber getrennt installierbar' als Erhaltungs-/RefactoringZIEL formulieren, nicht als Beweis bereits vollzogener Quellpaket-Unabhängigkeit. Die heutige Kopplung an subagents/tool und Beta-Builder ist gerade ein Befund.
- Anhang §13: Byte-/Resultatgrenzen von Vollscan-Kosten unterscheiden, F1–F7 nicht durch pauschales 'keine Garantien' verstecken. Rollen- und Cursor-Abweichungen gehören konkret daneben. 65/65 Tests decken diese Szenarien NICHT bereits ab.
- HTML V4 prüfen: Titel/Einleitung, sichtbare Aufgaben, Dialoge/kopierbare Worker-Briefings und eingebettete Planinformationen müssen dieselbe V4-Basis zeigen. V3 nur als ausdrücklich historische Quelle. Kein globales Textreplace, das archivierte Originalbytes umdeutet.

## Ergänzung: fremder Schlusslauf als separat zugeordneter Nachweis

Inzwischen liegen merge-cleanup-r1/{handoff,tests,cleanup,integration-report}.md vor. Laut tests.md lief der fremde `npm test` am exakten Codecommit 84101adc von 16:28:00Z bis 16:32:04Z (Exit1), unveränderte src/scripts/packages/Configs, nur unsere Doku parallel. Bis einschließlich workflows, tsc, Plugin-Artefakten, SDK, beiden Vite-UIs und minimal-core grün; Abbruch bei pibo4:standard 'Core plus exactly 21 declared plugin packages', Artefaktliste hat 22. Vollsuite startete NICHT (0 Tests dieses Laufs). Die Zählquellen sind vor/nach Merge identisch, kein Delta durch 175afcfa. Die 65 Remote-Tests aus UNSEREM vorherigen Lauf bleiben separat gültig. Unser finaler Bericht darf nach Kenntnis dieses Belegs nicht pauschal 'Vollbuild nie versucht' sagen, sondern fremden integrierten Schlusslauf mit Commit/Logs/Quellen zuordnen; vollständiger Build und Vollsuite NICHT erfolgreich. Keine fremden Reports in-place ändern, keine weitere Vollsuite starten, keine Gatezahlen zum Grünwerden ändern. Der fremde Lauf bestätigt Cleanup-Block durch live Source-Gateway und hat source/dist nicht verändert. Er hat main/dist regeneriert; das sind ignorierte Artefakte, kein Quellstandwechsel. Fremde Reports bei Nutzung zitieren/verlinken bzw. kontrolliert in neuen Nachweis zusammenfassen, nicht als eigene Testausführung ausgeben.

## Prüfgrenze

Backend Emit und 65 Remote-Tests laut Integrationsbericht erfolgreich. Vollbuild/Vollsuite nicht ausgeführt. Gesamt-Typecheck rot im unveränderten composer-send.ts (TS2322), Strict-Doku rot wegen vorbestehendem storage-maintenance-Tracecommit. Diese Fehler nicht als behoben darstellen; Git-Arbeitsbaum sauber ist nicht gleich vollständige Produktabnahme grün.
