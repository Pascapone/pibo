---
type: "Status"
title: "Pibo Latenzumbau: Übergabe zur Fortsetzung"
description: "Verzeichnet den finalen Produktkandidaten, Prüfbelege, Evidenzgrenzen und verbleibende externe Gates des Latenzumbaus."
tags: ["latency", "reliability", "handoff", "implementation"]
status: "draft"
authority: "informative"
generated: { by: "openai/codex", at: "2026-09-12T22:20:00Z" }
sources:
  - id: "plan"
    resource: "/plans/pibo-latency-reliability-remediation.md"
    title: "Verbindlicher Umfang und Definition of Done"
  - id: "validation"
    resource: "/reports/latency-reliability-validation-2026-09-12.md"
    title: "Bisherige Umsetzung und tatsächliche Prüfungen"
  - id: "archive"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-remediation-2026-09-12"
    title: "Commitsicherungen, Rohbelege, Audit-Übergabe und archivierte Workflows"
  - id: "continuation-evidence"
    resource: "scope: private controller archive /root/.pibo/investigations/latency-continuation-2026-09-12; candidates 09375bbb8d702d1bc6817ffe1313429fc05e07b3 and 722883c43c8868caaf3c32511780191ff5422b34"
    title: "Fortsetzungs-, Last-, Pibo2- und Testsuite-Nachweise"
implementation_state: "implemented; physical-device and final-candidate soak acceptance open"
---

# Aktueller Übergabestand

Die autorisierte Produktumsetzung ist auf dem committed Kandidaten `722883c43c8868caaf3c32511780191ff5422b34` abgeschlossen; die Gesamtabnahme bleibt wegen des externen physischen Geräts und des nicht wiederholten Zwei-Stunden-Soaks teilweise offen. Produktcode und Tests liegen im isolierten Worktree `/root/code/pibo/.worktrees/latency-reliability-continuation-pscb044a` auf Branch `latency-reliability-continuation-pscb044a`. Der Produktcode war vor den abschließenden Dokumentationsänderungen sauber. Es wurde nichts gepusht, als PR eröffnet, gemergt, veröffentlicht, released oder auf dem Controller-Gateway bereitgestellt.[^continuation-evidence]

Der Produktkandidat enthält die fokussierten Commits `20be897f`, `dee88a2d`, `8a7bbb67`, `00a7d5ca`, `04ca34cc`, `082dfb6d`, `b87a00d5`, `beb89780`, `d52f0f95`, `717e9a85`, `09375bbb` und `722883c4`. Der letzte Commit ergänzt die inkrementelle, prozessübergreifende Session-Strukturreconciliation. Das checksumgebundene Paket `pasko70-pibo-1.7.2-722883c4.tgz` hat SHA-256 `c3a774d8455e76aec0ca814056b0bdddeb299a49a61738810a138e4039772ad9`.

## Was auf `722883c4` belegt ist

- **AP-03:** Full-HTTP-Foreign-Write-p95 20,53 ms bei 3.250 Sessions und 13,32 ms bei 10.000 Sessions; Delete, Reparent, Detach und Revisionen korrekt.
- **Repräsentative Admission:** 3.250 Admissions, p95 15,22 ms, p99 21,31 ms, 3.270 akzeptierte/verfolgte Commands und null Integritätsfehler. Der 10.000-Lauf wurde bei Host-I/O-Full-PSI 11,12 geschützt beendet und zählt nicht.
- **Native:** Echter `codex-native`-Luna/medium-Toolsmoke mit Codex 0.153.2, erfolgreichem `codex_command`, Marker und fehlerfreiem terminalem Trace. Der fingerprintgebundene Auth-Store war `/root/.pibo/agent-runtimes/codex-native/codex-native-f93ba5251f4f/codex-home`.
- **6+12 Portfolio:** Endzustand sechs Parents, zwölf Children, ein Native-Parent, überall Luna/medium, Modellinferenz, Tools, Marker und terminale fehlerfreie Traces. Im kurzen Parallelfenster waren 17 Gateway-Angebote erfolgreich; eine weitere SSH-Anfrage scheiterte vor Admission und wurde später einzeln erfolgreich wiederholt. Nicht als 18 gleichzeitig aktive Agents ausgeben.
- **MCP-Langlauf:** Sieben erfolgreiche Modellrunden und sieben echte 60-Sekunden-MCP-Aufrufe über 1.860,856 Sekunden. Je 49 aktive Slash-Proben: `/status` p95 44,91 ms, `/session` p95 75,02 ms, `/thinking` p95 50,07 ms. Normale Pi-Isolation, keine Native-Sandbox-Ausnahme.
- **Öffentliche headful Abnahme:** Better-Auth-Machine-Session auf dem exakten Paket; `/status`, `/session` und `/thinking` sichtbar in 16,69–19,33 ms, `/thinking` im zweiten begrenzten Versuch bereit, `runtimeActive=false`. Desktop 1.440×900 und 390×844 ohne horizontalen Overflow, Composer aktiv.
- **Sichtbare Recovery:** 60,061 Sekunden hidden/frozen; Entwurf, Fokus und Composer erhalten; Trace- und Signal-Catch-up bei stabiler Epoche; Event-, Signal- und Trace-Timeline-Verbindungen nach Resume erneuert. Genau ein währenddessen angenommener Command blieb wegen `openai-codex` `disconnected/configured=false` im frischen Pi-Store `interrupted`, wurde nie wiederholt und nach Prüfung als fehlgeschlagen reconciliert. Queue danach gesund, scoped Dead-Letter-Traversierung leer.
- **Testsuite:** Exakt 476/476 kanonische Dateipfade erfolgreich, keine fehlenden/zusätzlichen Pfade und keine Hashabweichung. Ledger SHA-256 `c9d52ebb11a52a18ae37c005c9e0a5adaaeb7defa42c9f1ffc3668f192f9490c`. Abgebrochene Teilprotokolle wurden nicht gezählt.

