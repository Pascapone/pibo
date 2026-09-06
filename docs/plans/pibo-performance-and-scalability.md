---
type: "Plan"
title: "Pibo: schnelle Nachrichtenannahme und belastbare Parallelität"
description: "Priorisiert den belegten Annahme-Fix und den schrittweisen Umbau zu begrenzter, isolierter und messbar skalierbarer Gateway-Arbeit."
tags: ["performance", "gateway", "sqlite", "concurrency", "scalability"]
status: "draft"
authority: "directive"
generated: { by: "openai/codex", at: "2026-09-06T19:38:08Z" }
sources:
  - id: "audit"
    resource: "/reports/production-performance-audit-2026-09-06.md"
    title: "Neue Produktionsmessungen und Gegenprüfung des Erstberichts"
  - id: "gateway-plan"
    resource: "/plans/pibo-fast-gateway-and-trace-roadmap.md"
    title: "Bestehende Gateway-/Trace-Roadmap"
  - id: "trace-plan"
    resource: "/plans/chat-web-trace-v2-follow-up.md"
    title: "Bestehender Plan für persistente Trace-Projektionen"
  - id: "capture-plan"
    resource: "/plans/telemetry-capture-archive-isolation.md"
    title: "Bestehender Plan für Capture-/Archiv-Isolation"
  - id: "worker-plan"
    resource: "/plans/gateway-resource-protection-workers.md"
    title: "Bestehender Plan für Worker und Ressourcenbegrenzung"
  - id: "sqlite-wal"
    resource: "https://www.sqlite.org/wal.html"
    title: "SQLite Write-Ahead Logging"
  - id: "sqlite-backup"
    resource: "https://www.sqlite.org/backup.html"
    title: "SQLite Online Backup API"
---

# Entscheidung in Kürze

**Nicht zuerst Daten löschen, Server vergrößern oder SQLite ersetzen.** Zuerst den nachgewiesenen Raum-Scan entfernen. Dann verhindern, dass SQL, Payload-Verarbeitung, Runtime-Kaltstarts oder Wartung die gemeinsame HTTP- und Streaming-Verarbeitung blockieren.

Die Produktionsprüfung belegt zwei getrennte Probleme:

1. **Großer Raum:** etwa 2,1–2,3 Sekunden HTTP-Annahme bei nur 21–29 ms Runtime-Queue. Eine andere, kleine Session wartet dahinter ebenfalls über zwei Sekunden.
2. **Kalte Runtime:** selbst ein neuer, leerer Raum benötigt zunächst 2,88 Sekunden zur HTTP-Annahme; warm waren es 92 ms.

Die 18,34 Sekunden des Erstberichts wurden nicht erneut erzwungen. Der zugrunde liegende Ausfallmodus ist bestätigt; warme Cache-Zustände machen ihn nur weniger sichtbar. Alle neuen Messungen, Einschränkungen und Codebezüge stehen im [Produktionsaudit](/reports/production-performance-audit-2026-09-06.md).[^audit]

**Stand:** Paket A ist in Umsetzung; [Implementierung und Nachweise](/reports/performance-scalability-p0-2026-09-06.md). Die Gesamtabnahme ist offen; keine Produktionsfreigabe erteilt. Dieser Plan erlaubt keine Löschung von Datenbanken oder Sessions und keine automatische Event-Bereinigung.

# 1. Ziel und Nichtziele

## Ziel

Pibo bestätigt eine Nachricht schnell und erst nach dauerhafter Annahme. Eine große Raumhistorie, eine laufende Session, ein langsamer Browser oder ein Wartungsjob darf andere Sessions nicht sekundenlang blockieren. Unter Überlast begrenzt Pibo die Aufnahme früh und erklärt den Zustand, statt unbegrenzt Arbeit anzusammeln.

„Dauerhaft performant“ bedeutet hier **getestete Betriebsgrenzen, überwachbare Budgets und Release-Gates**. Es bedeutet nicht unbegrenzte Sessions, beliebig große Antworten oder eine garantierte Modellantwortzeit bei einem externen Provider.

## Nichtziele

- Keine pauschale Datenlöschung, Session-Aufteilung oder Raum-Neuanlage als Voraussetzung für gute Latenz.
- Kein bloß kosmetisches Ersetzen der Queue-Anzeige ohne schnellere, korrekte Annahme.
- Keine Verringerung der Persistenzgarantien, um bessere Benchmarks zu erzeugen.
- Kein Big-Bang-Wechsel zu PostgreSQL, Redis, Kafka oder Microservices ohne nachgewiesenen Bedarf.
- Keine unkontrollierte Vorinitialisierung aller historischen Sessions.
- Keine vollständige Garantie exakt einmal ausgeführter externer Tool-/Provider-Seiteneffekte nach beliebigen Abstürzen.

# 2. Ownership und bestehende Arbeit

Dieser Plan besitzt **Priorität, Abhängigkeiten, Ende-zu-Ende-Leistungsziele und Freigabekriterien für den Produktionsengpass**. Bestehende Detailpläne bleiben zuständig:

| Teilgebiet | Bestehender Detailplan | Ergänzung dieses Plans |
|---|---|---|
| Gateway/Trace-Gesamtarchitektur | [Gateway-Roadmap](/plans/pibo-fast-gateway-and-trace-roadmap.md) | Konkrete Annahmeblockade, Reihenfolge und Lastprofil |
| Persistente Trace-Lesemodelle | [Trace V2](/plans/chat-web-trace-v2-follow-up.md) | Query-/Bytebudgets, Isolation, Cold-/Warm-Abnahme |
| Diagnose-/Archivdaten | [Capture-/Archiv-Isolation](/plans/telemetry-capture-archive-isolation.md) | Schutz des Message-Writers und sichere Legacy-Überführung |
| Ressourcen und Worker | [Worker-Follow-ups](/plans/gateway-resource-protection-workers.md) | Fairness, Annahmebudgets, kontrollierte Runtime-Kaltstarts |
| Abgelehnte Nachrichten | [Rejected Message Signals](/plans/reconcile-rejected-message-signals.md) | Unterscheidung von nicht angenommen, angenommen und unklarem Timeout |

Keine zweite Trace-Implementierung und keine konkurrierende Telemetriearchitektur beginnen. Pro PR die betroffenen Detailpläne verknüpfen; implementierte Verträge erst nach Abnahme in die zuständigen Spezifikationen übernehmen.

# 3. Messbare Leistungsziele

## 3.1 Zeitmodell

