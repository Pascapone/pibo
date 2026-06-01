# Design: Extensible Ralph Stop Conditions

## Context

Ralph is a Pibo product-loop feature. It creates routed Pibo Sessions, sends service-authored work prompts, records run state, and decides whether to start another run. Stop decisions must therefore stay at the Pibo product boundary.

Pi Coding Agent extensions are still useful. They can observe model turns, tool calls, messages, and runtime-specific events that Ralph should not infer from transcripts. The design uses Pi extensions as signal producers and Pibo stop conditions as policy evaluators.

## Goals / Non-Goals

### Goals

- Preserve current Ralph stop behavior by default.
- Let Pibo plugins register stop-condition types.
- Let users attach registered conditions to individual Ralph jobs.
- Let several conditions run together and compose deterministically.
- Let conditions keep durable state.
- Let runtime extensions emit scoped run facts.
- Make every stop decision auditable in Chat Web, CLI, and tests.

### Non-Goals

- Browser-uploaded executable code.
- Direct Pi-extension control over Ralph lifecycle.
- A full workflow/rules engine.
- Cross-gateway distributed lock semantics beyond the current single-store behavior.

## Decisions

### Decision: Stop-condition registration belongs to the Pibo plugin registry

- **Choice:** Add Ralph stop-condition registration to `PiboPluginApi` and `PiboPluginRegistry`.
- **Rationale:** Ralph is a Pibo channel/service. Plugins already register product-boundary capabilities such as profiles, gateway actions, channels, web apps, and event listeners.
- **Alternatives considered:**
  - Load conditions only from Pi extensions. Rejected because Pi extensions do not own durable Ralph jobs or owner-scoped policy.
  - Hardcode more condition types in Ralph. Rejected because the feature goal is extensibility.

Illustrative type shape:

```ts
export type PiboRalphStopConditionDefinition = {
  type: string;
  name: string;
  description?: string;
  phases: readonly PiboRalphStopConditionPhase[];
  optionsSchema?: unknown;
  defaultOptions?: PiboJsonObject;
  timeoutMs?: number;
  failClosedDefault?: boolean;
  evaluate(context: PiboRalphStopConditionContext): Promise<PiboRalphStopConditionDecision> | PiboRalphStopConditionDecision;
};

export type PiboRalphStopConditionPhase = "before-run" | "after-run";
```

### Decision: Jobs store a policy JSON object

- **Choice:** Add `stop_policy_json` to Ralph jobs and expose `stopPolicy` in job payloads.
- **Rationale:** Runtime overrides already use JSON to avoid schema churn. Stop policies will evolve and need nested configuration.
- **Alternatives considered:**
  - One SQL table per condition instance. Rejected for V1 because it adds migration complexity without current query needs.
  - Encode conditions in the prompt. Rejected because stop policy must be auditable and enforceable outside the model.

Illustrative policy:

```ts
export type PiboRalphStopPolicy = {
  mode: "any" | "all";
  conditions: PiboRalphStopConditionInstance[];
};

export type PiboRalphStopConditionInstance = {
  id: string;
  type: string;
  enabled?: boolean;
  options?: PiboJsonObject;
  failClosed?: boolean;
  timeoutMs?: number;
};
```

### Decision: Existing behavior becomes built-in conditions

- **Choice:** Implement current `maxIterations` and `<promise>COMPLETE</promise>` checks as built-in registered conditions.
- **Rationale:** Built-ins should exercise the same path as custom conditions. That prevents duplicate logic and makes compatibility testable.
- **Alternatives considered:**
  - Keep built-ins hardcoded and add custom checks after them. Rejected because composition and diagnostics would split across two systems.

Built-in condition types:

```text
pibo.ralph.max-iterations
pibo.ralph.promise-complete
```

Manual stop and cancel remain control-plane actions in V1. They should appear in diagnostics, but they do not need to become normal policy conditions initially.

### Decision: Evaluate before-run and after-run phases

- **Choice:** Conditions declare supported phases. Ralph evaluates before-run conditions before session creation and after-run conditions after the run settles.
- **Rationale:** Some conditions prevent wasted runs. Others require final answer, status, or facts from the run.
- **Alternatives considered:**
  - Only evaluate after runs. Rejected because max-iteration blocking already happens before reservation.
  - Evaluate continuously during a run. Deferred. V1 can request cancel only at defined checkpoints.

Phase context examples:

```ts
export type PiboRalphStopConditionContext = {
  phase: "before-run" | "after-run";
  job: PiboRalphJob;
  policy: PiboRalphStopPolicy;
  instance: PiboRalphStopConditionInstance;
  state: PiboJsonObject;
  now: string;
  run?: PiboRalphRun;
  outcome?: PiboRalphRunOutcome;
  facts: PiboRalphFactReader;
  signal?: AbortSignal;
};
```