## Grenzen, die nicht umetikettiert werden dürfen

Die damaligen headful Desktop-/390×844-/Recovery-Artefakte, der `codex-native`-Kaltstartvergleich, die Pibo2-Core-Bootstrap-Messung, der echte `TelemetryCaptureWriter`-A/B-Vergleich und der 7.201,62-Sekunden-Soak gehören ausschließlich zu `09375bbb8d702d1bc6817ffe1313429fc05e07b3`. Sie bleiben wertvolle Vorläuferevidenz, sind aber keine exakten `722883c4`-Läufe. Die neue öffentliche headful Abnahme auf `722883c4` ist separat belegt und ersetzt keine der übrigen älteren Messungen.

Der Native-Smoke und der Native-Portfolio-Parent benötigten auf diesem Dockerhost vorübergehend `permissionMode: "yolo"`, weil Bubblewrap keine unprivilegierten User-Namespaces anlegen konnte. Diese Ausnahme galt nur dort. Der normale Pi-/MCP-Langlauf blieb isoliert.

Die Suite wurde nach Schutzstopps in kleinere geschützte Shards mit `--test-concurrency=1` und 1.024-MiB-Node-Heap zerlegt. `spawnSync.status === null` im Controller-Kompatibilitätstest fiel zeitlich mit Containerlimit, Peak und kumulativen OOM-Zählern zusammen, hatte aber kein erfasstes Exit-Signal. Deshalb nicht allein als OOM-kausal ausgeben. Der exakte fokussierte Wiederholungstest bestand. Nur taskeigene verwaiste Prozessgruppen wurden beendet.

## Verbleibende externe oder zeitliche Gates

1. Physisches Zielgerät: nicht verfügbar; Viewport-Emulation ersetzt es nicht.
2. Neuer 7.200-Sekunden-Soak auf `722883c4`: nicht wiederholt; der vorhandene erfolgreiche Soak bleibt `09375bbb` zugeordnet.
3. Der ältere Browserlauf hatte einen separaten `/api/previews/events`-503. Der neue Zielseiten-Monitor sah keinen Core-Network-/Runtime-Fehler, doch Containerlogs enthielten begrenzte Fehler für eine andere veraltete Session-ID; keinen vollständig fehlerfreien Hostlauf behaupten.
4. Der frühere 10.000-Admission-Versuch bleibt ein dokumentierter Host-I/O-Schutzstopp. Nach ausdrücklicher Freigabe der Servereinstellung 3.250 ist er kein offenes Gate; kein weiterer Lastlauf wurde dafür gestartet.

## Betriebs- und Abschlusszustand

Die explizite Pibo2-Lease `lease_0e34ee90319d825b87` auf Slot 01 wurde am 2026-09-12 um 21:24:14 UTC ordnungsgemäß freigegeben. Die spätere headful Lease `lease_8b448039c94bde2e01` wurde am selben Tag um 22:19:20 UTC freigegeben; der Pool meldete danach `active: 0`, `free: 10`. Browser-Slot `pibo-chat-slot-002` wurde freigegeben und sein Cookieprofil gelöscht. Temporäre Slotprofile und MCP-Konfiguration werden nicht weiter betrieben. GitHub-Issue #1013 bleibt der einzige Ort für langfristige Reminder-Read/Ack-Discovery; #1016 behandelt die allgemeine Pibo2-Providerauth. Beides ist nicht Teil dieses Produktpatches.

Private Kernartefakte liegen unter `/root/.pibo/investigations/latency-continuation-2026-09-12/`:

- `full-suite-coverage-summary-722883c4.json` und `full-suite-coverage-files-722883c4.tsv`;
- `ap03-http-foreign-writes-722883c4.json`;
- `finite-3250-admissions-722883c4-paced/`;
- `portfolio-722883c4-real/runtime-validation.json`;
- `mcp-long-722883c4/summary.json`;
- `pibo2-codex-native-luna-medium-tool-smoke5-722883c4.log`;
- `pibo2-pool-release-722883c4.json`;
- `headful-722883c4/headful-acceptance-summary-722883c4.json`;
- `headful-722883c4/headful-slash-responsive.json` und `visible-recovery-60s.json`;
- `headful-722883c4/message-queue-reconcile-applied.json` und `persistence-dead-letters-after.json`;
- `headful-722883c4/pibo2-pool-release-final.json`.

