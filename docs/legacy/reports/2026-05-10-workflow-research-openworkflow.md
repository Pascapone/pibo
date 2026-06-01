# OpenWorkflow-Recherchebericht für Pibo Workflow System V1

## Executive Summary

OpenWorkflow ist kein Graph-Editor und kein allgemeines Node/Edge-Workflow-System, sondern ein leichtgewichtiges Durable-Execution-Framework für deterministische TypeScript-Workflows. Das zentrale Modell ist **Replay über persistierte Step-Attempts**: Ein Worker startet einen Workflow bei jedem Claim logisch wieder am Anfang, memoisiert aber bereits erfolgreich persistierte Steps. Dadurch entstehen starke Eigenschaften für Retry, Crash-Recovery, Sleep, Child-Workflows und Signale – bei relativ wenig Runtime-Komplexität.

Für Pibo ist OpenWorkflow besonders relevant als Referenz für:

- **durable orchestration ohne separaten Orchestrator-Server**
- **klare Trennung zwischen Definition, Laufzeit, Persistenz und Worker-Polling**
- **kleine, robuste Persistenzprimitive**: `workflow_runs`, `step_attempts`, `workflow_signals`
- **deterministische Wiederaufnahme über Replay statt Snapshots/VM-Fortsetzung**
- **saubere TypeScript-Flächen** für Specs, Input-Schema, Output-Typen und Retry-Policies
- **racesichere Backend-Operationen** rund um Leases, Parent/Child-Wakeups und Signal-Zustellung

Für Pibo V1 ist OpenWorkflow **keine direkte Zielarchitektur**, weil Pibo zusätzlich braucht:

- **Pibo Runtime Nodes** statt nur Funktions-Steps
- **explizite Nodes, Edges, Interfaces und Adapter-Layers**
- **globalen Workflow-State + lokalen Node-State + datenflussorientierte Ports**
- **XState-kompatible Darstellung**
- **Text/JSON-Schema-In/Output pro Node und Workflow**
- **verschachtelte Workflows als kompositionsfähige Graphen**

Trotzdem sollte Pibo viel übernehmen: vor allem das Persistenzdenken, die Lease/Heartbeat-Mechanik, deterministische Step-/Node-Schlüssel, Backoff/Retry-Entscheidungen als pure Funktionen, und die Trennung zwischen durablem Kernel und ergonomischer API.

## Projektüberblick

### Repo-Struktur

Top-Level-Struktur in `/root/code/openworkflow`:

- `packages/openworkflow/` – Kern-SDK
- `apps/cli/` – CLI für Init, Worker-Start, Discovery, Doctor, Dashboard-Start
- `apps/dashboard/` – Web-Dashboard
- `apps/docs/` – Doku-Site
- `examples/` – Basisbeispiele, deklarative Workflows, Schema-Validation, Discovery
- `benchmarks/basic/` – einfache Performance-Benchmarks
- `openworkflow/` – Beispielprojekt im Repo selbst

### Monorepo / Build / Tooling

Wichtige Dateien:

- `package.json` – npm workspaces, Turbo, Vitest, TypeScript, ESLint
- `turbo.json` – Monorepo-Build-Orchestrierung
- `vitest.config.ts` – Tests
- `tsconfig*.json` – TS-Konfiguration
- `eslint.config.js`, `prettier.config.js`

Build/Test-Setup laut `package.json`:

- Build: `turbo build`
- Typecheck: `tsc --noEmit`
- Tests: `vitest run`
- Coverage: `vitest run --coverage`
- CI bündelt Format, Build, Lint, Duplication, Spellcheck, Knip, Typecheck, Coverage

### Zentrale Packages / Module

Innerhalb `packages/openworkflow/`:

- `client/client.ts` – öffentliche Client-API
- `worker/worker.ts` – Polling, Concurrency, Leases, Heartbeats
- `worker/execution.ts` – Kern der Workflow-Ausführung
- `worker/step-history.ts` – Replay-/Memoization-Zustand
- `core/workflow-definition.ts` – Workflow-Specs, Retry-Typen
- `core/workflow-function.ts` – Typen für Step-API und Workflow-Handler
- `core/workflow-run.ts` – Workflow-Run-Modell, Validation
- `core/step-attempt.ts` – Step-Attempt-Modell, Context-Typen
- `core/backend.ts` – Backend-Interface
- `postgres/backend.ts`, `sqlite/backend.ts` – Persistenzimplementierungen
- `core/workflow-registry.ts` – Workflow-Registry nach Name+Version

