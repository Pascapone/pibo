---
type: "Research"
title: "Workflow Research: Graphology-Analyse für Pibo V1"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/2026-05-10-workflow-research-graphology.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "ddbe4b647749970529bb2dfc914b4afc5167c8e7"
  source_bytes: 26859
  source_sha256: "7306d05336dd29ba2e10add8c5a98b8c55286a6c1f4bbe7282389655f50ec952"
  source_body_sha256: "7306d05336dd29ba2e10add8c5a98b8c55286a6c1f4bbe7282389655f50ec952"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Workflow Research: Graphology-Analyse für Pibo V1

## Executive Summary

`/root/code/graphology` ist kein einzelnes Graph-Paket, sondern ein Lerna-Monorepo mit einem kleinen Kern (`src/graphology`) und einer bewusst modularisierten Standardbibliothek aus Algorithmen, Layouts, Konvertern, Serialisierern und Utilities. Die stärkste Idee für Pibo ist nicht ein einzelner Algorithmus, sondern die Trennung zwischen:

- **kleinem, streng validiertem Kern-Graph-Store**,
- **klaren Mutationsoperationen**,
- **ereignisgetriebenem Update-Modell**,
- **separaten Utility-/Algorithmus-Paketen**.

Für Pibo Workflow System V1 ist besonders relevant:

1. **Ein kleines zentrales Graph-Store-Modell** ist wertvoller als ein riesiger Alleskönner.
2. **Mutationen sollten explizit, typisiert und eventfähig** sein.
3. **Node-/Edge-Keys müssen stabil und serialisierbar** sein.
4. **Validierung sollte an den API-Grenzen hart sein**, aber der Kern intern auf stabile Invarianten und günstige Datenstrukturen setzen.
5. **Graph-Store und Algorithmen sollten getrennt sein**: Workflow-Store im Kern, Analyse/Traversal/Layout/Visualisierung als Aufsatz.
6. **XState-Kompatibilität sollte als Export-/Projektionsschicht** gebaut werden, nicht als interne Kernrepräsentation.

Graphology ist für Pibo keine direkte Blaupause; es ist eher ein gutes Beispiel für API-Disziplin, Invariantenschutz, Eventfähigkeit und modulare Erweiterbarkeit.

## Projektüberblick

### Repo-Struktur

Wurzeldateien:

- `package.json`: Root-Skripte für Build, Lint, Test, Docs
- `lerna.json`: Monorepo mit `src/*` als Packages
- `README.md`: Gesamtüberblick
- `docs/`: Spezifikation und API-Dokumentation
- `.github/workflows/*.yml`: CI für Build und Tests

Wichtige Packages unter `src/`:

- `graphology`: Kernimplementierung des `Graph`
- `types`: TypeScript-Typen
- `library`: gebündelte Standardbibliothek
- `traversal`, `dag`, `shortest-path`, `metrics`, `layout`, `operators`, `utils`, `indices`
- dazu weitere Spezialpakete wie `gexf`, `graphml`, `components`, `generators`, `communities-*`, `svg`, `canvas`

### Build-/Test-Setup

- Root-Build über `lerna run ...` in `package.json`
- Root-Test via `lerna run test`
- Lint via `eslint './src/**/*.js'`
- Kernpaket `src/graphology/package.json` baut mit `rollup`, `babel`, `tsc`-Typetest
- CI in `.github/workflows/tests.yml` testet gegen mehrere Node-Versionen
- Das Repo enthält viele paketnahe Tests; `find src -path '*/test*' -type f` ergibt 138 Testdateien

### Architekturidee des Repos

Graphology behandelt den Kern-Graphen als eigene Spezifikation plus Referenzimplementierung. Die Algorithmenbibliothek hängt an der Kern-API, nicht an konkreten Interna. `docs/implementing-graphology.md` beschreibt sogar explizit, dass andere Implementierungen dieselbe API erfüllen und die Standardbibliothek weiterverwenden können.

**Für Pibo wichtig:** dieselbe Trennung ist attraktiv: ein Pibo-Workflow-Graph als Spezifikation/Kern-API; zusätzliche Runtime-, Visualisierungs- und Analysefunktionen separat.

## Architektur und Modulstruktur

