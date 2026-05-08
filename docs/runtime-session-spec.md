# Runtime Session Spec: Stateful Python and Node Execution

Status: design spec / implementation planning
Date: 2026-05-08
Owner area: Pibo product boundary, native tools, routed sessions
Related specs: `docs/terminal-pty-session-spec.md`

## 1. Purpose

Pibo should provide agents with persistent, stateful runtime sessions for code execution. The first supported runtimes should be Python and Node.js.

The feature solves a common agent failure mode: agents repeatedly run large one-off Bash snippets such as `python - <<'PY' ... PY` or `node - <<'JS' ... JS`. When a later line fails, the agent often has to resend and rerun the whole script, even though the first part succeeded and created useful variables, loaded models, opened database connections, or discovered partial state.

A runtime session should behave more like a notebook kernel or REPL-backed workspace:

- variables persist across calls
- imports persist
- loaded models and objects remain in memory
- database connections can stay open while debugging
- the agent can inspect objects, functions, modules, signatures, and available attributes
- a failed later command does not destroy earlier successful state
- the agent can close the session when finished, releasing memory

This spec intentionally separates structured runtime sessions from terminal PTY sessions. Runtime sessions are for reliable stateful code execution with structured results. Terminal PTY sessions are for shells, Docker/SSH terminals, TUIs, and interactive CLIs; see `docs/terminal-pty-session-spec.md`.

## 2. Problem statement

Today agents often use one-shot shell execution for exploratory code:

```bash
python - <<'PY'
import sqlite3
import pandas as pd
conn = sqlite3.connect('app.db')
df = pd.read_sql('select * from users', conn)
# many more lines...
print(df.groupby('missing_column').size())
PY
```

If line 41 fails because `missing_column` does not exist, the process exits and all useful state is gone:

- `conn` is closed or lost
- `df` is gone
- imported libraries are gone
- expensive setup must run again
- the model may rewrite large code blocks and introduce new mistakes

Desired flow:

1. Start a Python runtime once.
2. Execute setup code.
3. If later code fails, keep previous state.
4. Inspect `df.columns`, `dir(obj)`, `inspect.signature(fn)`, etc.
5. Continue from the existing state.
6. Close the runtime when finished.

The same applies to Node.js:

- imported modules remain loaded
- variables remain available
- async calls can be tested incrementally
- objects/functions can be inspected

## 3. Product goals

### 3.1 Must-have goals

1. Provide one native tool, recommended name `runtime`, for both Python and Node.js sessions.
2. Support `start`, `exec`, `inspect`, `vars`, `interrupt`, `close`, and `list` actions.
3. Preserve runtime state across `exec` calls.
4. Support per-execution auto-close-on-success behavior for one-shot work with recovery after failure.
5. Return structured results: stdout, stderr, result/repr, errors, traceback/stack, duration.
6. Support Python first and Node.js second under the same tool shape.
7. Be extensible to future runtimes without redesigning the tool API.
8. Scope sessions to the owning Pibo Session by default.
9. Provide cleanup controls so memory does not remain loaded indefinitely.
10. Avoid PTY prompt heuristics for normal runtime execution.
11. Give agents clear instructions on when to use `runtime` instead of one-shot Bash or `terminal`.

### 3.2 Should-have goals

1. Support `venv`, custom Python executable, and custom Node executable.
2. Support Docker/container target later via non-PTY stdin/stdout transport.
3. Capture rich object summaries for common Python objects such as pandas DataFrames.
4. Support async JavaScript with top-level `await`.
5. Support expression evaluation with a distinct returned result.
6. Support session history and optional reproducibility export.
7. Support idle timeout and max-memory hints.
8. Surface active runtime sessions in Chat Web traces/UI.

### 3.3 Non-goals for MVP

1. Full Jupyter protocol compatibility.
2. Browser-rendered notebooks.
3. Rich MIME display as a first requirement.
4. Perfect sandboxing beyond existing Pibo execution policy.
5. Long-lived runtime survival across gateway restarts.
6. Multi-agent shared runtime sessions.
7. Replacing terminal PTY sessions for Docker/SSH/TUI work.

## 4. Tool design

Preferred native tool name: `runtime`.

The tool should be action-based, with a common API for all supported runtimes.

### 4.1 Actions

MVP actions:

- `start`
- `exec`
- `inspect`
- `vars`
- `interrupt`
- `close`
- `list`

Later actions:

- `reset`
- `history`
- `export`
- `install`
- `complete`
- `help`
- `snapshot`

### 4.2 Runtime identifiers

Initial supported values:

```ts
type RuntimeKind = "python" | "node";
```

Future values could include:

- `ruby`
- `r`
- `deno`
- `bun`
- `sqlite`
- `duckdb`
- `browser-js`
- `java-jshell`

The tool shape should not assume Python-only behavior, even though Python is the first implementation priority.

## 5. Common API shape

### 5.1 `start`

Starts a persistent runtime process.

```ts
type RuntimeStartInput = {
  action: "start";
  runtime: "python" | "node";
  cwd?: string;
  env?: Record<string, string>;
  name?: string;
  executable?: string;
  args?: string[];
  target?: RuntimeTarget;
  idleTimeoutMs?: number;
  overallTimeoutMs?: number;
  memoryLimitMb?: number;
};
```

Output:

```ts
type RuntimeStartResult = {
  status: "running" | "failed";
  sessionId?: string;
  runtime: RuntimeKind;
  name?: string;
  pid?: number;
  cwd?: string;
  executable?: string;
  startedAt: string;
  message: string;
  warnings?: string[];
};
```

Notes:

- `executable` selects `python`, `.venv/bin/python`, `node`, etc.
- If omitted, Python uses `python3` or configured default; Node uses `node`.
- `target` is optional and can be local-only in MVP.

### 5.2 `exec`

Executes code inside an existing runtime session.

```ts
type RuntimeExecInput = {
  action: "exec";
  sessionId: string;
  code: string;
  timeoutMs?: number;
  mode?: "exec" | "eval" | "auto";
  closeOnSuccess?: boolean;
};
```

Output:

```ts
type RuntimeExecResult = {
  status: "ok" | "error" | "interrupted" | "timeout" | "not_found";
  sessionId: string;
  runtime: RuntimeKind;
  stdout: string;
  stderr: string;
  result?: RuntimeValueSummary;
  error?: RuntimeErrorSummary;
  durationMs: number;
  executionCount?: number;
  autoClosed?: boolean;
};
```

`mode` behavior:

- `exec`: run as statements, return no expression result unless backend extracts one.
- `eval`: evaluate as expression and return result.
- `auto`: try expression if code looks expression-like; otherwise execute as statements. MVP can default to `exec` for predictability and add `auto` later.

`closeOnSuccess` behavior:

- `closeOnSuccess` is an execution-level flag, not a session-level mode.
- If `closeOnSuccess: true` and the execution returns `status: "ok"`, the runtime closes immediately after captured output and result data are returned. The result should set `autoClosed: true`.
- If the execution returns `status: "error"`, `"timeout"`, or `"interrupted"`, the runtime remains available when the worker process is still healthy. State created before the failure remains available according to the runtime language's normal semantics.
- Agents can set `closeOnSuccess: true` on any `exec`, including an intentionally persistent session or a session that previously failed while using `closeOnSuccess`.
- This flag is intended for one-shot exploratory code: successful runs clean up automatically; failed runs become resumable debugging sessions instead of forcing the agent to rerun the whole script through Bash.

### 5.3 `inspect`

Inspects an expression/object in the runtime session.

```ts
type RuntimeInspectInput = {
  action: "inspect";
  sessionId: string;
  expression: string;
  detail?: "summary" | "signature" | "members" | "source" | "doc" | "all";
  maxBytes?: number;
};
```

Output:

```ts
type RuntimeInspectResult = {
  status: "ok" | "error" | "not_found";
  sessionId: string;
  expression: string;
  summary?: RuntimeValueSummary;
  signature?: string;
  members?: string[];
  source?: string;
  doc?: string;
  error?: RuntimeErrorSummary;
  truncated?: boolean;
};
```

### 5.4 `vars`

Lists user-visible variables in the session.

```ts
type RuntimeVarsInput = {
  action: "vars";
  sessionId: string;
  includePrivate?: boolean;
  maxItems?: number;
};
```

Output:

```ts
type RuntimeVarsResult = {
  status: "ok" | "not_found";
  sessionId: string;
  variables: Array<{
    name: string;
    type?: string;
    repr?: string;
    size?: string;
  }>;
  truncated?: boolean;
};
```

### 5.5 `interrupt`

Interrupts currently running code without closing the session if possible.

```ts
type RuntimeInterruptInput = {
  action: "interrupt";
  sessionId: string;
};
```

Implementation depends on backend:

- Python local process: send SIGINT on Unix; Windows best-effort.
- Node local process: send SIGINT or backend-specific cancel message if idle loop supports it.
- If interrupt fails, the tool should recommend `close`.

### 5.6 `close`

Closes the runtime process and releases memory.

```ts
type RuntimeCloseInput = {
  action: "close";
  sessionId: string;
  force?: boolean;
};
```

### 5.7 `list`

Lists sessions owned by the current Pibo Session.

```ts
type RuntimeListInput = {
  action: "list";
  runtime?: RuntimeKind;
  includeClosed?: boolean;
};
```

## 6. Common data types

### 6.1 Value summary

```ts
type RuntimeValueSummary = {
  type: string;
  repr: string;
  length?: number;
  shape?: number[];
  columns?: string[];
  keys?: string[];
  preview?: string;
  truncated?: boolean;
};
```

For Python:

- `type`: `module.ClassName` or built-in type name
- `repr`: safe bounded `repr(value)`
- pandas DataFrame: include `shape`, `columns`, and bounded `head()` preview
- dict: include keys
- list/tuple/set: include length and bounded preview

For Node:

- `type`: result of `typeof`, constructor name, or tag
- `repr`: `util.inspect(value, { depth, maxArrayLength })`
- arrays: include length
- objects: include keys
- functions: include name and approximate signature/source preview

### 6.2 Error summary

```ts
type RuntimeErrorSummary = {
  name: string;
  message: string;
  line?: number;
  column?: number;
  traceback?: string;
  stack?: string;
};
```

Python returns `traceback`; Node returns `stack`. When possible, both runtimes should also return the failing line and column in `line` and `column` so the agent can continue from the failure point.

## 7. Backend architecture

The runtime tool should route to pluggable backends.