### Decision: Conditions return normalized decisions

- **Choice:** Every evaluator returns a normalized decision with action, reason, details, and next state.
- **Rationale:** The Ralph service and UI need a stable contract independent of plugin implementation details.

Illustrative decision:

```ts
export type PiboRalphStopConditionDecision = {
  action: "continue" | "stop-after-run" | "cancel-current-run";
  reason?: string;
  details?: PiboJsonObject;
  nextState?: PiboJsonObject;
};
```

The evaluator wraps thrown errors, timeouts, invalid return values, and skipped conditions into evaluation diagnostics.

### Decision: Composition is `any` or `all` in V1

- **Choice:** Support `any` and `all` policy modes.
- **Rationale:** This covers common combinations while keeping UX and test behavior understandable.
- **Alternatives considered:**
  - Nested boolean trees. Deferred until users need them.
  - Priority-based rules. Rejected for V1 because they are harder to explain.

Severity order:

```text
cancel-current-run > stop-after-run > continue
```

For `any`, the final decision uses the highest severity returned by any enabled condition. For `all`, all enabled conditions must return at least `stop-after-run` to stop after a completed run. If any enabled condition returns continue, the final decision is continue.

### Decision: Per-condition state is stored under job state

- **Choice:** Add a condition-state object keyed by condition instance id to Ralph job state.
- **Rationale:** Stateful conditions need counters and previous observations. Keeping state next to job state makes completion updates atomic.
- **Alternatives considered:**
  - Store condition state in separate SQL rows. Deferred until querying condition state independently becomes necessary.

Illustrative state extension:

```ts
export type PiboRalphJobState = {
  // existing fields
  conditionStates?: Record<string, PiboJsonObject>;
  lastStopEvaluation?: PiboRalphStopEvaluationSummary;
};
```

### Decision: Run facts are product records, not transcript parsing

- **Choice:** Add a Ralph run-fact model and store.
- **Rationale:** Conditions should evaluate normalized facts, not parse assistant text or terminal output for every custom use case.
- **Alternatives considered:**
  - Parse transcripts and tool output. Rejected because it is fragile and expensive.
  - Let every condition read arbitrary files directly. Allowed for trusted custom code, but not as the primary integration path.

Illustrative fact:

```ts
export type PiboRalphRunFact = {
  id: string;
  ownerScope: string;
  jobId: string;
  runId?: string;
  piboSessionId?: string;
  type: string;
  source: "pibo" | "pi-extension" | "tool" | "plugin";
  payload: PiboJsonObject;
  createdAt: string;
};
```

### Decision: Pi extensions emit facts through a constrained bridge

- **Choice:** Provide a Ralph fact bridge only for Ralph sessions. The bridge can append facts but cannot edit jobs.
- **Rationale:** This uses Pi's event visibility without moving lifecycle authority into Pi.
- **Alternatives considered:**
  - Give extensions a `stopRalph()` API. Rejected because it bypasses owner policy, audit, and composition.

Possible bridge implementations:

1. A generated Pibo native/runtime tool that writes a fact.
2. A Pibo-owned Pi extension factory injected for Ralph sessions that listens to a shared event bus.
3. Product events emitted from `PiboPluginApi.emitProductEvent()` and consumed by Ralph.

Implementation can choose the smallest reliable path. The behavior contract is that facts become durable, scoped, and visible to stop-condition evaluators.

### Decision: User-authored condition code is trusted-local

- **Choice:** Support custom condition code only through operator-registered trusted sources.
- **Rationale:** Condition evaluators execute in the gateway process and can inspect local state. They must be treated as trusted code.
- **Alternatives considered:**
  - Browser-uploaded JavaScript. Rejected for security.
  - Pure declarative expression language. Useful later, but not enough for arbitrary project logic.

Open implementation choice:

- Reuse the existing Pi Package store and extend package metadata with Pibo condition resources.
- Add a separate `pibo plugins` or `pibo ralph conditions sources` store for trusted local condition modules.

The spec requires the trust boundary and operator-controlled loading. It does not require choosing the storage mechanism before implementation planning.

## Proposed Flow

### Gateway startup

1. Pibo creates the plugin registry.
2. Built-in Ralph plugin registers built-in stop conditions.
3. Additional trusted plugin/condition sources register custom condition types.
4. The condition catalog becomes available to channels, APIs, and CLI.

### Job edit

1. User opens Ralph job editor.
2. UI fetches jobs and condition catalog.
3. User adds condition instances and saves policy.
4. API validates owner scope, mode, instance ids, known types, and option schemas.
5. Store persists `stop_policy_json`.

### Scheduler before-run check