### Kernpaket `src/graphology`

Zentrale Dateien:

- `src/graphology/src/graph.js`: Hauptklasse, Mutationen, Read-API, Iteration, Events, Import/Export, Copy
- `src/graphology/src/data.js`: interne Node-/Edge-Datenstrukturen
- `src/graphology/src/errors.js`: Fehlerklassen
- `src/graphology/src/serialization.js`: Serialisierung + Validierung
- `src/graphology/src/iteration/*`: Edge-, Neighbor-, Adjacency-Iteration
- `src/graphology/src/attributes/*`: Attribut-Methoden
- `src/graphology/src/classes.js` und `src/index.js`: spezialisierte Graph-Konstruktoren

### Standardbibliothek

`src/library/index.js` bündelt die größeren Funktionsbereiche:

- Assertions
- Layouts
- Komponenten
- Generatoren
- GEXF/GraphML
- Metrics
- Operators
- Shortest Path
- Simple Path
- Traversal
- Utils

Das ist architektonisch sauber: **Kern bleibt klein, Speziallogik bleibt außerhalb**.

### Ergonomie durch spezialisierte Konstruktoren

`src/graphology/src/classes.js` exportiert:

- `Graph`
- `DirectedGraph`
- `UndirectedGraph`
- `MultiGraph`
- `MultiDirectedGraph`
- `MultiUndirectedGraph`

Diese Klassen erzwingen Konsistenz ihrer Optionen schon im Konstruktor.

**Übertragbar auf Pibo:** statt einem generischen „WorkflowGraph mit 30 Flags“ eher wenige gezielte Fabriken/Konstruktoren wie:

- `createWorkflowGraph()`
- `createStatechartWorkflow()`
- `createAgentWorkflow()`
- `createCodeNodeGraph()`

## Graph-Datenmodell

### Grundmodell

Graphology unterstützt drei Achsen gleichzeitig:

- **Richtung**: `directed`, `undirected`, `mixed`
- **Parallelkanten**: `multi: true/false`
- **Self-Loops**: `allowSelfLoops: true/false`

Optionen leben in `src/graphology/src/graph.js` (`DEFAULTS`) und werden beim Konstruktor streng validiert.

### Schlüsselmodell

Laut `docs/design-choices.md` werden Node- und Edge-Keys immer auf Strings koerziert. Das vereinfacht:

- Serialisierung
- API-Konsistenz
- externe Indizes
- Interoperabilität

Für Pibo ist das hoch relevant: **Workflow-Node-IDs und Edge-IDs sollten strikt stabile String-IDs sein**. Keine impliziten Objekt-Referenzen als Schlüssel.

### Interne Node-Daten

`src/graphology/src/data.js` definiert drei NodeData-Typen:

- `MixedNodeData`
- `DirectedNodeData`
- `UndirectedNodeData`

Sie speichern:

- `key`
- `attributes`
- Degree-Counter
- Adjazenz-Indizes (`in`, `out`, `undirected`)

Wichtig: Je nach Graph-Typ wird ein anderer NodeData-Typ verwendet. Dadurch spart der Kern unnötige Felder und Verzweigungen.

**Übertragbar auf Pibo:** statt alle Workflow-Fälle in einem gigantischen Node-Objekt zu vereinheitlichen, besser:

- schlanker gemeinsamer Basiskern,
- optionale spezialisierte interne Stores/Indices für bestimmte Workflow-Modi.

### Interne Edge-Daten

`EdgeData` speichert:

- `key`
- `attributes`
- `undirected`
- `source`
- `target`

Für Multigraphen nutzt Graphology in `data.js` eine **verkettete Liste pro Adjazenzslot** (`next`/`previous`). Das ist ein bemerkenswertes Performance-Muster: parallele Kanten werden nicht als Arrays pro Paar gehalten, sondern als Kopfknoten plus verkettete Folgeknoten.

### Attribute auf drei Ebenen

Graphology hat Attribute auf:

- Graph-Ebene
- Node-Ebene
- Edge-Ebene

Für Pibo ist die Analogie naheliegend:

- **Graph-Attribute**: Workflow-Metadaten, Version, UI-Settings, Schema-Refs
- **Node-Attribute**: Node-Definition, Interface, Ausführungsstrategie, UI-Position
- **Edge-Attribute**: Mapping, Guard, Adapter, Transform, Label

## Kern-Datentypen und Interfaces

### TypeScript-Typen

`src/types/index.d.ts` ist erstaunlich reichhaltig. Wichtige Merkmale:

- generische Attributtypen für Nodes, Edges und Graph
- typisierte Event-Payloads
- typisierte Callback-Signaturen für Iteration
- typisierte Serialisierungsformate
- spezialisierte Entry-Typen wie `NodeEntry`, `EdgeEntry`, `AdjacencyEntry`
- Ergebnis-Typen wie `NodeMergeResult`, `EdgeMergeResult`
- `UpdateHints` für Batch-Attribute-Updates

### Gute API-Design-Patterns

1. **Tri-generische Graph-Typisierung**
   - `NodeAttributes`
   - `EdgeAttributes`
   - `GraphAttributes`

2. **Explizite Serialisierungs-Typen**
   - `SerializedNode`
   - `SerializedEdge`
   - `SerializedGraph`

3. **Typisierte Event-Map**
   - `GraphEvents<...>`

4. **Funktionssignaturen für Iteration/Map/Reduce**
   - konsistent über Nodes, Neighbors, Edges

### Schwächen aus Pibo-Sicht

Die Typen sind stark attributzentriert, aber **nicht schemazentriert**. Für Workflow-Systeme braucht Pibo zusätzlich:

- Input-Schema-Typen
- Output-Schema-Typen
- Runtime-State-Typen
- Node-Kind-spezifische Discriminated Unions
- Edge-Adapter-Typen
- UI-Projektions-Typen

Graphology liefert gute API-Form, aber kein Modell für semantisch starke Workflow-Interfaces.

## Algorithmen und Utilities

### Traversal

Package `src/traversal`:

- `bfs.js`
- `dfs.js`

Merkmale:

- Graph-validierung via `graphology-utils/is-graph`
- optionaler Startknoten
- Traversal-Modus (`outbound`, etc.)
- Callback erhält `node`, `attributes`, `depth`
- Rückgabe `true` stoppt nur das Weiterverfolgen von Nachbarn, nicht die gesamte Traversal-Schleife

Für Pibo V1 wertvoll:

- BFS/DFS über Workflow-Graphen
- Start ab Teilgraph/Node
- Traversal-Modi wie `dataflow`, `controlflow`, `dependency`, `visual`

### DAG / Topological

Package `src/dag`:

- `has-cycle.js`
- `will-create-cycle.js`
- `topological-sort.js`

`topological-sort.js` nutzt Kahn-Algorithmus, behandelt auch getrennte Komponenten und liefert optional **Generationen**.

**Das ist direkt relevant für Pibo:**

- Topological sort für ausführbare acyclische Teilgraphen
- Generations/Layers für Scheduler und UI-Layout
- `willCreateCycle` als Preflight-Validierung beim Hinzufügen einer Kante

### Shortest Path

Package `src/shortest-path`:

- unweighted
- Dijkstra
- A*
- Indexed Brandes
- Hilfsfunktionen

Für Workflow-Orchestrierung ist klassischer Shortest-Path nicht Kernfunktion, aber die Struktur ist lehrreich:

- Algorithmen sind **separat vom Kern**
- Gewichte können über Attributname oder Getter-Funktion angegeben werden

Pibo könnte ähnlich optionale „Pfadkosten“ für:

- Latenz
- Kosten
- Priorität
- Risiko

modellieren.

### Metrics

Package `src/metrics` enthält:

- Graphmetriken: `density`, `diameter`, `modularity`, `simple-size`, `weighted-size`
- Knotenmétriken: `eccentricity`, `weighted-degree`
- Zentralitäten: `pagerank`, `betweenness`, `eigenvector`, `hits`, etc.
- Layout-Quality-Metriken

Für Pibo V1 nicht primär nötig, aber einige Ideen sind übertragbar:

- Workflow-Komplexitätsmetriken
- Fan-in/Fan-out von Nodes
- kritische Pfadlänge
- visuelle Qualitätsmetriken für Auto-Layout

### Layout

