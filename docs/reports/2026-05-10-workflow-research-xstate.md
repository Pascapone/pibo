---
type: "Research"
title: "XState-Analyse für Pibo Workflow V1"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/2026-05-10-workflow-research-xstate.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "b8d2c12e0d56b235f55733e79d08641c900ed0c6"
  source_bytes: 27740
  source_sha256: "9e3c47ed1cfec1ec45980b9fce8330dc103a255cb830fe30754d66cca8cd50b0"
  source_body_sha256: "9e3c47ed1cfec1ec45980b9fce8330dc103a255cb830fe30754d66cca8cd50b0"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# XState-Analyse für Pibo Workflow V1

Datum: 2026-05-10

## Executive Summary

XState ist im analysierten Repo kein reiner FSM-Baukasten mehr, sondern ein recht vollständiger Actor-Orchestrator mit drei klar getrennten Ebenen:

1. **statische Machine-Definition** (`createMachine`, `StateNode`, `StateMachine`)
2. **laufende Actor-Ausführung** (`createActor`, `Actor`, `ActorSystem`, Scheduler, Mailbox)
3. **Analyse/Visualisierung/Traversal** (`inspection`, `graph`, JSON-Definitionen, `machine.schema.json`)

Für Pibo Workflow V1 ist die wichtigste Erkenntnis: **XState ist stark als Runtime für eventgetriebene Orchestrierung, Human-Waiting, Guards, Delays, Child-Actors und UI-Projektion**. Es ist aber **nicht** die richtige kanonische Durable-Workflow-IR für Pibo. Seine Runtime ist prozesslokal, Event-/Timer-orientiert und nur begrenzt auf langlebige Resume-/Replay-Semantik ausgelegt. Persistenz ist vorhanden, aber eher als **Snapshot/Rehydration** als als vollwertiger durable execution log.

Empfehlung: **Pibo behält ein eigenes Workflow-IR und einen eigenen Runtime-Kernel.** XState sollte als:

- Orchestrierungs-Engine für interaktive/laufende Execution,
- Projektionsformat für Editor/Visualizer,
- Typ-/Guard-/Action-Host,
- Actor-Modell für Child-Runtimes und Human-in-the-loop

verwendet werden.

Nicht empfehlenswert ist, Pibo-Workflows 1:1 als native XState-Machines zu modellieren und XState-Snapshots als einziges Persistenzmodell zu behandeln.

---

## Projektüberblick

### Repo-Struktur

Root unter `/root/code/xstate`:

- Monorepo mit `pnpm-workspace.yaml`
- Root-README als Produktübersicht
- `packages/` für Core und Framework-Bindings
- `examples/` mit vielen Workflow-Beispielen
- `templates/` für Startprojekte
- `scripts/` für Repo-Hilfsskripte
- `.changeset/` für Release-Management

### Wichtige Packages

Unter `packages/`:

- `core` → Kernbibliothek `xstate`
- `xstate-react`, `xstate-vue`, `xstate-svelte`, `xstate-solid` → UI-Bindings
- `xstate-store` und Bindings → kleinerer Store-Ansatz neben Statecharts
- `xstate-inspect` → Inspect/Visualizer-Utilities
- `xstate-immer` → Immer-Integration

Für Pibo fast alles Relevante liegt in **`packages/core/src`**.

### Build/Test-Setup

Quellen:

- `/root/code/xstate/package.json`
- `/root/code/xstate/tsconfig.json`
- `/root/code/xstate/vitest.workspace.json`
- `/root/code/xstate/packages/core/vitest.config.mts`

Beobachtungen:

- Build via **Preconstruct** (`preconstruct build`)
- Package-Management via **pnpm**
- Tests via **Vitest**
- Strict TS-Konfiguration, `moduleResolution: nodenext`, `strict: true`
- Core nutzt `happy-dom` gezielt für Fehler-/Global-Error-Tests
- Exports sind fein granular: `xstate`, `xstate/actions`, `xstate/actors`, `xstate/guards`, `xstate/graph`, `xstate/dev`

Für Pibo wichtig: das Repo trennt die API-Surface sauber nach Themen. Das spricht für ein ähnliches Pibo-Design: **Kernel / actions / actors / graph / inspect** statt einer einzigen großen API.