Operativ ist keine weitere Produktimplementierung erforderlich, bevor ein Maintainer die fokussierte Commitkette und die dokumentierten Evidenzgrenzen reviewt. Der Branch ist lokal PR-bereit; ein Push oder Upstream-PR wurde nicht ohne gesonderte Veröffentlichungsfreigabe ausgeführt. Ein späterer Push oder PR braucht ausdrückliche Freigabe und den normalen upstream-first GitHub-Flow. Die offenen externen Gates dürfen separat nachgeholt werden; sie rechtfertigen keine Aufweichung von Schutzgrenzen oder Credential-Isolation.

# Historischer Ersthandoff

Die folgenden Abschnitte bewahren den ersten gestoppten Zwischenstand, alte Branchzuordnungen und Wiederherstellungshinweise als Herkunft. Sie sind keine aktuelle operative Anweisung und ersetzen den oben dokumentierten Kandidaten `722883c4` nicht.

# Wo die Arbeit liegt

Alle folgenden Pfade beziehen sich auf den Controller, nicht auf Pibo2. Der Controller-Checkout `/root/code/pibo` enthält fremde Arbeit und ist kein experimenteller Entwicklungsstand. Die Produktarbeit liegt in getrennten Worktrees. Vor neuen Änderungen den aktuellen Git-Stand prüfen; die folgende Tabelle ist ein verifizierter Übergabesnapshot.

| Branch | Worktree | Gesicherter Stand | Verwendung |
|---|---|---|---|
| `latency-integration` | `/root/code/pibo/.worktrees/latency-integration` | `ac6ecda0455f6dbb9552e79c0323207a17a8c52e` vor diesem zusätzlichen Dokumentationscommit | Geprüfte Produktteilfixes und zentrale Dokumentation; hier anschließen |
| `latency-audit` | `/root/code/pibo/.worktrees/latency-audit` | `c18890c157ac4490272b3fb6e450740e440bdc70` | Separates Paket; noch nicht abgenommen oder integriert |
| `latency-browser` | `/root/code/pibo/.worktrees/latency-browser` | Gemeinsame Basis, keine Produktänderungen | Frühere Zuordnung für Browserarbeit |
| `latency-gateway` | `/root/code/pibo/.worktrees/latency-gateway` | Gemeinsame Basis, keine Produktänderungen | Frühere Zuordnung für Serverarbeit; Teilfixes liegen bereits in Integration |
| `latency-storage` | `/root/code/pibo/.worktrees/latency-storage` | Gemeinsame Basis, keine Produktänderungen | Frühere Zuordnung für Storage; Klassifizierer liegt bereits in Integration |
| `latency-capture` | `/root/code/pibo/.worktrees/latency-capture` | Gemeinsame Basis, keine Produktänderungen | Frühere Zuordnung für AP-11 |

Gemeinsame Implementierungsbasis: `cac4dcd03945b9754db7be9ab2ab4324f10c335c`, damals aktuelles `upstream/dev`. Der historische untersuchte Pibo2-Kandidat war `0fe71c72a1d3bcb3b0d06295d323317a452b367a`. Beides nicht mit künftig aktuellem `upstream/dev` verwechseln. Vor Aktualisierung des Kandidaten neue Upstream-Änderungen und Patch-Äquivalenz prüfen; bestehende Branches erhalten.

Das ursprüngliche Eingangsdokument bleibt unverändert unter `/root/code/pibo-latency-plan/docs/plans/pibo-latency-reliability-remediation.md`. SHA-256: `b64c4ba221fd8261d43f608a2abea138753779674da27609e084d256a7f17a55`. Der gepflegte Ausführungsstand steht im oben verlinkten Plan im Integrations-Worktree.

Alle sechs Worktrees waren vor dieser Dokumentation sauber. Alle sechs taskeigenen Dockercontainer wurden freigegeben; frühere Web-/CDP-Ports und Browserhandles sind nicht mehr nutzbar. Die zehn delegierten Sessions sind ruhend, keine Anfrage läuft weiter. Keine Branches oder Worktrees wurden gelöscht. Kein Push, PR, Merge, Release oder Deployment wurde ausgeführt.

# Was bereits integriert ist

| Commit | Verhalten und betroffene Dateien | Nachweis und Grenze |
|---|---|---|
| `6c0e4ff6170f987cf6252589c8dadf6a7e79a5de` | `src/web/channel.ts`: Runtime-Status einmal pro Antwort berechnen und für beide kompatiblen Ausgabeansichten verwenden; Regression in `test/gateway-restart-safety.test.mjs` | Baseline las zweimal, Fix einmal; Fälle für 1/10/20 Runtimes. Kein vollständiger inkrementeller Projektor |
| `eace24be3b893512d649de96b30a34ed713d91ae` | `src/apps/chat/message-command-dispatcher.ts`: monotone Wakeups, 4,5–5,5 s Recovery-Jitter, frühere Lease-Erneuerung bei Bedarf, maximal zwölf Claims je Durchlauf und Event-Loop-Freigabe; Regressionen in gleichnamigem Test | Idle-, Wakeup-/Burst-, Lease-, Crash- und Fairnessprüfungen grün. Browser-Receipt-Polling noch unverändert |
| `81847c71989feb1645220daea1ded02f370ecb73` | Neue reine Funktion `classifyOutputCollision` in `src/core/output-collision-classification.ts`; Test `test/output-collision-classification.test.mjs` | Prüft gespeicherten Fingerprint unabhängig aus vollständiger kanonischer Evidenz, unterscheidet Äquivalenz/Konflikt/fehlende Evidenz/Version/Budget. Keine Datenmutation oder historische Reparatur |