Instrumentierung muss diese Intervalle getrennt messen:

```text
UI submit
  -> request received
  -> auth / validation
  -> admission queue / idempotency
  -> durable acceptance committed
  -> HTTP acknowledgement

independently after durable acceptance:
  -> runtime slot wait
  -> runtime initialization
  -> session queue
  -> prompt / provider request
  -> provider first byte / first useful delta
  -> durable final output
  -> browser rendered final output
```

`createdAt` eines vorbereiteten Events ist **kein Commit-Zeitpunkt**. Intervallmessung pro Prozess mit monotoner Uhr; Cross-Process-Spans durch Korrelations-IDs verknüpfen. Browser-/Server-Wallclocks nicht ungeprüft subtrahieren.

## 3.2 Erstes verbindlich zu validierendes Betriebsprofil

Die folgenden Werte sind **Zielvorschläge**, keine heute nachgewiesene Kapazität. Vor Implementierungsabnahme auf einem fest dokumentierten Benchmark-Host kalibrieren und anschließend nicht stillschweigend lockern.

- Referenz: Linux, 6 vCPU, etwa 16 GiB RAM, lokaler Datenträger mit gemessener I/O-Leistung. Das ähnelt dem untersuchten Host, dessen tatsächliche dauerhafte Kapazität noch nicht gemessen wurde.
- **10 aktive Sessions**, verteilt über große und kleine Räume; bis zu 5 neue Nachrichten/s insgesamt, kurze Bursts von 20 Nachrichten innerhalb einer Sekunde.
- Deterministischer Provider: 100 ms bis zum ersten Delta, feste begrenzte Turn-Dauer. Lastgenerator weist erzeugte, angenommene, abgewiesene, gestartete und abgeschlossene Last getrennt aus.
- Zusätzlich insgesamt 500 Live-Deltas/s und 100 persistierbare semantische Events/s; separat Payload-Spitzen von 64 KiB, 1 MiB und 10 MiB innerhalb der geltenden Tool-/Payload-Limits.
- Datensätze: kleine Basis, mindestens Produktionsgröße mit rund einer Million Events im größten Raum, dann etwa zehnfache Raumhistorie; realistische Payloadgrößen und Eventarten statt Millionen leerer Zeilen.
- UI: mehrere offene Streams, Navigation und History-Paging neben aktiven Sessions.

**20 Sessions sind eine nächste Kapazitätsstufe**, keine implizite Freigabe. Kapazitätsgrenze durch Rampentest bestimmen, Sicherheitsreserve definieren und im Admission-System abbilden. Reale Provider-Quoten separat behandeln.

## 3.3 Abnahmekriterien

| ID | Messgröße unter freigegebenem Profil | Ziel |
|---|---|---|
| PERF-ACCEPT-001 | Servereingang bis dauerhafte Annahme, ohne Datei-Upload | p95 ≤ 100 ms, p99 ≤ 250 ms |
| PERF-HTTP-001 | Browser-POST bis Annahmeantwort bei separat gemessener RTT ≤ 60 ms | p95 ≤ 250 ms, p99 ≤ 500 ms |
| PERF-IDEMPOTENCY-001 | Key-Lookup, Hit und Miss auf großer Historie | p99 ≤ 5 ms warm, indexierter Plan, kein Raum-/Tabellenscan |
| PERF-CONTROL-001 | Loopback-Health sowie Annahme eines Cancel-/Steer-Kommandos | p99 ≤ 100 ms; kein Sample > 500 ms durch fremde SQL-/CPU-Arbeit |
| PERF-LOOP-001 | Gateway-Event-Loop-Verzögerung im gleitenden 1-Minuten-Fenster | p99 ≤ 50 ms; kein > 250-ms-Stall durch Pibo-eigene synchrone Arbeit |
| PERF-DISPATCH-001 | Dauerhafte Annahme bis Start, warme Session ohne Vorgänger und mit freiem Slot | p95 ≤ 100 ms, p99 ≤ 250 ms |
| PERF-FIRST-DELTA-001 | Annahme bis erster gerenderter Inhalt, deterministischer Provider, warme freie Session | p95 ≤ 350 ms, p99 ≤ 600 ms |
| PERF-FAIRNESS-001 | Kleine Session unter Last einer großen Session | Annahme-SLO eingehalten, zusätzlich p95 höchstens 2× ihrer unbelasteten Basis |
| PERF-READ-001 | Navigation, Trace-Summary und 100er-Timeline-Seite | Server p95 ≤ 100 ms, p99 ≤ 250 ms; Seiten-/Bytebudget eingehalten |
| PERF-RECOVERY-001 | ACK, Replay, Absturz und Reconnect | Kein Verlust bestätigter Eingaben/Final-Events; Duplikate kontrolliert und erkennbar |
| PERF-BOUNDS-001 | Queue, Cache, IPC, SSE, Worker und Datenwachstum | Explizite Anzahl-, Byte- und Altersgrenzen; kein unbegrenzter Anstieg im Dauertest |

Die Grenzen gelten auch bei wachsender Historie; ein B-Tree-Lookup ist nicht mathematisch O(1), darf aber nicht proportional alle Raum-Events lesen. Dieselbe-Session-Wartezeit hinter einem noch laufenden langen Turn und Provider-/Toolzeit werden separat ausgewiesen. Sie werden nicht fälschlich als Gateway-SLO-Verletzung oder als „schnell“ verbucht.

# 4. Zielarchitektur

```text
Authenticated HTTP / SSE control plane
  - bounded validation, routing and in-memory state
  - no large SQL, filesystem, compression or projection work
       |
       | bounded asynchronous command/read interfaces
       v
Product storage execution boundary
  - prioritized short acceptance transactions
  - durable message-command receipt and dispatch state
  - semantic product history / output outbox
       |
       +--> fair dispatcher --> bounded runtime hosts --> provider / tools
       |
       +--> incremental read projections --> paged reads / live patches
       |
       +--> low-priority diagnostic capture / archive / maintenance workers
```

## Zentrale Invarianten

