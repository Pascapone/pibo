# Chat Web Performance 02: Trace Views inkrementell materialisieren

## Zweck

Dieses Dokument bewertet die Idee, Trace Views nicht bei jeder Anfrage aus gespeicherten Events und Transcript-Dateien neu aufzubauen, sondern inkrementell als Projection zu pflegen.

## Ausgangslage

`/api/chat/trace` in `src/apps/chat/web-app.ts` baut Trace Views über `buildTraceView()` in `src/apps/chat/trace.ts` auf. Der Aufbau nutzt mehrere Quellen:

- persistierte Chat-Web-Events aus `ChatWebReadModel.listTraceEvents()`;
- Pi Transcript JSONL über `readEntries(metadata.sessionPath)`;
- Pibo Session-Metadaten;
- Status aus dem Read Model;
- Child-, Parent- und Origin-Beziehungen;
- `latestStreamId` aus `ChatEventLog`.

Es gibt bereits `state.traceCache`, aber das ist ein in-memory Response-Cache keyed by Trace-Version. Es ist keine dauerhafte materialisierte Projection.

## Was sinnvoll ist

### Structural Cache von Raw Tail trennen

Der aktuelle Trace enthält Struktur und optional Raw Events. Es ist sinnvoll, die schwere Struktur separat zu cachen und Raw Events als bounded Tail nur bei Bedarf anzuhängen.

Das reduziert Arbeit für normale UI-Trace-Anfragen, ohne sofort einen persistenten Projection-Store einzuführen.

### Rebuild als Recovery-Pfad erhalten

Auch bei einer späteren Projection muss der vollständige Rebuild aus Events und Transcript erhalten bleiben. Er ist die Kontrollinstanz für Tests, Migration und Debugging.

### Versionierung schärfen

Eine Projection braucht eine klare Version. Die Version muss mindestens Änderungen an folgenden Quellen abdecken:

- Event-Sequenz oder Stream-Tail;
- Pibo Session `updatedAt` und Beziehungen;
- Status;
- Pi Transcript-Metadaten;
- Child-/Origin-Session-Liste;
- optional Raw Tail.

## Was riskant ist

### Persistente materialisierte Trace Views

Eine persistente Projection führt einen neuen abgeleiteten Datenbestand ein. Das Risiko ist hoch:

- Projection kann von Raw Events abweichen.
- Fehler können in Projection, Event-Store oder Transcript liegen.
- Migrationen werden komplexer.
- Recovery muss partielle Projection-Writes erkennen.
- Alte Sessions brauchen Rebuild oder Lazy-Migration.

### Incremental Projection bei Transcript-Daten

Der Trace hängt nicht nur an Chat-Web-Events. Pi Transcript JSONL bleibt eine Quelle. Eine rein eventgetriebene Projection übersieht Änderungen an Transcript-Dateien oder Metadaten.

### Raw Events als Teil der Projection

Raw Events sind Debug-Daten und sollten nicht die strukturelle Projection aufblasen. Sie sollten bounded und opt-in bleiben.

## Was den Code fundamental ändert

Ein echter materialisierter Trace Store würde diese Teile ändern:

- `src/apps/chat/trace.ts` als reine Read-Time-Projection;
- `src/shared/trace-engine.ts` als Rebuild-Engine;
- `src/apps/chat/web-app.ts` Trace-Handler;
- Read Model Schema oder ein neuer Store;
- Tests in `test/chat-trace.test.mjs`;
- Debug CLI für Trace-Rebuilds.

Damit würde der Trace nicht mehr nur aus Source-of-Truth-Daten berechnet, sondern aus einem zusätzlichen Projection-Zustand gelesen.

## Problematische Annahmen

„Store a compact trace version per session“ klingt einfacher, als es ist. Eine falsche Version führt zu stale UI-Daten oder unnötigen Rebuilds.

„Rebuild only as recovery“ ist erst sicher, wenn die Projection in Tests nachweislich bitweise oder semantisch zum Full-Rebuild passt.

## Übersehene Punkte

### Pi Transcript ist Source of Truth

Der aktuelle Trace liest Pi Session Entries aus Dateien. Eine Projection muss diese Quelle invalidieren oder bewusst ausklammern. Beides muss dokumentiert sein.

### Child-/Origin-Session-Abhängigkeiten

Trace-Versionen hängen von anderen Sessions ab. Wenn ein Child oder Fork aktualisiert wird, kann der Parent-Trace betroffen sein.

### Cache-Größe

Ein materialisierter Trace kann groß werden. Es braucht Limits, Retention und klare Cleanup-Regeln.

### Debugbarkeit

Der Debug CLI-Pfad sollte zeigen können:

- Raw Events;
- materialisierte Projection;
- Full-Rebuild;
- Diff zwischen Projection und Rebuild.

## Empfohlene Reihenfolge

1. Erst messen, ob `/api/chat/trace` nach kleineren Optimierungen weiter dominiert.
2. In-memory Structural Cache von Raw Event Tail trennen.
3. Rebuild-Diff-Tests erweitern.
4. Optional eine nicht-persistente inkrementelle Projection im Prozess testen.
5. Erst danach persistente Materialisierung planen.

## Akzeptanzkriterien

- Trace-Antwortzeit wächst nicht linear mit Session-Historie im Ziel-Szenario.
- Projection entspricht dem Full-Rebuild in Regressionstests.
- Raw Event Debug Output bleibt bounded und opt-in.
- Recovery kann Projection verwerfen und aus Source-Daten neu bauen.
- Cache invalidiert korrekt bei Session-, Transcript- und Event-Änderungen.

## Mindesttests

- Full-Rebuild und incremental Projection liefern gleiche sichtbare Node-Reihenfolge.
- Tool Calls, Tool Results, Reasoning, Assistant Messages und Subagent Links bleiben korrekt.
- Child-Session-Änderungen invalidieren betroffene Trace-Versionen.
- Transcript-Änderungen invalidieren oder rebuilden die Projection.
- Debug-Endpunkte können Projection und Full-Rebuild vergleichen.

## Empfehlung

Nicht als nächster Schritt umsetzen. Zuerst kleinere Server- und Frontend-Hotspots beheben und messen. Persistente Trace-Materialisierung ist ein späterer Architekturumbau.