Der Klassifizierer unterstützt vollständige `assistant_message`- und `message_finished`-Events. Er verwendet bestehende Identitätssemantik statt einer neuen rückwirkenden Bedeutungsänderung. Input-, Struktur-, Tiefen- und Zeitgrenzen sind implementiert. Producer-/Replay-End-to-End-Nachweise für den historischen Fehler bleiben offen.

Dokumentationscommits: `ae0ea199`, `1407b618`, `e805c7c6`, `ac6ecda0`. Die tatsächlich implementierten Verträge stehen in [Kapazität und Scheduling](/specs/runtime/capacity-and-scheduling.md), [Gateway](/specs/gateway/web-host-and-channel.md) und [Product Store](/specs/data/product-store-history-and-read-models.md). Schema-Version 14 war bereits Basis; der Klassifizierer führt keine Schema-Migration ein.

# Separates Audit-Paket: zuerst prüfen, dann übernehmen

Vollständige fachliche Übergabe: `latency-remediation-audit-handoff.md` im privaten Archiv aus dem nächsten Abschnitt. Sie enthält Source-/Testsymbole, CLI-Verträge, Messparameter, Fehlversuche und offene Abnahmen. Der Quellcode liegt nur auf `latency-audit`.

| Reihenfolge | Commit | Inhalt |
|---|---|---|
| 1 | `686a78e0a87d7f534170bbac210f380ef7b03e95` | Begrenztes Dead-Letter-Listing und killbarer Audit-Reader |
| 2 | `799ab6cae5ea31d49d3eb2d4f44fda370565eecf` | Vom Orchestrator eingespielter Klassifizierer; entspricht dem bereits integrierten `81847c71` |
| 3 | `f58f0a32c0be5ceb7052d51995f286e13e937206` | Reconciliation-Consumer, sichere Äquivalenzentscheidung und Ressourcenbudgets |
| 4 | `6b5417810c7ed3c6b7034e6237e94974547ebef0` | Lokaler Lastharness über tatsächliche Admission-/Dispatcher-/Persistenz-/Receipt-Pfade |
| 5 | `c18890c157ac4490272b3fb6e450740e440bdc70` | Abschließende Reviewkorrekturen für unbekannte Scopes, Fortschrittsgrenzen und Snapshot-Nachweis |

**Nicht den ersten Commit isoliert als fertigen Fix übernehmen.** Dort wurde reproduziert, dass ein passender übergroßer Payload bei Sessionfilter still verschwand und dennoch `complete: true` gemeldet wurde. Weitere Reviewpunkte betrafen konservative Arbeitszählung bei konkurrierenden Inserts sowie Byte-/Fortschrittsgrenzen. Der Worker meldet diese Punkte mit Regressionen behoben; der abschließende Orchestrator-Review fehlt. Das ursprüngliche Review liegt als `latency-ap08-review.md` im Archiv.

Bei Übernahme in einen vom Integrationsstand abgeleiteten Kandidaten den bereits vorhandenen Klassifizierer nicht erneut unbesehen cherry-picken. Die Audit-spezifische Reihenfolge ist `686a78e0`, `f58f0a32`, `6b541781`, `c18890c1`; Inhalt und Abhängigkeiten vor Übernahme prüfen. Danach gemeinsam bauen und testen. Die 82 Integrations- und 41 Audit-Tests sind getrennte Teststände und kein gemeinsamer 123-Test-Abnahmenachweis.

Wichtige Grenzen des Audit-Pakets:

- Äquivalenz-Apply schreibt eine idempotente auditierte Entscheidung. Es löscht keine Dead Letters und spielt keine Delivery erneut ab. Kein atomarer Zwei-Store-Reparaturanspruch.
- Deep Audit nutzt begrenzte Read-Snapshots je Store; kein gemeinsamer Snapshot über beide Stores. Der DLQ-Cursor ist eine Live-Traversierung, kein über Seiten festgehaltener Snapshot.
- SQLite kann bei read-only WAL-Lesern Sidecars/Locks verwenden. „Keine Produktmutation“ bedeutet nicht „keinerlei Dateisystemzugriff“.
- Der Lastharness benutzt echte lokale Produktpfade, aber einen deterministischen Modelladapter. Er ersetzt weder echte Provider-/Subagent-Last noch Browser- oder Smartphone-Prüfungen.

# Belege und Sicherungen

Private dauerhafte Ablage, Verzeichnisse geschützt mit Modus 0700:

```text
/root/.pibo/investigations/latency-remediation-2026-09-12/
```

Im Folgenden meint `ARCHIV` genau diesen Pfad. Die Ablage ist lokal auf diesem Controller, kein externes Backup. Bei Übergabe auf einen anderen Rechner müssen Repository beziehungsweise Bundles **und** dieses private Archiv kontrolliert übertragen werden. Rohbelege nicht ungeprüft im Repository veröffentlichen.[^archive]