1. **Schnelles ACK bedeutet dauerhaft angenommen**, nicht „in einer JS-Liste abgelegt“. Vor bestätigtem Commit keine erfolgreiche Annahmeantwort.
2. **Isolation ist nicht nur `async`.** Ein Promise oder `setTimeout()` um `DatabaseSync`/`gzipSync` schützt den Gateway-Thread nicht.
3. **Keine universelle FIFO für alle Arbeiten.** Ein DB-Worker mit einer gemeinsamen Schlange für Messages und große Reports würde die Blockade nur verlagern.
4. **Ein Writer pro SQLite-Datei, begrenzte Leser.** WAL erlaubt keine beliebige parallele Schreibskalierung. Lange Reader können Wartung/Checkpointing beeinflussen; Reader- und Writer-Limits zusammen planen.[^sqlite-wal]
5. **Produktdaten bleiben Pibo-eigen.** Worker verändern nicht eigenmächtig Session-/Room-Identität oder die Autorität von Runtime-Bindings.
6. **Große Inhalte über Referenzen.** IPC, SSE und Lesemodelle transportieren begrenzte Metadaten und Payload-Verweise statt beliebig großer JSON-Bäume.
7. **Reihenfolge gilt pro Session/Turn.** Unabhängige Sessions dürfen parallel laufen; keine gleichzeitigen normalen Prompts in derselben Session. Steering behält seinen gesonderten Vertrag.
8. **Überlast ist ein sichtbarer Zustand.** Keine still verworfenen semantischen Events; keine unendlichen Queues; keine erfolgreichen ACKs für verworfene Arbeit.

# 5. Umsetzungsphasen

## Phase 0 — Messbasis und enger Sofortfix

**Priorität P0. Eigene kleine PR, nicht auf die Gesamtarchitektur warten.**

### Arbeit

- [ ] In `src/apps/chat/data/event-command-service.ts` den kanonischen Schlüssel aus Raum, Akteur und `clientTxnId` einmal zentral bilden und die vorhandene `eventLog.findByIdempotencyKey()`-Suche verwenden.
- [ ] Redundanten `findByClientTxn()`-Aufruf in `ChatEventCommandService.appendEvent()` entfernen. Vorprüfung in `sendChatMessage()` für die bestehende Duplicate-Antwort vorerst erhalten.
- [ ] Eindeutigen Index, vorhandene Speicher-Deduplizierung und `INSERT OR IGNORE` unverändert erhalten; keine Online-Expression-Index-Migration als Ersatz.
- [ ] Bestehende Scope-Semantik zunächst exakt beibehalten: Schlüssel ist Raum/Akteur/Client-Transaktion, nicht automatisch Session. Verhalten bei fehlendem Raum/Akteur, leerem Key und erneutem Key mit anderem Inhalt durch Tests fixieren, nicht still verändern.
- [ ] Legacy-Prüfung auf sicherer Kopie über **alle** Räume: Hat jede unterstützte Client-Transaktion den erwarteten Key? Bei Ausnahmen explizite, idempotente Backfill-/Kompatibilitätsentscheidung. Kein unbeschränkter JSON-Fallback auf jeden Miss.
- [ ] Minimale `Server-Timing`-/Span-Messung in `src/apps/chat/web-app.ts`: Lookup, Append, Ingest, `emit`, ACK; Sampling begrenzen, keine Inhalte loggen. Nicht Teil eines großen Telemetrieumbaus machen.

### Prüfungen

Erweitern: `test/chat-v2-native-services.test.mjs`, `test/data-v2-store.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/chat-web-app-sessions.test.mjs` und die betroffenen API-Routentests. Ergänzen: eigener Query-Plan-/Skalierungstest.

- Gleicher Key → dasselbe Event, keine zweite Nachricht/Dispatch; andere Räume und Akteure kollidieren nicht.
- Wiederholte und konkurrierende Inserts, gleicher und unterschiedlicher Prozess; nicht nur `Promise.all()` auf synchronen In-Memory-Aufrufen. DB-Deduplizierung ist noch kein Beweis für genau einen Dispatch aus mehreren Gateways. P0 behält den bisherigen einzelnen Routing-Owner; prozessübergreifende Dispatch-Claims gehören zu Phase 2.
- Hit/Miss-Query-Plan, realistische große SQLite-Datei, begrenzte VM-Schritte beziehungsweise gleichwertiger Work-Counter.
- HTTP-Duplicate-Vertrag und Legacy-Scope bleiben kompatibel.
- Read-only-Produktionskopie: alter gegen neuen Lookup, gleiche Datensätze, deklarierter Cache-Zustand.
- Authentifizierter Headful-Browser: warmes Senden im großen Raum und versetzter Zwei-Session-Test samt unabhängigem Health-Puls.

**Gate:** Der Raum-Scan verschwindet. SLOs für warme Annahme werden gemessen; verbliebene Kosten separat dokumentieren. Nicht behaupten, dass Phase 0 den Kaltstart oder alle Parallelitätsprobleme löst.

## Phase 1 — Storage und schwere CPU-/Dateiarbeit vom Gateway lösen

**Priorität P1; startet nach dem engen Fix, schrittweise vertikale Schnitte.**

### Ausführungsmodell

- [ ] Einen Pibo-eigenen asynchronen Storage-Service mit klaren Command-/Read-Methoden einführen. `DatabaseSync` kann innerhalb des dedizierten Threads/Prozesses bleiben; am Gateway-Rand wird nicht auf synchrone DB-Methoden durchgegriffen.
- [ ] Zuerst Annahme/Idempotenz/kurze Metadatenoperationen portieren; danach Output-Ingest und Reads. Übergangsweise jeden verbleibenden Gateway-Sync-Zugriff inventarisieren und budgetieren.
- [ ] Beim Wechsel auf asynchrone Aufrufe die neue Race-Gefahr schließen: Lookup und Insert nicht als zwei unabhängig entscheidende RPCs behandeln. Eine atomare Append-/Acceptance-Operation liefert ausdrücklich `created` oder `existing`; nur der Gewinner darf neuen Dispatch auslösen. Sonst könnten zwei Requests nach gleichzeitigem Key-Miss dasselbe Event doppelt ausführen.
- [ ] Schreiben pro Datei durch einen begrenzten Writer koordinieren. High-Priority-Admission, semantische Output-Lieferung und Hintergrundprojektion unterschiedlich priorisieren; niedrige Prioritäten durch Alterung nicht verhungern lassen.
- [ ] Für History/Diagnose getrennte begrenzte Read-Worker und Verbindungen. Keine Bulk-Reads in die Admission-Schlange stellen. Eine einzelne riesige SQL-Abfrage kann nicht zwischen Zeilen fair geplant werden: umschreiben, paginieren oder isoliert abbrechbar ausführen.
- [ ] IPC nach **Bytes, Anzahl und Alter** begrenzen. Große Argument-/Result-Bäume nicht mehrfach `JSON.stringify()`/kopieren; vorab persistierte Payload-Referenzen verwenden.
- [ ] Writer-, Reader- und Worker-Status verfügbar machen: Queue-Alter, Budget, Commitzeit, Fehler, effektive Schutzstärke.