---

## Architektur und Modulstruktur

### Zentrale Core-Module

Unter `/root/code/xstate/packages/core/src`:

- `createMachine.ts` → stark generische Fabrik
- `StateMachine.ts` → Runtime-unabhängige Machine-Logik
- `StateNode.ts` → rekursive Struktur, Definition, invoke/after/on/always-Aufbereitung
- `State.ts` → Snapshot-Typen, `matches`, `hasTag`, Persistierung
- `createActor.ts` → laufender Actor inkl. Mailbox, Observer, Stop/Start, Inspection
- `system.ts` → Actor-System, Registry, Scheduler, Inspection-Fanout
- `stateUtils.ts` → Kernalgorithmik für Transition-Selektion, Exit/Entry, Microsteps/Macrosteps
- `transition.ts` → pure Hilfen für `transition`, `initialTransition`, `getMicrosteps`
- `setup.ts` → typsichere Setup-API
- `actions/*` → builtin actions
- `actors/*` → Promise-, Callback-, Observable-, Transition-Actor-Logiken
- `graph/*` → Traversal, Testmodell, Pfad-/Graph-Hilfen
- `inspection.ts` → Inspection-Event-Typen

### Grobe Schichten

1. **Definitionsebene**: `createMachine`, `StateNodeConfig`, `InvokeConfig`, `TransitionConfig`
2. **Kompilierung/Aufbereitung**: `StateNode._initialize()`, `formatTransitions`, `getDelayedTransitions`, `formatRouteTransitions`
3. **Pure Ausführung**: `StateMachine.transition`, `macrostep`, `microstep`, `resolveActionsAndContext`
4. **Runtime/Effects**: `Actor`, `ActorSystem`, Scheduler, Mailbox, `actionExecutor`
5. **Inspection/Projection**: `toJSON`, `definition`, `inspection`, `graph`

Das ist für Pibo sehr lehrreich: **Definition, pure Semantik und laufende Runtime sind getrennt, aber nicht perfekt entkoppelt**. Pibo sollte diese Trennung noch strikter machen.

---

## Kern-Datentypen und Interfaces

Wichtige Typquellen:

- `/root/code/xstate/packages/core/src/types.ts`
- `/root/code/xstate/packages/core/src/State.ts`
- `/root/code/xstate/packages/core/src/StateNode.ts`

### Snapshot

`SnapshotStatus = 'active' | 'done' | 'error' | 'stopped'`

Machine-Snapshots enthalten u. a.:

- `value` → State-Value-Shape
- `context`
- `children`
- `historyValue`
- `tags`
- `status`
- `output`
- `error`
- `_nodes`
- Methoden `matches`, `hasTag`, `can`, `getMeta`, `toJSON`

Wichtig für Pibo: XState-Snapshots mischen **fachliche Sicht** und **interne Runtime-Sicht** (`_nodes`, `children`, history intern). Für Pibo sollte es daher mindestens drei Ebenen geben:

- kanonischer Workflow-State
- Runtime-Execution-State
- UI/Inspector-Projection

### MachineConfig / StateNodeConfig

`StateNodeConfig` erlaubt u. a.:

- `initial`
- `type` (`atomic`, `compound`, `parallel`, `final`, `history`)
- `states`
- `invoke`
- `on`
- `entry` / `exit`
- `onDone`
- `after`
- `always`
- `meta`
- `output`
- `tags`
- `description`
- `route`

Für Pibo relevant:

- `description`, `tags`, `meta`, `id` sind nützlich für UI/Editor/Docs
- `invoke` + `input`/`onDone`/`onError`/`onSnapshot` sind ein starkes Orchestrierungsmodell
- `parallel` und `history` sind formale Statechart-Werkzeuge, nicht automatisch ideale Workflow-Primitive

### ActorLogic

`ActorLogic` ist der zentrale abstrakte Vertrag:

- `transition(snapshot, event, actorScope)`
- `getInitialSnapshot(actorScope, input)`
- optional `restoreSnapshot(...)`
- optional `start(...)`
- `getPersistedSnapshot(...)`

Das ist für Pibo extrem wertvoll: **jede Runtime-Einheit kann als ActorLogic-artige Logik beschrieben werden**, unabhängig davon, ob sie Maschine, Promise, Callback oder eigener Kernel-Adapter ist.