| Pfad relativ zu ARCHIV | Bedeutung |
|---|---|
| `orchestration-checkpoint.md`, `closure-manifest.json` | Bisheriger Abschlussstand, genaue Branchköpfe und Hashes; historischer Snapshot vor diesem zusätzlichen Handoff |
| `latency-remediation-audit-handoff.md` | Vollständige finale Worker-Übergabe |
| `manifest.json`, `pibo2-latency-evidence/`, `pibo2-multiagent-0912/` | 126 ursprüngliche Untersuchungsdateien; alle erneut gegen Größe und SHA-256 geprüft |
| `latency-audit-reviewed-tests.log`, `latency-final-docs-validator-tests.log` | Letzter Audit-Testlauf und Dokumentationsprüfungen des vorherigen Abschlusses |
| `latency-audit-evidence/`, `latency-audit-evidence.sha256`, `latency-audit-harness-reference.log` | Referenzmessungen mit Rohzeiten und roten Status-/Healthbudgets |
| `audit-reference-fixtures.tgz` | Synthetische Referenzdatenbanken und Payloads aus dem freigegebenen Auditcontainer |
| `latency-baseline-dist.tgz`, `latency-baseline-desktop.png` | Separates Baseline-Buildarchiv und lokaler Browser-Funktionscheck |
| `integration-final.bundle`, `audit-final.bundle` | Verifizierte inkrementelle Git-Bundles der oben genannten Abschlussköpfe |
| `pibo-latency-baseline.bundle` | Git-Basis und deren erreichbare Historie |
| `pibo-latency-traceability.bundle` | Zusätzlich benötigte historische Spezifikations-Commits unter `refs/latency-validation/*` |
| `integration-handoff.bundle`, `handoff-manifest.json` | Zusätzliche Sicherung inklusive dieses Handoff-Commits und Ergebnis der Übergabeprüfung |
| `workflows/`, `workflow-manifest.json` | Neun Workflow-Pakete einschließlich ihrer relativen Referenzen; Herkunft und SHA-256 je Datei |
| `latency-browser-contract.md`, `latency-gateway-contract.md`, `latency-storage-contract.md`, `latency-audit-api-request.md`, `latency-remediation-research-plan.md` | Frühere Schnittstellenabsprachen und Recherche; gegen aktuelle Quellen prüfen |

`audit-final-stop-wip.patch` ist nur eine frühere Zusatzsicherung; die Änderungen wurden anschließend in `c18890c1` committed. Nicht blind erneut anwenden. Alte `pibo-latency-checkpoint.bundle`, `latency-remediation-workers.json` und `orchestration-checkpoint-before-final-stop.md` bleiben Herkunftsbelege, sind aber kein aktueller Arbeits-/Containerstatus und keine Anweisung, viele Agents zu starten.

Direkt im Repository stehen der [historische Inhaltsnachweis](/reports/artifacts/latency-reliability-2026-09-12/historical-manifest.json), [82 Produkttests](/reports/artifacts/latency-reliability-2026-09-12/checkpoint-product-tests.log), [41 Audit-Tests](/reports/artifacts/latency-reliability-2026-09-12/audit-worker-tests.log), [Baseline-Tests](/reports/artifacts/latency-reliability-2026-09-12/baseline-focused-tests.log) und [bestehende Capture-/Cold-Fork-Prüfungen](/reports/artifacts/latency-reliability-2026-09-12/baseline-existing-capabilities.log).

## Wiederherstellung, falls Worktrees nicht verfügbar sind

Im bestehenden Repository zunächst `git bundle verify` und `git bundle list-heads` für das gewünschte Bundle verwenden. Die Abschlussbundles benötigen die Basis `cac4dcd0`. In einem neuen, isolierten Repository zuerst `pibo-latency-baseline.bundle` importieren; dessen Ref ist `refs/remotes/upstream/dev`. Danach `pibo-latency-traceability.bundle` mit beiden `refs/latency-validation/*` importieren, dann `integration-handoff.bundle` und `audit-final.bundle` auf **neue** lokale Branches übernehmen. Die Bundles nennen ihre Quell-Refs selbst; keine existierenden Branches mit Force ersetzen.

Die zwei zusätzlichen historischen Commits sind `2b7b2a7c31be0de7b326e5ef6b82f01ea2b51a3d` und `730cf01fcfa1032ce9c4640656617b8bdd831ba2`. Ohne diese Objekte können Spezifikations-Traceability-Prüfungen in einer isolierten Wiederherstellung scheitern, obwohl Produktcode vorhanden ist. Bundles enthalten keine Dependencies, Secrets oder laufenden Container.

# Tatsächlich ausgeführte Prüfungen