## Architektur und Modulstruktur

### Grundarchitektur

Die Architektur ist worker-getrieben:

1. Anwendung erzeugt einen `workflow_run`
2. Worker pollt Backend
3. Worker claimt einen Run über Lease (`availableAt`)
4. Worker lädt komplette Step-Historie
5. Worker führt Workflow-Code von vorne aus
6. Bereits abgeschlossene Steps werden aus Historie zurückgegeben
7. Neue Steps werden als `step_attempts` persistiert
8. Workflow wird entweder `completed`, `pending` (Retry) oder `running` geparkt

Wichtig: Das Backend ist zugleich

- Queue
- Zustandslog
- Wakeup-Mechanismus
- Crash-Recovery-Grundlage

### Registry und Discovery

- `core/workflow-registry.ts` speichert Workflows über `name + version`
- `apps/cli/commands.ts` entdeckt Workflow-Dateien rekursiv aus konfigurierten Verzeichnissen
- Import erfolgt dynamisch; exportierte Werte werden via `isWorkflow(...)` erkannt
- doppelte `name + version`-Kombinationen werden erkannt und beim Worker-Start abgelehnt

### Client / Worker / Backend Trennung

Sehr sauber gelöst:

- **Client** erzeugt Runs und exponiert ergonomische API
- **Worker** besitzt nur Polling/Ausführungslogik
- **Backend** kapselt Persistenz und Race-Handling
- **Execution** enthält den durable Interpreter der Workflow-Semantik

Diese Trennung ist für Pibo direkt übernehmbar.

## Kern-Datentypen und Interfaces

### Workflow-Spec und Workflow

`packages/openworkflow/core/workflow-definition.ts`

Zentrale Typen:

- `WorkflowSpec<Input, Output, RawInput>`
- `Workflow<Input, Output, RawInput>`
- `defineWorkflowSpec(...)`
- `defineWorkflow(...)`

Elegant ist hier:

- Trennung zwischen **Spec** und **Implementierung**
- optionales `schema` für Input-Validierung
- `RawInput` vs. validiertes `Input`
- Phantom-Typträger `__types` für Output-Typbindung

Für Pibo V1 ist das Vorbild gut: Ein Workflow- oder Node-Spec sollte klar von Runtime-Implementierung getrennt bleiben.

### Workflow-Function / Step-API

`packages/openworkflow/core/workflow-function.ts`

Wichtige Flächen:

- `WorkflowFunctionParams<Input>` mit `input`, `step`, `version`, `run`
- `StepApi` mit `run`, `runWorkflow`, `sleep`, `sendSignal`, `waitForSignal`
- `WorkflowRunMetadata` als minimale, stabile Runtime-Metadaten

Für Pibo relevant:

- lieber **kleine, explizite Runtime-APIs** als große kontextuelle Objektgraphen
- Metadaten klein und stabil halten
- dauerhafte Primitive explizit machen

### WorkflowRun

`packages/openworkflow/core/workflow-run.ts`

`WorkflowRun` enthält u. a.:

- Identität: `namespaceId`, `id`, `workflowName`, `version`
- Status: `pending | running | completed | failed | canceled` (+ deprecated states)
- Daten: `config`, `context`, `input`, `output`, `error`
- Retry/Ownership: `attempts`, `workerId`, `availableAt`, `deadlineAt`
- Parenting: `parentStepAttemptNamespaceId`, `parentStepAttemptId`
- Timestamps

Das Modell ist absichtlich knapp. Es enthält **keinen komplexen Graph-State**, sondern nur Run-Lebenszyklus plus grobe Payload-Felder.

### StepAttempt

`packages/openworkflow/core/step-attempt.ts`

`StepAttempt` ist der eigentliche durable Checkpoint:

- `stepName`
- `kind`: `function | sleep | workflow | signal-send | signal-wait`
- `status`: `running | completed | failed`
- `context` für wait-/workflow-spezifische Metadaten
- `output`, `error`
- Child-Linkage für Child-Workflow-Steps

Für Pibo ist das sehr wertvoll: Statt große Snapshots zu persistieren, kann man **kleine durable Ereignis-/Attempt-Einheiten** persistieren.

