# Chat Web Performance: Offene Punkte nach der Optimierungsserie

## Kurzfazit

Die risikoarmen Kernoptimierungen wurden umgesetzt: Prepared Statements, Write-Skip beim Bootstrap, Gateway-Backpressure, erste Gateway-Subscriptions, Signal-Registry-Optimierungen, Trace-Versionierung und referenzstabilere Live-Patches.

Nicht umgesetzt wurden vor allem die größeren Architekturumbauten: asynchrone Persistenz, persistente Trace-Materialisierung, umfassende Subscription-/Auth-Semantik, normalisierter Frontend-Trace-Store und erweiterte Operator-/Debug-Diagnostik.

## 1. Persistence vom Router-Event-Pfad entkoppeln

### Umgesetzt

- Prepared Statements in Hot Stores teilweise gecacht.
- Write-Anzahl reduziert.
- Idempotenz/Ordering-Tests ergänzt.
- Lokale Transactions im Read Model ergänzt.

### Noch nicht umgesetzt

- Persistenz ist weiterhin synchron im Router-/Indexing-Pfad.
- Keine bounded in-process Queue für Event-Indexing.
- Kein separater Persistence Worker.
- Keine vollständige Multi-DB-Konsistenz-/Recovery-Strategie zwischen:
  - `ChatEventLog`
  - `ChatWebReadModel`
  - `PiboReliabilityStore`
- Keine explizite Unterscheidung der Persistenzsemantik zwischen:
  - live-only Deltas
  - durable Chat Events
  - Audit-/Reliability-Events
- Keine Operator-Metriken für:
  - Write-Dauer
  - Queue-Druck
  - Persistenzfehler
  - partielle Indexierung

### Einschätzung

Der heiße Pfad ist optimiert, aber nicht entkoppelt. Der große Architekturpunkt „Persistenz raus aus dem Router-Pfad“ bleibt offen.

## 2. Trace Views inkrementell materialisieren

### Umgesetzt

- Trace-Versionierung wurde geschärft.
- Transcript-Metadaten fließen in Trace-Versionen ein.
- Raw Events bleiben bounded und opt-in.
- Trace-Rebuild bleibt Source-of-Truth.

### Noch nicht umgesetzt

- Keine persistente materialisierte Trace Projection.
- Keine inkrementelle serverseitige Projection.
- Kein separater materialisierter Trace Store.
- Kein Debug-Vergleich:
  - Projection vs. Full-Rebuild
  - Raw Events vs. materialisierte Struktur
- Keine Cache-/Retention-Strategie für materialisierte Trace Views.
- Keine Lazy-Migration alter Sessions.
- Keine vollständige Projection-Invalidierung über alle Quellen:
  - Transcript-Dateien
  - Child-/Origin-Sessions
  - Session-Metadaten
  - Status
  - Event Tail

### Einschätzung

Bewusst nicht umgesetzt. Das bleibt ein größerer Architekturumbau und sollte erst nach weiterer Messung angegangen werden.

## 3. Gateway Subscriptions und Backpressure

### Umgesetzt

- TCP-Backpressure wurde gehärtet.
- `socket.write()`-Backpressure wird berücksichtigt.
- Per-Connection Queue/Backlog wurde eingeführt.
- Droppable Eventklassen wurden ergänzt.
- Legacy-All-Modus bleibt erhalten.
- Einfache Session-Subscription wurde eingeführt.
- Tests für Slow Clients und Subscriptions wurden ergänzt.

### Noch nicht umgesetzt

- Keine umfassende Subscription-Semantik für:
  - Room
  - Owner Scope
  - Debug-All mit Berechtigung
- Keine vollständige Auth-/Access-Control-Schicht für Subscriptions.
- Keine externe/operatorfreundliche Diagnostik-Oberfläche für:
  - aktive Connections
  - Backlog pro Verbindung
  - dropped Events
  - slow Clients
  - aktive Subscription-Filter
- Browser-SSE-Backpressure wurde nicht in gleicher Tiefe behandelt.
- Kein ausgebautes Subscription-Protokoll mit Versionierung/Kompatibilitätsstrategie.
- Eventklassifikation ist vorhanden, aber noch relativ einfach.

### Einschätzung

Der wichtigste technische Schutz gegen Slow Clients ist drin. Das vollständige Subscription-System ist nur teilweise umgesetzt.

## 4. Signal Registry Recompute-Kosten reduzieren

### Umgesetzt

- `JSON.stringify`-Vergleiche wurden weitgehend durch typed Equality ersetzt.
- Session Depth wird gecacht.
- `updatedAt`-Semantik wurde geklärt: semantische Änderung vs. Patch-Generierung.
- `generatedAt` existiert auf Patch-/Snapshot-Ebene.
- Tests für Deep Trees, Queue, Metadata, Pruning und Versionen wurden ergänzt.
- Benchmark-Script wurde ergänzt.