| Stand | Ergebnis | Aussagegrenze |
|---|---|---|
| Integrationsproduktcode `81847c71` | Vollständiges `npm run build` und `npm run typecheck`; sieben relevante Suiten mit 82 Tests grün | Keine komplette Root-Testsuite, kein integrierter Browser-/Pibo2-Pass; spätere Integrationscommits änderten nur Dokumentation |
| Auditproduktcode `c18890c1` | Server-TypeScript kompiliert; acht fokussierte Suiten mit 41 Tests grün, 18,335 s | Kein vollständiger Web-/VSCode-/Releasebuild; noch kein abschließender Review |
| Frühere Harness-Referenz, Gateway-Basis `cac4dcd0` | 1.000 Admission-Proben je Profil, 30 Status-/Health-Paare; Status-p95 2.114,894 ms bei 3.250 und 7.562,6244 ms bei 10.000 Sessions | Beide Profile `passed: false`; spätere Harness-Härtungen nur im Smoke geprüft. Kein Vorher-nachher-Nachweis des gemeinsamen Kandidaten |
| Audit-CLI, letzter Worker-Lauf | 30 tatsächliche CLI-Aufrufe auf 10.000 Jobs: p95 160,457 ms; 100.000-Job-Fixture mit Index-SEARCH statt Vollscan | Lokale Diagnoseprüfung, kein allgemeiner Status-/Browser-Latenzpass |

Für die 82er-Suite im neu eingerichteten Dockerworker nach Build:

```bash
node --test test/gateway-restart-safety.test.mjs \
  test/gateway-restart-approval.test.mjs \
  test/message-command-dispatcher.test.mjs \
  test/message-command-store.test.mjs \
  test/output-collision-classification.test.mjs \
  test/output-identity-regression.test.mjs \
  test/data-v2-ingest-service.test.mjs
```

Für die Audit-Suite den kompilierten Audit- beziehungsweise geprüften kombinierten Kandidaten verwenden:

```bash
node --max-old-space-size=1200 node_modules/typescript/bin/tsc -p tsconfig.json
node --test --test-concurrency=1 \
  test/output-collision-classification.test.mjs \
  test/output-collision-equivalence.test.mjs \
  test/output-inspection-bounded.test.mjs \
  test/output-integrity-debug.test.mjs \
  test/latency-harness.test.mjs \
  test/output-identity-regression.test.mjs \
  test/storage-maintenance.test.mjs test/storage-backup.test.mjs
```

Früher scheiterte ein Build parallel zur großen Statuslast mit `Killed`; sequenzielle Builds bestanden. AP-04-Tests scheiterten zunächst an der fehlenden Klassifizierer-Abhängigkeit und später gegen die echte API nicht mehr. Einzelheiten und weitere korrigierte Fixturefehler stehen in der Audit-Übergabe. Keine Fehler durch übersprungene Tests oder geänderte Zielbudgets verdecken.

# Was noch offen ist

| Paket | Bisher erreicht | Noch erforderlich |
|---|---|---|
| AP-00 Basis und Evidenz | Historische Belege gesichert; lokale Baseline und Harness vorhanden | Vollständige Anforderungszuordnung, gemeinsame repräsentative Messung, Diagnoseeinfluss belegen |
| AP-01 Browser-Recovery | Recherche/Schnittstellenabsprachen | Resume-/Focus-/Visibility-Recovery zusammenführen und Last begrenzen |
| AP-02 Statusübertragung | Vorläufiger Browser-/Gateway-Vertrag | Versions-/Resync-/Epoch-Verhalten und begrenzte Statusarbeit tatsächlich implementieren und prüfen |
| AP-03 Gateway-Projektion | Doppelte Berechnung entfernt | Vollständigen inkrementellen Projektor und Skalierung nachweisen |
| AP-04 Output-Identität | Reiner Klassifizierer integriert; Debug-Consumer separat | Audit-Review/Integration, echte Producer-/Retry-/Replay-Prüfung, historische Einzelbefunde soweit belegbar klären |
| AP-05 Storage-Worker | Bestehende Infrastruktur und Basistests geprüft | Deadline-/Commit-Reconciliation, Fencing und Diagnose für Writerersatz vervollständigen |
| AP-06 Hintergrundpolling | Server-Dispatcher verbessert | Browser-Receipt-Verhalten und gemeinsame Latenz-/Idle-Abnahme |
| AP-07 Native Kaltstarts | Bestehende passive Lesewege geprüft | Wartephasen, Abhängigkeiten und reale Kaltstart-/Kapazitätsmessungen |
| AP-08 Begrenzte Diagnose | Separates Paket mit Regressionen | Abschließender Review, Integration, aktuelle Vertragsdokumentation und kombinierte Abnahme |
| AP-09 Initialer Aufbau | Recherche/Schnittstellenabsprachen | Kleinen nutzbaren Bootstrap und spätere Zusatzdaten laden; Browser nachweisen |
| AP-10 Gesamtprüfung | Baseline und lokaler Harness | 10.000 deterministische Admission-Proben, gemeinsame Headful-/Pibo2-Prüfung, mindestens 30 Minuten echte Last mit 6 Parents/12 Children, zwei Stunden gemischter Dauerlauf, Geräteprüfung gemäß Plan |
| AP-11 Telemetrie/Capture | Bestehende Capture-Funktionen und Tests identifiziert | Kontrollierter A/B-Vergleich mit drei wechselnden Wiederholungen; danach erforderliche Änderungen umsetzen |

Die historische `dead-letters.json` ist leer. Einzelfallbelege lassen sich nicht aus den Aggregaten „31 Fehler / 32 Diagnosen“ rekonstruieren. Keine historische Reparatur wurde durchgeführt. Fehlende Evidenz explizit kennzeichnen und nur über erlaubte aktuelle Quellen ergänzen.

