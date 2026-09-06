---
type: "Investigation Report"
title: "Produktionsaudit: Nachrichtenannahme, Parallelität und Datenbankwachstum"
description: "Überprüft die gemeldete Nachrichtenlatenz anhand neuer Produktionsmessungen und trennt bestätigte Engpässe von Architektur-Risiken."
tags: ["performance", "gateway", "sqlite", "concurrency"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-06T19:38:08Z" }
sources:
  - id: "original"
    resource: "/reports/artifacts/performance-audit-20260906/original-investigation.txt"
    title: "Unveränderte vom Benutzer bereitgestellte Erstuntersuchung"
  - id: "measurements"
    resource: "/reports/artifacts/performance-audit-20260906/measurements.json"
    title: "Browser-, HTTP-, Runtime- und Health-Messungen"
  - id: "sql"
    resource: "/reports/artifacts/performance-audit-20260906/sql-audit.json"
    title: "Read-only SQL mit Query-Plänen, Laufzeiten und VM-Schritten"
  - id: "native"
    resource: "/reports/artifacts/performance-audit-20260906/native-audit.json"
    title: "Direkte Messung der ausgelieferten Node-Klassen und Deployment-Hashes"
  - id: "source"
    resource: "git:90ba3a562b168a9329a7f0917ad6dcf53ccd78df:src"
    title: "Geprüfter upstream/dev-Code"
  - id: "node-sqlite"
    resource: "https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html"
    title: "Node.js 24.15.0: DatabaseSync"
  - id: "sqlite-wal"
    resource: "https://www.sqlite.org/wal.html"
    title: "SQLite Write-Ahead Logging"
  - id: "sqlite-busy"
    resource: "https://www.sqlite.org/c3ref/busy_timeout.html"
    title: "SQLite Busy Timeout"
---

# Ergebnis

**Die Hauptursache des Erstberichts ist bestätigt. Es handelt sich um eine gatewayweite Annahmeblockade, nicht um 18 Sekunden notwendige Runtime-Queue.** Der indizierte Idempotenzpfad beseitigt den nachgewiesenen Raum-Scan. Er allein garantiert aber noch keine schnelle Kaltannahme, faire Parallelität oder Schutz vor anderen synchronen Arbeiten.

Neue Messungen zeigen:

- HTTP-Annahme im großen Raum: **2.092 ms**; Runtime-Queue: **21 ms**.
- Unabhängiger Health-Request währenddessen: **1.916 ms**, gegenüber etwa **1,8–1,9 ms** im Leerlauf.
- Kleine, warme Session allein: **91,8 ms**. Dieselbe Session hinter einem großen Raum-Request: **2.215 ms**.
- Erste Nachricht in einem neuen, nahezu leeren Raum: **2.882 ms**; der Kaltstart ist ein eigener Engpass.
- Ausgelieferte `findByClientTxn()`-Methode in einem separaten, nur lesenden Node-Prozess: **1.022 ms**. Vorhandene indizierte Methode: **0,178 ms**.[^measurements][^native]

**Kein Fix wurde implementiert oder deployt.** Die Folgeschritte stehen im [Umbauplan](/plans/pibo-performance-and-scalability.md).

# Umfang und Sicherheit

Untersuchungsfenster: 6. September 2026, etwa 19:07–19:27 UTC. Produktionsversion **3.4.3**, Node **24.15.0**, darin SQLite **3.51.3**. Untersucht wurden das tatsächlich laufende Release und der separat ausgecheckte aktuelle `upstream/dev`-Stand `90ba3a562b168a9329a7f0917ad6dcf53ccd78df`. Das Windows-Ausgangscheckout und das Server-Repository hatten andere Commits; sie wurden nicht mit dem Deployment gleichgesetzt. Die ausgelieferten relevanten JS-Dateien sind durch SHA-256 identifiziert.[^native]

- Bestehender authentifizierter Headful-Chrome-Tab, 1920 × 911 Pixel, Chrome DevTools MCP.
- Test A durch echte Texteingabe und Send-Button; weitere Tests durch Same-Origin-HTTP-Aufrufe im selben Browser.
- SSH: zuerst Pibo-Debug-CLI, danach gezielte Read-only-SQL- und Prozessmessungen.
- SQL mit `mode=ro` beziehungsweise `DatabaseSync({ readOnly: true })`; Python-Abfragen zusätzlich mit `query_only` und Deadline über Progress-Handler.
- Keine Datenbank oder Session gelöscht. Keine Retention, Migration, Indexänderung, Cache-Leerung, Kompaktierung, Konfigurationsänderung oder Gateway-Neustart.
- **Sieben neue, kurze Testnachrichten**, alle ohne Tool-Aufrufe; zwei zusätzliche Duplicate-Retries ohne neue Turns.
- Ein klar bezeichneter Testraum und eine Testsession wurden angelegt und bleiben erhalten. Ihre IDs stehen in `measurements.json`.

Das Browser-Use-Target-Listing war nicht erreichbar; der bereits verbundene Headful-Browser wurde über den vorgesehenen DevTools-MCP weiterverwendet. Es wurde kein Ersatzbrowser und keine Fake-Authentifizierung eingerichtet. Eine vorübergehende MCP-Verbindungsstörung wurde vor Wiederholung durch Kontrolle persistierter Events abgegrenzt.

# Neue Messungen

## Nachrichten und Parallelität

HTTP-Werte sind im Browser gemessene Dauern. Queue-Werte stammen aus serverseitigen `queuedAt`-/`startedAt`-Zeitstempeln. Es wurden **keine synchronisierten Uhren zwischen Browser und Server vorausgesetzt**.

| Test | Zustand | HTTP bis Antwort | Runtime-Queue | Runtime bis Finish |
|---|---|---:|---:|---:|
| A | Bestehende warme Session, großer Raum, Composer | 2.092,4 ms | 21 ms | 3.462 ms |
| B, Kaltstart | Neue Session, neuer kleiner Raum | 2.882,4 ms | 17 ms | 2.679 ms |
| B, warm | Kleine Session allein | 91,8 ms | 20 ms | 2.864 ms |
| C | Groß, gleichzeitig mit D abgesendet | 2.297,0 ms | 29 ms | 4.601 ms |
| D | Klein, gleichzeitig mit C abgesendet | 109,6 ms | 19 ms | 6.268 ms |
| E | Groß, zuerst abgesendet | 2.268,8 ms | 29 ms | 2.460 ms |
| F | Klein, 156 ms nach E abgesendet | 2.215,1 ms | 19 ms | 1.646 ms |

Bei C/D nahm der Server die kleine Nachricht zuerst an. Zwei gleichzeitig gestartete Fetches garantieren keine Ankunftsreihenfolge. Deshalb wurde E/F als gezielt versetzter Test ergänzt. **E/F belegt die gegenseitige Beeinträchtigung:** Die kleine Session hat praktisch keine Raumhistorie, wartet aber hinter dem Scan des anderen Raums. Aus D allein lässt sich die verlängerte Modellphase dagegen nicht sauber in Providerzeit und blockierte Verarbeitung zerlegen.[^measurements]

Duplicate-Retries lieferten beide `duplicate: true`: großer Raum **1.028,9 ms**, kleiner Raum **288 ms**. Auch der Retry-Pfad ist im großen Raum teuer. Der einzelne kleine Retry ist kein belastbarer eigener Engpassnachweis.

## Unabhängiger Gateway-Puls

Der Health-Sampler lief in einem separaten SSH-Prozess gegen den lokalen HTTP-Endpunkt. Er wartete zwischen abgeschlossenen Requests 0,5 Sekunden; Timeout war 3 Sekunden.

| Fenster | Samples | Median | Maximum | Timeout/Fehler |
|---|---:|---:|---:|---:|
| Leerlauf, kein abgesendeter Test | 169 | 1,93 ms | 270,30 ms | 0 |
| A | 165 | 1,81 ms | 1.916,47 ms | 0 |
| C/D | 164 | 1,79 ms | 2.154,15 ms | 0 |

Das ist ein gezielter Nachweis der Blockade, **keine belastbare p99-Lastmessung**. Der Sampler arbeitet closed-loop und erfasst während einer Blockade nicht jeden theoretisch wartenden Request. Rohsamples: [Leerlauf](/reports/artifacts/performance-audit-20260906/health-single.json), [A](/reports/artifacts/performance-audit-20260906/health-ui-a.json), [C/D](/reports/artifacts/performance-audit-20260906/health-parallel.json).

Während A stieg `/proc/<gateway-pid>/io.rchar` um etwa **3,80 GB**, `read_bytes` aber nur um **1,43 MB**. Diese Zähler beschreiben unterschiedliche Dinge: gelesene Bytes über Systemaufrufe gegenüber tatsächlichem Storage-I/O. Das Messfenster enthält auch normale Polling- und Gateway-Arbeit. Es ist kein exklusiver Query-Zähler. Die Daten sprechen für weitgehend cachewarme Lesezugriffe; die Erstbericht-Erklärung „kältere Daten“ bleibt für dessen 18-Sekunden-Fall plausibel, aber hier nicht experimentell nachgewiesen.

## Read-Routen nach den Nachrichtentests

Je drei serielle Browser-Requests auf dieselbe bestehende Session:

| Route | HTTP-Spanne | Zusätzliche Evidenz |
|---|---:|---|
| `/api/chat/status`, `activate=false` | 40,4–45,8 ms | Kleine Antwort, keine Runtime-Aktivierung |
| `/api/chat/navigation` | 235,7–242,4 ms | Rund 40,7 KB unkomprimierter Body |
| `/api/chat/trace/timeline`, `limit=100` | 110,9–197,9 ms | Rund 124 KB; Serverphase beim Cache-Miss 150,8 ms, bei Page-Hit 66,7–71,8 ms |

Die kleinen JSON-Serialisierungszeiten erklären diese Serverkosten nicht. Navigation und Trace-Cache-Hits verdienen eigene Profile; die vorliegenden Samples beweisen aber keinen neuen mehrsekündigen Engpass.[^measurements]

# SQL-Gegenprüfung

Zum SQL-Snapshot enthielt der große Raum **1.075.464 Events**. Die gesamte Hauptdatenbank enthielt **1.577.074 Event-Zeilen**, davon **1.542.294 `trace_event`**. Es gab **3.213 Sessions**, bevor die neue Testsession angelegt wurde.[^sql]

| Abfrage | Python-SQLite, read-only | Ungefähre VM-Schritte | Plan |
|---|---:|---:|---|
| JSON-Suche, fehlende Transaktion | 1.126,533 ms | 5.381.000 | `idx_event_log_room_stream` |
| JSON-Suche, vorhandene aktuelle Transaktion | 1.159,420 ms | 5.381.000 | `idx_event_log_room_stream` |
| Indizierter Schlüssel, vorhanden | 0,143 ms | unter 1.000 | `idx_event_log_idempotency` |
| Indizierter Schlüssel, fehlend | 0,530 ms | unter 1.000 | `idx_event_log_idempotency` |
| `MAX(session_sequence)+1`, aktuelle Session | 0,073 ms | unter 1.000 | Covering Session-Sequence-Index |
| Dasselbe, Session mit 179.173 Events | 0,497 ms | unter 1.000 | Covering Session-Sequence-Index |
| Vollständige Gruppierung nach Retentionklasse | 5.351,422 ms | 18.924.000 | Full Scan und temporäre Gruppierung |

Die Python-Tests verwenden bei der JSON-Suche nur `stream_id` als Ergebnis; Query-Pläne und Parameter sind im Artefakt enthalten. Die zusätzliche **native Messung führt die unveränderte ausgelieferte Methode mit `SELECT *` aus**. Ein zuvor gesetzter Null-Millisekunden-Timer konnte erst nach **1.022,673 ms** laufen; die Query dauerte **1.022,411 ms**. Bei `findByIdempotencyKey()` waren es **0,178 ms Queryzeit** und **1,317 ms Timerverzögerung**. Der Test fand in einem separaten Read-only-Prozess statt, nicht durch Manipulation der Gateway-Verbindung.[^sql][^native]

Nicht jede Zeile muss dabei JSON-parsen: Der Kernfehler ist bereits der große Raumdurchlauf mit Tabellenzugriffen für die nicht hinreichend indizierten Filter. Nur das JSON-Parsing zu beschleunigen wäre die falsche Korrektur.

## Kompatibilität des schnellen Schlüssels

Im untersuchten Raum:

- 1.437 `user.message.accepted`-Zeilen;
- 1.435 davon mit `clientTxnId`;
- **alle 1.435 mit genau dem erwarteten kanonischen Schlüssel**;
- eine Annahmezeile ohne Idempotenzschlüssel, aber nicht unter den Zeilen mit `clientTxnId`.

Das unterstützt den migrationsfreien Fix **für diesen Datenbestand**. Vor Rollout ist dieselbe Prüfung für alle unterstützten Legacy-Datenformen und andere Räume erforderlich. Keine unbeschränkte JSON-Fallback-Suche bei jedem Key-Miss einbauen. Das würde den normalen Neunachrichtenpfad erneut verlangsamen.

**Keine vorschnelle Optimierung von `MAX(session_sequence)`**: Der vorhandene Index bedient die geprüften Formen schnell. Mehrere Writer würden eine separate Transaktions-/Sequenzkorrektheitsfrage aufwerfen; daraus folgt nicht, dass diese Abfrage heute den Engpass bildet.

# Bewertung des Erstberichts

| Annahme | Ergebnis der Gegenprüfung |
|---|---|
| Doppelte synchrone Raum-/JSON-Suche ist Hauptursache | Bestätigt im Deployment, im aktuellen Upstream und durch direkte Messungen. |
| Die Queue selbst wartet etwa 18 Sekunden | Für die Testfälle widerlegt; echte Queue 17–29 ms. Vorherige HTTP-Annahme blockiert. |
| 18,34 Sekunden treten reproduzierbar bei jeder Nachricht auf | Nicht bestätigt. Neue warme Großraum-Messungen etwa 2,1–2,3 Sekunden. Keine absichtliche Cache-Verdrängung. |
| Alles geschieht vor `user.message.accepted` | Präzisieren: `createdAt` wird in `appendEvent()` **vor dem zweiten Scan** gesetzt. Der Zeitstempel ist kein Commit-/Publikationszeitpunkt. |
| Vorhandener Index reicht als unmittelbarer Fix | Bestätigt, mit Legacy-/Scope-/Duplicate-Vertrag als Rollout-Gate. |
| Modell und Runtime können generell ausgeschlossen werden | Zu weitgehend. Beim warmen Scanfall nicht primär; beim neuen leeren Raum liegt ein eigener Kaltannahmeengpass vor. Providerzeit bleibt separat. |
| Niedrige CPU-Last oder normales Event-Loop-p95 schließen Blockaden aus | Nein. Die Einzelfenster blockieren alle Requests; das Lifetime-p95 bleibt dennoch etwa 21 ms. |
| Vorhandene Telemetrie-Retention löst das Eventwachstum | Nein. Sie ist weiterhin deaktiviert und erfasst nicht die drei großen Event-/Observation-Bestände. |
| Keine beschädigten Traces | Strukturchecks in beiden Test-Sessions `ok`, `issues: 0`. Bestehende Session hat 34 historische Tool-Fehlerknoten; diese sind keine neuen Audit-Fehler und nicht pauschal Trace-Korruption. |

Der ursprüngliche Text wird [unverändert aufbewahrt](/reports/artifacts/performance-audit-20260906/original-investigation.txt); sein [Hash](/reports/artifacts/performance-audit-20260906/original-source.json) schützt vor stiller nachträglicher Umschreibung.

# Weitere Engpässe und Hypothesen

Quellcodeaussagen beziehen sich auf den oben genannten Upstream-Commit; die wichtigsten Deployment-Dateien wurden zusätzlich direkt gelesen beziehungsweise gehasht. „Risiko“ bedeutet ausdrücklich nicht „in Produktion als Ursache gemessen“.

| Bereich | Befund und Status | Konsequenz |
|---|---|---|
| Annahme und Kaltstart | **Gemessen + Code:** `sendChatMessage()` wartet auf `channelContext.emit()`, der Router auf `getOrCreateSession()`. Kleiner Raum: 2.882 ms kalt, 92 ms warm. | Dauerhafte Annahme von Runtime-Initialisierung trennen; deren Unterphasen noch instrumentieren. |
| Storage im Gateway | **Bestätigte Mechanik:** `PiboDataStore` und Reliability-Store verwenden `DatabaseSync`, `busy_timeout=5000`, WAL. | Auch andere langsame Abfragen oder Lock-Wartezeiten können den gemeinsamen Event-Loop blockieren. |
| Telemetrie | **Code-Risiko:** `AsyncTelemetryWriter` sammelt 25 ms, führt SQL aber synchron aus; bei 1.024 Operations sofortiger Drain im Aufrufer. | „Async“ ist hier Batching, keine Thread-Isolation; Daten-/Zeitbudgets und separater Writer nötig. |
| Output-Fan-out | **Code-Risiko:** `ensureEventIndexing()` startet durable Retry-Arbeit; V2-Ingest, Reliability-Append und mehrere Job-Checkpoints gehören zur Lieferung. | Korrektheit erhalten, Write-Amplification pro semantischem Event messen und gruppieren. Bestehende Outbox nicht durch einen flüchtigen Ersatz verlieren. |
| Große Payloads | **Code-Risiko:** `PayloadStore` nutzt `gzipSync`, `gunzipSync` und synchrone Dateizugriffe; Ingest kann das in einer Schreibtransaktion aufrufen. | Payload-I/O und Kompression vor kurze DB-Transaktionen beziehungsweise in isolierte Worker verlagern. |
| Queue und Fairness | **Code-Risiko:** `RuntimeRoutedSession.enqueueMessage()` hängt an eine In-Memory-Queue; dort kein Mengen-/Bytebudget. `pendingSessions` dedupliziert nur pro Session. | Nachrichtenzulassung, Runtime-Kaltstarts und Provider-Slots separat begrenzen. Yielded-Run-Grenzen sind kein globales Chat-Admission-System. |
| Navigation/History | **Messung + Code:** Navigation 236–242 ms; lädt Sessionmengen und berechnet Unread-Counts. History-Coverage aggregiert pro Session; Page-Hit hat weiterhin Vorarbeit. | Kompakte inkrementelle Lesemodelle; vor neuen Umbauten repräsentative Profile und Query-Pläne. |
| Wartung | **Code-Risiko:** Auto-Retention wird nach Idle-Prüfung mit `setTimeout(0)` angesetzt, löscht dann synchron und ungebündelt. | Ein Timer verschiebt Arbeit, isoliert sie aber nicht. Retention nicht als Sofortmaßnahme aktivieren. |
| Observability | **Gemessen:** `pibo debug resources` meldete den kurzlebigen CLI-PID als `gateway`; Live-Endpoint zeigte den tatsächlichen Prozess mit etwa 458–460 MB RSS. | Prozessidentität immer belegen; CLI und Gateway-Metriken getrennt ausweisen. |

Node dokumentiert die gesamte `DatabaseSync`-Oberfläche als synchron. WAL ermöglicht parallele Leser und einen Writer, nicht mehrere gleichzeitige Writer. `busy_timeout` wartet bei Locks; er setzt **kein Laufzeitlimit für einen teuren Scan**. Ein Promise um synchrone SQL-Arbeit würde daran nichts ändern.[^node-sqlite][^sqlite-wal][^sqlite-busy]

# Datenwachstum und Wartungsgrenzen

Nach den Tests: Hauptdatei **6.685.417.472 Bytes**, Reliability-Datei **5.054.832.640 Bytes**, WAL-Dateien etwa **78,6 MB** beziehungsweise **18,0 MB**. Die Hauptdatei meldete beim SQL-Snapshot keine freien Seiten. Dateigröße allein belegt weder Korruption noch die Notwendigkeit eines anderen DBMS.[^native][^sql]

Die Einstellung blieb `enabled: false`, `days: 30`, `lastPrunedAt: 2026-07-04T18:30:23.476Z`. Der Code entfernt nur Telemetrie-Tabellen. **`trace_event` ist keine sichere pauschale Löschklasse**: Dazu können semantisch wichtige Tool- und Lifecycle-Fakten gehören. Außerdem vermeidet die aktuelle Output-Policy bereits die normale dauerhafte Speicherung bestimmter Live-Deltas; „alle Tokens werden überall gespeichert“ ist keine korrekte Beschreibung des heutigen Standardpfads.

`pibo debug events consumers` lieferte eine leere Liste. Das ist **keine Löschfreigabe**: Output-Retry-Jobs, Delivery-Receipts, Produktprojektionen, Payload-Verweise und mögliche unregistrierte/offline Leser müssen ebenfalls berücksichtigt werden. Lock-Contention, Checkpoint-Starvation und Langzeit-Wachstumsraten wurden nicht künstlich provoziert oder abschließend vermessen.

# Beweisgrenzen und Nachprüfbarkeit

- Kleine gezielte Stichprobe, keine Flotten-SLOs und kein Kapazitätsnachweis für zehn oder zwanzig Sessions.
- Kein Eingriff in Produktions-Cache, Locks, fsync, WAL oder Runtime-Prozesse, um schlechtere Zeiten zu erzwingen.
- SQL-Gruppierungen liefen getrennt von den HTTP-Testfenstern und als externe Read-only-Prozesse.
- Kein CPU-Stackprofil des Gateways, kein Multiwriter-/Crash-/Disk-full-Test, keine Produktionsgrößenkopie und kein Fix-A/B-Test in diesem Auftrag.
- Kein Regressionstestlauf des Produktcodes; Tests wurden als Ausgangspunkte für den Plan gelesen. Dokumentvalidierung wird separat ausgeführt.
- Browser-Console: keine gelisteten Errors, jedoch zahlreiche Preload-Warnungen. Test A erzeugte im beobachteten Fenster keine Long Tasks. Das ist keine vollständige UI-Performancefreigabe.
- Die aus dem Browser direkt gesendeten API-Nachrichten C–F wurden serverseitig abgeschlossen. Vollständige Render-/Autoscroll-Akzeptanz dafür wird nicht behauptet; E war im abschließenden virtualisierten DOM nicht sichtbar.
- Das [zugeschnittene Headful-Bild](/reports/artifacts/performance-audit-20260906/ui-a-completed-crop.png) belegt die sichtbare Antwort auf Composer-Test A, nicht eine Millisekundenmessung.

Zum Wiederholen zuerst `pibo debug --help`, `pibo debug session --help`, `pibo debug telemetry --help` und `pibo debug db --help` verwenden. Session- und Transaktions-IDs stehen im Messartefakt. Für SQL enthält `sql-audit.json` die tatsächlichen Statements, Bindewerte, Pläne und Messwerte; der Audit-Akteur ist redigiert. Niemals für eine Diagnose den normalen `PiboDataStore`-Konstruktor gegen eine schreibgeschützte Produktionskopie verwenden: Er führt Schemaarbeit aus. Die native Messung nutzte nur einen Read-only-Handle und die beiden lesenden Service-Methoden.

# Folgerung

**Zuerst den belegten Scan entfernen. Danach harte Ausführungsgrenzen einführen, damit eine andere langsame Operation nicht denselben Ausfallmodus wiederherstellt.** Der [Umbauplan](/plans/pibo-performance-and-scalability.md) verbindet diese Reihenfolge mit bestehenden Trace-, Worker- und Telemetrieplänen, konkreten SLO-Zielen, Lasttests und Rollback-Gates.

[^original]: Unveränderter Erstbericht, vom Benutzer zur Gegenprüfung bereitgestellt.
[^measurements]: Neue Browser-/Runtime-Messungen einschließlich Methoden und Grenzen in `measurements.json`.
[^sql]: Read-only SQL-Ergebnisse; VM-Schritte über Progress-Handler in Tausenderschritten angenähert.
[^native]: Ausgelieferte Klassen, separate Read-only-Verbindung; enthält Dateigrößen, Einstellungen und SHA-256-Hashes.
[^source]: Im Bericht genannte Quellcodepfade wurden am Commit `90ba3a562b168a9329a7f0917ad6dcf53ccd78df` gelesen.
[^node-sqlite]: Offizielle, versionsgebundene Node.js-Dokumentation; am 6. September 2026 abgerufen.
[^sqlite-wal]: Offizielle SQLite-WAL-Dokumentation; am 6. September 2026 abgerufen.
[^sqlite-busy]: Offizielle SQLite-Dokumentation des Busy-Timeouts; am 6. September 2026 abgerufen.