---

## Execution Model / Actor System

### Actor als laufender Prozess

Quelle: `/root/code/xstate/packages/core/src/createActor.ts`

`Actor<TLogic>` kapselt:

- aktuelles Snapshot
- Mailbox
- Observer
- Event-Listener für emittierte Events
- Parent-Referenz
- System-Zugehörigkeit
- Start/Stop-Logik
- Persist/Restore

Wichtig:

- `createActor(logic)` erzeugt implizit ein `ActorSystem`, falls kein Parent existiert
- Child-Actors hängen im selben System
- `sessionId` ist global im System, `id` ist parent-relativ

### Mailbox / Queue

Quelle: `/root/code/xstate/packages/core/src/Mailbox.ts`

Die Mailbox ist eine einfache FIFO-Struktur:

- `enqueue(event)` hängt ans Ende
- `start()` aktiviert Flush
- `flush()` verarbeitet synchron solange Elemente da sind

Das deutet auf ein **synchrones, in-memory, single-threaded Event-Queue-Modell**.

### Scheduler

Quelle: `/root/code/xstate/packages/core/src/system.ts`

Der Scheduler hält `_scheduledEvents` und nutzt `clock.setTimeout` / `clearTimeout`.

Das ist funktional für Delays und After-Transitions, aber nicht durable. Timer werden nur über Snapshot-Rehydration erneut geplant.

### Microsteps und Macrosteps

Quellen:

- `/root/code/xstate/packages/core/src/stateUtils.ts`
- `/root/code/xstate/packages/core/src/transition.ts`
- `/root/code/xstate/packages/core/test/microstep.test.ts`

`macrostep(...)` verarbeitet:

1. externe Eventannahme
2. Transition-Selektion
3. Exit/Entry/Actions
4. interne Queue (`raise`, done-events, after-events etc.)
5. eventless transitions (`always`)
6. wiederholt Microsteps bis stabile Konfiguration erreicht ist

`getMicrosteps()` und `machine.microstep()` erlauben reine Analyse des inneren Ablaufs.

Für Pibo ist das sehr nützlich als Denkmodell:

- **Macrostep** = eine Workflow-Reaktion auf ein externes Signal
- **Microsteps** = interne Ableitungen, automatische Kaskaden, Child-Done, Wait-State-Auflösung

### Transition-Selektion und Ordnung

Indizien aus:

- `stateUtils.ts`
- `test/order.test.ts`
- `test/microstep.test.ts`
- `getNextTransitions()` in `transition.ts`

Merkmale:

- atomare States zuerst
- dann Vorfahren
- Dokumentreihenfolge ist relevant (`order`)
- eventless und delayed transitions werden in dieselbe Semantik eingespeist
- interne Queue wahrt Reihenfolge raised events / done events

Für Pibo ist das wichtig, wenn ein eigener Kernel gebaut wird: **Ordering muss explizit spezifiziert werden**, sonst werden Human-Loop-, Retry- und Fan-out-Szenarien unklar.

---

## Guards / Actions / Context / Events

### Context

`assign(...)` in `/root/code/xstate/packages/core/src/actions/assign.ts`:

- arbeitet deklarativ, nicht imperativ
- baut partielles Context-Update
- kann gleichzeitig Child-Actors über `spawn` erzeugen
- erzeugt neues Snapshot via `cloneMachineSnapshot`

Punkt für Pibo: **Context-Updates sind im Kern reine Daten-Transformationen**. Das sollte Pibo übernehmen.

### Actions

Builtin-Actions u. a.:

- `assign`
- `raise`
- `sendTo`, `sendParent`, `forwardTo`
- `spawnChild`, `stopChild`
- `emit`
- `cancel`
- `log`
- `enqueueActions`

XState trennt intern oft:

- **resolve phase** → berechne nächste State-/Effect-Daten
- **execute phase** → führe Side-Effects via `actorScope.defer()` aus

Das ist ein sehr gutes Muster für Pibo:

- erst deterministisch berechnen
- dann Effects ausführen
- Outgoing Events erst nach State-Update senden

### Guards

Quellen:

- `/root/code/xstate/packages/core/src/guards.ts`
- `/root/code/xstate/packages/core/test/setup.types.test.ts`