### Transaktionen und Payloads

Betroffene Stellen: `src/data/pibo-store.ts`, `src/data/ingest-service.ts`, `src/data/payload-store.ts`, `src/reliability/store.ts`, `src/apps/chat/data/*`.

- [ ] Keine Kompression und kein großes File-I/O innerhalb offener Schreibtransaktionen. Payload zuerst in begrenztem Worker erzeugen, atomar veröffentlichen, dann Referenz in kurzer Transaktion verbinden.
- [ ] Crashs zwischen Datei und DB mit einem wiederaufnehmbaren Staging-/Orphan-Verfahren behandeln. Orphan-Dateien nicht während normaler Requests scannen oder unkontrolliert löschen.
- [ ] Kurzlebige Batches durch Anzahl, Bytes und maximale Ausführungszeit begrenzen; initialer Versuchsrahmen 5 ms beziehungsweise 100 Operations, anschließend anhand realer Kosten kalibrieren.
- [ ] `MAX(session_sequence)` nicht allein wegen des Namens ersetzen: gemessen schnell. Sequenzvergabe und Insert bei mehreren Prozessen transaktional korrekt machen; vorhandene Render-Sequencer-/High-Water-Verträge erhalten.
- [ ] Fünf Sekunden `busy_timeout` nicht als Query-Deadline behandeln. Kurze Lock-Wartebudgets im Writer, asynchroner begrenzter Retry mit Jitter und absoluter Deadline; kein Busy-Spin im Gateway.

### Isolationstest

Eine absichtlich langsame Abfrage, ein fünf Sekunden gehaltener Write-Lock und eine große Kompression laufen **nur im isolierten Testsystem**. Health, Cancel-Annahme und kleine Reads müssen weiter reagieren. Bei blockierter dauerhafter Annahme früh `503` beziehungsweise den vereinbarten Kapazitätsstatus liefern; niemals fälschlich Erfolg melden.

**Gate:** PERF-CONTROL-001, PERF-LOOP-001, PERF-BOUNDS-001; Prozessabsturz und geschlossene IPC-Verbindung führen zu sichtbarem Zustand, nicht zu verlorenen bestätigten Nachrichten.

## Phase 2 — Dauerhafte Annahme von Runtime und Ausführung trennen

**Priorität P1. Abhängigkeit: schneller, asynchron erreichbarer Admission-Writer.**

### Ein langlebiger Message-Command, keine flüchtige Inbox

- [ ] Einen kompakten dauerhaften Command-/Receipt-Datensatz mit stabilem Request-Key, Zielsession, Delivery-Modus, Payload-Verweisen und Dispatch-Zustand definieren. Er besitzt den Zustellstatus; `event_log` bleibt Produktgeschichte, kein konkurrierender Runtime-Resume-Store.
- [ ] Command und `user.message.accepted` in **derselben kurzen Produkt-DB-Transaktion** anlegen. Rebuildbare Projektionen und Runtime-Initialisierung gehören nicht in diese Annahmegrenze.
- [ ] HTTP-Annahme nach Commit zurückgeben; Antwortvertrag explizit versionieren beziehungsweise kompatibel erweitern. Ziel: `accepted` mit Receipt-ID und Statuspfad, typischerweise HTTP 202. Nicht weiterhin `message_queued` erfinden, wenn noch keine Runtime existiert.
- [ ] Hintergrunddispatcher beansprucht den Command mit Lease/Fencing-Token, beschafft einen Runtime-Slot und aktualisiert Zustände nachvollziehbar: angenommen → wartet auf Slot → initialisiert → Queue → läuft → terminal.
- [ ] Wiederholung desselben Keys gibt vorhandenen Receipt und Zustand zurück. Keine neue Runtime-Arbeit nur aufgrund eines Client-Retrys.
- [ ] Unterstützten Idempotenzzeitraum festlegen. Aufbewahrung kompakter Receipts von optionaler Trace-/Telemetrie-Retention trennen; nicht unbemerkt durch einen 30-Tage-Prune Duplicate-Sicherheit verlieren.

### Fehler und Recovery

- ACK verloren nach Commit → Wiederholung findet denselben Receipt.
- Prozess stirbt vor Dispatch → wiederaufnehmbarer Command bleibt erhalten.
- Prozess stirbt nach Runtime-Start, bevor dessen Bestätigung persistiert wurde → Runtime-Binding/Checkpoint und Fencing prüfen. **Nicht blind erneut ausführen**, wenn externe Seiteneffekte unklar sind; sichtbar als Abgleich-/Fehlerzustand behandeln.
- Client-Timeout während möglichem Commit → `acceptance_unknown`/Statusabfrage mit demselben Key; nicht als garantiert abgelehnt darstellen.
- Auth-/Validierungsfehler vor Commit → keine Annahme; vorhandene Eingabe und Attachments erhalten.
- Spätere Dispatch-Ablehnung → terminaler Command-Zustand und nachvollziehbare UI-Meldung statt dauerhaftem „queued“.

Für einen neuen Vertrag Inhalt/Session/Delivery an einen Request-Fingerprint binden; gleicher Key mit verändertem Inhalt soll explizit kollidieren statt versehentlich die falsche Nachricht zu bestätigen. **Diese Änderung gehört nicht ungeprüft in den kompatiblen P0-Fix.**

### Prüfungen

Neue Inbox-/Command-Crash-Tests; vorhandene `test/web-outbox-process-crash.test.mjs`, `test/runtime-restart-recovery.test.mjs`, `test/runtime-session-binding.test.mjs` und `test/chat-ui-app-signal-status.test.mjs` gezielt ergänzen. Neue Tests für abgelehnte oder unklare Annahme mit dem Rejected-Message-Signal-Plan abstimmen; konkrete Namen in der ersten Phase-2-PR festlegen.

**Gate:** Cold- und Warm-HTTP erfüllen dasselbe Annahme-SLO. Runtime-Kaltstart wird als eigener Zustand sichtbar; akzeptierte Nachricht überlebt Gateway-/Worker-Neustart. Kein allgemeines Exactly-once-Versprechen für Provider oder Tools.

## Phase 3 — Faire Parallelität und begrenzte Runtime-Arbeit

**Priorität P1; gemeinsam mit Phase 2 entwerfen, separat abnehmen.**