### Noch nicht umgesetzt / nur teilweise

- Kein vollständig ausgearbeiteter Dirty-Tracking-Graph.
- Child-Snapshot-Reuse ist nicht als umfassender normalisierter Cache umgesetzt.
- Metadata-Vergleich bleibt ein Bereich, der bei neuen Metadata-Formen weiter gepflegt werden muss.
- Keine automatische Performance-Regression im CI, nur Benchmark-Script.
- Keine Operator-Metriken für Signal-Recompute-Kosten.

### Einschätzung

Dieser Report ist am weitesten umgesetzt. Offen sind eher Vertiefungen und Mess-/CI-Themen.

## 5. Frontend Trace Transforms optimieren

### Umgesetzt

- Live-Patches sind referenzstabiler.
- Assistant-/Reasoning-/Tool-Updates ändern gezielter nur betroffene Nodes.
- Raw Events werden nur bei aktivem Raw Panel verarbeitet.
- Debug Snapshot Collection wurde stärker gegated.
- Tests für referenzstabile Patch-Identität wurden ergänzt.

### Noch nicht umgesetzt

- Kein normalisierter Frontend-Trace-State mit:
  - `nodesById`
  - `rootIds`
  - `childrenById`
  - separatem raw event store
- Kein direkter Renderer für `PiboTraceNode`; Span-Adapter bleibt bestehen.
- Adapter-Memoization ist nicht vollständig auf stabile Versionen umgestellt.
- Keine umfassenden Tests für:
  - Expansion State nach Live Delta
  - Auto-scroll-Verhalten
  - Server-Rebase bei langen Streams
  - Sessionwechsel während aktivem Streaming
- Keine neue Virtualisierungsstrategie für sehr lange Traces.
- Kein vollständiges Entfernen rekursiver Transform-Arbeit aus dem Hotpath.

### Einschätzung

Der wichtigste Low-Risk-Schritt — referenzstabile Patches — ist umgesetzt. Der größere Client-Umbau zu einem normalisierten Trace Store bleibt offen.

## 6. Wiederholtes Bootstrap Indexing vermeiden

### Umgesetzt

- `upsertSessionsIfChanged()` wurde ergänzt.
- Unveränderte Sessions werden beim Bootstrap übersprungen.
- Relevante Felder werden verglichen:
  - `piSessionId`
  - `parentId`
  - `profile`
  - `channel`
  - `kind`
  - `createdAt`
  - `updatedAt`
- Fehlende Rows werden geschrieben.
- Status wird nicht versehentlich überschrieben.
- Batch-Transaction für echte Upserts wurde ergänzt.
- Tests für Bootstrap-Indexing wurden ergänzt.

### Noch nicht umgesetzt / optional offen

- Keine Produktionsmetrik für tatsächlich übersprungene vs. geschriebene Rows.
- Kein Operator-/Debug-Output für Bootstrap-Indexing-Kosten.
- Kein per-session indexed-version-System.
- Kein breiter Lasttest mit sehr großen realen Sessionlisten als automatisierter Test.

### Einschätzung

Dieser Report ist im Kern umgesetzt. Offen sind vor allem Messbarkeit und mögliche spätere Projection-/Versionierungsverbesserungen.

## Priorisierte offene Arbeit

### Hoch sinnvoll, aber noch nicht Architekturbruch

1. Metriken ergänzen:
   - Persistenzdauer
   - Bootstrap written/skipped rows
   - Trace build time
   - Gateway dropped/backlog counts
   - Signal recompute duration

2. Browser-SSE-Robustheit prüfen:
   - Disconnect cleanup
   - langsame Clients
   - Write-/Stream-Fehler

3. Frontend-Trace-Rebase-/Expansion-State-Tests:
   - Sessionwechsel während Streaming
   - Expansion State nach Live-Patches
   - lange Trace-Verläufe

### Größere Architekturthemen

4. Persistenz asynchronisieren:
   - bounded queue
   - Crash-/Flush-Semantik
   - Recovery
   - Multi-DB-Konsistenz

5. Materialisierte Trace Projection:
   - erst in-memory testen
   - dann persistent planen
   - Full-Rebuild-Diff als Kontrollinstanz

6. Vollständiges Gateway-Subscription-System:
   - Room-/Owner-Scope-Filter
   - Auth-Regeln
   - Debug-All-Berechtigung
   - Protokollversionierung

## Gesamtbewertung

Die aktuelle Commit-Serie hat die besten Low-Risk-Optimierungen umgesetzt. Nicht umgesetzt sind bewusst die Punkte, die Persistenz-, Trace- oder Gateway-Semantik fundamental ändern würden. Diese sollten als separate Design-/Implementierungsprojekte behandelt werden, nicht als kleine Performance-Patches.