Package `src/layout` plus `layout-force`, `layout-forceatlas2`, `layout-noverlap` zeigt: Layout wird **außerhalb des Kern-Graphen** gehalten.

**Für Pibo sehr wichtig:** UI-Positionierung sollte nicht Kernlogik dominieren. Besser:

- Kern speichert nur optionale Positionsattribute
- Auto-Layout als gesonderte Utility/Projection-Schicht

### Serialization / Import / Export

Kern:

- `src/graphology/src/serialization.js`
- `Graph.export()` / `Graph.import()` in `graph.js`

Zusatzformate:

- `src/gexf`
- `src/graphml`

Für Pibo relevant:

- stabiler JSON-Export als kanonisches Format
- Import mit Merge-Modus
- externe Interop-Formate optional später

### Operators / Utilities

Packages `src/operators` und `src/utils` enthalten nützliche Transformationsideen:

- `to-directed`, `to-undirected`, `to-mixed`, `to-simple`, `to-multi`
- `subgraph`, `reverse`, `union`, `disjoint-union`
- `rename-graph-keys`, `update-graph-keys`
- `merge-path`, `merge-cycle`, `merge-star`, `merge-clique`

Für Pibo übertragbar:

- `subworkflow`
- `cloneWorkflow`
- `renameNodeIds`
- `extractRunnableSubgraph`
- `projectToRuntimeGraph`
- `projectToXState`

## Datenfluss / Mutationen / Events

### Mutationsmodell

Kernoperationen in `graph.js` und dokumentiert in `docs/mutation.md`:

- `addNode`, `mergeNode`, `updateNode`
- `addEdge`, `addEdgeWithKey`
- `mergeEdge`, `mergeEdgeWithKey`
- `updateEdge`, `updateEdgeWithKey`
- `dropNode`, `dropEdge`
- `clear`, `clearEdges`

Wichtiges Pattern:

- **`add*`**: strikt, Fehler bei Konflikt
- **`merge*`**: idempotenter/ergonomischer Upsert-Stil
- **`update*`**: funktionaler Updater-Stil

Das ist für Pibo exzellent übertragbar. Für Workflow-V1 würde ich genau diese Dreiheit empfehlen:

- `addNode` / `addEdge`
- `mergeNode` / `mergeEdge`
- `updateNode` / `updateEdge`

### Datenfluss über Attribute und Payloads

Graphology modelliert Datenfluss nicht fachlich, aber API-seitig sichtbar über:

- Attribute auf Nodes/Edges
- Event-Payloads bei Mutationen
- Iterationsmethoden mit Zugang zu Source/Target/Attribute

Für Pibo sollte echter Datenfluss explizit im Edge-Modell stecken, z. B.:

- `sourcePort`
- `targetPort`
- `adapter`
- `mapping`
- `contract`
- `guard`

Graphology selbst zeigt vor allem: **Datenflussinformationen sollten direkt an der Kante hängen, nicht implizit aus Node-Interna erraten werden.**

### Event-Modell

`docs/events.md` und `src/graphology/tests/events.js` zeigen ein sauberes Event-System:

- `nodeAdded`
- `edgeAdded`
- `nodeDropped`
- `edgeDropped`
- `cleared`
- `edgesCleared`
- `attributesUpdated`
- `nodeAttributesUpdated`
- `edgeAttributesUpdated`
- `eachNodeAttributesUpdated`
- `eachEdgeAttributesUpdated`

Stärken:

- stabile, benannte Events
- objektförmige Payloads
- Payload enthält genug Kontext
- Events sind nah an Mutationen, nicht an UI-Sonderfällen

**Für Pibo V1 sehr wertvoll:**

- Graph-Store sollte mutation events emittieren
- UI, Validatoren, Scheduler und Persistenz können darauf reagieren
- Events sollten differenzieren zwischen Strukturänderung, Interfaceänderung, Stateänderung, UI-Änderung

### Iteration

Graphology bietet drei Iterationsstile:

- Arrays (`nodes()`, `edges()`, `neighbors()`)
- Callbacks (`forEachNode`, `forEachEdge`, ...)
- Iteratoren (`nodeEntries`, `edgeEntries`, ...)