```ts
interface RuntimeBackend {
  kind: RuntimeKind;
  start(options: RuntimeStartOptions): Promise<RuntimeSessionHandle>;
  exec(session: RuntimeSessionHandle, input: RuntimeExecInput): Promise<RuntimeExecResult>;
  inspect(session: RuntimeSessionHandle, input: RuntimeInspectInput): Promise<RuntimeInspectResult>;
  vars(session: RuntimeSessionHandle, input: RuntimeVarsInput): Promise<RuntimeVarsResult>;
  interrupt(session: RuntimeSessionHandle): Promise<void>;
  close(session: RuntimeSessionHandle, force?: boolean): Promise<void>;
}
```

A central `RuntimeSessionRegistry` owns sessions and dispatches by `sessionId`.

```ts
type RuntimeSessionRecord = {
  id: string;
  ownerPiboSessionId: string;
  runtime: RuntimeKind;
  name?: string;
  cwd?: string;
  executable?: string;
  pid?: number;
  status: "starting" | "running" | "busy" | "idle" | "closed" | "failed";
  startedAt: string;
  updatedAt: string;
  lastExecAt?: string;
  executionCount: number;
  backendState: unknown;
  history: RuntimeHistoryEntry[];
};
```

MVP registry can be in-memory. Later, metadata/history can be persisted while live processes remain ephemeral.

## 8. Python backend design

### 8.1 Recommended MVP approach

Use a long-running Python worker process communicating with Pibo over JSON lines on stdin/stdout.

Do **not** use a PTY for the Python runtime MVP.

Reasons:

- structured messages are easier to parse
- stdout/stderr can be captured separately per execution
- no prompt detection
- multi-line code is reliable
- inspect operations can return structured data
- interruptions/timeouts can be handled at process level

### 8.2 Python worker behavior

The worker maintains a persistent globals dictionary:

```python
user_globals = {
    "__name__": "__pibo_runtime__",
}
```

For each request:

1. read one JSON line from stdin
2. dispatch by request type
3. capture stdout/stderr using `contextlib.redirect_stdout` and `redirect_stderr`
4. execute/evaluate code against `user_globals`
5. return one JSON response line

### 8.3 Python execution semantics

For `mode: "exec"`:

- compile code with `compile(code, '<pibo-runtime>', 'exec')`
- execute with `exec(compiled, user_globals, user_globals)`
- preserve mutations even if later statements fail, according to Python semantics: statements before the exception remain applied

For `mode: "eval"`:

- compile with `eval`
- evaluate and return value summary

For `mode: "auto"` later:

- try `eval` first for expression-like code
- fall back to `exec`
- avoid surprising double side effects by compiling, not executing twice when possible

### 8.4 Python inspection

The Python worker should implement internal helpers:

```python
inspect_value(expression, detail)
list_vars(include_private)
summarize_value(value)
```

Use standard library modules:

- `inspect`
- `traceback`
- `io`
- `contextlib`
- `types`

For value summaries:

- Always bound `repr` length.
- Catch exceptions from user-defined `__repr__`.
- Detect pandas DataFrame/Series if pandas is installed without requiring pandas as a worker dependency.
- For functions/classes, include signature when possible.
- For modules, include module name and file if available.

### 8.5 Python request/response sketch

Request:

```json
{"id":"req_1","type":"exec","mode":"exec","code":"import pandas as pd\nx = 1"}
```

Response:

```json
{
  "id": "req_1",
  "status": "ok",
  "stdout": "",
  "stderr": "",
  "result": null,
  "error": null
}
```

Error response:

```json
{
  "id": "req_2",
  "status": "error",
  "stdout": "",
  "stderr": "",
  "error": {
    "name": "KeyError",
    "message": "'missing_column'",
    "traceback": "Traceback ..."
  }
}
```

### 8.6 Python environment selection

Start options should allow:

- default `python3`
- explicit executable path, e.g. `.venv/bin/python`
- explicit env overrides
- cwd

Examples:

```json
{
  "action": "start",
  "runtime": "python",
  "executable": ".venv/bin/python",
  "cwd": "/repo"
}
```

For Docker later:

```json
{
  "action": "start",
  "runtime": "python",
  "target": {
    "type": "docker",
    "container": "app",
    "cwd": "/app",
    "executable": "python"
  }
}
```

The Docker backend can run a non-PTY command like:

```bash
docker exec -i -w /app app python /tmp/pibo_python_worker.py
```

Structured runtime communication should prefer pipes, not `docker exec -t`.

## 9. Node.js backend design

### 9.1 Recommended MVP approach

Use a long-running Node worker process communicating with Pibo over JSON lines on stdin/stdout.

The worker maintains a persistent execution context.

Possible implementation choices:

1. `node:vm` context
2. direct async function wrapper with a persistent global object
3. Node REPL internals

Recommendation for MVP: use `node:vm` with a persistent context and support top-level `await` by wrapping code when needed.

### 9.2 Node execution semantics

For `mode: "exec"`:

- execute code in the persistent context
- capture `console.log`, `console.error`, and process stdout/stderr writes where practical
- return no result unless the backend can safely detect a final expression

For `mode: "eval"`:

- evaluate expression/script and return `util.inspect` summary
- support promises by awaiting returned thenables

For `mode: "auto"` later:

- attempt expression handling carefully
- avoid executing code twice

### 9.3 Node inspection

Use standard modules:

- `util.inspect`
- reflection APIs such as `Object.keys`, `Object.getOwnPropertyNames`, `Reflect.ownKeys`

Inspection details:

- `summary`: type, constructor name, bounded inspect output
- `members`: own property names and selected prototype members
- `source`: bounded `Function.prototype.toString()` for functions/classes
- `signature`: best-effort extraction from function source; not guaranteed
- `doc`: usually unavailable unless object carries docs

### 9.4 Node async support

Agents often need to call async APIs. The Node backend should support:

```js
const data = await fs.promises.readFile('file.txt', 'utf8')
```

Implementation can wrap code in an async function or use `vm.SourceTextModule` depending on complexity. MVP can document limitations if top-level await is not ready immediately, but it is a high-value feature.

### 9.5 Node environment selection

Start options:

- default `node`
- explicit executable path
- cwd
- env
- extra args such as `--loader`, `--require`, or `--experimental-*` only if allowed by policy

Example:

```json
{
  "action": "start",
  "runtime": "node",
  "cwd": "/repo",
  "args": ["--conditions=development"]
}
```

## 10. Target abstraction

Runtime sessions should eventually support targets:

```ts
type RuntimeTarget =
  | { type: "local" }
  | { type: "docker"; container: string; cwd?: string; user?: string }
  | { type: "ssh"; host: string; user?: string; port?: number; cwd?: string };
```

MVP can implement only local target.

Important distinction:

- Runtime target uses structured pipes and worker protocol.
- Terminal target uses PTY semantics.

For Docker runtime, prefer `docker exec -i`, not `-t`.

For SSH runtime, prefer a command that starts the worker over stdin/stdout, but bootstrapping a worker file remotely is more complex and should be later.

## 11. Session history and reproducibility

Runtime sessions are stateful, which is powerful but can hurt reproducibility.

The registry should keep a bounded history:

```ts
type RuntimeHistoryEntry = {
  executionCount: number;
  startedAt: string;
  durationMs: number;
  codePreview: string;
  status: "ok" | "error" | "interrupted" | "timeout";
  stdoutPreview?: string;
  stderrPreview?: string;
  errorName?: string;
  errorMessage?: string;
};
```

Future `history` action can return this. Future `export` action can concatenate successful code cells for reproduction.

MVP can store history internally and expose it later.

## 12. Agent guidance

The runtime tool should be described to agents as:

Use `runtime` when:

- exploring Python/Node code incrementally
- loading data/models once and reusing them
- debugging after partial success
- inspecting objects/functions/modules
- needing persistent variables
- running one-shot exploratory code with `closeOnSuccess: true`, so success cleans up and failure keeps useful state for repair

Use normal Bash when:

- running a simple deterministic command
- invoking a test runner once
- installing packages
- executing a script from scratch

Use `terminal` when:

- you need a shell with persistent shell state
- you need Docker/SSH interactive access
- the program requires a TTY
- you are operating a TUI or interactive CLI

Do not use `runtime` for unbounded daemons or long-running services unless the tool supports background execution later.

## 13. Safety, policy, and isolation

Runtime sessions execute arbitrary code. Treat them like shell execution with persistent memory.

Requirements:

1. The tool must be profile-selectable.
2. Execution must be scoped to the owning Pibo Session.
3. Runtime processes must terminate when the owning session is disposed unless configured otherwise.
4. Environment and cwd handling should follow Pibo policy.
5. Docker/SSH targets should be separately policy-gated.
6. Output and variable reprs can contain secrets; do not expose across owner scopes.
7. Idle timeout should prevent forgotten sessions from holding memory forever.
8. Large outputs should be truncated.
9. Dangerous env overrides may need filtering like host exec.

## 14. Lifecycle and cleanup

Session states:

- `starting`
- `idle`
- `busy`
- `closed`
- `failed`

Default lifecycle:

1. `start` spawns worker and waits for ready handshake.
2. Session becomes `idle`.
3. `exec` transitions to `busy`, then back to `idle` or `failed` depending on process health.
4. Code-level exceptions do not close the session.
5. If `exec` uses `closeOnSuccess: true` and returns `status: "ok"`, the runtime closes automatically and marks `closed` after returning stdout, stderr, result data, and metadata.
6. If `exec` uses `closeOnSuccess: true` and returns an error, timeout, or interrupt, the runtime remains open when possible so the agent can inspect state and continue from the failure.
7. Worker protocol/process errors may mark session `failed`.
8. `close` terminates worker and marks `closed`.

Recommended defaults:

- idle timeout: 30-60 minutes or configurable
- max output per execution: e.g. 256 KB initially
- max repr length: e.g. 8-32 KB
- max history entries: e.g. 100
- per-exec default timeout: optional; be careful because legitimate data work can take time

## 15. Interrupts and timeouts

Interrupting running code is difficult with a single worker thread/process.

### Python

Options:

- Send SIGINT to the Python process on Unix.
- If the worker is executing Python code, KeyboardInterrupt may be raised.
- If native extension code blocks, SIGINT may not stop immediately.
- If interrupt fails, close/kill process.

### Node

Options:

- Send SIGINT to the process.
- Use worker threads for each execution in future, but that complicates persistent shared state.
- Use VM timeout for synchronous scripts where available, but async operations need separate handling.
- If interrupt fails, close/kill process.

MVP stance:

- Provide `interrupt` best-effort.
- Provide `close(force: true)` as reliable fallback.

## 16. Failure modes and mitigations

### 16.1 State pollution

Problem: The agent may forget that variables were changed.