Betroffene Stellen: `src/core/session-router.ts`, `src/agent-runtime/routed-session.ts`, Runtime-Registry/-Adapter und bestehende Ressourcen-Guards.

- [ ] Admission-Limits pro Session, Raum und Gateway: Anzahl, aufsummierte Payloadbytes, älteste Wartezeit. Oberhalb harter Grenzen `429`/`503` plus Retry-Hinweis **vor neuer Annahme**; bei bereits bestätigter Arbeit nicht still droppen.
- [ ] Fairer Scheduler über aktive Sessions, innerhalb einer Session FIFO. Gewichtet oder Round-Robin mit Starvation-Schutz; ein Raum darf nicht sämtliche Slots besetzen.
- [ ] Kaltstarts global begrenzen, zunächst mit einem kleinen konfigurierten Wert wie zwei parallelen Starts. `pendingSessions` verhindert nur doppelte Starts derselben Session, keine Startlawine über viele Sessions.
- [ ] Separate Limits für Provider-Requests, Runtime-Hosts, Tool-/Yielded Runs und Wartung. Provider-Rate-Limits/Retry-Backoff nicht mit der internen Session-Queue vermischen.
- [ ] Steuerpfad für Abort, Steering, Status und Recovery mit reservierter Kapazität. Das SLO gilt für die Kommandoannahme; ein nicht kooperierendes Tool kann trotzdem länger zum Beenden benötigen.
- [ ] Runtime-Initialisierung profilieren: Binding/Auth, Ressourcen/Skills, Native-History, SDK-Start, Provider-Verbindung. Nur unveränderliche und korrekt geschlüsselte Metadaten cachen; keine Credentials oder Session-Kontexte falsch teilen.
- [ ] Keine pauschale Vorwärmung historischer Sessions. Begrenzter aktiver Pool mit Idle-Eviction, sichtbaren Init-Zeiten und generation-sicherem Cleanup.

### Runtime-Isolation als eigener Entscheidungspunkt

Ein Storage-Worker schützt nicht vor CPU-lastigen Plugins, Tokenisierung, Trace-Konvertierung oder SDK-Callbacks im Gateway. Nach Storage-Isolation die verbleibenden Profile auswerten. Verletzen Runtime-/Plugin-Callbacks weiter die Budgets, die betroffenen Adapter in **Pibo-verwaltete Runtime-Host-Prozesse** verschieben.

Nicht reflexartig ein Prozess pro historischer Session. Ein begrenzter, ressourcenbeschränkter Host-Pool kann Sessions pinnen; Prozessgrenzen müssen Portable Tools, MCP, Dateien, Runtime-Generation, Cancellation und Bindings korrekt tragen. Pibo bleibt Autorität über Produktdaten und Routing. Linux/cgroups und Windows-Verhalten getrennt nachweisen; keine Isolation aus einer bloßen Prozess-ID ableiten.

**Gate:** Rampen 1 → 2 → 5 → 10 → 20 Sessions, gemischte große/kleine Räume und ein überaktiver Teilnehmer. Erst freigeben, wenn Fairness, Memory-Plateau, frühe Überlastantworten und Recovery belegt sind.

## Phase 4 — Write-Amplification und teure Lesepfade begrenzen

**Priorität P1/P2 nach Profil; Detailarbeit in bestehenden Trace-/Capture-Plänen.**

### Semantische Outputs und Telemetrie

Betroffene Stellen: `ensureEventIndexing()`/`deliverWebOutputPersistenceState()` in `src/apps/chat/web-app.ts`, `src/core/output-persistence-retry.ts`, `src/data/ingest-service.ts`, `src/data/telemetry-writer.ts`.

- [ ] Pro Ereignistyp messen: Inserts, Updates, Transaktionen, fsync-/WAL-Bytes, kopierte Payloadbytes und CPU-Zeit. Insbesondere V2-Event, Observation, Reliability-Kopie, Delivery-Receipt und Job-Checkpoints.
- [ ] Bestehende durable Output-Retry-Grenze, Claims und Delivery-Receipts erhalten. Mehrere zusammengehörige Änderungen nur dann bündeln, wenn Recovery weiterhin mindestens dieselben Garantien hat.
- [ ] `AsyncTelemetryWriter` durch tatsächliche isolierte Ausführung und begrenzte Batches ersetzen. Bei Queue-Druck nicht synchron im Produzenten alles leeren.
- [ ] Produktrelevante Lifecycle-/Final-Events verlustfrei; optionale Detaildiagnostik nur scoped/opt-in und limitiert. Live-Deltas koaleszieren, nicht Final-Events verwerfen.
- [ ] Bestehende Live-only-/Output-Compactor-Policy beibehalten und prüfen; nicht fälschlich eine schon implementierte Delta-Unterdrückung neu bauen.
- [ ] Telemetrie-Gesundheit mit kleinen Aggregaten überwachen, damit das Monitoring selbst keine großen Queries oder Schreibstürme auslöst.

### Lesemodelle und UI

- [ ] Navigation/Unread-Zustand inkrementell aus bestätigten Ereignissen aktualisieren. Ziel: normale Navigation liest kleine indizierte Projektionen statt bei jedem Poll die gesamte Sessionmenge neu aufzubereiten.
- [ ] Trace-Summary, Turn-Timings und History-Coverage aus versionierten Lesemodellen mit Watermark bedienen. Default-Seiten müssen nach der angeforderten Seite skalieren, nicht nach Gesamthistorie.
- [ ] Keyset-Pagination und passende Indexpräfixe belegen; `LIMIT` nach teurem Scan/Sortieren ist allein kein Work-Budget.
- [ ] Cache-Hits vor unnötiger Rekonstruktion ermöglichen. Cache-Key bindet Session, Version/Watermark, Scope und Seitenparameter; Größe nach Bytes begrenzen, nicht nur Entry-Anzahl.
- [ ] Bulk-Backfill/Rebuild als resumierbarer Worker mit Fortschritt, Cancellation und konkurrierender Nutzerlast testen. Nie die Erstöffnung als unbeschränkten Backfill benutzen.
- [ ] SSE/IPC-Backlogs pro Client nach Bytes und Alter begrenzen. Langsamen Client kontrolliert zum Cursor-Reconnect bewegen; semantische Daten bleiben replaybar, Live-Deltas dürfen nach definierter Policy zusammengefasst werden.
- [ ] Aktives Streaming darf nicht fortlaufend History-Seiten neu laden. Browser-Patching, Virtualisierung, Zustand bei externen API-Sends und Reconnect im echten Headful-Browser separat prüfen.