Guards können sein:

- inline Funktion
- benannter Guard via `setup({ guards })`
- parametrisiert `{ type, params }`
- Komposition via `and`, `or`, `not`, `stateIn`

Für Pibo sehr brauchbar:

- parametrisierte Guards sind editorfreundlich
- benannte Guards erleichtern IR-Stabilität
- reine Inline-Funktionen sind gut für Code-Nodes, aber schlecht für Visual/Portable IR

### Events

XState ist strikt eventobjekt-basiert. String-Events als direkte Inputs sind in v5 bewusst unerwünscht.

Interne Eventtypen umfassen u. a.:

- `xstate.init`
- `xstate.done.state.*`
- `xstate.done.actor.*`
- `xstate.error.actor.*`
- `xstate.snapshot.*`
- After-Events
- Raised Events

Für Pibo: ein eigener Event-Namespace für Kernel-/Systemevents ist sinnvoll. XState zeigt gut, dass dies früh nötig wird.

---

## Actors / Invocations / Parent-Child Flow

### Invoke und Spawn

Wichtige Quellen:

- `/root/code/xstate/packages/core/src/StateNode.ts`
- `/root/code/xstate/packages/core/src/stateUtils.ts`
- `/root/code/xstate/packages/core/src/actions/spawnChild.ts`
- `/root/code/xstate/packages/core/src/actions/stopChild.ts`
- `/root/code/xstate/packages/core/test/invoke.test.ts`

XState kennt zwei nahe verwandte Muster:

1. **invoke** → an State-Lebenszyklus gekoppelt
2. **spawnChild / spawn(...)** → explizit und freier

`invoke` startet beim Enter des States und stoppt beim Exit. Das passt sehr gut zu:

- temporären Tasks
- Human-Waits
- Child-Subflows
- IO-Integrationen

`spawnChild` ist besser für langlebigere Children im Context.

Für Pibo:

- **Nested Workflow Node** ähnelt eher `invoke`
- **Pibo Runtime als Child-Agent** kann je nach Lebensdauer `invoke` oder `spawn` entsprechen

### Actor-Typen

Quellen:

- `/root/code/xstate/packages/core/src/actors/promise.ts`
- `/root/code/xstate/packages/core/src/actors/callback.ts`
- `/root/code/xstate/packages/core/src/actors/observable.ts`
- `/root/code/xstate/packages/core/src/actors/transition.ts`

#### `fromPromise`

- Input möglich
- Abschluss erzeugt `done`
- Fehler erzeugt `error`
- Stop nutzt `AbortController`
- Persistiert nur Snapshot, nicht Promise-Fortschritt

#### `fromCallback`

- sehr frei
- kann `receive`, `sendBack`, `emit`
- Cleanup-Funktion beim Stop
- kein echtes `onDone`
- Snapshot weniger bedeutend

#### `fromObservable` / `fromEventObservable`

- streamen Werte oder Events
- halten Subscription intern
- Subscription wird bei Persistenz nicht mitgespeichert
- bei Restore wird Subscription neu aufgebaut

#### `fromTransition`

- kleinster reducer-artiger Actor
- gute Blaupause für einfache Nodes oder Stores

### Parent-Child-Kommunikation

Mittel:

- `sendParent`
- `sendTo(childId, event)`
- `onDone`, `onError`, `onSnapshot`
- `emit`

Done/Error/Snapshot-Events werden über systematische Eventnamen modelliert. Das ist für Pibo interessant, aber vermutlich sollte Pibo semantischere Domänen-Events definieren, z. B.:

- `workflow.child.done`
- `runtime.child.output`
- `human.task.completed`
- `adapter.output.ready`

statt XState-Namen direkt nach außen durchzureichen.

---

## Persistence / Restore / Snapshots

### Snapshot vs Persisted Snapshot

Quellen:

- `/root/code/xstate/packages/core/src/createActor.ts`
- `/root/code/xstate/packages/core/src/State.ts`
- `/root/code/xstate/packages/core/src/StateMachine.ts`
- `/root/code/xstate/packages/core/test/rehydration.test.ts`

XState unterscheidet klar:

- `getSnapshot()` → letztes emittiertes Laufzeitbild
- `getPersistedSnapshot()` → internes persistierbares Wiederanlaufbild