### Utility Types und Type-Inference

Besonders gelungen:

- `SchemaInput<TSchema, Fallback>`
- `SchemaOutput<TSchema, Fallback>`
- `StandardSchemaV1.InferInput/InferOutput`
- Overloads in `defineWorkflow(...)`
- Trennung zwischen Client-Sicht (`RawInput`) und Handler-Sicht (`Input`)

Das ist für Pibo sehr anschlussfähig, insbesondere wenn Nodes sowohl Text- als auch JSON-Schema-Interfaces bekommen.

## Datenfluss / Execution Flow

### Input-Fluss

1. Client validiert Input gegen `spec.schema` in `client/client.ts`
2. Validierter Input wird in `workflow_runs.input` gespeichert
3. Worker liest Run
4. Workflow-Funktion erhält `workflowRun.input`

### Output-Fluss

1. `step.run(...)` normalisiert Output via `normalizeStepOutput(...)`
2. Output wird im `step_attempt.output` gespeichert
3. Bei Replay wird dieser Output direkt aus Cache zurückgegeben
4. Workflow-Endergebnis wird in `workflow_runs.output` geschrieben

### Replay und Memoization

Kernlogik in `worker/execution.ts` + `worker/step-history.ts`:

- Worker lädt **alle Step-Attempts** eines Runs
- `StepHistory` baut daraus:
  - Success-Cache
  - Running-Map
  - Failed-Count pro Step-Name
  - Failed-Map
- `resolveStepName(...)` erzeugt deterministische Namespaces pro Aufrufposition/Kollision
- `findCached(...)` liefert bereits abgeschlossene Steps sofort
- neue Steps werden persistiert und dann ausgeführt

Wichtiger Punkt: Das ist **kein Graph-Traversal**, sondern **deterministische Neuinterpretation des Programms**.

### Fehlerfluss

Bei Step-Fehlern:

1. `failStepAttempt(...)`
2. `StepHistory.recordFailedAttempt(...)`
3. `StepError` trägt `stepName`, `stepFailedAttempts`, `retryPolicy`
4. `executeWorkflow(...)` entscheidet, ob Reschedule oder terminales Scheitern

Bei Workflow-Fehlern außerhalb von Steps:

- `failWorkflowRun(...)` mit Workflow-Retry-Policy

### Sleep / Parken

`step.sleep(...)`:

- erzeugt Running-Step-Attempt mit `resumeAt`
- wirft intern `SleepSignal`
- `executeWorkflow(...)` fängt das ab
- Backend setzt Run auf `running`, `workerId = null`, `availableAt = resumeAt`

Das ist ein elegantes Muster: **interne Control-Flow-Signale**, aber persistiert und außerhalb sauber behandelt.

### Child-Workflow-Fluss

`step.runWorkflow(...)`:

- validiert Child-Input
- erzeugt Workflow-Step-Attempt
- erstellt Child-Run mit deterministischem Idempotency-Key
- verlinkt Child-Run auf den Step-Attempt
- Parent parkt durably, bis Child terminal ist oder Timeout erreicht
- Child-Ergebnis wird als Output des Parent-Steps persistiert

### Signal-Fluss

`step.waitForSignal(...)` / `sendSignal(...)`:

- wartende Signal-Steps bleiben `running`
- `sendSignal(...)` persistiert Zustellungen in `workflow_signals`
- Workflow wird geweckt, indem `availableAt` auf `NOW()` vorgezogen wird
- Empfänger liest Payload später über `getSignalDelivery(...)`

Wichtig: Signale sind **nicht gepuffert**, wenn noch niemand wartet.

## Retry / Replay / Resume / Persistenz

### Retry-Modell

Zwei getrennte Retry-Ebenen:

1. **Step-Retry**
   - konfiguriert über `step.run({ retryPolicy })`
   - Budget pro `stepName`
   - Default: 10 Versuche
2. **Workflow-Retry**
   - konfiguriert über `workflow.spec.retryPolicy`
   - Default: `maximumAttempts: 1` => faktisch kein automatischer Retry

Sehr gutes Pattern: **Retry-Budgets nicht vermischen**.

### Replay / Resume

Resume ist vollständig replay-basiert:

- kein Interpreter-Snapshot
- kein Serialisieren der JS-Callstack-Struktur
- kein AST-basiertes Rewriting
- nur persistierte Schritte + erneute Ausführung des deterministischen Codes