**Gate:** PERF-READ-001 und PERF-FAIRNESS-001 bei parallelem Streaming, großen Payloads, Navigation, History-Paging und absichtlich langsamem Consumer. Bestehende Trace-/Outbox-/Backpressure-Regressionen bleiben grün.

## Phase 5 — Wachstum, Archive und Wartung beherrschen

**Priorität P2, Design früh; keine Freigabe zur Bereinigung dieses Servers.**

- [ ] Alle Tabellen und Payload-Verweise klassifizieren: dauerhafte Produktgeschichte, Idempotenz-/Recovery-Fakten, rebuildbare Projektion, optionale Diagnose, Live-Daten.
- [ ] `trace_event` nicht pauschal löschen. Finale Nachrichten, Tool-Ergebnisse, relevante Lifecycle-Fakten und historische Referenzen erhalten beziehungsweise vollständig nachvollziehbar archivieren.
- [ ] Detaillierte Capture-Daten aus aktiven Product-/Reliability-Stores in getrennte, begrenzte Capture-Stores führen; abgeschlossene Archive bleiben im Normalbetrieb ungeöffnet.
- [ ] Für alte Event-/Observation-/Reliability-Daten erst Archivmanifest, Verweise, Restore-/Replay-Nachweis und Retentionvertrag erstellen. Consumer-Checkpoints, Output-Retry-Jobs, Delivery-Receipts und offline Leser berücksichtigen. Leere Consumerliste ist keine Freigabe.
- [ ] Archivieren/Backfill/Prune nur als begrenzte Jobs: Keyset-Fortschritt, etwa kleine Millisekunden-/Zeilenbatches, Speicher-/I/O-Quota, Resume und Cancel zwischen Batches.
- [ ] Retention auch bei nie endender Aktivität kontrolliert mit kleinem Budget fortschreiten lassen; nicht unbegrenzt auf globalen Idle warten und danach einen Riesen-Delete ausführen.
- [ ] WAL-/Checkpoint-Verhalten messen: WAL-Größe, Alter offener Reader, Checkpointdauer, Busy-Zähler und Writer-Stalls. Wartung in eigener Ausführungsgrenze; keine `FULL`-/`TRUNCATE`-Aktion im Message-Handler.
- [ ] SQLite-Durability bewusst festlegen. `synchronous=OFF` ist keine Performancekorrektur. Änderungen an `FULL`/`NORMAL` nur nach expliziter Entscheidung über Stromausfallgarantien; aktuelle Connection-PRAGMAs direkt am Owner beobachten, nicht aus einer Diagnoseverbindung ableiten.
- [ ] VACUUM/physische Kompaktierung nur als separat genehmigte Wartung mit freiem Speicher für Original, Backup, temporäre Kopie und WAL. Löschen und Platzfreigabe sind unterschiedliche Operationen.

Sicherung einer laufenden SQLite-Datei mit einer unterstützten konsistenten Backup-/Snapshot-Methode, nicht durch blindes Kopieren nur der Hauptdatei trotz aktivem WAL. Backup und Restore testweise verifizieren. Vollständige Produktionskopien bleiben privat und gelangen nicht in Git oder öffentliche Artefakte.[^sqlite-backup]

**Gate:** Stunden-/Tage-Soak zeigt begrenztes Wachstum aktiver Diagnose- und Replaybestände. Dauerhaft aufzubewahrende Produktgeschichte darf wachsen; ihre Größe darf die Nachrichtenannahme nicht linear verlangsamen. Jede tatsächliche Bereinigung benötigt eine gesonderte Freigabe.

# 6. Observability und ehrliche Zustandsanzeige

**Beginnt mit Phase 0, wird über alle Phasen erweitert.**

## UI-Zustände

`src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx` und die optimistischen Message-Reducer unterscheiden künftig:

- Wird gesendet / wartet auf Bestätigung.
- Dauerhaft angenommen.
- Wartet auf Runtime-Slot beziehungsweise initialisiert Runtime.
- In Session-Queue; echter Vorgänger vorhanden.
- Wird verarbeitet.
- Abgelehnt, fehlgeschlagen oder Annahme unklar.

„Queued for next turn“ und „Waiting for the active turn to finish“ erscheinen nur mit entsprechendem autoritativem Zustand. Ein lokaler Fetch beweist keinen aktiven Vorgänger. Wiederholungen behalten dieselbe Transaktions-ID und zerstören nicht den Entwurf. Steering wird nicht unbemerkt zu normalem Queueing.

## Metriken

- Request-/Command-Korrelation; keine Prompts, Tokens, Credentials oder beliebigen Payloads in Standardmetriken.
- Gleitende Histograms für Annahme, DB-Queue, SQL, Lock-Wartezeit, Commit, Runtime-Slot/Init, Session-Queue, Provider-first-byte, Final-Persistenz, SSE-Lag und Render-Lag.
- Event-Loop-p99 **plus Fenstermaximum und Slow-Operation-Zähler**. Lifetime-p95 allein hat die nachgewiesenen Blockaden verdeckt.
- Queueanzahl/-bytes/-alter je Arbeitsklasse; aktive/kalte Runtimes; Provider-Quoten; Worker CPU/RSS/Heap; freier Speicher, Diskreserve und I/O-Pressure.
- Writer-Commit-/Busy-/Checkpointzeiten, WAL- und Datenwachstum, Projektion-Watermarks, fehlgeschlagene Recovery und verlorene Worker-Heartbeats.
- Bounded Slow-Query-Proben mit Statement-ID und Plan-Fingerprint; keine unbeschränkten High-Cardinality-Labels pro Session in globalen Zeitreihen.
- Prozessidentität und Herkunft jeder Messung anzeigen. `pibo debug resources` darf CLI-Selbstmessung nicht als Live-Gateway-Wert ausgeben.

**Alarm-/Release-Regeln:** Jeder sekundenlange Pibo-eigene Stall, Verlust bestätigter Arbeit oder unbegrenzter Queue-Anstieg stoppt den Rollout. Mehrfache SLO-Verletzung in kurzen Fenstern löst Diagnose aus. Monitoring muss auch ohne detaillierte Telemetrie funktionieren.

# 7. Test- und Benchmarkprogramm

## 7.1 Deterministische Regressionen in CI

