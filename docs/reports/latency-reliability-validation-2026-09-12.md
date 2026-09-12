---
type: "Validation Report"
title: "Latenz und Zuverlässigkeit: Umsetzung und Abnahme 2026-09-12"
description: "Dokumentiert Baseline, Paketintegration, Messbelege und verbleibende Abnahmegates des Latenzumbaus."
tags: ["latency", "reliability", "multi-agent", "validation"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-12T08:35:06Z" }
sources:
  - id: "remediation-plan"
    resource: "/plans/pibo-latency-reliability-remediation.md"
    title: "Vom Nutzer beauftragter Umsetzungsplan"
  - id: "historical-archive"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-remediation-2026-09-12; original Pibo2 investigations"
    title: "Unveröffentlichte Rohbelege der ursprünglichen Untersuchungen"
  - id: "baseline-tests"
    resource: "/reports/artifacts/latency-reliability-2026-09-12/baseline-focused-tests.log"
    title: "Ausgeführte fokussierte Docker-Baselineprüfungen"
implementation_state: "in-progress"
---

# Abnahmegrenze

Der zentrale [Handoff zur Fortsetzung](/reports/latency-reliability-handoff-2026-09-12.md) verbindet diesen Prüfbericht mit Branches, privaten Artefakten, offenen Paketen und den erforderlichen Workflows.

Die Ausführung endet auf ausdrücklichen Nutzerwunsch mit einem gesicherten Zwischenstand. Der gesamte Umbau bleibt unvollständig. Dieser Bericht unterscheidet den unveränderten Ausgangsstand, neue Paketprüfungen und die noch ausstehende integrierte Pibo2-Abnahme. Ein grüner Baseline-Test belegt keine geschlossene neue Anforderung. Die Zielbudgets bleiben diejenigen des [beauftragten Plans](/plans/pibo-latency-reliability-remediation.md).[^remediation-plan]

# Reproduzierbare Basis

| Merkmal | Nachgewiesener Stand |
|---|---|
| Historischer Pibo2-Kandidat | `0fe71c72a1d3bcb3b0d06295d323317a452b367a` laut Untersuchungszuordnung |
| Implementierungsbasis nach Fetch | `upstream/dev`, `cac4dcd03945b9754db7be9ab2ab4324f10c335c` |
| Integrations-Worktree | `latency-integration`; eigener Dockerworker `pibo-dev-latency-integration` |
| Controller-Ressourcen vor Produktlast | 15.6 GiB RAM, 8 GiB Swap, etwa 107 GiB freier Plattenplatz; zusätzlich laufende Agentarbeit, daher keine isolierte Performanceaussage |
| Paketversion des Ausgangsstands | `1.7.2` |
| Dev-Lockfile SHA-256 | `fd534c04db9e115c5fce5afeb324cdec4e72f667a747a01f8b92881ffa62b357` |
| Abhängigkeitsabgleich | Alle installierten, plattformrelevanten Pflichtpakete stimmen mit dem Dev-Lockfile überein; Pi AI/Coding Agent `0.85.0`, Vite `8.2.2` |

Der Controller-Checkout selbst steht auf einem anderen Commit und enthält fremde uncommittete Arbeit. Er ist kein Implementierungs- oder Testkandidat. Die Umsetzung benutzt ausschließlich die getrennten, von `upstream/dev` angelegten Worktrees.

# Historische Belege

126 reguläre Dateien mit insgesamt 14.393.748 Bytes wurden aus den zwei temporären Untersuchungsverzeichnissen in eine private, nur für den Controller-Benutzer zugängliche Ablage übernommen. Das [SHA-256-Manifest](/reports/artifacts/latency-reliability-2026-09-12/historical-manifest.json) hat den Hash `e5c3ab7f1bc2de94546030f3a54a838d092d688b9e71914739e2f058803d2c2b`. Die Rohdateien bleiben privat; im Repository stehen das Inhaltsmanifest und gezielt geprüfte Ableitungen. Das spätere Baseline-Buildarchiv ist ein separater, zusätzlicher Vergleichsgegenstand und verändert dieses historische Manifest nicht.[^historical-archive]

# Ausgeführte lokale Baseline

`docker exec -w /workspace pibo-dev-latency-integration npm run build` ist erfolgreich. Die bestehenden Vite-Warnungen über große Bundles bleiben sichtbar; sie sind keine neue Regression und ersetzen keine Bootstrap- oder Nutzbarkeitsmessung.

Der folgende Testlauf besteht mit **26 Tests, 0 Fehlern**, Dauer laut Testläufer 4.810 ms:[^baseline-tests]

```text
docker exec -w /workspace pibo-dev-latency-integration node --test \
  test/output-identity-regression.test.mjs \
  test/storage-worker-isolation.test.mjs \
  test/chat-ui-app-signal-status.test.mjs \
  test/message-command-dispatcher.test.mjs
```

Die Tests bestätigen die vorhandene Basis für Identität, Storage-Admission/Workerersatz, Statuspatches und Dispatcher. Zusätzliche neue Ablaufprüfungen für Caller-Stall, Recovery-Generationen, Arbeitsbudgets und echte integrierte Last sind noch erforderlich.

Zusätzlich bestehen `test/telemetry-capture.test.mjs` und `test/cold-fork-candidates.test.mjs` mit **8 Tests, 0 Fehlern**, zusammen 2.945 ms. Das [Protokoll](/reports/artifacts/latency-reliability-2026-09-12/baseline-existing-capabilities.log) bestätigt die vorhandenen scoped Captures und passiven Runtime-Lesezugriffe. Insgesamt sind damit 34 fokussierte Baseline-Tests ausgeführt. `npm run docs:validate` besteht mit 0 Fehlern/0 Warnungen; `npm run docs:validator:test` besteht mit [84 Tests](/reports/artifacts/latency-reliability-2026-09-12/docs-validator-tests.log).

Der headful Browser im Integrationsworker öffnet die Baseline-App mit Worker-Authentifizierung. Der sichtbare Composer ist vorhanden und nicht deaktiviert; `document.readyState` ist `complete`. Dieses leere lokale Fixture ist ein Funktionscheck, kein Nachweis für das große Referenzprofil oder die Zeitbudgets.

# Erster Paketreview: AP-08

Worker-Commit `686a78e0a87d7f534170bbac210f380ef7b03e95` führt ein begrenztes DLQ-Listing und einen killbaren Auditprozess ein. Der Orchestrator hat einen reproduzierbaren Restfehler gefunden: Bei Sessionfilter und gültigem, über 64 KiB großem Jobpayload wird ein passender Job übersprungen und dennoch `complete: true` mit leerem Ergebnis geliefert. Die Reproduktion im Audit-Dockerworker verwendet einen einzigen `output-persistence`-Job für `ps_target` mit 80.000 Zeichen synthetischem Body. Ergebnis: erwartete Treffer 1, zurückgegeben 0, `scannedRows: 1`, `complete: true`. Das verletzt die Unvollständigkeitszusage; AP-08 ist deshalb noch nicht abgenommen.

Ein zweiter offener Reviewpunkt betrifft die konservative Deep-Audit-Arbeitszählung: Tabellegrößen werden zwischen getrennten Leseabfragen gecacht. Ohne einen stabilen, zeitlich begrenzten Read-Snapshot können parallele Inserts diese Obergrenze ungültig machen. Dafür sind ein Ablaufnachweis und gegebenenfalls eine Korrektur erforderlich.

# Integrierte Teilfixes

Commit `6c0e4ff6170f987cf6252589c8dadf6a7e79a5de` berechnet Runtime-Status und Telemetrie einmal je Gateway-Antwort und verwendet sie in beiden kompatiblen Ausgabeansichten. Die Regression für 1/10/20 Runtimes schlägt gegen die Baseline wegen zwei statt eines Reads fehl. Nach TypeScript-Kompilierung bestehen `test/gateway-restart-safety.test.mjs` und `test/gateway-restart-approval.test.mjs`: 34 Tests, 0 Fehler, 4.769,7 ms. Dieser AP-03-Teilfix ersetzt noch keinen vollständigen inkrementellen Projektor.

Commit `eace24be3b893512d649de96b30a34ed713d91ae` stellt den Dispatcher auf monotone Wakeups, 4,5–5,5 Sekunden Recovery-Jitter mit früherer Lease-Erneuerung und höchstens zwölf Claims pro Event-Loop-Durchlauf um. Der neue Idle- und Burst-Test schlägt gegen die Baseline fehl; der Burst verarbeitet dort alle 100 Claims vor dem nächsten Event-Loop-Turn. Nach Kompilierung bestehen `test/message-command-dispatcher.test.mjs` und `test/message-command-store.test.mjs`: 24 Tests, 0 Fehler, 2.714,1 ms. Bestehende Zwei-Prozess-, Crash-, Fairness-, Control-Reserve- und Fencing-Prüfungen bleiben grün. Browser-Receipts und die integrierte Lastabnahme von AP-06 bleiben offen.

Beide Teilfixes wurden vom Orchestrator im Integrationsworker ausgeführt, während die delegierte Agent-Steuerung nicht erreichbar war. Die aktuellen Verträge in [Kapazität](/specs/runtime/capacity-and-scheduling.md) und [Gateway](/specs/gateway/web-host-and-channel.md) dokumentieren ausschließlich diese implementierten Änderungen.

Commit `81847c71989feb1645220daea1ded02f370ecb73` ergänzt die fehlende reine AP-04-Vergleichsfunktion. Sie prüft den tatsächlichen gespeicherten Fingerprint anhand des unabhängig rekonstruierten vollständigen Events, bevor sie die vorhandene v2-Semantik und Delivery-ID vergleicht. Unvollständige Daten, unbekannte Versionen und überschrittene Budgets führen zu getrennten nicht reparierbaren Ergebnissen. Die Funktion verändert keine Daten. `test/output-collision-classification.test.mjs`, `test/output-identity-regression.test.mjs` und `test/data-v2-ingest-service.test.mjs` bestehen nach Kompilierung mit 24 Tests, 0 Fehlern, 494,9 ms. Dieselbe Abhängigkeit liegt als `799ab6ca` im Audit-Branch, damit dessen bereits begonnene Integration abschließen kann.

Die historische Datei `dead-letters.json` ist leer; die gesicherten Aggregate und der vorhandene Detailbeleg erlauben deshalb noch keine vollständige Zuordnung sämtlicher 31 Fehler und 32 Diagnosen. Es wurde keine historische Reparatur angewendet. Die begonnenen read-only Pibo2-Abfragen beschränken sich auf verfügbare Index-/Spaltenmetadaten und sind keine Kandidatenabnahme.

Der Nutzer hat die laufende Ausführung anschließend auf einen gesunden Zwischenstand begrenzt und zuletzt auch den zügigen Abschluss des Audit-Agenten angeordnet. Seine bestehende Session erhielt über den regulären lokalen Pibo-Client eine `/steer`-Nachricht zum Einstellen der Umsetzung, Sichern vorhandener Arbeit und Schreiben der Übergabe. Der Gateway bestätigte die Zustellung an den aktiven Turn. Die MCP-Verbindung meldete weiterhin `Auth required`; es wurden keine Credentials verändert und keine neue Agent-Session erzeugt. Noch nicht akzeptierte Ergebnisse bleiben getrennt vom geprüften Integrationsstand.

Der Audit-Agent hat seinen Auftrag beendet. Sein Branch ist bis `c18890c157ac4490272b3fb6e450740e440bdc70` committed und sauber. Er enthält die begrenzte Diagnose, AP-04-Reconciliation, einen lokalen Lastharness und abschließende Reviewkorrekturen. Der vor dem Abschlusscommit ausgeführte Server-TypeScript-Build und [41 fokussierte Tests](/reports/artifacts/latency-reliability-2026-09-12/audit-worker-tests.log) bestehen; danach wurde kein Code verändert. Diese Änderungen wurden noch nicht in `latency-integration` übernommen; die früheren AP-08-Reviewpunkte gelten ohne erneute Abnahme nicht als geschlossen. Die private Abschlussablage enthält den Orchestrierungsstand, den gesicherten Zwischenpatch, die vollständige Agent-Übergabe `latency-remediation-audit-handoff.md`, Referenzmessungen, synthetische Referenzdatenbanken und Git-Bundles für die spätere Fortsetzung.

Die separat gesicherte frühere Referenzmessung des Auditworkers verwendete 1.000 Admission-Proben und 30 Status-/Health-Paare je Profil. Bei 3.250 beziehungsweise 10.000 Sessions lag Status-p95 bei 2.114,894 beziehungsweise 7.562,6244 ms; beide Profile melden `passed: false`. Diese Baselinewerte betreffen den damaligen Gateway und eine frühere Harness-Fassung, nicht den geprüften Integrationsstand oder eine finale kombinierte Kandidatenabnahme. Der vollständige Bericht hält Messversionen, fehlgeschlagene Zwischenschritte und alle verbleibenden Grenzen fest.

## Gemeinsame Prüfung des Zwischenstands

Auf dem integrierten Code bei `81847c71989feb1645220daea1ded02f370ecb73` bestehen `npm run build` und `npm run typecheck` vollständig im Dockerworker. Der gemeinsame [Testlauf](/reports/artifacts/latency-reliability-2026-09-12/checkpoint-product-tests.log) umfasst die sieben oben benannten Gateway-, Dispatcher-/Store- und Identität-/Ingest-Suiten: **82 Tests, 0 Fehler**, 6.525,6 ms. Die bestehenden Vite-Bundlewarnungen bleiben unverändert sichtbar. Eine vollständige Root-Testsuite oder Releaseabnahme wurde nicht ausgeführt.

Die Dokumentationsindizes haben keinen Drift; `npm run docs:validate` besteht mit 800 Markdown-Pfaden, 0 Fehlern und 0 Warnungen. Die Dokumentationsvalidator-Tests bestehen erneut mit 84 Tests, 0 Fehlern. Zum Sessionabschluss werden alle sechs taskeigenen Dockerworker nach Sicherung ihrer relevanten Artefakte über die Compute-CLI freigegeben. Ihre Worktrees und Branches bleiben erhalten. Alle zehn delegierten Sessions melden `idle`; es läuft kein Sub-Agent mehr.

# Ausführungsunterbrechung der Agent-Anbindung

Mehrere delegierte Läufe endeten nach erfolgreichen Dateireads mit `Request was aborted`; einzelne erste Starts meldeten `Runtime capacity wait deadline exceeded`. Die Starts wurden daraufhin gestaffelt. Diese Beobachtungen beweisen noch keine einheitliche Ursache aller Abbrüche. Der Auditworker konnte einen Commit erstellen und am Lastharness weiterarbeiten.

Ab etwa 05:43 UTC lehnt die aktuelle native Session ihre Pibo-MCP-Steuerung mit `Auth required` ab. Die inspizierte Implementierung begrenzt Tool-Credentials auf 30 Minuten (`src/tools/credential-registry.ts`) und sieht eine Prozess-/Credentialerneuerung vor dem nächsten Turn vor (`src/agent-runtimes/codex-native/adapter.ts`, `ensureFreshResourcesForTurn`). Der zeitliche Verlauf passt dazu; Credentialwerte wurden weder ausgegeben noch verändert. Der Arbeitsstand ist für die Fortsetzung gesichert. Controller-Gateway, Zugangsschutz und Laufzeitgrenzen wurden nicht verändert.

Nach der vom Nutzer gemeldeten Authentifizierungsreparatur liefern die bestehende MCP-Verbindung und ein erneuter `pibo_run_status`-Aufruf weiterhin `Auth required`. Die reguläre Debug-CLI bestätigt einen weiter arbeitenden Audit-Agent und neun wiederverwendbare ruhende Sessions. Der Nutzer begrenzt die weitere Parallelität auf zwei bis höchstens drei Agents. Bis die Tool-Verbindung erneuert ist, laufen unabhängige lokale Umsetzung und Tests weiter; es wurden keine Ersatzsessions erzeugt und keine Authentifizierungsgrenzen umgangen.

# Paket- und Befundstatus

| Befunde / Pakete | Besitzer | Stand |
|---|---|---|
| F1/F3/F9; AP-01/02/09 Client, AP-06/07 UI | Browser | Ruhend; Implementierung offen |
| F2/F4/F5/F9; AP-03/06/07 und Serveranteile AP-02/09 | Gateway / Integration | AP-03-Doppelberechnung und AP-06-Dispatcher lokal integriert; weitere Serverarbeit offen |
| F6/F7; AP-04/05 | Storage | Reiner Klassifizierer integriert; Producer-/Worker-Arbeit und historische Zuordnung offen |
| F8; AP-08, AP-04 Debug-Reconciliation | Audit | Separater Branch bis `c18890c1` gesichert; Review und Integration offen |
| SQLite-/Detailcapture-Hypothese; AP-11 | Capture | Ruhend; kontrollierter Vergleich offen |
| Alle Befunde; AP-00/10 | Integration | Historische Belege gesichert, Docker-Baseline gebaut und fokussiert geprüft |

# Offene integrierte Gates

- Quell-/Testnachweis für jede Pflichtanforderung PIBO-LATENCY-001 bis PIBO-LATENCY-012 und jeden Teilbefund F1 bis F9.
- Review der Paketimplementierungen, Integration und vollständige relevante lokale Prüfungen des gemeinsamen Kandidaten.
- Authentifizierte headful Browserprüfung auf Desktop und 390×844, Revision-/Auth-/Offline-/Freeze-Fehlerfälle und messbare Composer-Nutzbarkeit.
- Unverändertes committed Paket mit SHA-256 und relevante Pibo2-Prüfungen; der Deploymentpool war beim read-only Vorabcheck frei, wurde noch nicht belegt.
- 10.000 deterministische Admission-Proben als gemeinsames strengeres Profil beider Pläne, gepaarte Status-/Health-Messungen, kontrollierter Capture-Vergleich mit drei wechselnden Wiederholungen, mindestens 30 Minuten echte Multi-Agent-Last, native Kaltstarts und zwei Stunden gemischter Dauerlauf.
- Geräteprüfung auf dem tatsächlich betroffenen Smartphone. Gerät, Browser/PWA und Zugriff sind angefragt; Desktopemulation beweist diesen Fall nicht.

[^remediation-plan]: Verbindliche Pakete, Budgets, Schutzregeln und Definition of Done des beauftragten Plans.
[^historical-archive]: Private Originale; Hashmanifest für Herkunft und spätere Nachprüfung.
[^baseline-tests]: Unverändertes Docker-Testprotokoll des ausgeführten Ausgangsstands.
