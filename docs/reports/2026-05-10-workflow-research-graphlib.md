---
type: "Research"
title: "Graphlib-Analyse für Pibo Workflow System V1"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/2026-05-10-workflow-research-graphlib.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "4dd9a7781fbb97aed4e33c614d230c0563920d79"
  source_bytes: 22618
  source_sha256: "256aae5b9a769eac28b0da18ec29f7622d8fff0ddbc4a6322d4992671bf8888b"
  source_body_sha256: "256aae5b9a769eac28b0da18ec29f7622d8fff0ddbc4a6322d4992671bf8888b"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Graphlib-Analyse für Pibo Workflow System V1

## Executive Summary

`/root/code/graphlib` ist ein kleines, fokussiertes TypeScript-Repo für einen generischen Graph-Kern plus klassische Graph-Algorithmen. Der Kern liegt fast vollständig in `lib/graph.ts`; Algorithmen liegen flach in `lib/alg/*`; JSON-Serialisierung in `lib/json.ts`; ein kleiner `PriorityQueue`-Baustein in `lib/data/priority-queue.ts`.

Für Pibo ist das Repo besonders interessant, weil es zeigt, wie man mit sehr wenig API-Oberfläche trotzdem viele Traversal-, Validierungs- und Analysefunktionen ermöglicht. Die stärksten Ideen sind:

- ein kleiner, stabiler Kern (`setNode`, `setEdge`, `removeNode`, `removeEdge`, `successors`, `predecessors`, `neighbors`, `inEdges`, `outEdges`, `nodeEdges`),
- explizite Graph-Optionen (`directed`, `multigraph`, `compound`) beim Konstruktor,
- Trennung von öffentlichem Edge-Objekt und internem Edge-Key,
- separate interne Indizes für Knoten, Kanten, Predecessor-/Successor-Zählung und Incident-Edges,
- einfache Komposition: Algorithmen arbeiten nur gegen die öffentliche `Graph`-API.

Für Pibo Workflow V1 sollte man **nicht** Graphlib 1:1 übernehmen. Es ist stark für generische Graphen optimiert, aber kaum für typsichere Workflow-Schemas, Runtime-Knoten, Adapter-Kanten, State-Semantik oder XState-nahe Modellierung. Am wertvollsten ist die Architekturidee: **ein sehr kleiner mutierbarer Graph-Kern plus separat aufgebaute Validierungs- und Ausführungs-Layer**.

Wichtige Einschränkungen:

- Repo scheint vollständig wiederhergestellt, aber `node_modules` fehlen lokal; `npm test` und `npm run typecheck` schlagen deshalb aktuell mit `jest: not found` bzw. `tsc: not found` fehl.
- README ist sehr knapp; die eigentliche Wahrheit liegt im Code und in den Tests.
- Einige APIs sind historisch-kompatibel und deshalb etwas unsauber typisiert, z. B. Methoden, die laut TypeScript nicht `undefined` zurückgeben sollten, dies aber effektiv tun.

## Projektüberblick

Repo-Top-Level:

- `index.ts`: Haupt-Exports.
- `lib/graph.ts`: zentrale `Graph`-Implementierung.
- `lib/types.ts`: Kern-Typen (`GraphOptions`, `Edge`, `Path`, Funktions-Typen).
- `lib/json.ts`: JSON write/read.
- `lib/alg/*`: Algorithmen.
- `lib/data/priority-queue.ts`: Heap-basierte Queue für Shortest-Path/MST.
- `test/*`: sehr breite Testabdeckung des Kernverhaltens.
- `dist/*`: vorgebaute Artefakte liegen bereits im Repo vor.
- `build.ts`: esbuild-Bundles.
- `jest.config.ts`, `tsconfig*.json`, `eslint.config.mts`: Tooling.
- `.github/workflows/build.yml`: CI mit Install -> Lint -> Build -> Test.

Wiederherstellungscheck:

- Repo enthält `package.json`, `README.md`, `README_CN.md`, `LICENSE`, `Makefile`, `index.ts`, `lib/*`, `test/*`, `dist/*`, CI-Dateien und Release-Skripte.
- `git ls-files` zeigt 136 getrackte Dateien.
- `find` zeigt 23 TS-Dateien unter `lib`, 21 TS-Testdateien unter `test`, 56 Dateien unter `dist`.
- Es fehlen lokal nur installierte Abhängigkeiten (`node_modules` nicht vorhanden), nicht aber offensichtliche Quell-Dateien.