| Testpaket | Muss beweisen |
|---|---|
| Indexed admission | Hit/Miss, Legacy und Scope korrekt; kein Rückfall auf Raum-/JSON-Scan |
| Durable command | ACK-before/after-commit, Duplicate, Payloadkonflikt, Timeout, Prozessabsturz und Recovery |
| Storage isolation | Langsame Abfrage, Writer-Lock, Worker-Absturz und Queue-Sättigung blockieren nicht den Control-Plane-Thread |
| Session fairness | FIFO pro Session; kleine Session neben überaktiver Session erhält Budget; begrenzte Kaltstarts |
| Output durability | Vorhandene Multiprocess-Outbox-, Claims-, Receipt- und Replay-Invarianten bleiben erhalten |
| Streaming/read model | Große History, späte Events, Duplicate, Reconnect, langsamer Client, partieller Backfill |
| Maintenance | Archive/Prune/Export wachsen und laufen nur innerhalb erlaubter Budgets; Pause/Resume, Disk-full und Restore |
| Resource lifetime | Worker/Runtime-Generation beendet ihre Handles; keine wachsenden Maps, Warteschlangen oder Subscriptions im Soak |

Vorhandene Ausgangspunkte: `test/telemetry-writer.test.mjs`, `test/runtime-routed-session.test.mjs`, `test/gateway-session-isolation.test.mjs`, `test/gateway-backpressure-subscriptions.test.mjs`, `test/web-outbox-process-crash.test.mjs`, `test/stream-render-multiprocess-durability.test.mjs`, `test/trace-v2-fast-path.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/chat-ui-pending-message-delivery.test.mjs`, `test/telemetry-retention-service.test.mjs`.

Neue Endurance-/Query-Plan-Tests ergänzen. Die bestehende Datei `test/performance-optimizations.test.mjs` prüft kleine funktionale Sessionfilter, nicht die jetzt erforderliche Last- und Skalierungsgrenze.

## 7.2 Produktionsnahe Lastsuite außerhalb Produktion

1. Fixtures mit realistischen Verteilungen: kleine/heiße Räume, einzelne Sessions mit 100.000+ Events, ein Raum mit 1 Mio. und später 10 Mio. Events, 1.000/10.000 Sessions, große und externe Payloads.
2. Gleiche Software, gleiche DB-Treiber-/SQLite-Version, gleiche PRAGMAs und dokumentierte Hardware für Vorher/Nachher. Schema-/Indexbestand und Fixture-Hash mitschreiben.
3. Cold- und Warm-Runs getrennt. Cache-Verdrängung nur im dedizierten Benchmarksystem, niemals Host-`drop_caches` auf Produktion. Container teilen den Host-Page-Cache; ein neuer Container beweist keinen Cold Run.
4. Rampen für Parallelität und Ankunftsrate. Open-loop-Lastgenerator mit unabhängigen geplanten Ankunftszeiten; Warteschlangen, Timeouts, Rejections und Coordinated-Omission-Risiko nicht aus Statistiken herausfiltern.
5. Mindestens 10.000 Annahmen pro maßgeblichem Profil und mehrere Wiederholungen. p50/p95/p99/p99,9, Maximum, angebotene/bediente Last und Fehler zusammen veröffentlichen.
6. Gleichzeitiges Streaming, Navigation, History, Slow-Reader, Tool-Payload und Wartungsjob. Dieselbe Session mit Vorgänger zusätzlich testen, aber deren berechtigte Wartezeit separat auswerten.
7. Fault-Injection: Hold-Write-Lock, CPU-Hog im Runtime-Host, Netzwerk-Timeout, Provider-429, Worker-Kill, Disk-full, Crash an jeder Commit-/Dispatch-Grenze. Testgrenzen dürfen nur Testprozesse/Fixtures betreffen.
8. Mindestens zwei Stunden Soak als PR-/Integrationsgate für relevante Umbauten; längerer, beispielsweise 24-stündiger Release-Soak für Lebensdauer-/Wachstumsänderungen.

Eine Docker-Worker-Validierung unter einem anderen CPU-/RAM-Limit ist wertvoll, aber kein Ersatz für die vermessene Referenzkapazität. Bei gemeinsamem Host genug Reserve für Produktion lassen; volle Kapazitätslast auf separater Benchmarkumgebung fahren.

## 7.3 Echte Nutzerpfade

Nach Unit-/Lasttests im isolierten Worker und nach Deployment auf Dev:

- Authentifizierter **Headful-Browser**, Composer senden, zweite Nachricht in dieselbe Queue und Nachricht in andere Session.
- Großer Raum neben kleinem Raum, cold/warm, Streaming, Abort/Steer, Reload, Reconnect, History und Navigation.
- Sichtbare Zustände und Antworten mit korrelierten Network-/Server-Timing-/Event-/DOM-Daten und Screenshots prüfen.
- Reale Provider-Samples begrenzt ergänzen; Modellantwortzeit getrennt von Plattformlatenz ausweisen.
- Browser Use für den Nutzerfluss, DevTools/CDP für technische Evidenz; existierenden authentifizierten Browser beziehungsweise vorgesehenen Auth-Lease verwenden.

# 8. Reihenfolge, Arbeitspakete und Freigaben

| Paket | Priorität | Abhängigkeit | Ergebnis / Gate |
|---|---|---|---|
| A: Index-Fix + minimale Spans | P0 | Legacy-Vertrag, schmale Regression | Warme Großraum-Annahme schnell; kein Scan |
| B: Isolierter Admission-/Storage-Schnitt | P1 | A | Fremde SQL-/Payload-Arbeit blockiert HTTP nicht |
| C: Durable Message-Command + UI-Zustände | P1 | B, Vertrag gemeinsam mit D | Cold-ACK schnell, Recovery und Zustände korrekt |
| D: Fairness, Limits, Kaltstart-/Provider-Slots | P1 | B/C | Freigegebenes Multi-Session-Profil statt unbegrenzter Last |
| E: Output-/Telemetrie-Batching und Payload-Isolation | P1 | B, Outbox-Regressionssuite | Weniger Schreib-/CPU-Arbeit ohne verlorene Events |
| F: Navigation-/Trace-Lesemodelle | P1/P2 | B/E und bestehender Trace-Plan | Historygröße beeinflusst Default-Requests nicht linear |
| G: Archive, Retention, Wartung | P2 | Datenvertrag, Backup-/Restore-Nachweis | Kontrolliertes Wachstum ohne neuen Request-Stall |
| H: Runtime-Host-Isolation / nächste Kapazitätsstufe | nach Messung | B–F, verbleibende CPU-Profile | Zusätzliche Isolation oder nachgewiesene Skalierung |

