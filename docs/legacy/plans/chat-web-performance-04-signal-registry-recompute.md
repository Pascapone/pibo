# Chat Web Performance 04: Signal Registry Recompute-Kosten reduzieren

## Zweck

Dieses Dokument bewertet Optimierungen an `InMemoryPiboSignalRegistry`. Ziel ist weniger CPU-Arbeit pro Signal-Update, ohne die sichtbare Session-, Tool-, Run- und Fehleranzeige zu ändern.

## Ausgangslage

`src/signals/registry.ts` speichert Signal Nodes, Session-Beziehungen und Snapshot-Patches im Speicher. Bei Mutationen recomputed die Registry betroffene Sessions und Ancestors.

Auffällige Kostenpunkte:

- Equality über `JSON.stringify`;
- `depth()` berechnet die Tiefe wiederholt durch Parent-Walks;
- Snapshots setzen `updatedAt: now()` bei jeder Berechnung;
- Ancestors werden recomputed, auch wenn sich Kind-Snapshots semantisch nicht ändern.

## Was sinnvoll ist

### Typed Equality statt `JSON.stringify`

`JSON.stringify` ist teuer und fragil gegenüber Feldreihenfolge oder unnötigen Feldern. Typed Equality sollte gezielt vergleichen:

- Node Identity und Status;
- Parent-/Child-IDs;
- Timestamps, sofern sie semantisch relevant sind;
- Metadata über begrenzte, stabile Vergleiche;
- Snapshot-Felder wie `aggregateStatus`, `isTreeActive`, `errors`, `activeToolCalls`, `activeRuns`.

### Session Depth cachen

`depth()` kann beim Linken einer Parent Session berechnet und gespeichert werden. Das vermeidet wiederholte Parent-Walks beim Sortieren von Recompute-Kandidaten.

### Dirty Sessions explizit markieren

Statt alle möglichen Ancestors blind zu behandeln, sollte die Registry markieren:

- welche Session lokale Node-Änderungen hat;
- welche Ancestors wegen Aggregaten betroffen sein können;
- welche Snapshots unverändert bleiben.

### Child Snapshots wiederverwenden

Wenn ein Child Snapshot unverändert ist, sollte der Parent ihn referenziell oder semantisch wiederverwenden. Das senkt Recompute-Kosten in tiefen Bäumen.

## Was riskant ist

### Falsche Equality

Wenn Equality zu grob ist, fehlen Patches. Die UI kann dann stale bleiben. Wenn Equality zu fein ist, bleibt die Performance schlecht.

### `updatedAt`-Semantik

Aktuell setzt `computeSessionSnapshot()` `updatedAt` auf `now()`. Dadurch sieht ein Snapshot auch dann verändert aus, wenn sich nur die Berechnungszeit geändert hat.

Vor einer typed Equality muss entschieden werden:

- Ist `updatedAt` ein Änderungszeitpunkt oder ein Generierungszeitpunkt?
- Soll `updatedAt` nur bei semantischer Änderung fortgeschrieben werden?
- Soll `generatedAt` auf Patch-Ebene die Recompute-Zeit tragen?

### Version-Monotonie

Patches haben `fromVersion` und `toVersion`. Optimierungen dürfen Versionen nicht überspringen, rückwärts setzen oder bei echten Änderungen auslassen.

## Was den Code fundamental ändert

Dieser Umbau ist weniger fundamental als Gateway- oder Persistenzumbauten. Er bleibt im Signal-System, kann aber UI-Verhalten beeinflussen. Betroffen sind:

- `src/signals/registry.ts`;
- Signal Typen in `src/signals/types.ts`, falls Semantik dokumentiert wird;
- Tests in `test/signal-registry.test.mjs`;
- Chat Web Signal API Tests.

Fundamental wird es erst, wenn Snapshot-Semantik oder Patch-Verträge geändert werden.

## Problematische Annahmen

„JSON.stringify durch shallow compare ersetzen“ wäre falsch. Die Objekte enthalten Arrays und nested Metadata. Ein einfacher shallow compare würde echte Änderungen übersehen oder unnötige Änderungen melden.

„updatedAt kann ignoriert werden“ ist ebenfalls riskant. Andere UI-Teile können es für Sortierung oder Anzeigen nutzen.

## Übersehene Punkte

### Metadata-Vergleich

Signal Nodes tragen `metadata`. Diese kann tool-, run- oder message-spezifisch sein. Eine typed Equality muss entweder bekannte Felder vergleichen oder eine stabile kleine Deep-Equal-Funktion für Metadata behalten.

### Pruning

`pruneTerminalNodes()` erzeugt Mutationen. Optimierungen müssen auch Prune-Patches korrekt auslösen.

### Queue Nodes

`queuedMessagesBySessionId` beeinflusst Snapshot-Status. Dirty-Tracking muss Queue-Änderungen erfassen.

### Root-Wechsel und Parent-Links

`ensureSession()` kann Parent-/Root-Zuordnungen ändern. Depth-Cache und Root-Maps müssen dann konsistent bleiben.

## Empfohlene Reihenfolge

1. Tests für bestehendes Verhalten erweitern.
2. `updatedAt`-Semantik festlegen.
3. Depth-Cache hinzufügen.
4. Typed Equality für Snapshots einführen.
5. Typed Equality für Nodes einführen.
6. Dirty-Tracking und Child-Snapshot-Reuse ergänzen.
7. Micro-Benchmark für tiefe Session-Bäume und tool-heavy Updates hinzufügen.

## Akzeptanzkriterien

- Patch-Versionen bleiben monoton pro Root.
- Snapshots bleiben semantisch identisch zum aktuellen Verhalten.
- Active/Error/Blocked-Zustände propagieren weiter über Ancestors.
- CPU pro Signal-Update sinkt bei tiefen Session-Bäumen.
- Keine stale UI-Signale bei Tool Calls, yielded runs, subagents oder errors.

## Mindesttests

- Deep tree: Child tool start setzt Parent und Root active.
- Child error setzt Parent `hasErrorDescendant`.
- Run completion entfernt active run aus Snapshots.
- Queue count ändert local status.
- Prune terminal node sendet Remove Patch.
- Keine Patch-Auslassung bei Metadata-Änderung.
- Keine Patch-Erzeugung bei identischem Input.

## Empfehlung

Das ist ein guter mittlerer Follow-up. Erst Tests und `updatedAt` klären, dann Equality und Depth optimieren. Keine Protokoll- oder Persistenzänderung nötig.