Für Pibo ist das attraktiv, wenn Runtime-Nodes ebenfalls über kleine durable Operations modelliert werden.

### Persistenzmodell

Drei Kern-Tabellen, siehe `sqlite/sqlite.ts` und `postgres/postgres.ts`:

- `workflow_runs`
- `step_attempts`
- `workflow_signals`

Dazu Indizes für:

- Status + `available_at`
- Idempotency-Lookups
- Parent/Child-Verknüpfungen
- Step-Listen pro Run
- Signal-Waits

Das ist bemerkenswert klein und fokussiert.

### Crash Recovery / Durable Execution

Crash-Recovery beruht auf:

- Claim-Lease über `availableAt`
- Heartbeat über `extendWorkflowRunLease(...)`
- Wiederclaim nach Lease-Ablauf
- Replay aus persistierter Step-Historie

Das ist robust und relativ leicht verständlich.

### Checkpointing

OpenWorkflow hat **kein separates Checkpoint-Objekt**. Der Checkpoint ist implizit die Menge persistierter `step_attempts` plus Run-Zustand. Für Pibo ist das wahrscheinlich besser als ein schweres Snapshot-System für V1.

### Idempotenz

Es gibt mehrere Idempotenzebenen:

- Workflow-Run-Erzeugung via `idempotencyKey`
- Child-Workflow-Erzeugung via internem deterministischem Key `__workflow:...`
- Signal-Senden via internem oder externem Idempotency-Key `__signal:...`

Das ist ein starkes Vorbild für Pibo: **Idempotenz nicht nur am API-Rand, sondern auch für interne Kompositionen**.

## Utilities und Algorithmen

### StepHistory als zentraler Replay-Helper

`worker/step-history.ts`

Sehr gute Kapselung von:

- Schritt-Namensauflösung
- Success-Cache
- Failed-Counts
- Running-Waits
- Earliest-Wakeup-Berechnung
- Step-Limit-Überwachung

Für Pibo wäre ein analoges Objekt sinnvoll, z. B. `NodeHistory` oder `ExecutionLedger`.

### Backoff als pure Funktion

`core/backoff.ts` und `computeFailedWorkflowRunUpdate(...)`

Gutes Pattern:

- Retry-Entscheidung als **pure, testbare Funktion**
- Policy -> nächste Transition
- keine versteckte Logik im Worker-Loop

Das sollten wir für Pibo direkt übernehmen.

### Pagination-Cursor

`core/cursor.ts`

Sauber gelöst:

- Cursor als `{ createdAt, id }`
- Base64-Serialisierung
- `buildPaginatedResponse(...)` kapselt Overfetch + next/prev-Logik

Nicht workflow-kritisch, aber gutes Utility-Design.

### ExecutionFence gegen stale parallel branches

`worker/execution.ts`

Sehr interessantes Detail:

- Parallelbranches via `Promise.all` können nach Park/Finalize noch weiterlaufen
- `ExecutionFence` verhindert dann späte, ungültige Persistenzschreibungen

Das ist für Pibo hochrelevant, sobald parallele Node-Ausführung oder Adapter-Pipelines erlaubt sind.

### Lease- und Wakeup-Algorithmen

Backend-seitig gut gelöst:

- Claim nur für Runs mit `availableAt <= now`
- Parent-Wakeup bei Child-Termination
- Reconciliation direkt nach `sleepWorkflowRun(...)`, um Race Conditions zu schließen
- separate Owned-Where-Conditions für Run/Step-Mutationen

Besonders stark sind die defensiven Race-Fixes in `postgres/backend.ts` und `sqlite/backend.ts`.

## Elegante Coding Patterns

### 1. Durable Kernel + dünne API

Die öffentliche API ist klein, die Haltbarkeit steckt in wenigen, klaren internen Modulen. Für Pibo V1 sollten wir ebenfalls einen kleinen durable Kernel bauen und darauf Graph-/Runtime-Komfort legen.

### 2. Pure Entscheidungsfunktionen

Beispiel: `computeFailedWorkflowRunUpdate(...)`.

Empfehlung für Pibo:

- Retry-Entscheidungen
- Routing-Entscheidungen
- Adapter-Kompatibilitätsprüfungen
- Wakeup-/Schedule-Entscheidungen