`docs/performance-tips.md` empfiehlt aus Performancegründen klar die Callback-Varianten.

Für Pibo ist das übertragbar als API-Prinzip:

- High-level APIs für Ergonomie
- Low-allocation APIs für Hot Paths

## Validierung und Fehlerbehandlung

### Fehlerklassen

`src/graphology/src/errors.js`:

- `GraphError`
- `InvalidArgumentsGraphError`
- `NotFoundGraphError`
- `UsageGraphError`

Das ist ein starkes Pattern. Es trennt:

- ungültige Eingaben,
- fehlende Referenzen,
- semantisch falsche Nutzung.

**Empfehlung für Pibo:** ähnliche Klassen wie:

- `InvalidWorkflowDefinitionError`
- `UnknownNodeError`
- `UnknownEdgeError`
- `WorkflowInvariantError`
- `InterfaceCompatibilityError`
- `ExecutionStateError`

### API-Grenzvalidierung

Graphology validiert früh:

- Konstruktoroptionen
- Attributobjekte
- Node-/Edge-Existenz
- Typkonsistenz `directed`/`undirected`
- Self-loop-Regeln
- Parallelkanten-Regeln
- Importformate
- Merge-Inkonsistenzen bei Edge-Key + Extremitäten

Beispiel: `mergeEdge` in `graph.js` prüft, ob ein vorhandener Edge-Key mit anderen Extremitäten verwendet wird, und wirft dann einen Fehler.

**Für Pibo essenziell:**

- Wenn `edge.id` bereits existiert, müssen `from`/`to`/Ports konsistent bleiben
- Interface-Kompatibilität muss bei Kantenänderung prüfbar sein
- Zyklusregeln müssen graph-spezifisch konfigurierbar sein

### Upgrade statt Downgrade

`Graph.copy(options)` erlaubt nur kompatible Änderungen; inkompatible „Downgrades“ werden blockiert.

Das ist sehr elegant. Übertragbar auf Pibo:

- Projektion von einfachem Workflow zu reicherem Workflow ok
- aber kein stilles Entfernen von nötiger Semantik
- z. B. kein „Downcast“ von adapterbehafteten Edges auf blanke XState-Transitionen ohne explizite Projektion

## Performance Patterns und interne Datenstrukturen

### Zentrale Strukturen

Im Kern in `graph.js`/`data.js`:

- `_nodes: Map`
- `_edges: Map`
- Node-lokale Adjazenzobjekte `in`, `out`, `undirected`
- Degree-Counter pro Node
- globale Counter für Größen und Self-Loops

Vorteile:

- O(1)-artige Schlüssel-Lookups via `Map`
- schnelle lokale Nachbarschaftsabfragen
- Count-Werte werden inkrementell gepflegt statt ständig neu berechnet

### Multi-Edge-Strategie

Parallele Kanten als verkettete Liste pro Adjazenzeintrag (`attachMulti`, `detachMulti`) sind ein klares Low-Level-Optimierungsmuster.

Für Pibo V1 wahrscheinlich **nicht nötig**, aber die Idee dahinter ist wertvoll:

- Hot-path-Strukturen bewusst wählen
- keine übergenerische Repräsentation erzwingen

### Vermeidung unnötiger Arbeit

Beobachtete Patterns:

- spezialisierte NodeData-Klassen je Graph-Typ
- Counter werden inkrementell gepflegt
- `clear`/`clearEdges` emittieren Sammelereignisse statt tausende Drop-Events
- Performance-Tipps dokumentieren API-Nutzung explizit
- in Topological Sort werden teure Löschungen vermieden

### Key-Generierung

Automatische Edge-Key-Generierung in `graph.js` nutzt Präfix + Instanz-ID + Counter, um Kollisionen und adversariale Fälle zu reduzieren.

Für Pibo ist das nützlich, wenn Edges automatisch erzeugt werden. Trotzdem würde ich in Workflows bevorzugen:

- Node-IDs explizit stabil
- Edge-IDs stabil oder deterministisch ableitbar
- Auto-IDs nur als Fallback

## Tests und Beispiele

### Kernabdeckung

`src/graphology/tests/` deckt u. a. ab:

- Instanziierung
- Properties
- Read-Methoden
- Mutationen
- Events
- Attribute
- Serialisierung
- bekannte Methoden / Utilities

Die Tests prüfen nicht nur „Happy Paths“, sondern viele Invarianten und Fehlerszenarien.

### Algorithmische Tests

Separate Pakete testen ihre Domäne selbst, z. B.:

- `src/traversal/test.js`
- `src/shortest-path/test/*.js`
- `src/layout/test/*`
- `src/indices/test/*`
- `src/operators/test.js`

### Besonders gute Test-Patterns

1. **Fehlertypen werden explizit geprüft**
2. **Gemischte Graphfälle** werden getestet
3. **Disconnected graphs**, Zyklen, Multigraphen und Self-Loops kommen vor
4. **Serialisierung/Deserialisierung** wird rund getestet
5. **TypeScript-Typen** werden separat getestet (`src/graphology/test-types.ts`)

**Für Pibo V1 unbedingt übernehmen:**

- Kerninvarianten testen
- Roundtrip-Tests für JSON-Export/Import
- Kompatibilitätsfehler für Interfaces testen
- Projektionstests für XState-Export
- Mutation-Event-Tests

## Elegante Coding Patterns

### 1. Kleiner Kern, breite Bibliothek

Graphology hält den Kern relativ kompakt und lagert alles andere aus. Das ist wahrscheinlich die wichtigste übernehmbare Architekturentscheidung.

### 2. API-Familien mit konsistenter Semantik

- `add*`
- `merge*`
- `update*`
- `drop*`
- `forEach*`, `map*`, `reduce*`, `find*`, `some*`, `every*`

Diese Regelmäßigkeit macht die API lernbar.

### 3. Explizite Invarianten statt stiller Magie

Viele Dinge, die andere Libraries stillschweigend „irgendwie“ tun würden, werden hier blockiert oder klar getrennt.

### 4. Event-Payloads als Objekte

Skalierbarer als positional arguments; später erweiterbar.

### 5. Separate Copy-/Projection-Methoden

`nullCopy`, `emptyCopy`, `copy` sind für Graphtransformationen sehr sauber.

Übertragbar auf Pibo:

- `emptyWorkflowCopy`
- `structureCopy`
- `runtimeProjection`
- `visualProjection`

### 6. Import/Export als First-Class API

Graphology behandelt Serialisierung nicht als Nebensache. Das passt sehr gut zu Pibo, wo Persistenz, UI und Ausführung denselben Workflow teilen müssen.

### 7. Interfaces statt Implementierungszwang

`docs/implementing-graphology.md` ist stark: Standardbibliothek hängt an API-Vertrag, nicht an einer konkreten Implementierung.

Für Pibo wäre das ideal, damit später andere Workflow-Stores oder remote-backed Stores dieselbe API bedienen können.

## Relevanz für Pibo V1

### Was direkt passt

1. **Graph als eigener Kern-Store**
2. **strikte Node-/Edge-IDs**
3. **explizite Mutations-API**
4. **ereignisgetriebene Änderungssignale**
5. **Serialisierung als Kernfunktion**
6. **separate Algorithmen/Utilities**
7. **Cycle-/Topological-Helfer**

### Was nur teilweise passt

- Graphology behandelt Struktur und Attribute generisch; Pibo braucht zusätzlich starke Workflow-Semantik.
- Graphology kennt keine Interfaces, Ports, Adapter, Runtime-State-Maschinen oder Nested Workflows.
- Graphology kennt keine globale vs. lokale State-Semantik.

### Was Pibo ergänzen muss

- Node-Kind-System: Runtime Node vs. TS Code Node vs. Subworkflow Node
- Port-/Schema-System
- Adapter-Layer zwischen inkompatiblen Outputs/Inputs
- globaler Workflow-State
- lokaler Node-State
- Ausführungszustand pro Node/Run
- Nested Workflow Boundaries
- XState-kompatible Exportprojektion

## Konkrete Übernahmeempfehlungen

### 1. Pibo Workflow Graph Store als kleiner Kern

Empfohlenes V1-Kernmodell:

- `WorkflowGraph`
- `WorkflowNode`
- `WorkflowEdge`
- `WorkflowGraphAttributes`