1. Ralph identifies an enabled due job.
2. Evaluator builds effective policy.
3. Evaluator runs before-run conditions.
4. If final decision is continue, Ralph reserves/starts a run.
5. If final decision stops, Ralph disables or marks the job without creating a session.

### Run completion check

1. Ralph receives final run outcome.
2. Facts for the run are available through the fact reader.
3. Evaluator runs after-run conditions.
4. Store persists run status, condition state updates, evaluation diagnostics, and enabled/disabled state.
5. Chat Web and CLI can explain the result.

## Data Model Changes

### Ralph jobs

Add columns if using the existing single-table shape:

```sql
ALTER TABLE pibo_ralph_jobs ADD COLUMN stop_policy_json TEXT;
```

Continue accepting `max_iterations` during migration. The effective default policy maps `max_iterations` into the built-in max condition when no explicit policy exists.

### Ralph job state

Extend `state_json`:

```ts
conditionStates?: Record<string, PiboJsonObject>;
lastStopEvaluation?: {
  id: string;
  phase: "before-run" | "after-run";
  at: string;
  finalAction: "continue" | "stop-after-run" | "cancel-current-run";
  reason?: string;
  decisions: PiboRalphStopConditionEvaluation[];
  diagnostics: PiboRalphStopConditionDiagnostic[];
};
```

### Ralph run facts

Add a table or store area:

```sql
CREATE TABLE pibo_ralph_run_facts (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  job_id TEXT NOT NULL,
  run_id TEXT,
  pibo_session_id TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Indexes:

```sql
CREATE INDEX idx_pibo_ralph_facts_job_created ON pibo_ralph_run_facts(job_id, created_at DESC);
CREATE INDEX idx_pibo_ralph_facts_run_type ON pibo_ralph_run_facts(run_id, type, created_at DESC);
```

## API Design

### Condition catalog

```http
GET /api/chat/ralph/conditions
```

Returns registered types available in the current gateway.

### Job policy

Existing create/edit endpoints include `stopPolicy`.

Policy mutations must keep the same same-origin JSON requirements as other Ralph mutations.

### Run facts

Run facts do not need a public browser creation API in V1. Facts should be emitted through trusted product/runtime paths. Browser UI may read facts through job/run detail endpoints if useful for diagnostics.

## CLI Design

Keep CLI discovery progressive.

Possible commands:

```text
pibo ralph conditions
pibo ralph policy show <job-id> --json
pibo ralph policy set <job-id> --file policy.json
pibo ralph policy clear <job-id>
pibo ralph runs --json    # includes evaluation summary when present
```

If a separate trusted source store is added:

```text
pibo ralph conditions sources
pibo ralph conditions add-source <path-or-package>
pibo ralph conditions doctor
```

## UI Design

Add a **Stop Conditions** section to `RalphArea` job editing.

Recommended UI:

- policy mode selector: `Any condition stops` / `All conditions must stop`
- condition list in evaluation order
- add-condition dropdown from catalog
- enabled toggle
- remove button
- reorder controls
- option editor generated from schema for simple fields
- raw JSON option editor fallback
- latest evaluation summary near run history

The promise-complete token should remain visible when the built-in promise-complete condition is enabled.

## Risks / Trade-offs

- **Trusted code risk:** Custom condition modules run in the gateway process. Mitigation: operator-only registration, no browser uploads, explicit docs.
- **Evaluator latency:** Slow conditions can block scheduling. Mitigation: timeouts and diagnostics.
- **Schema drift:** Plugins can change option schemas. Mitigation: validate on edit, tolerate legacy stored options with diagnostics on evaluation.
- **Policy confusion:** Multiple conditions can be hard to understand. Mitigation: simple `any`/`all`, evaluation summaries, stable ordering.
- **Fact volume:** Facts can grow. Mitigation: retention policy and payload size limits.

## Migration / Rollback

### Migration

- Add `stop_policy_json` as nullable.
- Existing jobs with null policy use effective default policy.
- Keep `max_iterations` field for compatibility and CLI/API continuity.
- Store built-in condition diagnostics without requiring users to edit old jobs.

### Rollback

- Existing hardcoded behavior can be restored while leaving nullable policy/fact columns unused.
- Jobs without explicit policies continue to have `max_iterations`.
- Explicit custom policies may be ignored by old code; UI should warn before downgrading if needed.

## Open Questions

- Should custom condition sources be modeled as Pibo plugins, Pi Packages with Pibo resources, or a new Ralph-specific source store?
- Should before-run stops create a run record with status such as `skipped`, or only update job state?
- What default timeout should evaluators use?
- How much condition state and fact payload data should be allowed per job?
- Should policy option schemas use TypeBox to match native tool patterns or plain JSON Schema for web rendering?