Zum tatsächlich betroffenen Smartphone liegen keine bestätigten Geräte-/Browser-/Zugangsdaten vor. Desktopemulation schließt diese Abnahme nicht. Das ist eine konkrete noch zu klärende externe Voraussetzung; die übrigen offenen Pakete sind überwiegend ausstehende Arbeit, nicht externe Blocker.

# Workflows und Betriebsgrenzen

Aktuell bereitgestellte Skills sind die erste Anlaufstelle. Falls eine neue Session sie nicht mitliefert, liegen die unten genannten Pakete vollständig unter `ARCHIV/workflows/<Name>/SKILL.md`; relative `references/` mitlesen. Die Kopien konservieren diesen Run und können später veralten. Aktuelle Nutzeranweisung und autoritativer V2-Umgebungskontext haben Vorrang. Insbesondere nennen ältere generische Docker-Texte noch Host-Dev-Deployments: Für diesen V2-Auftrag gilt **lokaler Dockerworker → Pibo2**, kein experimentelles Deployment auf den Controller.

| Arbeitsbereich | Referenzierter Workflow | Zu beachten |
|---|---|---|
| Git, Branches, PR und Release | `pibo-v2-github-flow` | `upstream/dev` als Quelle; erhaltene Arbeit vor Aktualisierung sichern; fokussierte PRs, keine Mirror-Rewrites oder Releases als Nebeneffekt |
| Lokale Implementierung und Tests | `pibo-docker-dev`, `pibo-docker-system`; [Ressourcenmodell](/project/compute-browser-resource-operating-model.md) | Für Produktcode isolierten Worker neu einrichten; freigegebene Container nicht voraussetzen |
| Worker-Anmeldung | `pibo-debug-auth` | Dev-Auth ausschließlich im Worker; keine Credentials auf Controller/Pibo2 übertragen |
| Browser und UI | `browser-tool-selection`; [Debug-Verträge](/specs/operator/debug-web-and-pty.md) | Browser Use mit headful Ziel für UI-/Input-Abnahme, DevTools/CDP als technische Evidenz; `DESIGN.md` lesen |
| Pibo2-Kandidatenabnahme | `pibo-v2-server-development`; [Poolbetrieb](/project/isolated-deployment-pool-operations.md) | Genau das lokal gebaute, committed und gehashte Paket prüfen; Remote-Ziel aus Operator-Konfiguration ermitteln und bei Mutationen ausdrücklich angeben |
| Plan, Anforderungen, aktuelle Verträge | `pibo-spec-writing`; [Hauptplan](/plans/pibo-latency-reliability-remediation.md) | Geplantes und implementiertes Verhalten getrennt halten; keine konkurrierenden Spezifikationen |
| Dokumentation und Evidenz | `maintain-okf-docs`; [Dokumentationsprofil](/project/documentation-profile.md) | Ledger, Index, Log und relevante Validatoren gemeinsam pflegen; private Rohbelege nicht veröffentlichen |
| Optionale Delegation | `outcome-first-prompting`; [Runtimebetrieb](/project/agent-runtime-operations.md) | Arbeitsweise frei. Bei Delegation klare Dateibesitzer und bestehende Abhängigkeiten angeben; keine Pflicht, alte Agentenaufteilung wiederherzustellen |

`AGENTS.md`, `GLOSSARY.md` und bei UI-Arbeit `DESIGN.md` liegen als Hostdateien im Repository-Root; ihre aktuellen Inhalte sind zusätzlich zu lesen.

Discovery jeweils schrittweise über `--help`, unter anderem `pibo compute --help`, `pibo compute dev --help`, `pibo compute dev spawn --help`, `pibo debug --help`, `pibo tools show browser-use` und die im Skill genannten Guides. In diesem Run musste die Operator-CLI explizit `PIBO_HOME=/root/.pibo` erhalten, da das native Agent-Home sonst einen anderen Kontext auswählte; neue Umgebung vorher prüfen. Dev-Auth ist davon unabhängig und bleibt im Worker.

Beim damaligen Compute-CLI-Stand scheiterte das direkte erneute Anlegen eines bereits vorhandenen Worktrees trotz anderslautender Skill-Beschreibung. Erhaltene Worktrees deshalb nicht löschen, um einen Spawn zu erzwingen. Aktuelle CLI prüfen oder einen neuen, eindeutig benannten Fortsetzungsbranch vom gesicherten Commit verwenden. Der Worker braucht korrekte Git-Metadaten für Dokumentations-Traceability. Keine globalen `GIT_DIR`-/`GIT_WORK_TREE`-Exports: Sie haben zuvor Git-Fixturetests umgeleitet. Dependencies und Build müssen zum tatsächlichen Kandidaten passen.

Session-Diagnose beginnt bei der Debug-CLI. Ursprungssession: `ps_73d65a12-f122-4b0f-b2bc-739a4edbfb39`, Room: `room_209cf2ff-6b46-4705-a216-a6d2138604bd`. Audit-Session: `ps_2047dc78-446a-4ec9-8c96-f4ea9039d1bd`, Thread-Key `latency-w-audit`, abgeschlossener Run `run_16e74cf1-c088-4bc2-aead-778b1e01349a`. Diese IDs sind historische Diagnoseadressen, keine Vorgabe für den neuen Agenten.