Das ist wichtig und richtig.

### Was persistiert wird

Bei Machine-Snapshots u. a.:

- `value`
- `context`
- `children` inkl. deren persistierten Snapshots
- `historyValue` in serialisierter Form
- Status-/Output-/Error-Daten
- Scheduler-Snapshot auf Systemebene für Delays

Nicht einfach persistierbar:

- Inline-Child-Actors ohne opt-in (`__unsafeAllowInlineActors`)
- aktive JS-Closure-Zustände
- laufende Promise/Observable-Substrukturen selbst

### Restore-Semantik

`restoreSnapshot(...)`:

- rekonstruiert Child-Actors
- rekonstruiert History-Nodes
- ersetzt Actor-Referenz-Platzhalter im Context
- **führt Actions nicht neu aus**

Tests in `rehydration.test.ts` bestätigen explizit:

- Aktionen werden beim Rehydrate nicht erneut abgespielt
- `hasTag` und `can` funktionieren direkt
- Child-Actors können nach Restore sauber weiterlaufen/gestoppt werden

### Kompatibilitätsgrenzen

Diese Persistenz ist nützlich, aber begrenzt:

- kein Commit-Log als Quelle der Wahrheit
- keine garantierte Cross-Version-Migration außer implizit
- kein deterministisches Replay externer IO
- laufende Side-Effects werden nicht „durable“

Für Pibo heißt das: **XState-Snapshots sind gut als Cache/Resume-Hilfe, aber nicht als primäres Durable-Execution-Modell.**

---

## Visualization / Inspection / UI Editing

### Inspection API

Quellen:

- `/root/code/xstate/packages/core/src/inspection.ts`
- `/root/code/xstate/packages/core/test/inspect.test.ts`
- `/root/code/xstate/packages/xstate-inspect/*`

Inspection-Events umfassen:

- `@xstate.actor`
- `@xstate.event`
- `@xstate.snapshot`
- `@xstate.microstep`
- `@xstate.action`

Das ist für Pibo Gold wert. Ein Workflow-UI braucht fast genau diese Projektionen:

- welche Runtime/Node existiert?
- welches Event lief wohin?
- welches Snapshot entstand?
- welche Microsteps passierten?
- welche Action wurde ausgeführt?

Empfehlung: Pibo sollte ein **eigenes Inspection/Event-Protokoll** bauen, das von XState inspiriert ist, aber Pibo-Terme nutzt.

### Machine-Definition als JSON/Projection

Quellen:

- `/root/code/xstate/packages/core/src/StateNode.ts`
- `/root/code/xstate/packages/core/src/machine.schema.json`

`StateNode.definition` und `toJSON()` liefern strukturierte Definitionen mit:

- IDs
- Typ
- States
- Transitions
- Entry/Exit
- Invoke
- Meta
- Tags
- Description

`machine.schema.json` deutet zusätzlich auf einen serialisierbaren Maschinen-Shape hin. Das ist nicht das gesamte Typ-/Runtime-Modell, aber eine brauchbare Editor-/Interop-Schicht.

### Graph / Explorer Support

Quellen:

- `/root/code/xstate/packages/core/src/graph/*`

Es gibt:

- Directed Graph Projection (`toDirectedGraph`)
- Pfadberechnung
- Shortest/Simple Paths
- Event-basierte Traversal-Hilfen
- `TestModel`

Für Pibo ist das relevant für:

- Editor-Layout/Graphanzeige
- Reachability/Dead-end-Checks
- Test-/Simulation-Generierung
- Design-Review-Tools

---

## Retry / Replay / Resume / Durable Kernel Integration

### Was XState selbst bietet

- Reaktion auf Fehler via `onError`
- Delays/After
- erneutes Enter/Invoke als Retry-Muster
- Snapshot-Persistenz und Rehydration
- `waitFor(...)` für externe Warte-APIs

### Was XState nicht vollständig löst

- durable command log
- deterministisches Replay von Side-Effects
- idempotente Recovery über Prozess-/Maschinengrenzen
- versionierte Workflow-Migrationen
- langlaufende Human Tasks mit garantierter Resume-Semantik
- Backoff-/Retry-Policies als langlebige Systemprimitive