als pure Funktionen modellieren.

### 3. Explizite Persistenzprimitive statt Magie

OpenWorkflow versteckt Durable Execution nicht hinter zu viel Magie. Man sieht klar:

- Run
- Step Attempt
- Signal Delivery
- Lease

Das passt gut zu Pibo, wo Agenten- und Tool-Laufzeit ohnehin beobachtbar bleiben sollte.

### 4. Kleine, fokussierte Context-Payloads

Step-Context ist pro Kind unterschiedlich und klein:

- Sleep: `resumeAt`
- Workflow-Wait: `timeoutAt`
- Signal-Wait: `signal`, `timeoutAt`

Für Pibo heißt das: lieber **kleine node-kind-spezifische persisted contexts** statt ein riesiges universelles Blob-Format.

### 5. Deterministische interne Ids/Keys

- Child-Workflow-Idempotency-Key aus Parent-Step
- Signal-Key aus Workflow-Run + Step-Name
- Step-Namens-Kollisionen durch stabile Suffixe

Für Pibo essenziell, wenn Outputs anderer Nodes/Workflows weiterverwendet werden.

### 6. Backward-Compatibility im Modell

Deprecated States (`sleeping`, `succeeded`) werden weiter gelesen und normiert. Gute Praxis für ein Workflow-System, das mit langlebigen Runs umgehen muss.

## Relevanz für Pibo V1

### Was direkt relevant ist

1. **Run/Attempt-basierte Persistenz**
2. **Replay statt schwere Snapshots**
3. **Lease + Heartbeat + Reclaim**
4. **Retry-Policies getrennt nach Ebene**
5. **Child-Workflow-Komposition als first-class Primitive**
6. **Signale/Wakeup als persistierte externe Ereignisse**
7. **kleiner, testbarer durable Core**

### Was nur indirekt passt

OpenWorkflow modelliert Workflows primär als **Code mit durable API-Aufrufen**, nicht als deklarativen Graphen. Pibo braucht zusätzlich:

- deklarative Node-/Edge-Modelle
- Interface-Kompatibilität zwischen Nodes
- Adapter-Nodes/Layers
- graphische/XState-artige Exportform
- Pibo-Runtime als Node-Typ

OpenWorkflow ist also eher Referenz für **Execution Kernel**, nicht für **Workflow-Authoring-Modell**.

## Konkrete Übernahmeempfehlungen

### 1. Für Pibo einen kleinen durable Core definieren

Empfohlene Kernobjekte:

- `WorkflowDefinition`
- `WorkflowRun`
- `NodeExecutionAttempt`
- `WorkflowEvent` oder `SignalDelivery`
- `WorkflowLease`

Nicht zu früh ein riesiges universelles Graph-Objekt bauen.

### 2. Pibo Runtime Node und TS Code Node auf dieselbe durable Attempt-Schicht setzen

Statt Sonderwelten:

- **Pibo Runtime Node** = durable Node-Typ, der eine Pibo Runtime startet/fortsetzt
- **TS Code Node** = durable Node-Typ, der TypeScript-Funktion ausführt
- beide persistieren über denselben Attempt-Mechanismus

So bekommt ihr einheitliche Retry-, Resume- und Tracing-Semantik.

### 3. Interfaces explizit typisieren

Für jede Node und jeden Workflow:

- `inputSchema` oder `inputKind: text|json`
- `outputSchema` oder `outputKind: text|json`
- optional `stateSchema`
- optional `adapterFrom` / `adapterTo`

OpenWorkflows `RawInput -> validated Input` ist hier ein gutes Vorbild.

### 4. Adapter/Layers als explizite Nodes behandeln

Nicht implizit Daten „irgendwie“ konvertieren.

Besser:

- Adapter ist eigener Node-Typ oder expliziter Edge-Transform
- persistiert Input, Output, Fehler, Retry-Zustand
- ist im UI sichtbar

Das passt zu eurem Ziel „inkompatible Interfaces brauchen explizite Adapter/Layers“.

### 5. Global State und Local State trennen

OpenWorkflow hat nur begrenzten Run-/Step-State. Für Pibo sollte es geben:

- **global workflow state** – langlebige, workflowweite Daten
- **local node state** – node-spezifischer Fortschritt / Cursor / Runtime-Metadaten
- **edge payloads** – konkrete transportierte Daten