## Architektur und Modulstruktur

### Export-Struktur

`index.ts` exportiert:

- `Graph`
- `version`
- Namespace `json`
- Namespace `alg`
- Typen aus `lib/types.ts`

Das ist elegant: sehr kleine Public Surface, intern aber sauber segmentiert.

### Kernarchitektur

`lib/graph.ts` ist der eigentliche Zustandsträger. Alles andere hängt nur von seiner API ab. Das ist für Pibo lehrreich: erst ein kleines Datenmodell, dann Algorithmen/Validierung/Serialization als reine Benutzer desselben.

### Build/Test-Setup

`package.json`:

- Build: `tsc` für Typdeklarationen + `esbuild` für CJS/ESM/IIFE.
- Tests: `jest` via `ts-jest`.
- Typecheck: `tsc --noEmit`.
- Lint: ESLint.

`build.ts` erzeugt:

- `dist/graphlib.cjs.js`
- `dist/graphlib.esm.js`
- `dist/graphlib.min.js`
- `dist/graphlib.js`

`jest.config.ts` zeigt ein pragmatisches Setup mit `ts-jest`, ESM-bezogener Pfadnormalisierung und Coverage auf `lib/**/*.ts`.

Lokale Ausführung aktuell nicht möglich ohne Installation:

- `npm test -- --runInBand` -> `jest: not found`
- `npm run typecheck` -> `tsc: not found`

## Graph-Datenmodell

### Unterstützte Modellformen

`GraphOptions` in `lib/types.ts`:

- `directed?: boolean` default `true`
- `multigraph?: boolean` default `false`
- `compound?: boolean` default `false`

Daraus ergeben sich:

1. **Directed graph**: Standard.
2. **Undirected graph**: über `directed: false`.
3. **Multigraph**: mehrere Kanten zwischen denselben Knoten via `name`.
4. **Compound graph**: Parent/Child-Hierarchie zwischen Knoten.

Für Pibo ist besonders relevant: Graphlib trennt **Kantenstruktur** von **Hierarchie**. `compound` modelliert Knotenverschachtelung, aber nicht Workflow-State oder Execution-Semantik.

### Edge-Modell

Öffentliches Edge-Objekt:

```ts
interface Edge {
  v: string;
  w: string;
  name?: string;
}
```

- `v` und `w` sind immer Strings.
- `name` identifiziert Multi-Edges.
- Für undirected Graphen normalisiert Graphlib intern die Reihenfolge von `v`/`w`.

### Labels

Es gibt drei Label-Ebenen:

- Graph-Label (`setGraph` / `graph()`)
- Node-Label (`setNode`, `node()`)
- Edge-Label (`setEdge`, `edge()`)

Labels sind generisch typisiert, aber standardmäßig `any`.

### Compound Graph

Compound-Graph-Logik nutzt einen synthetischen Wurzelknoten `GRAPH_NODE = "\x00"` intern. Jeder Compound-Knoten hat implizit einen Parent; root-nahe Knoten hängen unter diesem Sentinel.

Wichtig für Pibo: Das ist nützlich als Vorbild für verschachtelte Workflows/Subgraphs, aber Pibo sollte dafür lieber explizite Workflow-/Subworkflow-Typen verwenden statt eines generischen Compound-Schalters.

## Kern-Datentypen und Interfaces

### API-Design: minimalistisch und operationsorientiert

Auffällig ist, wie klein die Kern-API bleibt:

- Graph-Flags: `isDirected`, `isMultigraph`, `isCompound`
- Graphlabel: `setGraph`, `graph`
- Nodes: `setNode`, `setNodes`, `node`, `nodes`, `hasNode`, `removeNode`
- Hierarchie: `setParent`, `parent`, `children`
- Kanten: `setEdge`, `setPath`, `edge`, `edgeAsObj`, `hasEdge`, `removeEdge`, `edges`
- Nachbarschaft: `predecessors`, `successors`, `neighbors`, `inEdges`, `outEdges`, `nodeEdges`
- Strukturhilfen: `sources`, `sinks`, `isLeaf`, `filterNodes`