### Empfehlung für Pibo-Durable-Kernel

Pibo sollte:

1. **eigenen Event-/Command-Log** haben
2. **eigene durable Timer** haben
3. **XState nur aus dem Kernel-State projizieren** oder als ausführende Overlay-Runtime betreiben
4. IO/Tool/Agent-Aufrufe als **journalisierte Commands** behandeln
5. Outputs/Done/Error von Children als **Kernel-Events** materialisieren
6. XState-Snapshot höchstens als **beschleunigte Resume-Projection** verwenden

Kurz: **Kernel first, XState second.**

---

## TypeScript API Patterns

### `createMachine(...)`

Quelle: `/root/code/xstate/packages/core/src/createMachine.ts`

Stark generisch, aber relativ schwergewichtig. Unterstützt:

- `types`-Block
- `schemas`-Block
- Implementierungen via zweitem Argument (deprecated zugunsten `setup`/`provide`)

### `setup(...)`

Quelle: `/root/code/xstate/packages/core/src/setup.ts`

Das modernere Muster. Es erlaubt:

- `types`
- `actors`
- `actions`
- `guards`
- `delays`
- `createMachine`
- `createStateConfig`
- `createAction`
- `extend(...)`

Das ist vermutlich die wichtigste TS-Lehre für Pibo.

**Gute Idee für Pibo:**

- ein `defineWorkflow()` / `setupWorkflow()`-Layer
- getrennt von `createRuntime()` / `executeWorkflow()`
- benannte Actor-/Action-/Guard-/Adapter-Registry pro Workflow-Scope

### Typinferenz-Muster

Tests in `setup.types.test.ts`, `spawn.types.test.ts`, `input.test.ts` zeigen:

- Input-Typen werden bis in Child-Actors propagiert
- Event-Typen werden präzise inferiert
- benannte Guards/Actions mit Params sind typisiert
- `ActorRefFrom`, `SnapshotFrom`, `EventFromLogic`, `InputFrom`, `OutputFrom`, `EmittedFrom` sind zentrale Utility-Types

Für Pibo sollte es analoge Utility-Types geben:

- `WorkflowInputFrom<T>`
- `WorkflowOutputFrom<T>`
- `NodeInputFrom<T>`
- `NodeOutputFrom<T>`
- `RuntimeEventFrom<T>`
- `ProjectionSnapshotFrom<T>`

### Typing-Fazit

XState zeigt, dass sehr gute Inferenz möglich ist, aber auf Kosten hoher Typkomplexität. Für Pibo sollte der öffentliche Typ-Layer **schlanker** sein als XState intern.

---

## Elegante Coding Patterns

1. **Trennung von pure transition und effect execution**  
   sichtbar in `resolve`/`execute`-Mustern bei Actions.

2. **ActorLogic als gemeinsamer Minimalkontrakt**  
   Maschinen, Promises, Observables und Reducer teilen denselben Vertrag.

3. **`setup(...)` als Typscope**  
   bessere Lesbarkeit und Inferenz als alles in `createMachine` zu stopfen.

4. **Inspection als first-class API**  
   nicht nur Devtool-Hack, sondern expliziter Eventstrom.

5. **Snapshot vs persisted snapshot trennen**  
   sehr wichtig für Resume-Systeme.

6. **Definition/`toJSON()`/Graph-Projektionen**  
   gut für UI, Docs, Tests, Explorer.

7. **`input` und `output` explizit modellieren**  
   sehr passend für Pibo-Workflow-Schnittstellen.

8. **`onSnapshot` als Child-Projection-Hook**  
   gutes Vorbild für Live-UI-Projektion von Child-Runtimes.

---

## Relevanz für Pibo Workflow V1

### Was sehr gut passt

- Actor-Modell für Pibo Runtimes und Nested Workflows
- `invoke`-Semantik für Node-Lebenszyklen
- `input`/`output`-Typing
- Guard/Action/Delay-Konzept
- Parallel- und Final-State-Modell für Orchestrierung
- Inspection und Visualisierung
- State-Metadaten (`description`, `tags`, `meta`)
- Child done/error/snapshot flow

### Was nur teilweise passt