Mitigations:

- `vars` action.
- session names.
- execution count.
- optional `reset` later.
- encourage closing and restarting for clean work.

### 16.2 Memory leaks

Problem: Large models/DataFrames remain loaded.

Mitigations:

- idle timeout.
- `close` action.
- optional memory limit.
- show age/idle time in `list`.

### 16.3 Non-reproducibility

Problem: Results depend on hidden session history.

Mitigations:

- bounded history.
- future `export` action.
- trace all code snippets in Pibo event log.

### 16.4 Hanging code

Problem: Infinite loops or blocking calls.

Mitigations:

- per-exec timeout option.
- interrupt.
- force close.
- visible busy status.
- `closeOnSuccess` must not close on timeout; it should leave the session available if the worker can recover.

### 16.5 Huge output

Problem: A loop prints too much.

Mitigations:

- output cap per exec.
- truncation flag.
- optional process interrupt on excessive output.

### 16.6 Serialization errors

Problem: Some objects cannot be represented safely.

Mitigations:

- return bounded safe `repr`/`inspect`.
- catch repr/inspection exceptions.
- never require JSON-serializing arbitrary user objects directly.

### 16.7 Worker protocol desync

Problem: User code writes arbitrary bytes to stdout, which could mix with JSON protocol.

Mitigation:

- The worker should reserve stdout for protocol and redirect user stdout to captured buffers during execution.
- Consider sending protocol over an extra fd if needed later.
- For Node, avoid letting user code write protocol-looking lines directly to stdout during capture.

## 17. Implementation plan

Treat `runtime` as a built-in Pibo tool: Pibo owns the catalog entry, execution policy, session registry, worker processes, lifecycle cleanup, and profile exposure. Pi Coding Agent should only see a normal `ToolDefinition`. Do not implement this as an external MCP server, provider-hosted tool, or raw Pi built-in.

### Phase 0: Development setup and scope lock

1. Work inside a Docker compute worker before changing code:
   - run `pibo compute spawn`
   - use the returned worker worktree for edits and tests
   - release with `pibo compute release <id>` after validation
2. Keep the MVP local-only:
   - Python runtime: implement now
   - Node runtime: keep interfaces ready, implement in Phase 3
   - Docker/SSH targets: type-shape only, no behavior yet
3. Define the built-in Pibo tool contract:
   - tool name: `runtime`
   - catalog owner: `pibo.core`
   - profile selection: through normal Pibo profile/native-tool selection
   - runtime binding: created per Pibo runtime/session so owner scope is known
   - yieldable: yes, unless later policy says otherwise

### Phase 1: Core type model

Create `src/tools/runtime/types.ts`.

Define exported types matching this spec:

- `RuntimeKind = "python" | "node"`
- `RuntimeAction = "start" | "exec" | "inspect" | "vars" | "interrupt" | "close" | "list"`
- `RuntimeTarget`
- action input types:
  - `RuntimeStartInput`
  - `RuntimeExecInput` with `closeOnSuccess?: boolean`
  - `RuntimeInspectInput`
  - `RuntimeVarsInput`
  - `RuntimeInterruptInput`
  - `RuntimeCloseInput`
  - `RuntimeListInput`
- result types:
  - `RuntimeStartResult`
  - `RuntimeExecResult` with `autoClosed?: boolean`
  - `RuntimeInspectResult`
  - `RuntimeVarsResult`
  - close/list/interrupt result types
- shared summaries:
  - `RuntimeValueSummary`
  - `RuntimeErrorSummary` with `line?: number` and `column?: number`
  - `RuntimeHistoryEntry`
  - `RuntimeSessionRecord`
  - `RuntimeBackend`

Add narrow runtime status strings:

```ts
type RuntimeSessionStatus = "starting" | "idle" | "busy" | "closed" | "failed";
```

Implementation notes:

- Keep input/result types JSON-serializable.
- Do not expose process handles in public result types.
- Keep backend-private process state in a separate internal handle type.

### Phase 2: Built-in Pibo tool registration and runtime binding

Touch these files:

- `src/core/profiles.ts`
- `src/plugins/builtin.ts`
- `src/core/runtime.ts`
- `src/plugins/registry.ts` if catalog metadata needs a built-in marker
- `src/index.ts` for public exports if needed

Steps:

1. Extend `ToolProfile` only as much as needed. Recommended shape:

```ts
type ToolProfile = {
  name: string;
  description?: string;
  enabled?: boolean;
  yieldable?: boolean;
  pluginId?: string;
  definition?: ToolDefinition;
  providerTool?: ProviderToolProfile;
  builtInPiboTool?: "runtime";
};
```

2. Add `createRuntimeToolProfile()` in `src/tools/runtime/tool.ts` or `src/tools/runtime/index.ts`:

```ts
export function createRuntimeToolProfile(): ToolProfile {
  return {
    name: "runtime",
    description: "Start and use persistent Python/Node runtime sessions with structured exec, inspect, vars, interrupt, close, and list actions.",
    yieldable: true,
    builtInPiboTool: "runtime",
  };
}
```

3. Register the tool from `piboCorePlugin` in `src/plugins/builtin.ts`:

```ts
api.registerTool(createRuntimeToolProfile());
```

4. Add `runtime` to the default Codex-compatible profile in `src/plugins/codex-compat.ts`:

```ts
const CODEX_COMPAT_TOOL_NAMES = [
  "apply_patch",
  "web_search",
  "view_image",
  "runtime",
] as const;
```

5. Do not store a static `ToolDefinition` on the catalog entry. The executable definition must be generated when a Pibo runtime is created because it needs the owning Pibo Session ID.

6. In `src/core/runtime.ts`, add a generated tool path like subagents and run-control:

- import `createRuntimeToolDefinition`
- add `runtimeToolController?: PiboRuntimeToolController` to `PiboRuntimeOptions`
- update `getEnabledToolDefinitions(...)` to:
  - detect an enabled profile tool with `builtInPiboTool === "runtime"` or `name === "runtime"`
  - exclude that profile entry from static `profileTools`
  - append `createRuntimeToolDefinition(controller)` when enabled
  - include it in `yieldableTools` when `yieldable !== false`

7. For non-routed runtimes, create a local runtime registry inside `createPiboRuntime()` when the profile enables `runtime` and no controller was provided. Use owner id `profile.sessionId ?? "local"`. Wrap `runtime.dispose()` so it closes this local owner’s sessions.

8. For routed sessions, create and pass a controller from `PiboSessionRouter`:

- add a private `RuntimeSessionRegistry` field
- add `createRuntimeToolController(parentPiboSessionId: string)`
- pass `runtimeToolController: this.createRuntimeToolController(piboSession.id)` to `createPiboRuntime(...)`
- on `resetCachedSession`, router `dispose`, and session disposal/kill paths, call `runtimeRegistry.closeOwnerSessions(piboSessionId, { force: true })`

9. Update profile inspection:

- generated `runtime` should show as registered and active when selected
- `hasDefinition` should be true for `builtInPiboTool: "runtime"`, even though the catalog entry has no static `definition`

### Phase 3: Runtime registry

Create `src/tools/runtime/registry.ts`.

Responsibilities:

1. Own an in-memory map of runtime sessions by `sessionId`.
2. Scope every operation by `ownerPiboSessionId`.
3. Generate ids such as `rt_python_<shortid>` or `rt_<randomUUID>`.
4. Dispatch operations to backend by `runtime`.
5. Enforce state transitions:
   - `start`: `starting` -> `idle` or `failed`
   - `exec`: `idle` -> `busy` -> `idle`/`closed`/`failed`
   - code-level errors return `status: "error"` but keep session `idle`
   - worker/process errors mark `failed`
   - `close` marks `closed`
6. Keep bounded history, default `maxHistoryEntries = 100`.
7. Enforce owner access:
   - wrong owner gets `status: "not_found"` for agent-facing actions
   - never leak another Pibo Session’s variables, output, or errors
8. Implement cleanup:
   - `close(sessionId, force)`
   - `closeOwnerSessions(ownerPiboSessionId, force)`
   - `pruneIdle(now)` for idle timeout
9. Implement `closeOnSuccess` centrally:
   - after backend `exec` returns `status: "ok"`, close the session
   - return `autoClosed: true`
   - after `error`, `timeout`, or `interrupted`, do not auto-close unless the backend process is dead
10. Prevent concurrent exec against one runtime in MVP:
   - if session is `busy`, return a clear error status/message or throw a tool error
   - do not queue multiple execs inside the same runtime until a later phase

### Phase 4: Tool definition and validation

Create `src/tools/runtime/tool.ts`.

Use `defineTool` from `@mariozechner/pi-coding-agent` and `Type`/`StringEnum` from `@mariozechner/pi-ai`.

Define:

```ts
export type PiboRuntimeToolController = {
  start(input: RuntimeStartInput): Promise<RuntimeStartResult>;
  exec(input: RuntimeExecInput): Promise<RuntimeExecResult>;
  inspect(input: RuntimeInspectInput): Promise<RuntimeInspectResult>;
  vars(input: RuntimeVarsInput): Promise<RuntimeVarsResult>;
  interrupt(input: RuntimeInterruptInput): Promise<RuntimeInterruptResult>;
  close(input: RuntimeCloseInput): Promise<RuntimeCloseResult>;
  list(input: RuntimeListInput): Promise<RuntimeListResult>;
};
```

Then implement:

```ts
export function createRuntimeToolDefinition(controller: PiboRuntimeToolController): ToolDefinition
```

Tool schema:

- one object with `action` enum
- optional fields for all actions
- runtime validation in TypeScript after schema parse, because action-discriminated schemas may be cumbersome with current tool schema helpers

Execution behavior:

1. Normalize and validate by `action`.
2. Call the matching controller method.
3. Return a text summary plus structured `details`.
4. Set `isError: true` when:
   - result status is `"error"`, `"timeout"`, `"interrupted"`, `"not_found"`, or `"failed"`
   - validation fails
5. Keep stdout/stderr visible in the text result. Recommended text format:

```text
status: ok
sessionId: rt_python_abc
runtime: python
autoClosed: false

stdout:
...

stderr:
...

result:
...
```

6. Keep full structured data in `details` for Chat Web traces and future UI.
7. Prompt snippet must teach the one-shot flag:

```text
Use runtime for stateful Python/Node exploration. Set closeOnSuccess on exec for one-shot code: success closes the runtime; failure keeps prior state for inspection and repair.
```

### Phase 5: Python worker source

Create `src/tools/runtime/python-worker-source.ts` with an exported string constant.

Do not ship a loose `.py` file unless package/build scripts are updated to copy it. An embedded string survives TypeScript compilation into `dist`.

