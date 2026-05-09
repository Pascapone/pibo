# Chat Web Performance 06: Wiederholtes Bootstrap Indexing vermeiden

## Zweck

Dieses Dokument bewertet die Optimierung, Chat Web Bootstrap-Writes zu reduzieren. Ziel ist weniger SQLite-Arbeit beim Laden der Session-/Room-Übersicht.

## Ausgangslage

`indexOwnedSessions()` in `src/apps/chat/web-app.ts` schreibt alle sichtbaren Sessions ins Read Model:

```ts
function indexOwnedSessions(readModel: ChatWebReadModel, sessions: PiboSession[]): void {
	for (const session of sessions) readModel.upsertSession(session);
}
```

`ChatWebReadModel.upsertSession()` führt immer ein `INSERT ... ON CONFLICT DO UPDATE` aus. Das passiert auch dann, wenn sich kein persistiertes Feld geändert hat.

Nach dem Performance-Patch vom 7. Mai 2026 sind Bootstrap-Queries bereits besser, aber diese unnötigen Writes bleiben ein Hotspot.

## Was sinnvoll ist

### Unveränderte Sessions überspringen

Vor dem Upsert sollte der Code prüfen, ob sich relevante Felder geändert haben. Relevante Felder sind mindestens:

- `pibo_session_id`
- `pi_session_id`
- `parent_id`
- `profile`
- `channel`
- `kind`
- `created_at`
- `updated_at`

Wenn alle Felder gleich sind und kein Status-Override nötig ist, kann der Write entfallen.

### Batch-Transaction für echte Upserts

Wenn mehrere Sessions geschrieben werden müssen, sollte der Batch in einer lokalen Transaction laufen. Das reduziert SQLite-Overhead.

### Separate Methoden für Bootstrap und Status-Updates

Bootstrap-Indexing und Live-Status-Updates haben unterschiedliche Semantik. Eine eigene Methode wie `upsertSessionsIfChanged()` könnte Bootstrap optimieren, ohne `recordEvent()` zu verkomplizieren.

## Was riskant ist

### Nur `updatedAt` vergleichen

Das ist zu wenig. Andere Felder können sich ändern, ohne dass `updatedAt` zuverlässig als einziger Indikator dient. Besonders relevant:

- Profil-Kanonisierung;
- Parent-/Child-Beziehungen;
- `piSessionId` bei Recovery;
- `kind` oder `channel` nach Migration;
- `createdAt` bei alten oder reparierten Records.

### Status stale machen

`upsertSession(session, status?)` kann auch Status setzen. Bootstrap sollte nicht versehentlich einen laufenden Status auf `idle` zurücksetzen oder einen Fehlerstatus überschreiben.

### Recovery-Verhalten beschädigen

Bootstrap dient auch dazu, das Read Model aus dem Session Store wieder zu befüllen. Write-Skip darf Recovery nicht blockieren, wenn ein Record fehlt oder unvollständig ist.

## Was den Code fundamental ändert

Dieser Punkt ist kein fundamentaler Architekturumbau. Er bleibt im bestehenden Read Model und reduziert nur unnötige Writes.

Betroffen sind wahrscheinlich:

- `src/apps/chat/read-model.ts`;
- `src/apps/chat/web-app.ts`;
- Tests für Bootstrap, Session-Liste und Migration.

Fundamental würde es erst, wenn ein neues per-session indexed version system als eigene Projection-Schicht eingeführt wird. Das ist für den ersten Schritt nicht nötig.

## Problematische Annahmen

„Upsert only if `updatedAt` changed“ ist die wichtigste problematische Annahme. Besser ist ein Vergleich aller Felder, die `web_chat_sessions` speichert.

Eine zweite Annahme wäre: „Ein extra SELECT vor jedem Upsert ist immer schneller.“ Das muss gemessen werden. Bei kleinen Sessionzahlen kann der SELECT mehr kosten als der Upsert. Bei großen Sessionlisten und WAL-Writes ist Skip-Logik aber wahrscheinlich hilfreich.

## Übersehene Punkte

### Bestehender `getSession()`-Pfad

`ChatWebReadModel.getSession()` existiert bereits. Für Batch-Optimierung ist aber eine Methode besser, die alle vorhandenen Sessions in einem Query lädt, statt pro Session einen SELECT auszuführen.

### Session Ordering

Bootstrap-Sortierung hängt an Session- und Activity-Daten. Write-Skip darf Reihenfolge nicht ändern.

### Status Reset im Constructor

`ChatWebReadModel` ruft `resetInterruptedSessions()` im Constructor auf. Bootstrap-Optimierung darf dieses Recovery-Verhalten nicht verdecken.

### Tests mit archivierten Sessions

Unread Counts und sichtbare Sessions berücksichtigen archivierte Pfade. Bootstrap-Indexing muss auch diese Fälle korrekt lassen.

## Empfohlene Reihenfolge

1. Batch-Lesemethode für vorhandene Session Rows ergänzen.
2. Vergleichsfunktion für persistierte Session-Felder schreiben.
3. `upsertSessionsIfChanged()` im Read Model ergänzen.
4. `indexOwnedSessions()` auf diese Methode umstellen.
5. Optional echte Upserts in eine Transaction packen.
6. Metrik oder Test-Hook für Anzahl geschriebener Rows ergänzen.

## Akzeptanzkriterien

- Bootstrap schreibt keine unveränderten Session Rows.
- Neue Sessions werden weiter indexiert.
- Geänderte Session-Felder werden erkannt und geschrieben.
- Status wird nicht versehentlich überschrieben.
- Room-/Session-Ordering bleibt unverändert.
- Migration und Recovery funktionieren weiter.

## Mindesttests

- Unchanged Bootstrap erzeugt keine Writes oder keine Row-Changes.
- Änderung an `updatedAt` löst Upsert aus.
- Änderung an `parentId`, `profile`, `kind`, `channel` oder `piSessionId` löst Upsert aus.
- Fehlender Row wird geschrieben.
- Laufender Status bleibt erhalten, wenn Bootstrap ohne Status-Override läuft.
- Session-Liste vor und nach Optimierung ist identisch sortiert.

## Empfehlung

Das ist der beste Low-Risk-Follow-up. Er reduziert unnötige SQLite-Writes ohne Protokoll-, UI- oder Persistenzarchitektur zu ändern.