- globaler Workflow-State vs XState-`context`
- lokaler Node-State vs XState-Statechart-Hierarchie
- Edge-Payloads: XState hat Events und Child IO, aber keine explizite Edge-Objektschicht
- Adapter/Layers bei Interface-Mismatch müssen bei Pibo expliziter sein als in XState

### Was nicht als Primärmodell passt

- Durable Execution
- Persistenz über Jahre/Versionen/Deployments
- deterministisches Replay externer Agent-/Tool-Aufrufe
- Workflow-IR als reine Statechart-Definition

---

## Konkrete Design-Änderungsvorschläge für Pibo

### 1. Eigenes IR strikt von XState trennen

Pibo sollte dokumentieren:

- **Pibo Workflow IR** ist kanonisch
- **XState Machine** ist eine optionale Projektion / Ausführungsrepräsentation
- nicht jedes Pibo-Konstrukt muss 1:1 auf einen XState-State gemappt werden

### 2. Drei Zustandsarten explizit machen

In den Pibo-Design-Dokumenten klar trennen:

- **global workflow state**
- **node local state**
- **edge payload / transfer state**

XState hat primär `context` + Events + Child-Snapshots. Pibo braucht feinere Begriffe.

### 3. Pibo Runtime als Actor definieren

Eine Pibo Runtime sollte formal ungefähr folgende Oberfläche haben:

- input
- output
- snapshot
- send(event)
- inspect(event)
- persist()
- restore()
- stop()/cancel()

Damit kann sie intern XState-ähnlich oder XState-basiert laufen.

### 4. Node-Typen explizit unterscheiden

Empfohlene Pibo-IR-Node-Typen:

- `runtime` node
- `code` node
- `workflow` node
- optional `adapter` node / `transform` node
- optional `human` node / `wait` node

Nicht alles als „state“ formulieren.

### 5. Human-in-the-loop als first-class Kernel-Konstrukt

Nicht nur als Callback-Actor nachbauen. Besser:

- durable wait token
- assigned human task
- resume event
- timeout/escalation path
- UI projection

XState hilft bei Orchestrierung, aber Pibo sollte die Persistenz dafür selbst besitzen.

### 6. Retry/Backoff/Compensation im Kernel definieren

Nicht nur mit `after` + `onError` modellieren. Pibo sollte Policies nativ haben:

- retry count
- backoff strategy
- jitter
- retryable vs terminal errors
- compensation hooks

### 7. UI-Projektion bewusst gestalten

Pibo sollte ein eigenes Projection-Modell definieren, inspiriert von XState Inspection:

- actor/node created
- event sent
- transition taken
- snapshot updated
- action executed
- child output received
- waiting state entered/exited
- human task created/completed

### 8. Typ-API nach `setup(...)`-Vorbild

Empfehlung:

- `setupWorkflow({ types, nodes, guards, actions, adapters })`
- `defineWorkflow(...)`
- `provideWorkflow(...)`
- Utility-Types für Input/Output/Event/Snapshot

### 9. XState nur für geeignete Teilmengen projizieren

Gute Zielmengen für XState-Projektion:

- interaktive Orchestrierung
- Nested workflow execution
- UI/editor visualization
- simulation/test pathing
- local waiting logic

Nicht gute Zielmengen:

- dauerhafte Kernel-Wahrheit
- versionierte Recovery-Semantik
- komplette Agent-Execution-Historie

---

## Risiken / Nicht übernehmen

1. **Typkomplexität explodiert schnell.**  
   XState v5 ist stark typisiert, aber intern sehr schwergewichtig.

2. **Statechart-Hierarchie ist nicht automatisch der beste Workflow-IR.**  
   Gerade Edge-Payloads und Adapter sind darin nicht erstklassig.

3. **Persistenz ist Snapshot-basiert, nicht log-basiert.**

4. **Observable/Promise/Callback-Actors sind nicht durable by design.**

5. **Inline-Funktionen schaden Portabilität und Editierbarkeit.**  
   Für Pibo-UI/Specs sollten benannte Guards/Actions/Adapters bevorzugt werden.

6. **Zu viel XState-Semantik würde Pibo unnötig verkomplizieren.**  
   History States, tiefe Parallel-Hierarchien, SCXML-Nähe und interne Eventtypen sind mächtig, aber teuer.