Worker protocol:

- stdin: JSON Lines requests
- stdout: JSON Lines responses only
- user stdout/stderr: captured and returned in JSON
- request fields:
  - `id`
  - `type`: `exec` | `inspect` | `vars` | `shutdown`
  - action-specific fields
- response fields:
  - `id`
  - `status`
  - `stdout`
  - `stderr`
  - `result`
  - `error`

Python implementation details:

1. Maintain:

```python
user_globals = {"__name__": "__pibo_runtime__"}
```

2. For `exec` mode:
   - compile with `compile(code, "<pibo-runtime>", "exec")`
   - execute with `exec(compiled, user_globals, user_globals)`
   - statement mutations before an exception remain available
3. For `eval` mode:
   - compile with `eval`
   - evaluate and summarize the returned value
4. For `auto` mode in MVP:
   - either treat as `exec`, or compile as `eval` only when no side effects are possible to infer safely
   - document the chosen behavior in tests
5. Capture output with `contextlib.redirect_stdout` and `redirect_stderr`.
6. Summarize values safely:
   - bound `repr`
   - catch broken `__repr__`
   - detect pandas `DataFrame`/`Series` by type/module without importing pandas eagerly
   - include `shape`, `columns`, and bounded preview for DataFrames
   - include keys for dict-like values
   - include length for sequences
7. Errors:
   - return `name`, `message`, `traceback`
   - parse the traceback for the best failing `line`
   - include `column` only when available
8. `vars`:
   - hide private names by default
   - skip modules and helper internals unless `includePrivate` is true
9. `inspect`:
   - evaluate the expression in `user_globals`
   - support `summary`, `signature`, `members`, `source`, `doc`, `all`
   - bound every returned string by `maxBytes`

### Phase 6: Local Python backend

Create `src/tools/runtime/python-backend.ts`.

Responsibilities:

1. Start a worker process:
   - executable: input `executable` or default `python3`
   - args: `input.args ?? []`, plus `-u -c <workerSource>`
   - cwd: resolved against runtime cwd
   - env: `process.env` plus allowed overrides
   - stdio: pipes, no PTY
2. Wait for a ready handshake before returning `RuntimeStartResult`.
3. Maintain request ids and a pending map.
4. Read stdout line-by-line and parse JSON responses.
5. Treat stderr from the worker process as worker diagnostics, not user stderr. User stderr should come from JSON responses.
6. Implement per-request timeout:
   - reject/return timeout when elapsed
   - leave session open if worker still responds later only if protocol can resync safely
   - for MVP, prefer marking session failed on protocol uncertainty
7. Implement `interrupt`:
   - send `SIGINT` to the process on Unix
   - return best-effort result
8. Implement `close`:
   - send shutdown request first
   - after grace period, `SIGTERM`
   - with `force`, kill immediately or escalate to `SIGKILL`
9. Implement crash handling:
   - reject all pending requests
   - mark backend session dead

### Phase 7: MVP action behavior

Wire registry + backend + tool action behavior.

`start`:

- validate `runtime === "python"` for MVP
- reject `target.type !== "local"` with a clear message
- create registry record with owner Pibo Session ID
- return pid, cwd, executable, startedAt

`exec`:

- require existing session and owner match
- run backend exec
- append history entry
- apply `closeOnSuccess`
- return stdout, stderr, result, error, duration, executionCount, autoClosed

`inspect`:

- require existing session and owner match
- call backend inspect
- return bounded fields

`vars`:

- require existing session and owner match
- return bounded variable list

`interrupt`:

- require existing session and owner match
- best-effort signal

`close`:

- require existing session and owner match
- close process
- mark closed

`list`:

- return only records owned by current Pibo Session
- include `sessionId`, runtime, name, cwd, status, startedAt, updatedAt, lastExecAt, executionCount
- hide backend-private state

### Phase 8: Tests for Python MVP

Add `test/runtime-tool.test.mjs`.

Test through built `dist` exports. Extend `src/index.ts` exports only if tests need direct access to registry/tool helpers.

Required tests:

1. Core registry/backend:
   - start Python runtime
   - `exec x = 1`
   - later `eval x + 1` returns `2`
2. Failure preserves state:
   - execute `x = 1\nraise Exception("boom")`
   - result status is `error`
   - line information exists when available
   - later `eval x` returns `1`
3. `closeOnSuccess` success path:
   - start runtime
   - exec with `closeOnSuccess: true`
   - result `status: "ok"`, `autoClosed: true`
   - later exec returns `not_found` or closed-session error
4. `closeOnSuccess` failure path:
   - exec with `closeOnSuccess: true` and failing later line
   - runtime remains listed as open/idle
   - variables created before failure remain inspectable
   - second exec with `closeOnSuccess: true` can finish and auto-close
5. stdout/stderr separation:
   - `print("out")`
   - `print("err", file=sys.stderr)`
6. `vars` hides private names by default.
7. `inspect` function signature:
   - define `def f(a, b=1): ...`
   - inspect signature returns `(a, b=1)` or equivalent
8. owner isolation:
   - owner A starts runtime
   - owner B cannot list/exec/inspect it
9. profile/catalog:
   - default plugin registry lists `runtime` as a built-in Pibo/native tool
   - `codex-compat-openai-web` includes `runtime`
   - profile inspection marks it active