Das ist für Pibo sehr attraktiv: kleine Graph-API, Spezialisierung in höheren Layern.

### Defaults

Default Labels werden über Factory-Funktionen gehalten:

- `_defaultNodeLabelFn`
- `_defaultEdgeLabelFn`

`setDefaultNodeLabel` und `setDefaultEdgeLabel` akzeptieren entweder festen Wert oder Factory-Funktion. Sehr gutes Pattern:

- Creation-Time-Defaults statt globales nachträgliches Rewriting
- Default-Generierung mit Zugriff auf `v`, `w`, `name`

Für Pibo empfehlenswert für Node-IDs, Edge-Metadaten, Statuscontainer oder Adapter-Konfiguration.

### Typische Unsauberkeiten

Es gibt mehrere historische TODOs in `lib/graph.ts`:

- `graph()` sollte semantisch `undefined` liefern können.
- `node()` und `edge()` ebenfalls.
- Typen signalisieren teils strengere Garantien als die Laufzeit tatsächlich gibt.

Für Pibo sollte man das **nicht** übernehmen. Workflow-Kerne sollten strikt `T | undefined` modellieren, wenn Lookup fehlschlagen kann.

## Algorithmen und Utilities

### Topological Sort / Cycle Handling

- `lib/alg/topsort.ts`: DFS-basierter Topsort, startet von `sinks()`, traversiert über `predecessors()`.
- Nutzt `visited` plus `stack`; Zyklus wirft `CycleException`.
- Wenn nach Traversal nicht alle Knoten besucht wurden, wird ebenfalls `CycleException` geworfen.

Stark für Pibo:

- eigener, semantischer Fehlertyp für Zyklusfall,
- lineare Komplexität,
- unabhängig vom konkreten Graph-Storage.

### Cycle Detection

- `lib/alg/is-acyclic.ts`: wraps `topsort`, gibt boolean zurück.
- `lib/alg/find-cycles.ts`: nutzt `tarjan`, filtert SCCs >1 oder Self-Loops.
- `lib/alg/tarjan.ts`: klassische SCC-Implementierung mit `index`, `lowlink`, `stack`, `onStack`.

Für Pibo sehr relevant:

- **zwei Ebenen von Zyklusbehandlung**: schneller boolescher Check vs. erklärende Diagnose.
- Genau das braucht Workflow V1: `validateNoCycles()` plus `explainCycles()`.

### DFS / Traversal

- `lib/alg/dfs.ts` ist nur ein dünner Wrapper über `reduce`.
- `lib/alg/reduce.ts` ist das eigentliche Traversal-Grundmuster.
- Directed Graph: Navigation über `successors`.
- Undirected Graph: Navigation über `neighbors`.
- `preorder.ts` und `postorder.ts` sind Minimal-Wrapper.

Sehr gutes Pattern für Pibo: erst **ein generischer Traversal-Reducer**, dann benannte Spezialfälle darüber.

### Components

`lib/alg/components.ts`:

- für undirected Graphen: Connected Components,
- für directed Graphen pragmatisch „connected via predecessor or successor relation“.

Für Pibo nutzbar als lose Erreichbarkeitsprüfung, aber semantisch sollte man klarere Begriffe wählen, z. B.:

- weakly connected components
- strongly connected components
- reachable from entry nodes

### Shortest Paths

- `dijkstra.ts`
- `dijkstra-all.ts`
- `floyd-warshall.ts`
- `bellman-ford.ts`
- `shortest-paths.ts`
- `extract-path.ts`

Bemerkungen:

- `dijkstra` verbietet negative Gewichte explizit.
- `floydWarshall` unterstützt negative Kanten.
- `shortestPaths` wählt Dijkstra oder Bellman-Ford je nach erkannter negativer Kante.
- `extractPath` rekonstruiert Pfad aus Predecessor-Map.

Für Pibo Workflow V1 wahrscheinlich nur begrenzt relevant. Nützlich eher für spätere Kostenmodelle, Priorisierung oder Scheduling.

### Prim