Mit stabilen IDs und JSON-serialisierbaren Daten.

### 2. Strikte Trennung von Struktur und Ausführung

Im Graph nur definitorische Struktur plus optionaler gespeicherter State:

- Struktur: Nodes, Edges, Ports, Schemas, Adapter, Guards
- Ausführung: separat als Runtime/Execution-Projektion

Nicht alles direkt in einen überladenen Node-Record packen.

### 3. API-Familien wie bei Graphology

V1 sollte mindestens haben:

- `addNode`, `mergeNode`, `updateNode`, `dropNode`
- `addEdge`, `mergeEdge`, `updateEdge`, `dropEdge`
- `hasNode`, `hasEdge`, `getNode`, `getEdge`
- `forEachNode`, `forEachEdge`
- `export`, `import`, `copy`

### 4. Spezifische Fehlerklassen

Empfohlene Typen:

- `InvalidWorkflowGraphError`
- `WorkflowNotFoundError`
- `WorkflowUsageError`
- `WorkflowInterfaceError`
- `WorkflowValidationError`

### 5. Event-System für den Store

Mindestens:

- `nodeAdded`
- `nodeUpdated`
- `nodeDropped`
- `edgeAdded`
- `edgeUpdated`
- `edgeDropped`
- `graphUpdated`
- `interfaceChanged`
- `stateChanged`
- `layoutChanged`

Ich würde Struktur-, Interface-, Runtime- und UI-Änderungen trennen.

### 6. Kanten als Träger fachlicher Datenfluss-Semantik

Edge-V1 sollte nicht nur `from`/`to` haben, sondern etwa:

- `sourceNodeId`
- `sourcePort`
- `targetNodeId`
- `targetPort`
- `mode` (`data`, `control`, `state`, `event`)
- `adapter` / `transform`
- `guard`
- `schemaCompatibility` / `contract`

### 7. Validierung in zwei Schichten

Wie bei Graphology, aber erweitert:

**API-Schicht**
- Existenzprüfungen
- ID-Kollisionen
- Port-Existenz
- Graph-Strukturregeln

**Semantik-Schicht**
- Input/Output-Schema-Kompatibilität
- Adapterpflicht bei inkompatiblen Interfaces
- Zyklusregeln nach Edge-Modus
- Node-Kind-Kompatibilität

### 8. Topological / Cycle Utilities früh einbauen

Mindestens für V1:

- `hasCycle(graph, mode?)`
- `willCreateCycle(graph, edgeDraft, mode?)`
- `topologicalSort(graph, mode?)`
- `topologicalLayers(graph, mode?)`

Besonders nützlich für Scheduler und UI-Layering.

### 9. Nested Workflows explizit modellieren

Graphology selbst hat keine Hierarchie. Pibo sollte sie ausdrücklich modellieren, z. B.:

- Subworkflow Node mit Referenz auf inneren Workflow
- definierte Boundary-Ports
- explizite Adapter an der Boundary

### 10. XState-Kompatibilität als Projektion

Nicht den Kern auf XState zwingen. Besser:

- interner Pibo-Workflow-Graph bleibt leichtgewichtig
- Exporter `toXStateMachineSpec()` oder `toXStateCompatibleGraph()`
- UI kann denselben Projektionslayer nutzen

### 11. Separate Utility-Pakete

Wie Graphology:

- `workflow-store` (Kern)
- `workflow-validation`
- `workflow-traversal`
- `workflow-layout`
- `workflow-xstate`
- `workflow-runtime-projection`
- `workflow-serialization`

## Risiken / Nicht übernehmen

### 1. Zu generische Attributobjekte

Graphology lebt von freien Attributobjekten. Für Pibo wäre das im Kern allein zu schwach. Nodes und Edges brauchen stärker strukturierte Felder.

### 2. Zu breite API-Fläche im Kern

Graphology hat historisch eine große API. Für Pibo V1 besser kleiner starten und nur nötige Primitive einbauen.

### 3. Multigraph-Semantik blind übernehmen

Pibo sollte Mehrfachkanten nur erlauben, wenn semantisch sinnvoll. Oft sind doppelte Datenflusskanten eher Fehler als Feature.

### 4. Mixed-Graph-Komplexität eins zu eins übernehmen