Mehrere frühere Agentläufe wurden abgebrochen; die MCP-Steuerung meldete zeitweise `Auth required`. Die Abschluss-Steuerung erreichte den aktiven Audit-Turn über den regulären lokalen Pibo-Client. Spätere MCP-Abschlussreads funktionierten wieder und bestätigten das Ende; Authentifizierung daher nicht ohne aktuelle Prüfung als weiter bestehenden Blocker behandeln. Es gab keine Credential-Änderung oder Controller-Neustart. Falls der neue Agent delegiert, gilt der aktuelle Pibo-Workflow: Send über `pibo_run_start`, danach Status/Observe/Read; normalerweise abgeschlossene Nachrichten statt aller Toolausgaben lesen.

Das alte automatische Gesamtziel dieser Session wurde wegen der ausdrücklichen Stop-Anweisung als `blocked` markiert. Das ist keine technische Fertigstellung und kein Nachweis eines weiterhin bestehenden Infrastrukturfehlers. Der neue Agent benötigt nicht die Reaktivierung dieser alten Session, um einen neuen Fortsetzungsauftrag zu bearbeiten.

# Sinnvoller Anschluss

1. Aktuelle Nutzeranweisung, `AGENTS.md`, `GLOSSARY.md`, diesen Handoff und den Hauptplan lesen. Branchköpfe, Sauberkeit und Archiv prüfen. Arbeitsweise selbst wählen.
2. Den geprüften Integrationsstand als Ausgangspunkt erhalten und aktuelle Upstream-Differenzen erfassen. Einen passenden isolierten Worker einrichten. Nicht mit dem alten Controller-Checkout oder einer ungeprüften Gesamtzusammenführung anfangen.
3. Das Audit-Paket einschließlich aller drei Reviewpunkte prüfen, gezielt übernehmen und zusammen mit den vorhandenen Teilfixes testen. Danach Implementierungsverträge korrekt nachführen.
4. Die verbleibenden Browser-/Gateway-/Storage-Pakete anhand ihrer tatsächlichen Quellen umsetzen. Vorläufige Verträge sehen `serverEpoch`, Status-`version`/`fromVersion`, Snapshot-Recovery und einen kleinen opt-in Bootstrap vor; diese Absprachen sind noch keine implementierten APIs.
5. Den gemeinsamen Kandidaten gegen dieselben repräsentativen Fixtures messen. Erst dann Aussagen zur Verbesserung treffen. Sampler-Einfluss, unbekannte Commitzustände, Receipt-/Output-Integrität und rote Budgets sichtbar halten.
6. Nach lokalen Prüfungen unveränderten Kandidaten auf Pibo2 abnehmen, reale Last-/Dauerlauf-/Gerätegates gemäß Plan behandeln und erst mit passender Evidenz PRs vorbereiten. Gesundheitscheck allein reicht nicht. Keine Veröffentlichung oder Release-Freigabe aus Teiltests ableiten.

Die angrenzenden Pläne bleiben fachliche Eigentümer: [Gateway-/Trace-Roadmap](/plans/pibo-fast-gateway-and-trace-roadmap.md), [Trace-V2-Follow-up](/plans/chat-web-trace-v2-follow-up.md), [Worker-/Ressourcenschutz](/plans/gateway-resource-protection-workers.md), [Capture-/Archiv-Isolation](/plans/telemetry-capture-archive-isolation.md), [Rejected-Message-Signale](/plans/reconcile-rejected-message-signals.md) und der übergeordnete [Performance-/Skalierbarkeitsplan](/plans/pibo-performance-and-scalability.md). Bereits geschlossene Arbeit nur mit konkretem Gegenbeleg erneut öffnen.

# Abschluss dieser Übergabe

Dieser Schritt ergänzt ausschließlich Dokumentation und Sicherungen. Die bestehenden sechs Branchstände und sechs Abschlussartefakte wurden vor der Änderung geprüft; alle 126 historischen Dateien stimmen mit dem Originalmanifest überein. Die endgültige Dokumentationsrevision, Prüfergebnisse und Bundle-Hashes stehen nach Abschluss in `ARCHIV/handoff-manifest.json`. Das bisherige `closure-manifest.json` bleibt unverändert als Herkunftssnapshot erhalten. Eine Kopie dieses Dokuments liegt zusätzlich unter `ARCHIV/HANDOFF.md`.

Die Dokumentationsprüfungen dieses Schritts laufen als reine Dateiprüfungen im Integrations-Worktree; dafür ist nach dem Docker-Skill kein neuer Worker nötig. Produktprüfungen und Deployments werden nicht erneut ausgeführt. Die oben genannten Produkt-Testresultate bleiben Belege ihrer ausdrücklich benannten früheren Kandidaten.

[^plan]: Unveränderter Anforderungsumfang des importierten Umsetzungsplans.
[^validation]: Bisherige lokale Ausführung, Grenzen und getrennte Prüfstände.
[^archive]: Private Originale, Worker-Übergabe und wiederherstellbare Arbeitsstände auf dem Controller.
[^continuation-evidence]: Private, checksumgebundene Fortsetzungsartefakte für Kandidatenidentität, Testsuite, Last, Pibo2, Native, MCP und Lease-Freigabe; keine Credentials werden veröffentlicht.
