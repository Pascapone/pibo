---
type: "Investigation Report"
title: "Pibo performance and scalability implementation handoff"
description: "Transfers the exact implementation, validation, branch, environment, and open-test state for packages A through H."
tags: ["performance", "scalability", "handoff", "storage"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-07T00:00:00.000Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/production-performance-audit-2026-09-06.md"
  - resource: "/reports/performance-scalability-p0-2026-09-06.md"
  - resource: "/reports/performance-scalability-storage-isolation-2026-09-06.md"
---

# Auftrag und maßgebliche Quellen

Der Nutzer hat die vollständige Umsetzung des [Performance- und Skalierbarkeitsplans](/plans/pibo-performance-and-scalability.md) verlangt und ausdrücklich angeordnet, bis zum Abschluss aller Arbeitspakete A–H weiterzuarbeiten. Ausgangspunkt sind der [Produktionsaudit](/reports/production-performance-audit-2026-09-06.md) und dessen [Messdaten und Belege](artifacts/performance-audit-20260906/). Der nächste Agent soll diese Dokumente als maßgebliche Anforderung und Evidenz behandeln, nicht nur diesen Übergabebericht.

Für Code gelten weiterhin die Repository-Regeln aus `AGENTS.md` und `GLOSSARY.md`: fokussierter Branch und eigenes Worktree von `upstream/dev`, Implementierung und Tests im isolierten Docker-Worker, anschließend Installation desselben inhaltsadressierten Pakets in einem isolierten Pibo2-Pool-Slot, reale relevante Abnahme und erst danach ein PR gegen `upstream/dev`. Den Controller-Host oder dessen Gateway nicht verändern. Der Nutzer hat außerdem verlangt, den `researcher` für gezielte Codebase-Suche zu verwenden, große eigene `rg`-Ausgaben zu vermeiden und beim Beobachten von Subagents nur deren letzte Nachrichten ohne Tool-Ausgaben zu lesen.

# Gesamtstatus

| Paket | Stand am 7. September 2026 | Nächster Gate-Schritt |
|---|---|---|
| A: Index-Fix und minimale Spans | Implementiert, lokal und auf Pibo2 abgenommen, PR eröffnet | PR #953 prüfen und integrieren lassen |
| B: Isolierter Admission-/Storage-Schnitt | Code und Pibo2-Abnahme vorhanden; vollständige Web-Regression hat nachträglich eine asynchrone Test-/Integrationslücke gezeigt | Uncommittete Versuche bereinigen, Web-Regressionssuite vollständig grün machen, Kandidat neu bauen und Pibo2 erneut abnehmen |
| C: Durable Message-Command und UI-Zustände | Nicht begonnen | Erst nach belastbarem B-Gate |
| D: Fairness, Limits, Kaltstart-/Provider-Slots | Nicht begonnen | Gemeinsamen Command-/Lease-Vertrag mit C umsetzen |
| E: Output-/Telemetrie-Batching und Payload-Isolation | Teilweise Vorarbeit in B, eigenes Paket nicht begonnen | Outbox-Vertrag und B-Grenze als Basis verwenden |
| F: Navigation-/Trace-Lesemodelle | Nicht begonnen | Nach B/E und bestehendem Trace-Plan |
| G: Archive, Retention und Wartung | Nur Telemetrie-Timer-Lifecycle in B korrigiert | Retention, Reconciliation, Backup/Restore und kontrolliertes Wachstum implementieren |
| H: Runtime-Host-Isolation oder nächste Kapazitätsstufe | Nicht begonnen | Nach Messung von B–F entscheiden und belegen |

# Paket A: abgeschlossener Stand

Worktree: `/root/code/pibo/.worktrees/performance-scalability-p0`

Branch: `feature/performance-indexed-admission`

Commits:

- `79984bc7` — indexed admission and timing
- `b14e41cf` — restore screenshots required by baseline validation
- `29eebe7d` — Pibo2 validation report
- `d178416c` — reports index refresh

PR: [Pascapone/pibo#953](https://github.com/Pascapone/pibo/pull/953)

Der Stand ist in [Indexed chat admission: P0 validation](/reports/performance-scalability-p0-2026-09-06.md) dokumentiert. Der genaue Pibo2-Kandidat, Lastmessungen, Query-Plan-Nachweis und Artefakte stehen dort. Am Handoff-Zeitpunkt ist `d178416c` kein Vorfahr des aktuellen `upstream/dev`; eine lokale `gh`-CLI war nicht installiert, daher wurde der aktuelle serverseitige PR-Zustand nicht erneut abgefragt. Vor weiterer Branch-Verkettung den PR-Status über den vorgesehenen GitHub-App-/Repository-Flow prüfen.

# Paket B: implementierter und abgenommener Kern

Worktree: `/root/code/pibo/.worktrees/performance-storage`

Docker-Worker: `pibo-dev-performance-storage` (beim Handoff noch laufend)

Aktueller Branchname: `performance-storage`; vor einem Push in einen konformen Namen wie `feature/performance-storage-isolation` umbenennen.

Der Branch enthält auf einem älteren `upstream/dev` zunächst die Paket-A-Commits `79df038e` und `b2f6971f`, danach:

- `defcad65` — isolierter Storage-Schnitt
- `4d3dd9a6` — Crash-Recovery, Lifecycle und Payload-Staging
- `c6a25b79` — Runtime-Binding während Projektionen erhalten
- `051455e5` — Runtime-Binding aus Read-Projektionen heraushalten
- `45ab8c3` — B-Abnahmebericht und Maschinenartefakte
- `846cc29d` — Headful-Browser-Screenshot

Der letzte vollständig gepackte und auf Pibo2 installierte Code-Kandidat ist `051455e5d80ccfe48958e0ff1d998f60e231edf4`. Das Paket `/tmp/pibo-performance-storage-051455e5.tgz` hatte SHA-256 `854cb7629bc149fdbffd857fb5de909f475f9f73064fb15678edb16623c1f5a6`. Es wurde unter `/opt/pibo-candidates/performance-storage/051455e5d80ccfe48958e0ff1d998f60e231edf4/runtime` installiert. Alle Pool-Leases wurden freigegeben; der kanonische Pibo2-Dienst wurde nicht verändert.

Die Implementierung umfasst:

- `BoundedWorkerClient` mit Begrenzung nach Anzahl, geschätzten Bytes und Alter, Prioritäten, FIFO innerhalb einer Priorität, Aging, Deadline, Worker-Absturzbehandlung und expliziten Zuständen für Überlastung und unbekannten Commit-Ausgang.
- `chat-storage-worker` mit separater SQLite-Verbindung, 10-ms-`busy_timeout`, jitterbasierten Wiederholungen bis zur absoluten Deadline und atomarer Admission-Transaktion.
- `AsyncChatStorage` mit dediziertem Writer und lazy separatem Reader.
- Atomare Idempotenzentscheidung, Event-, Session-, Navigation- und Message-Projektion für die Nachrichtenannahme. Nur der Gewinner darf die Runtime auslösen.
- Asynchronen semantischen Output-Ingest unter Erhalt der bestehenden Outbox-, Reliability- und Receipt-Phasen.
- Hashing, Kompression und atomare Payload-Dateiveröffentlichung vor der kurzen Metadaten-Transaktion.
- Schutz gegen das Überschreiben eines neueren Runtime-Bindings durch alte Projektionen.
- Abbruch des Telemetrie-Retention-Timers beim App-Lifecycle-Ende.

Der vollständige akzeptierte Stand und die Grenzen des Pakets sind in [Chat storage isolation: package B validation](/reports/performance-scalability-storage-isolation-2026-09-06.md) dokumentiert. Die Pibo2-Artefakte liegen unter [performance-scalability-storage-20260906](artifacts/performance-scalability-storage-20260906/). Die wichtigste Pibo2-Evidenz: frische Annahme in 78,8 ms Browserzeit, 20 gleichzeitige Duplikate mit genau einer Stream-ID und p95 96,5 ms, 297 Health-Samples ohne Fehler, dauerhafter und sichtbarer Output `STORAGE_OK`. Ein 50er-Stress außerhalb des freigegebenen Profils erreichte p95 499,7 ms und gehört zum Kapazitäts-Gate von Paket D.

# Paket B: bestandene lokale Nachweise

Vor der nachträglichen Vollsuite bestanden im Docker-Worker:

- vollständiger Build und `npm pack`/Prepack des exakten Kandidaten;
- sieben Storage-Isolationstests für Event-Loop-Isolation, Queue-Anzahl und -Bytes, Priorität/FIFO, Crash/Deadline, IPC-Größen, Payload-Staging, Runtime-Binding, atomare 10-fache Admission, Neustart und Writer-Lock;
- 13 V2-Ingesttests;
- 15 kombinierte Runtime-Binding-/Storage-Tests;
- fünf Telemetrie-Retention-Tests;
- alle sechs echten Prozess-Crash-Grenzen des Web-Outbox-Fixtures;
- der file-backed HTTP-Idempotenztest;
- alle 84 OKF-Validator-Tests ohne den zuvor irrtümlich gesetzten privaten `GIT_DIR`-Override;
- strikte Dokumentationsvalidierung, Indexprüfung und Logprüfung mit dem dafür erzeugten privaten Bare-Git-Verlauf.

# Offener Integrationsfehler und uncommittete Dateien

Paket B darf noch nicht gepusht oder als fertig bezeichnet werden. Ein nachträglich ausgeführtes

```text
node --test --test-isolation=none test/web-channel.test.mjs
```

bestand nur 114 von 131 Tests. Nach einem ersten unvollständigen Reparaturversuch schlugen 22 Tests fehl. Die gemeinsame Ursache ist überwiegend, dass Persistenz nun asynchron im Worker erfolgt, während ältere Tests unmittelbar nach einem synchronen Fixture-`emitOutput()` aus der Datenbank oder über einen Read-Endpunkt lesen. Die In-Process-Fehlerinjektionen patchen außerdem `ChatDataIngestService.prototype`; sie erreichen den Worker-Prozess nicht und können die vorgesehenen Before-/After-V2-Write-Grenzen daher nicht mehr auslösen.

Im Worktree sind genau drei uncommittete WIP-Dateien vorhanden:

- `src/apps/chat/web-app.ts`: ergänzt eine öffentliche `drain()`-Methode für die Output-Persistence-Queue.
- `src/web/types.ts`: ergänzt `PiboWebApp.drain?()`.
- `test/web-channel.test.mjs`: macht das Fixture-`emitOutput()` asynchron, importiert `AsyncChatStorage` bislang ungenutzt und setzt in einem Teil der Tests `await`.

Dieser WIP ist nicht commitreif. Das aktuelle `async emitOutput()` beginnt den Drain bereits beim Aufruf, auch wenn der Test das zurückgegebene Promise absichtlich nicht awaited. Dadurch werden Crash-/Restart-Szenarien semantisch verändert. Der nächste Agent sollte entweder diese drei uncommitteten Änderungen vollständig auf `846cc29d` zurücksetzen und einen sauberen Ansatz bauen oder den Ansatz so korrigieren, dass ein Test-Drain nur beim ausdrücklichen Await startet. Eine mögliche Testtechnik ist ein lazy Thenable; eine klarere Produktionsschnittstelle ist vorzuziehen, falls sie auch für geordnetes Draining einen echten Nutzen hat.

Für Worker-aware Fault-Injection sollten die Before-/After-V2-Write-Fälle `AsyncChatStorage.prototype.ingestOutput` umschließen: vor dem delegierten Aufruf werfen oder nach dessen erfolgreichem Await werfen. Projektion, Reliability und Receipt bleiben im Gateway-Prozess und können weiterhin dort injiziert werden. Der separate Prozess-Crash-Test `test/web-outbox-process-crash.test.mjs` ist bereits an die asynchrone Storage-Methode angepasst und war vollständig grün.

Die im letzten Lauf sichtbaren Fehlergruppen waren: exakte Bild-Payloads, einmaliger Output-Retry, Restart-Recovery, alle sechs In-Process-Outbox-Grenzen, Trace-Cursor und Trace-Cache-Version, 200er-Kompatibilitätsseite, Native-History-Reconciliation, Unread-/Read-State, direkte Assistant-/Tool-Persistenz und SSE-Cursor. Diese Gruppen zuerst gemeinsam über eine explizite Persistenzbarriere und Worker-aware Injection korrigieren; keine individuellen Sleeps hinzufügen.

# Git- und Umgebungszustand

Beim Handoff meldete der Storage-Worktree `ahead 8, behind 9` gegenüber `upstream/dev`. Das aktuelle `upstream/dev` war `a6009408`; der Storage-Branch basiert noch auf dem früheren `a9a62825` plus den acht oben genannten Commits. Nicht blind rebasen: zuerst Paket A/PR #953 klären, die drei WIP-Dateien sichern oder verwerfen und die inzwischen hinzugekommenen Änderungen auf Konflikte in Session-Status, Recovery und Tests prüfen.

Es gibt keinen aktiven Pibo2-Pool-Lease. Ein früher gestarteter Browser/CDP-Prozess oder Tunnel auf Port 9223 kann noch existieren und sollte vor einer neuen Abnahme über den vorgesehenen Browser-/Pool-Workflow geprüft und gegebenenfalls bereinigt werden. Keine lokale Gateway-Instanz auf dem Controller neu starten.

Der `researcher` wurde für die ursprüngliche Dateikartierung und Paket-B-Grenze verwendet. Spätere Observe-/Send-Aufrufe scheiterten wiederholt mit `Auth required`. Das ist ein Sitzungs-/Toolproblem, kein Ergebnis des Repository-Codes. Bei einer neuen Agentensitzung den `researcher` erneut gezielt auf die Web-Integrationsfehler und danach auf die kleinste Paket-C-Grenze ansetzen; keine großen eigenen Volltext-Suchen durchführen.

# Empfohlene Fortsetzung

1. In `/root/code/pibo/.worktrees/performance-storage` den uncommitteten Drei-Dateien-WIP prüfen. Den eager Drain beseitigen und die Worker-aware Fault-Injection ergänzen.
2. TypeScript bauen und zunächst nur die betroffenen `web-channel`-Tests ausführen. Danach die gesamte Datei mit `--test-isolation=none` verlangen: 131 von 131 müssen bestehen.
3. Die bereits grünen Storage-, Ingest-, Telemetrie-, Runtime-Binding- und Prozess-Crash-Suiten erneut ausführen. Danach vollständigen Build, Pack und Dokumentationsprüfungen durchführen.
4. Wegen der Codeänderung nach `051455e5` einen neuen exakten Kandidaten packen, SHA-256 festhalten, in einem neuen isolierten Pibo2-Pool-Lease installieren und den authentifizierten Message-, Duplicate-, Output-, Health- und Headful-Browser-Pfad erneut abnehmen. Bericht und Artefakte auf den neuen Commit aktualisieren.
5. Paket-A-PR-Status und aktuellen `upstream/dev` klären. Storage-Branch sauber aktualisieren, konform umbenennen und erst nach grünem Pibo2-Gate als fokussierten, gegebenenfalls von #953 abhängigen PR eröffnen.
6. Paket C in einem neuen Worktree beginnen. Der bereits kartierte kleinste Einstieg ist `sendChatMessage`/`admitChatMessage`: in derselben Produktdatenbank-Transaktion wie `user.message.accepted` einen kompakten dauerhaften Command und Receipt anlegen, nach Commit früh HTTP 202 liefern und Dispatch in einen langlebigen Hintergrund-Dispatcher verschieben. Zustände `accepted`, `waiting_slot`, `initializing`, `session_queue`, `running` und terminale Zustände müssen dauerhaft, idempotent und per Lease/Fencing geschützt sein. Wiederholung derselben Client-Transaktion muss denselben Receipt liefern; andere Payload unter derselben ID muss kollidieren.
7. Danach D–H in der Reihenfolge und mit den Gates des Plans umsetzen. Für jedes Paket: neuer fokussierter Schnitt, deterministische Regressionen, Docker-Build, exakter Pibo2-Kandidat, authentifizierte reale Abnahme, Evidenzbericht und PR. Das Paket-H-Ergebnis ist eine Messentscheidung: Runtime-Host-Isolation implementieren, wenn B–F noch relevante Gateway-CPU-/Stallprofile zeigen, oder mit belastbaren Kapazitätsmessungen dokumentieren, warum sie derzeit nicht erforderlich ist.

# Abschlussbedingung

Der Nutzerauftrag ist erst erfüllt, wenn alle Pakete A–H des Plans umgesetzt oder im Fall der messungsabhängigen H-Entscheidung mit dem im Plan geforderten Nachweis entschieden, lokal und auf Pibo2 abgenommen, dokumentiert und über den vorgesehenen GitHub-Flow reviewbar gemacht wurden. Dieser Handoff beendet den Umbau nicht; er konserviert den Stand nach Paket A und dem noch zu schließenden Paket-B-Integrationsgate.


# Fortsetzung: lokales Integrationsgate am 7. September

Commit `3c3e4d51` schließt die oben beschriebenen Testlücken: Der synchrone Fixture-Emitter löst keine erzwungenen Wiederholungen mehr aus; `emitOutputAndDrain()` verwendet die ausdrückliche App-Persistenzbarriere. Before-/After-Write-Injections greifen an `AsyncChatStorage.ingestOutput` an, und die After-Write-Grenze wartet auf den Worker-Commit.

Im vorhandenen Docker-Worker bestanden danach alle 131 Web-Channel-Tests sowie 39 kombinierte Storage-, Ingest-, Binding-, Retention- und echte Prozess-Crash-Regressionen. TypeScript bestand nach Anhebung des standardmäßigen 1-GiB-JavaScript-Heaps. Diese lokale Korrektur ersetzt noch keine erneute Pibo2-Kandidatenabnahme; C–H bleiben offen.