Graphology unterstützt `mixed`. Für Pibo lieber fachliche Edge-Modi explizit benennen statt nur „gerichtet/ungerichtet/gemischt“.

### 5. Zu viele Iterationsvarianten sofort anbieten

V1 braucht nicht alle `map*`, `reduce*`, `find*`, `some*`, `every*`-Varianten. Kern zuerst klein halten.

### 6. Event-Sturm bei feingranularen Updates

Graphology hat Sammelereignisse wie `clear` und `eachNodeAttributesUpdated`. Für Pibo sollte es ebenfalls Batch-/Transaction-Events geben, sonst wird UI-Sync teuer.

### 7. Interne Low-Level-Optimierungen zu früh

Verkettete Listen für Multi-Edges sind clever, aber für Pibo V1 vermutlich Overkill. Erst messen, dann optimieren.

## Quellen/Pfade im Repo

### Root / Monorepo

- `/root/code/graphology/package.json`
- `/root/code/graphology/lerna.json`
- `/root/code/graphology/README.md`
- `/root/code/graphology/.github/workflows/tests.yml`

### Kernimplementierung

- `/root/code/graphology/src/graphology/package.json`
- `/root/code/graphology/src/graphology/src/graph.js`
- `/root/code/graphology/src/graphology/src/data.js`
- `/root/code/graphology/src/graphology/src/errors.js`
- `/root/code/graphology/src/graphology/src/serialization.js`
- `/root/code/graphology/src/graphology/src/classes.js`
- `/root/code/graphology/src/graphology/src/iteration/edges.js`
- `/root/code/graphology/src/graphology/src/iteration/neighbors.js`
- `/root/code/graphology/src/graphology/src/iteration/adjacency.js`

### Typen

- `/root/code/graphology/src/types/index.d.ts`
- `/root/code/graphology/src/graphology/test-types.ts`

### Dokumentation

- `/root/code/graphology/docs/design-choices.md`
- `/root/code/graphology/docs/events.md`
- `/root/code/graphology/docs/performance-tips.md`
- `/root/code/graphology/docs/serialization.md`
- `/root/code/graphology/docs/iteration.md`
- `/root/code/graphology/docs/mutation.md`
- `/root/code/graphology/docs/attributes.md`
- `/root/code/graphology/docs/utilities.md`
- `/root/code/graphology/docs/implementing-graphology.md`

### Algorithmen / Utilities

- `/root/code/graphology/src/traversal/bfs.js`
- `/root/code/graphology/src/traversal/dfs.js`
- `/root/code/graphology/src/dag/topological-sort.js`
- `/root/code/graphology/src/dag/has-cycle.js`
- `/root/code/graphology/src/dag/will-create-cycle.js`
- `/root/code/graphology/src/shortest-path/dijkstra.js`
- `/root/code/graphology/src/metrics/README.md`
- `/root/code/graphology/src/layout/*`
- `/root/code/graphology/src/operators/*`
- `/root/code/graphology/src/utils/*`
- `/root/code/graphology/src/library/index.js`

### Tests

- `/root/code/graphology/src/graphology/tests/events.js`
- `/root/code/graphology/src/graphology/tests/mutation.js`
- `/root/code/graphology/src/graphology/tests/serialization.js`
- `/root/code/graphology/src/traversal/test.js`
- `/root/code/graphology/src/shortest-path/test/dijkstra.js`

## Schlussfazit

Für Pibo Workflow System V1 würde ich **nicht** versuchen, Graphology nachzubauen. Ich würde aber sehr bewusst diese Prinzipien übernehmen:

- kleiner, harter Kern
- stabile IDs
- klare Mutationen
- starke Invarianten
- Eventfähigkeit
- Serialisierung als Kernfeature
- Algorithmen und Projektionen außerhalb des Stores

Wenn Pibo diese Disziplin mit workflow-spezifischer Semantik verbindet — Runtime Nodes, Code Nodes, Schema-Interfaces, Adapter-Layer, global/local state, Nested Workflows und XState-Projektion — dann entsteht ein System, das leichter bleibt als LangGraph/XState-Kombinationen, aber trotzdem robust genug für UI, Routing und Ausführung ist.