10. cleanup:
   - closing owner sessions terminates processes

Run:

```bash
npm run typecheck
npm test
```

### Phase 9: Agent guidance and trace visibility

Touch these files as needed:

- `src/tools/runtime/tool.ts`
- `skills/builtin/pi-agent-harness/SKILL.md` only if product guidance belongs there
- `src/shared/trace-engine.ts`
- `src/apps/chat-ui/src/tracing/*`
- `src/apps/chat-ui/src/session-views/*`

MVP guidance requirements:

1. Tool description and prompt snippet must explain:
   - persistent state
   - `inspect` and `vars`
   - when to use Bash instead
   - `closeOnSuccess` one-shot recovery behavior
2. Generic tool traces are acceptable for MVP if `details` contain structured runtime data.
3. Add custom trace rendering only if generic tool rendering hides stdout/stderr or `autoClosed`.

### Phase 10: Node backend

Create:

- `src/tools/runtime/node-worker-source.ts`
- `src/tools/runtime/node-backend.ts`

Implement under the same registry and tool shape.

Minimum Node acceptance:

1. start Node runtime
2. define variable and reuse it later
3. capture `console.log` / `console.error`
4. `eval` returns value summary
5. thrown exceptions return stack and line when available
6. inspect object keys and function source preview
7. support top-level `await` if feasible; otherwise document the limitation and add a skipped/failing TODO test
8. support `closeOnSuccess` success and failure behavior

### Phase 11: Packaging and exports

1. Confirm `npm run build` emits all runtime modules into `dist/tools/runtime/*`.
2. If worker code is embedded as TypeScript strings, no package `files` change is needed.
3. If any non-TS worker asset is introduced, update `package.json` `files` and build/copy scripts. Prefer not to do this for MVP.
4. Export only stable product APIs from `src/index.ts`:
   - `createRuntimeToolProfile` if useful to plugin authors
   - runtime types if tests or downstream code need them
   - avoid exporting backend internals

### Phase 12: Later target support

Do not implement in MVP, but keep type seams ready.

Future files likely touched:

- `src/tools/runtime/docker-python-backend.ts`
- `src/tools/runtime/ssh-python-backend.ts`
- policy/config modules for allowed targets

Rules:

- Docker uses `docker exec -i`, never `-t`, for runtime workers.
- SSH starts a structured worker over stdin/stdout.
- Target support must be separately policy-gated.

### Phase 13: Done criteria

Implementation is complete when:

1. `runtime` appears in the capability catalog as a Pibo-owned built-in tool.
2. The Codex-compatible default profile exposes `runtime` to agents.
3. Python runtime sessions work through the actual agent tool path, not only direct unit calls.
4. Runtime sessions are scoped to the owning Pibo Session.
5. `closeOnSuccess` matches the specified behavior.
6. Runtime processes close on explicit `close`, owner disposal, and router disposal.
7. `npm run typecheck` passes.
8. `npm test` passes.
9. Any Chat Web smoke check uses the Docker worker gateway, not the host production gateway.

## 18. Acceptance criteria for Python MVP

1. Agent can start a Python runtime in a chosen cwd.
2. Agent can run `x = 1` and later run `x + 1` or `print(x)` successfully.
3. If `raise Exception()` occurs after `x = 1`, `x` remains available.
4. Agent can inspect a function signature using `inspect` action.
5. Agent can list variables.
6. stdout and stderr are returned separately.
7. Tracebacks are returned on errors.
8. Session can be closed and no longer accepts exec calls.
9. Sessions are scoped to the owning Pibo Session.
10. Large outputs are truncated safely.
11. `closeOnSuccess: true` automatically closes after a successful execution.
12. `closeOnSuccess: true` keeps the runtime available after an execution error, with previous state intact and line-specific error information when available.

## 19. Acceptance criteria for Node MVP

1. Agent can start a Node runtime.
2. Agent can define a variable and use it in a later exec.
3. Agent can capture `console.log` output.
4. Agent can return a value summary from an evaluated expression.
5. Agent can inspect object keys.
6. Error stack is returned on thrown exceptions.
7. Session can be closed.
8. Sessions are scoped to the owning Pibo Session.
9. `closeOnSuccess: true` automatically closes after a successful execution.
10. `closeOnSuccess: true` keeps the runtime available after an execution error, with previous state intact and line-specific error information when available.

## 20. Open questions

1. Should `exec` default to `exec` mode or `auto` expression detection?
2. Should Python use a minimal custom worker or an IPython/Jupyter kernel in the first version?
3. How much rich display support is needed for pandas/matplotlib?
4. Should package installation helpers exist, or should agents use Bash for installs?
5. Should runtime sessions be yieldable/backgrounded when an execution runs long?
6. How should runtime session events appear in Chat Web traces?
7. Should a profile be able to disable Node but allow Python, or vice versa?
8. How should runtime workers be packaged and injected into Docker targets?
9. Do we want an “active runtime” context similar to active terminal?

## 21. Recommendation

Implement one generic `runtime` native tool with pluggable backends. Start with a structured Python worker, then add a structured Node worker. Do not use PTY for normal runtime execution. Keep PTY as the separate `terminal` tool for shells and interactive terminal programs.

This gives agents two complementary capabilities:

- `runtime`: reliable, inspectable, stateful code sessions for Python/Node.
- `terminal`: true terminal sessions for shell/Docker/SSH/TUI workflows.