Diese drei Dinge nicht in ein einziges Blob vermischen.

### 6. Wakeup-/Scheduling-Modell übernehmen

Empfehlung:

- `availableAt`-ähnliches Feld pro Run oder Execution-Slice
- Heartbeats für aktive Runtime-Nodes
- Wakeup bei externem Event, Child-Finish, Timeout, manueller Freigabe

Das ist deutlich einfacher und robuster als aggressive In-Memory-Scheduler.

### 7. Retry-Entscheidungen rein funktional modellieren

Analog zu `computeFailedWorkflowRunUpdate(...)` sollten in Pibo reine Funktionen existieren für:

- Node-Retry
- Workflow-Retry
- Adapter-Retry
- Cancellation-Propagation
- Resume-Strategie nach Crash

### 8. Deterministische Node-Keys pro Ausführungspfad

OpenWorkflow löst Step-Kollisionen über stabile Namen mit Suffixen. Für Pibo sollte jede Node-Ausführung einen stabilen Schlüssel haben, z. B. aus:

- graph path
- node id
- branch/repetition index
- parent execution id

Das ist wichtig für Replay und UI-Traceability.

### 9. XState-Kompatibilität als Projektion, nicht als Primär-Engine

OpenWorkflow zeigt indirekt: interne Durable-Mechanik und externe Darstellungsform sollten getrennt sein.

Für Pibo empfehlenswert:

- **interner durable execution graph** als Primärmodell
- **XState-kompatible Projektion** für Visualisierung, Export, UI-Editing

Nicht XState selbst zum Persistenzkernel machen.

### 10. Früh viele Race-Condition-Tests schreiben

Die Stärke von OpenWorkflow liegt nicht nur im Design, sondern in den vielen Tests zu:

- Parallelität
- Child/Parent-Races
- Timeout-Reihenfolge
- fehlender Definition/Version
- Sleep-Recovery
- Cancellation
- Lease-Reclaim

Für Pibo V1 sollte ein erheblicher Teil des Werts genau in solchen Tests liegen.

## Risiken / Nicht übernehmen

### 1. Nicht das Code-zentrierte Modell 1:1 übernehmen

Pibo braucht deklarative Composability mit Nodes/Edges. Reine „Workflow-Funktion mit Step-API“ reicht dafür nicht.

### 2. Nicht Replay-Kosten unterschätzen

OpenWorkflow akzeptiert Replay-CPU-Kosten. Für Pibo kann das bei langen Agenten- oder Node-Graphen teurer werden, besonders wenn Nodes teure Kontextaufbereitung haben. Pibo sollte daher früh entscheiden, wo Replay genügt und wo kompaktere Node-State-Snapshots nötig sind.

### 3. Keine implizite Parallelität ohne Schutzmechanismen

`ExecutionFence` zeigt, wie schnell parallele durable Ausführung stale writes produziert. Pibo sollte parallele Node-Ausführung nur mit klaren Ownership-/Fence-Regeln erlauben.

### 4. Signale nicht als universelles Message-Bus-Modell missverstehen

OpenWorkflow-Signale sind absichtlich ungebuffert und waitergesteuert. Für Pibo braucht ihr vermutlich zusätzlich dauerhafte Event-/Inbox-Mechanismen für bestimmte Use Cases.

### 5. Keine zu groben Persistenz-Blobs

OpenWorkflow ist stark, weil Run und StepAttempt klar getrennt sind. Für Pibo sollte man vermeiden, alles in einem großen `execution_state_json` zu speichern.

### 6. Keine Vermischung von Node-State und Dataflow-Payload

OpenWorkflow trennt Step-Context, Output und Run-State bereits recht gut. Pibo muss das noch konsequenter tun, weil bei Graphen sonst Debugging und Adapterlogik schnell unübersichtlich werden.

### 7. Versionierung nicht nur auf Workflow-Ebene denken

OpenWorkflow versioniert Workflows über `name + version`. Pibo wird vermutlich zusätzlich brauchen:

- Workflow-Definition-Version
- Node-Typ-Version
- Adapter-Version
- Agent-Profile-/Skill-/Tool-Bundle-Version

## Quellen/Pfade im Repo

Wesentliche Dateien für diese Analyse:

### Architektur / Überblick

- `/root/code/openworkflow/README.md`
- `/root/code/openworkflow/ARCHITECTURE.md`
- `/root/code/openworkflow/package.json`