Keine seriöse Gesamtdauer zusagen, bevor Paket A und der vertikale Schnitt B vermessen sind. Jeder Schnitt muss unabhängig reviewbar und reversibel sein. Der kleine P0-Fix darf nicht auf F/G/H warten.

## Git-/Ausführungsstrategie

- Jede Implementierung beginnt vom dann aktuellen `upstream/dev`, nicht vom alten Windows-Checkout oder direkt vom Produktions-Release.
- Eigenes Worktree und fokussierte Branch; Code-/Gateway-Validierung im vorgesehenen Docker-Dev-Worker, sofern verfügbar.
- Relevante Unit-/Integrationstests, Build und Typecheck; anschließend fokussierte Fork-PR gegen `upstream/dev`.
- Host-Webänderungen zunächst mit `./scripts/deploy-web-dev.sh` deployen und Dev unter konfigurierter hostbezogener URL testen. Keine öffentlichen Hostnamen in neue Skripte fest einbauen.
- Produktion erst nach Dev-Nachweis und **ausdrücklicher Freigabe**. Release-/Main-Schritt über den vorgesehenen Release-Flow; kein stiller Direkt-Hotfix.
- Gateway-Start/Restart nur über Pibo CLI. Vor Produktion aktive Arbeit kontrollieren; Restart-Guard nicht umgehen.

## Production-Canary und Rollback

- Bei Single-Host-Release zuerst wenige markierte Testnachrichten und zwei ausgewählte Sessions, keine ungetestete breite Last. Bei geeigneter Feature-Gate-Architektur neue Admission-/Dispatch-Pfade für klar definierte Sessions aktivieren.
- Vorher/Nachher gleiche Fixtures und Messmethoden; Checkpoints, Runtime-Bindings, Receipts und Persistenzfehler mitprüfen.
- Bei Latenz-/Durability-Verletzung neue Dispatches in den betroffenen Pfad stoppen, in-flight Claims sauber auslaufen/reconciliieren, dann Codeversion zurückrollen.
- Neue Schemafelder zunächst additiv und rückwärtsverträglich. Vor Freigabe beweisen, wie die alte Version neue Commands erkennt oder wie ein vorgeschalteter Drain den Rollback sicher macht.
- **Keine Wiederherstellung eines alten DB-Backups über neue bestätigte Nachrichten.** DB-Restore ist ein eigener Incident-Prozess, kein normaler Performance-Rollback.
- Bei Überlast lieber begrenzt ablehnen und sichtbare Restarbeit erhalten, statt neue Jobs im Gateway auszuführen oder bestätigte Arbeit zu verwerfen.

# 9. Entscheidung über SQLite, PostgreSQL und horizontale Skalierung

**SQLite zunächst behalten.** Die vorhandene indizierte Suche ist auf der echten Datenbank bereits unter einer Millisekunde schnell. Mehr RAM oder eine andere Datenbank ersetzt keine Begrenzung der Arbeit im Gateway.

Nach A–F anhand der Lastsuite neu entscheiden:

| Option | Wann sinnvoll | Was sie nicht löst |
|---|---|---|
| SQLite + isolierter Writer + begrenzte Reader | SLOs im benötigten Single-Host-Profil werden erreicht | Unbegrenzte Schreibparallelität oder Mehrhost-HA |
| Diagnosestores/Archive getrennt | Diagnose-/Wartungslast konkurriert mit Produktwrites | Schlechte Gateway-Queries und CPU-intensive Callbacks |
| PostgreSQL | Benötigte Write-Rate/HA/Mehrhost-Betrieb scheitert nach Optimierung nachweislich an SQLite-Writerkapazität | Unbegrenzte Queues, teure Projektionen, fehlende Request-Indizes |
| Mehrere Gateway-/Runtime-Knoten | Explizite Verfügbarkeits-/Kapazitätsanforderung und geklärte Session-Ownership | Automatische sichere Verteilung zustandsbehafteter Runtimes |

Ein Wechsel benötigt gemessene Lock-/Commit-Wartezeiten, Writer-Auslastung, Betriebsaufwand und Migration-/Rollback-Proof. Bei mehreren Hosts zusätzlich Session-Leases/Fencing, Routing, Reconnect und gemeinsame Payload-Verfügbarkeit definieren. SQLite-Dateien nicht einfach auf ein Netzwerkfilesystem legen und mehrere Gateways darauf schreiben lassen.

# 10. Offene Entscheidungen und Abschluss

Vor Umsetzung konkret festlegen:

1. Welche Parallelitäts-/Nachrichtenrate ist das tatsächlich benötigte erste Produktziel? Das vorgeschlagene 10-Session-Profil bestätigen oder mit Begründung ändern.
2. Welche ACK-/Durability-Garantie gilt bei Prozess- versus Stromausfall? Welche Timeout-/Retry-Semantik unterstützt jeder Client?
3. Welche Diagnose- und History-Inhalte müssen wie lange vollständig erhalten bleiben? Keine Bereinigungsannahme aus dem Dateiumfang ableiten.
4. Welche Runtime-/Adaptergrenze benötigt echte Prozessisolation und welches Backend beweist sie?
5. Welche Produktions-Canary-/Rollback-Möglichkeit existiert für neue Commands und Schema-Erweiterungen?

**Abschlusskriterien:** Alle für die freigegebene Kapazitätsstufe relevanten PERF-Kriterien sind erfüllt; keine verlorenen bestätigten Nachrichten; keine unbeschränkte Arbeit im Control Plane; Last-/Fault-/Soak-/Headful-Nachweise liegen am Release-Commit vor; Betreiber können SLO, Restkapazität, Queue-Alter und Datenwachstum erkennen. Erst dann wird „performant“ als getesteter Betriebszustand behauptet.

Nach jedem abgeschlossenen Paket aktuelle Verträge in die zuständigen Spezifikationen übernehmen, Messungen als eigenen Bericht veröffentlichen und diesen Plan fortschreiben. Nach Gesamtabnahme Dauerwissen konsolidieren und den geschlossenen Plan mit Nachfolgelinks archivieren.

[^audit]: Read-only-Produktionsaudit vom 6. September 2026; die Messungen sind eine Diagnose, keine bereits erreichten Ziel-SLOs.
[^sqlite-wal]: Offizielle SQLite-Dokumentation: getrennte Reader/Writer- und Checkpoint-Eigenschaften; am 6. September 2026 geprüft.
[^sqlite-backup]: Offizielle SQLite-Dokumentation der Online-Backup-Verfahren; am 6. September 2026 geprüft.