7. **Root-Context als Sammelbecken vermeiden.**  
   Pibo sollte globale, lokale und Transfer-Daten sauber trennen.

---

## Quellen/Pfade im Repo

### Root / Build / Workspace

- `/root/code/xstate/package.json`
- `/root/code/xstate/tsconfig.json`
- `/root/code/xstate/pnpm-workspace.yaml`
- `/root/code/xstate/vitest.workspace.json`
- `/root/code/xstate/README.md`

### Core API / Runtime

- `/root/code/xstate/packages/core/src/index.ts`
- `/root/code/xstate/packages/core/src/createMachine.ts`
- `/root/code/xstate/packages/core/src/setup.ts`
- `/root/code/xstate/packages/core/src/StateMachine.ts`
- `/root/code/xstate/packages/core/src/StateNode.ts`
- `/root/code/xstate/packages/core/src/State.ts`
- `/root/code/xstate/packages/core/src/createActor.ts`
- `/root/code/xstate/packages/core/src/system.ts`
- `/root/code/xstate/packages/core/src/Mailbox.ts`
- `/root/code/xstate/packages/core/src/stateUtils.ts`
- `/root/code/xstate/packages/core/src/transition.ts`
- `/root/code/xstate/packages/core/src/types.ts`

### Actions / Guards / Actors

- `/root/code/xstate/packages/core/src/actions/assign.ts`
- `/root/code/xstate/packages/core/src/actions/send.ts`
- `/root/code/xstate/packages/core/src/actions/spawnChild.ts`
- `/root/code/xstate/packages/core/src/actions/stopChild.ts`
- `/root/code/xstate/packages/core/src/actions/enqueueActions.ts`
- `/root/code/xstate/packages/core/src/guards.ts`
- `/root/code/xstate/packages/core/src/actors/promise.ts`
- `/root/code/xstate/packages/core/src/actors/callback.ts`
- `/root/code/xstate/packages/core/src/actors/observable.ts`
- `/root/code/xstate/packages/core/src/actors/transition.ts`

### Inspection / Graph / Schema

- `/root/code/xstate/packages/core/src/inspection.ts`
- `/root/code/xstate/packages/core/src/machine.schema.json`
- `/root/code/xstate/packages/core/src/graph/index.ts`
- `/root/code/xstate/packages/core/src/graph/graph.ts`
- `/root/code/xstate/packages/xstate-inspect/README.md`
- `/root/code/xstate/packages/xstate-inspect/src/index.ts`
- `/root/code/xstate/packages/xstate-inspect/src/inspectMachine.ts`

### Tests

- `/root/code/xstate/packages/core/test/rehydration.test.ts`
- `/root/code/xstate/packages/core/test/microstep.test.ts`
- `/root/code/xstate/packages/core/test/order.test.ts`
- `/root/code/xstate/packages/core/test/invoke.test.ts`
- `/root/code/xstate/packages/core/test/inspect.test.ts`
- `/root/code/xstate/packages/core/test/activities.test.ts`
- `/root/code/xstate/packages/core/test/errors.test.ts`
- `/root/code/xstate/packages/core/test/setup.types.test.ts`
- `/root/code/xstate/packages/core/test/spawn.types.test.ts`
- `/root/code/xstate/packages/core/test/input.test.ts`

### Beispiele

- `/root/code/xstate/examples/workflow-async-subflow/main.ts`
- `/root/code/xstate/examples/workflow-parallel/main.ts`
- `/root/code/xstate/examples/workflow-event-based/main.ts`
- `/root/code/xstate/examples/workflow-media-scanner/src/mediaScannerMachine.ts`

---

## Schlussfazit

XState ist für Pibo Workflow V1 **sehr wertvoll als Orchestrierungs- und Projektions-Engine**, aber **nicht** als alleinige Workflow-Wahrheit.

Die beste strategische Nutzung ist:

- **Pibo IR** = kanonisches Workflow-Modell
- **Pibo Kernel** = durable execution, retry, resume, persistence, agent/tool journaling
- **XState Projection/Runtime Layer** = lokale Orchestrierung, Child-Actors, Guards, Waiting, Visualization, Editing, Simulation

Wenn Pibo diese Trennung sauber hält, kann XState maximal helfen, ohne das Framework unnötig schwer oder semantisch unscharf zu machen.