### Kern-SDK

- `/root/code/openworkflow/packages/openworkflow/index.ts`
- `/root/code/openworkflow/packages/openworkflow/internal.ts`
- `/root/code/openworkflow/packages/openworkflow/client/client.ts`
- `/root/code/openworkflow/packages/openworkflow/core/backend.ts`
- `/root/code/openworkflow/packages/openworkflow/core/workflow-definition.ts`
- `/root/code/openworkflow/packages/openworkflow/core/workflow-function.ts`
- `/root/code/openworkflow/packages/openworkflow/core/workflow-run.ts`
- `/root/code/openworkflow/packages/openworkflow/core/step-attempt.ts`
- `/root/code/openworkflow/packages/openworkflow/core/workflow-registry.ts`
- `/root/code/openworkflow/packages/openworkflow/core/backoff.ts`
- `/root/code/openworkflow/packages/openworkflow/core/cursor.ts`
- `/root/code/openworkflow/packages/openworkflow/core/error.ts`
- `/root/code/openworkflow/packages/openworkflow/core/standard-schema.ts`

### Worker / Execution

- `/root/code/openworkflow/packages/openworkflow/worker/worker.ts`
- `/root/code/openworkflow/packages/openworkflow/worker/execution.ts`
- `/root/code/openworkflow/packages/openworkflow/worker/step-history.ts`

### Persistenz / Backends

- `/root/code/openworkflow/packages/openworkflow/sqlite/backend.ts`
- `/root/code/openworkflow/packages/openworkflow/sqlite/sqlite.ts`
- `/root/code/openworkflow/packages/openworkflow/postgres/backend.ts`
- `/root/code/openworkflow/packages/openworkflow/postgres/postgres.ts`

### CLI / Discovery

- `/root/code/openworkflow/apps/cli/commands.ts`
- `/root/code/openworkflow/openworkflow.config.ts`

### Tests

- `/root/code/openworkflow/packages/openworkflow/worker/execution.test.ts`
- `/root/code/openworkflow/packages/openworkflow/worker/worker.test.ts`
- `/root/code/openworkflow/packages/openworkflow/testing/backend.testsuite.ts`
- `/root/code/openworkflow/packages/openworkflow/postgres/backend.test.ts`
- `/root/code/openworkflow/packages/openworkflow/sqlite/backend.test.ts`

### Beispiele / Docs

- `/root/code/openworkflow/examples/basic/index.ts`
- `/root/code/openworkflow/examples/declare-workflow/index.ts`
- `/root/code/openworkflow/examples/with-schema-validation/*.ts`
- `/root/code/openworkflow/apps/docs/docs/workflows.mdx`
- `/root/code/openworkflow/apps/docs/docs/steps.mdx`
- `/root/code/openworkflow/apps/docs/docs/retries.mdx`
- `/root/code/openworkflow/apps/docs/docs/parallel-steps.mdx`
- `/root/code/openworkflow/apps/docs/docs/signals.mdx`
- `/root/code/openworkflow/apps/docs/docs/child-workflows.mdx`
- `/root/code/openworkflow/apps/docs/docs/versioning.mdx`
- `/root/code/openworkflow/apps/docs/docs/canceling.mdx`

## Abschließende Einschätzung

OpenWorkflow ist für Pibo V1 vor allem eine **sehr gute Referenz für den durable Ausführungskern**, nicht für das vollständige Workflow-Definitionsmodell. Die stärksten übernehmbaren Ideen sind:

- Replay über kleine durable Attempts
- Lease/Heartbeat/Reclaim
- pure Retry-/Failure-Entscheidungen
- Parent/Child-Komposition mit Wakeup
- deterministische Schlüssel und Idempotenz
- harte Tests für Races und Resume-Pfade

Die wichtigsten Ergänzungen, die Pibo selbst liefern muss, sind:

- deklarative Graphstruktur mit Nodes/Edges
- Pibo Runtime als Node-Typ
- TS Code Nodes
- explizite Adapter zwischen inkompatiblen Interfaces
- globaler Workflow-State + lokaler Node-State
- XState-kompatible Projektion für UI/Visualisierung

Wenn Pibo diese zusätzlichen Ebenen **auf einen ähnlich kleinen und robusten durable Kern** setzt, ist OpenWorkflow eine starke technische Referenz.