`lib/alg/prim.ts` baut MST für ungerichtete zusammenhängende Graphen. Für Workflow-Definitionen wahrscheinlich nicht wichtig.

### JSON-Serialisierung

`lib/json.ts`:

- serialisiert Optionen, Knoten, Kanten, optional Graph-Label,
- erhält `parent`-Beziehungen für Compound-Graphen,
- nutzt `structuredClone` für Graph-Label,
- liest per `read()` wieder in neue `Graph`-Instanz ein.

Für Pibo relevant als Vorbild für ein **kanonisches, verlustarmes, toolfreundliches JSON-Format**.

## Datenfluss / interne Indices

Der stärkste technische Teil des Repos ist die interne Indexstruktur in `lib/graph.ts`.

### Hauptspeicherstrukturen

- `_nodes: Record<string, NodeLabel>`
- `_in: Record<string, Record<string, Edge>>`
- `_preds: Record<string, Record<string, number>>`
- `_out: Record<string, Record<string, Edge>>`
- `_sucs: Record<string, Record<string, number>>`
- `_edgeObjs: Record<string, Edge>`
- `_edgeLabels: Record<string, EdgeLabel>`
- `_parent?: Record<string, string>`
- `_children?: Record<string, Record<string, boolean>>`

Das Design ist bewusst redundant. Genau das macht viele Operationen O(1) oder nahe daran.

### Edge-Key vs. Edge-Objekt

Interne Kanten-ID wird via `edgeArgsToId` erzeugt:

- normalisiert bei undirected Graphen die Endpunkte,
- verbindet `v`, `w`, `name/default-name` mit Delimiter `\x01`,
- nutzt `DEFAULT_EDGE_NAME = "\x00"` für namenlose Kanten.

Das ist elegant, weil:

- Public API bleibt objektbasiert,
- interne Hashtabellen bleiben string-key-basiert,
- Multigraph-Unterstützung wird billig.

### setNode-Datenfluss

`setNode(name, label?)`:

1. existiert Knoten bereits -> optional Label-Update,
2. sonst Node-Label anlegen,
3. bei Compound: Parent/Children-Wurzelstruktur initialisieren,
4. `_in/_preds/_out/_sucs` für Knoten anlegen,
5. `_nodeCount++`.

### setEdge-Datenfluss

`setEdge(...)`:

1. Eingaben normalisieren/stringifizieren,
2. interne Edge-ID bilden,
3. bei bereits existierender Kante nur optional Label aktualisieren,
4. Named Edge ohne `multigraph` -> Fehler,
5. Knoten via `setNode` sicherstellen,
6. Edge-Label speichern,
7. Edge-Objekt normiert erzeugen und `freeze`n,
8. `_edgeObjs[e] = edgeObj`,
9. `_preds[w][v]++`, `_sucs[v][w]++`,
10. `_in[w][e] = edgeObj`, `_out[v][e] = edgeObj`,
11. `_edgeCount++`.

Wichtige Beobachtung: `_preds/_sucs` speichern **Zählwerte**, nicht bloß booleans. Dadurch funktionieren Multigraphen korrekt beim Entfernen einzelner Kanten.

### removeEdge-Datenfluss

`removeEdge(...)`:

1. interne ID bilden,
2. Edge-Objekt lookup,
3. Label und Edge-Objekt löschen,
4. `_preds/_sucs` via decrement-or-delete aktualisieren,
5. `_in/_out` Einträge löschen,
6. `_edgeCount--`.

### removeNode-Datenfluss

`removeNode(name)`:

1. Knoten löschen,
2. bei Compound: Parentbezug entfernen, Children hochstufen,
3. alle in-Kanten iterativ `removeEdge`,
4. alle out-Kanten iterativ `removeEdge`,
5. Node-Indizes löschen,
6. `_nodeCount--`.

Für Pibo ist das Kernlehrstück: lieber ein paar redundante Indizes sauber aktuell halten, statt alles aus einer einzigen Wahrheit ständig neu abzuleiten.

## Validierung und Fehlerbehandlung

### Laufzeitfehler / Invariants

Explizite Fehlerfälle:

- `setParent` auf non-compound -> Error
- Parent-Zyklus in Compound-Hierarchie -> Error
- Named Edge ohne Multigraph -> Error
- `reduce` bei unbekanntem Startknoten -> Error
- `dijkstra` bei negativer Kante -> Error
- `bellmanFord` bei negativer Zyklusstruktur -> Error
- `prim` bei unverbundenem Graph -> Error
- `PriorityQueue.min/removeMin` bei leerer Queue -> Error
- `PriorityQueue.decrease` bei unbekanntem Key oder erhöhter Priorität -> Error

### Gute Punkte

- Fehler werden früh geworfen.
- Invariants sind lokal in den mutierenden Operationen verankert.
- Compound-Hierarchie schützt aktiv vor Parent-Zyklen.
- Multigraph-Fehlgebrauch wird sofort geblockt.

### Schwächere Punkte

- Viele Fehler sind untypisiert (`Error` statt domänenspezifischer Fehlerklassen).
- Lookup-APIs geben effektiv oft `undefined` zurück, obwohl Signaturen das nicht sauber ausdrücken.
- Es gibt keine dedizierte Validierungsschicht; vieles ist implizit in Mutationen kodiert.

Für Pibo V1 wäre besser:

- `WorkflowValidationError`
- `CycleValidationError`
- `InterfaceMismatchError`
- `MissingNodeError`
- `DuplicateEdgeError`
- strukturierte Fehlerobjekte mit Pfad/Node-ID/Edge-ID/Severity.

## Elegante Coding Patterns

1. **Minimaler Kern, Algorithmen außen herum**  
   `Graph` kennt keine Topsort-/Tarjan-/Dijkstra-Logik. Sehr gutes Layering.

2. **Interne redundante Indizes für billige Reads**  
   `_in/_out/_preds/_sucs/_edgeObjs/_edgeLabels` ist simpel, schnell, nachvollziehbar.

3. **Öffentliche Edge-Objekte, interne String-Keys**  
   Saubere Trennung zwischen API-Ergonomie und Speicher-/Lookup-Effizienz.

4. **Factory-basierte Default-Labels**  
   Erlaubt leichtgewichtige automatische Metadaten.

5. **Algorithmen nur gegen öffentliche API**  
   Fördert Testbarkeit und spätere alternative Implementierungen.

6. **Kleine Wrapper für benannte Spezialfälle**  
   `preorder/postorder` auf Basis von `dfs/reduce` ist ein gutes Beispiel.

7. **`filterNodes` als strukturerhaltende Projektion**  
   Besonders interessant für Pibo: Teilgraphen, Views, kompakte Ausführungs-Slices.

8. **Freeze von Edge-Objekten**  
   Schützt gegen versehentliche Mutation von Identitätsobjekten.

## Relevanz für Pibo V1

Graphlib ist kein Workflow-System, aber es enthält mehrere direkt übertragbare Architekturideen.

### Was direkt relevant ist

- kleiner Graph-Kern statt schweres Framework,
- eigene semantische Knoten-/Kanten-Typen auf einem einfachen Mutationsmodell,
- Validierung und Traversal als separate Layer,
- explizite Cycle-Prüfung vor Ausführung,
- JSON-Serialisierung eines workflow-tauglichen IR,
- Subgraph-/Compound-Idee als Vorbild für verschachtelte Workflows.

### Was Pibo zusätzlich braucht

Graphlib deckt wichtige Workflow-Themen nicht ab:

- typisierte Node-Klassen: `runtime`, `code`, `adapter`, `subworkflow`, ggf. `router/join`,
- Input-/Output-Interfaces als Text oder JSON-Schema,
- globaler Workflow-State vs. lokaler Node-State,
- Edge-Semantik: data edge, control edge, error edge, completion edge,
- Ausführungsstatus, Retry, Timeout, Idempotenz,
- XState-kompatible Export-/Import-Repräsentation,
- Agent-spezifische Kontexte: Profile, Tools, Skills, Routing.

## Konkrete Übernahmeempfehlungen

### 1. Kleinen mutierbaren WorkflowGraph-Kern bauen

Empfehlung:

- `WorkflowGraph` mit bewusst kleiner API,
- zentrale Operationen ähnlich Graphlib:
  - `setWorkflowMeta`
  - `setNode`
  - `removeNode`
  - `setEdge`
  - `removeEdge`
  - `successors/predecessors`
  - `inEdges/outEdges`
  - `filterNodes`

Aber: nicht generisch-`any`, sondern domänentypisiert.

### 2. Node- und Edge-Definitionen explizit typisieren

Statt Graphlib-Labels besser:

- `WorkflowNode = RuntimeNode | CodeNode | AdapterNode | SubworkflowNode`
- `WorkflowEdge = DataEdge | ControlEdge | ErrorEdge`

Jede Kante sollte enthalten:

- `from`, `to`
- `kind`
- optional `sourcePort`, `targetPort`
- optional `adapterId` oder `transformRef`

### 3. Interface-Kompatibilität als First-Class-Validierung

Graphlib validiert Struktur, aber nicht Interface-Kompatibilität. Für Pibo zentral:

- Knoten-Input: `text | json-schema`
- Knoten-Output: `text | json-schema`
- Edge darf nur gesetzt werden, wenn kompatibel oder Adapter explizit referenziert ist

Empfehlung:

- `validateInterfaces(graph)`
- `findRequiredAdapters(graph)`
- `explainInterfaceMismatch(edgeId)`

### 4. Cycle Handling zweistufig bauen

Von Graphlib übernehmen:

- schneller `isAcyclic`-Check,
- erklärende `findCycles`-/SCC-Diagnostik.

Für Pibo zusätzlich:

- Zyklen je Edge-Kind getrennt bewerten,
- erlaubte Zyklen nur bei explizitem Feedback-/Loop-Node,
- Diagnose mit Knotenarten und Kantenarten.

### 5. Redundante Indizes bewusst nutzen

Wie Graphlib:

- Node-Map,
- Edge-Map,
- `inEdgesByNode`,
- `outEdgesByNode`,
- `predecessorCounts`,
- `successorCounts`.

Für Pibo erweitern um:

- `nodesByKind`,
- `entryNodes`,
- `exitNodes`,
- `adapterEdges`,
- `subworkflowParents`.

### 6. `filterNodes`-ähnliche Projektionen übernehmen

Sehr nützlich für:

- Teilworkflow-Vorschauen,
- nur ausführbare Slice-Ansicht,
- UI-Fokus auf einen Subworkflow,
- Debug-Report für einen Ausführungspfad.

### 7. JSON-IR ähnlich einfach halten

Analog zu `lib/json.ts` sollte Pibo ein kanonisches IR definieren:

- `meta`
- `nodes[]`
- `edges[]`
- optional `subworkflows[]` oder parent-Beziehungen
- klare Versionierung

Das Format sollte direkt:

- im Repo speicherbar,
- UI-editierbar,
- in XState-nahe Darstellung transformierbar,
- durch Agenten leicht lesbar/schreibbar sein.

### 8. Traversal-Baustein wie `reduce` bauen

Ein generischer Traversal-Kern lohnt sich für:

- reachable nodes,
- execution planning,
- dead-node detection,
- dependency collection,
- topological layer construction.

### 9. Domain-Fehler statt rohe `Error`

Im Unterschied zu Graphlib sollte Pibo strukturierte Fehlerklassen und Diagnoseobjekte haben.

### 10. Mutabler Builder, aber optional immutable Export

Graphlib ist vollständig mutabel. Für Pibo sinnvoll:

- mutabler Builder für Agenten/CLI/UI,
- validierter, eingefrorener `CompiledWorkflow` für Ausführung.

## Risiken / Nicht übernehmen

1. **Zu generische Label-API**  
   Für Pibo sind freie `any`-Labels zu schwach. Workflow-Semantik muss im Typmodell sichtbar sein.

2. **Historisch unscharfe Rückgabetypen**  
   `node()`/`edge()`/`graph()` sollten nicht so typisiert sein, als gäbe es immer Werte.

3. **Alles als String-IDs ohne stärkere Identitätsebene**  
   Für Pibo besser: stabile IDs plus klar getrennte Display-Namen.

4. **Compound-Graph als alleinige Verschachtelungssemantik**  
   Für Workflows zu generisch. Subworkflows brauchen stärkere Bedeutung als bloße Parent/Child-Hierarchie.

5. **Keine Schema-/Port-Semantik**  
   Für Pibo zwingend notwendig.

6. **Unstrukturierte Fehlertexte**  
   Für UI und Agent-Debugging unzureichend.

7. **Algorithmen ohne Execution-Modell**  
   Graphlib prüft Struktur, aber nicht Scheduling, Async, Retries, State oder side effects.

8. **Mutationen direkt auf dem Runtime-Modell**  
   Für Pibo-Ausführung besser nach Validierung in kompilierte Form überführen.

## Quellen/Pfade im Repo

Zentrale Dateien:

- `/root/code/graphlib/package.json`
- `/root/code/graphlib/README.md`
- `/root/code/graphlib/index.ts`
- `/root/code/graphlib/lib/graph.ts`
- `/root/code/graphlib/lib/types.ts`
- `/root/code/graphlib/lib/json.ts`
- `/root/code/graphlib/lib/alg/index.ts`
- `/root/code/graphlib/lib/alg/topsort.ts`
- `/root/code/graphlib/lib/alg/is-acyclic.ts`
- `/root/code/graphlib/lib/alg/find-cycles.ts`
- `/root/code/graphlib/lib/alg/tarjan.ts`
- `/root/code/graphlib/lib/alg/reduce.ts`
- `/root/code/graphlib/lib/alg/dijkstra.ts`
- `/root/code/graphlib/lib/alg/floyd-warshall.ts`
- `/root/code/graphlib/lib/alg/bellman-ford.ts`
- `/root/code/graphlib/lib/alg/shortest-paths.ts`
- `/root/code/graphlib/lib/alg/prim.ts`
- `/root/code/graphlib/lib/data/priority-queue.ts`
- `/root/code/graphlib/build.ts`
- `/root/code/graphlib/jest.config.ts`
- `/root/code/graphlib/tsconfig.json`
- `/root/code/graphlib/tsconfig.build.json`
- `/root/code/graphlib/.github/workflows/build.yml`

Besonders aussagekräftige Tests:

- `/root/code/graphlib/test/graph-test.ts`
- `/root/code/graphlib/test/json-test.ts`
- `/root/code/graphlib/test/bundle-test.ts`
- `/root/code/graphlib/test/version-test.ts`
- `/root/code/graphlib/test/alg/topsort-test.ts`
- `/root/code/graphlib/test/alg/find-cycles-test.ts`
- `/root/code/graphlib/test/alg/is-acyclic-test.ts`
- `/root/code/graphlib/test/alg/tarjan-test.ts`
- `/root/code/graphlib/test/alg/components-test.ts`
- `/root/code/graphlib/test/alg/reduce-test.ts`
- `/root/code/graphlib/test/alg/dijkstra-test.ts`
- `/root/code/graphlib/test/alg/dijkstra-all-test.ts`
- `/root/code/graphlib/test/alg/floyd-warshall-test.ts`
- `/root/code/graphlib/test/alg/prim-test.ts`
- `/root/code/graphlib/test/alg/utils/shortest-paths-tests.ts`
- `/root/code/graphlib/test/alg/utils/all-shortest-paths-test.ts`
- `/root/code/graphlib/test/data/priority-queue-test.ts`

## Schlussfazit

Wenn Pibo Workflow V1 ein leichtgewichtiges eigenes System bauen will, ist Graphlib ein gutes Referenzrepo für den **Graph-Kern**, aber nicht für die gesamte Workflow-Semantik. Die beste Übernahme ist nicht die API im Detail, sondern das Architekturprinzip:

- kleiner Kern,
- klare Indizes,
- einfache Serialisierung,
- Traversal/Algorithmen außerhalb des Kerns,
- frühe Invariant-Prüfung,
- zusätzliche domänenspezifische Validierung in separaten Layern.

Für Pibo würde ich deshalb empfehlen:

1. `WorkflowGraph` klein halten,
2. Node-/Edge-Typen domänenscharf machen,
3. Interface-/Adapter-Validierung als First-Class-Konzept einbauen,
4. Cycle-Checks und SCC-Diagnose früh anbieten,
5. später XState-/UI-Export als Projection-Layer daraufsetzen.
