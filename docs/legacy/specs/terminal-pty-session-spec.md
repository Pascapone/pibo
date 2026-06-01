# Terminal PTY Session Spec

Status: design spec / implementation planning
Date: 2026-05-08
Owner area: Pibo product boundary, native tools, routed sessions
Related specs: `docs/runtime-session-spec.md`

## 1. Purpose

Pibo should offer agents a persistent, interactive terminal capability for cases where normal one-shot Bash commands are the wrong abstraction. The feature should let an agent start or attach to a terminal-like process, send input over time, observe output, resize it, interrupt it, and close it.

The primary goal is not only to support full-screen terminal UIs. It is to let an agent logically “enter” another shell or terminal context and work there without repeating command prefixes. Examples:

- enter a Docker container shell once instead of prefixing every command with `docker exec ...`
- enter an SSH session once and run remote commands naturally
- activate or enter a package/runtime environment and run commands there while preserving shell state
- operate CLI tools that require a TTY
- interact with coding CLIs or TUIs that expect terminal semantics

This spec deliberately separates terminal PTY sessions from structured runtime sessions. For notebook-like Python/Node state, use the runtime feature in `docs/runtime-session-spec.md`. Terminal PTY sessions remain the generic, terminal-faithful escape hatch for shells, Docker, SSH, TUIs, REPLs, and interactive CLIs.

## 2. Background and source assessment

We examined four agent projects for PTY support:

### OpenClaw

OpenClaw is the closest UX reference for agent-facing PTY sessions.

Observed design points:

- `src/process/supervisor/adapters/pty.ts` dynamically loads `@lydell/node-pty` and spawns a real PTY.
- `src/process/supervisor/supervisor.ts` supports `mode: "pty"` next to normal child processes.
- `src/agents/bash-tools.exec-runtime.ts` can run an exec request in PTY mode and falls back to normal child execution if PTY spawn fails.
- `src/agents/bash-tools.process.ts` exposes interaction actions such as `write`, `send-keys`, `submit`, `paste`, `poll`, `log`, and `kill`.
- `docs/tools/exec.md` documents `pty` for TTY-only CLIs, coding agents, and terminal UIs.

Useful ideas to adopt:

- a supervisor-owned session registry
- explicit background sessions
- post-start interaction by session id
- `paste`, `submit`, `send-keys`, `interrupt`, and `kill`
- fallback and warning behavior when PTY is unavailable
- bounded output buffers

Important caveat from OpenClaw:

- PTY is not enabled for every backend. Sandbox/node-host paths can differ. Pibo should keep backend capability checks explicit.

### Codex

Codex is the strongest technical reference for a cross-platform PTY process layer.

Observed design points:

- `codex-rs/utils/pty/` contains a PTY abstraction.
- It uses `portable-pty` and platform-specific mechanics.
- API shapes include `tty`, initial size, write, resize, terminate, and session/process ids.
- Windows uses ConPTY; Unix paths use PTY primitives.
- Unified exec can return a running session id and accept more stdin later.

Useful ideas to adopt:

- PTY is a first-class process mode, not only a UI detail.
- write/resize/terminate are explicit API concepts.
- session ids are stable handles for later interaction.
- cross-platform behavior must be specified.

### OpenCode

OpenCode has strong PTY infrastructure for web terminal tabs, using `@lydell/node-pty` on Node and `bun-pty` on Bun. It has server routes and WebSocket streaming for terminals. However, its agent shell tool appears separate from the PTY subsystem and uses normal process execution.

Useful idea to adopt:

- PTY sessions can be rendered in a web UI later, with WebSocket stream/replay.

Caveat:

- A terminal UI alone is not the same as an agent-facing terminal tool.

### Kimi CLI

Kimi CLI uses non-interactive subprocesses for the normal agent shell tool and intentionally closes stdin to avoid interactive hangs. PTYs appear in tests and ACP terminal capabilities, not as the local production shell backend.

Useful lesson:

- Non-interactive shell execution and interactive terminal execution should remain separate tools/modes.
- Agents need clear guidance on when *not* to use a PTY.

## 3. Product goals

### 3.1 Must-have goals

1. Start a persistent terminal session from an agent tool.
2. Send text, submit Enter, send common control keys, and paste multi-line text.
3. Read output incrementally and inspect recent logs.
4. Close or kill the session reliably.
5. Preserve shell state while the session is alive: cwd, env mutations, activated virtualenvs, loaded shell functions, shell history where applicable.
6. Support Docker-shell style workflows: start once, then run commands without repeated `docker exec` prefix.
7. Support SSH-shell style workflows: connect once, then run remote commands naturally.
8. Support CLIs that require TTY detection.
9. Be safe against runaway/hanging sessions via timeouts, output caps, and explicit interrupts.
10. Be discoverable for agents through compact tool descriptions and deeper guide/context docs.

### 3.2 Should-have goals

1. Optional “active terminal” agent context so follow-up terminal writes can target a selected session without repeating its id in the model reasoning.
2. ANSI-aware output sanitation for model-readable logs.
3. Web Chat visibility for active sessions and recent output.
4. Replay buffer and incremental cursor for output polling.
5. Idle-timeout cleanup.
6. Human takeover/inspection in a web terminal later.

### 3.3 Non-goals for the first implementation

1. Perfect full-screen TUI understanding by the model.
2. Pixel/cell-accurate terminal rendering in the tool result.
3. Replacing one-shot Bash for simple commands.
4. Replacing structured Python/Node runtime sessions.
5. Long-lived daemon management across Pibo restarts in the MVP.
6. Multi-agent shared terminal sessions in the MVP.

## 4. Use cases

### 4.1 Docker shell

Agent starts:

```json
{
  "action": "start",
  "command": "docker exec -it app bash",
  "cwd": "/workspace",
  "name": "app-container"
}
```

Then sends:

```json
{
  "action": "paste",
  "sessionId": "term_123",
  "text": "cd /app\npytest tests/test_api.py\n"
}
```

The command runs inside the container shell. The agent does not repeat `docker exec`.

### 4.2 SSH session

```json
{
  "action": "start",
  "command": "ssh -tt staging.example.internal",
  "name": "staging"
}
```

Then:

```json
{
  "action": "submit",
  "sessionId": "term_456",
  "text": "systemctl status app"
}
```

### 4.3 TTY-only CLI

Some CLIs change behavior without a TTY, prompt differently, or refuse to run. The agent can start them in a PTY, observe prompts, and answer.

### 4.4 Coding CLI / TUI

An agent may start another coding CLI or TUI-like workflow. The PTY tool should support control keys and paste. Model-readable summaries may be imperfect, but the capability should exist.

### 4.5 Temporary environment shell

```bash
source .venv/bin/activate
python script.py
pytest
```

The virtual environment activation persists in the terminal until exit.

## 5. Proposed native tool shape

Preferred stable Pibo native tool name: `terminal`.

Alternative names considered:

- `pty`: technically precise, but less user-friendly and too implementation-specific.
- `process`: broad but ambiguous with existing run-control concepts.
- `shell_session`: narrower than the intended SSH/TUI use cases.

Recommendation: expose one tool named `terminal`, and describe it as “persistent PTY-backed terminal sessions”. Internal packages/classes can use `pty`.

### 5.1 Actions

MVP actions:

- `start`
- `write`
- `submit`
- `paste`
- `send_keys`
- `poll`
- `log`
- `interrupt`
- `close`
- `kill`
- `list`

Later actions:

- `resize`
- `enter`
- `leave`
- `rename`
- `snapshot`
- `clear_buffer`

### 5.2 `start`

Starts a new PTY session.

Input:

```ts
type TerminalStartInput = {
  action: "start";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  name?: string;
  cols?: number;
  rows?: number;
  idleTimeoutMs?: number;
  overallTimeoutMs?: number;
  outputLimitBytes?: number;
  target?: TerminalTarget;
  enter?: boolean;
};
```

`command` can be either a shell command string or an executable depending on implementation. For the MVP, a shell command string is sufficient because most use cases are shell-shaped: `docker exec -it app bash`, `ssh -tt host`, `bash`, `python`, etc.

Output:

```ts
type TerminalStartResult = {
  status: "running" | "failed";
  sessionId?: string;
  name?: string;
  pid?: number;
  startedAt: string;
  cwd?: string;
  message: string;
  output?: string;
  warnings?: string[];
};
```

### 5.3 `write`

Writes raw bytes/text to stdin without adding Enter.

```ts
type TerminalWriteInput = {
  action: "write";
  sessionId: string;
  data: string;
};
```

Use for exact input, control sequences, and advanced cases.

### 5.4 `submit`

Sends a command plus carriage return/newline. This is the common path for shell commands.

```ts
type TerminalSubmitInput = {
  action: "submit";
  sessionId: string;
  text?: string;
};
```

Behavior:

- If `text` is present, write `text` then Enter.
- If `text` is absent, send only Enter.
- Use CR (`\r`) for terminal submit by default, not LF only.

### 5.5 `paste`

Pastes multi-line text. Bracketed paste should be enabled by default when useful.

```ts
type TerminalPasteInput = {
  action: "paste";
  sessionId: string;
  text: string;
  bracketed?: boolean;
  submit?: boolean;
};
```

Behavior:

- If `bracketed !== false`, wrap text in bracketed paste sequences.
- If `submit === true`, send Enter after the paste.
- Preserve exact newlines in the payload.

### 5.6 `send_keys`

Sends symbolic key sequences.

```ts
type TerminalSendKeysInput = {
  action: "send_keys";
  sessionId: string;
  keys: string[];
};
```

Initial keys to support:

- `Enter`
- `Escape`
- `Tab`
- `Backspace`
- `Delete`
- `Up`, `Down`, `Left`, `Right`
- `Home`, `End`
- `PageUp`, `PageDown`
- `C-c`, `C-d`, `C-z`, `C-l`

Caveat: cursor-key modes vary by terminal/application. The implementation may need mode detection or conservative warnings like OpenClaw.

### 5.7 `poll`

Returns new output since the caller’s cursor, or recent output when no cursor is provided.

```ts
type TerminalPollInput = {
  action: "poll";
  sessionId: string;
  cursor?: string;
  maxBytes?: number;
  ansi?: "raw" | "strip" | "summary";
};
```

Output:

```ts
type TerminalPollResult = {
  status: "running" | "exited" | "failed" | "not_found";
  sessionId: string;
  output: string;
  cursor: string;
  exitCode?: number | null;
  signal?: string | number | null;
  truncated?: boolean;
  idleMs?: number;
};
```

### 5.8 `log`

Returns the recent session buffer without cursor semantics.

```ts
type TerminalLogInput = {
  action: "log";
  sessionId: string;
  tailBytes?: number;
  ansi?: "raw" | "strip" | "summary";
};
```

### 5.9 `interrupt`, `close`, and `kill`

`interrupt` sends Ctrl-C.

```ts
{ action: "interrupt"; sessionId: string }
```

`close` attempts graceful close:

1. send EOF or `exit` depending on mode/config
2. wait briefly
3. optionally escalate

```ts
{ action: "close"; sessionId: string; forceAfterMs?: number }
```

`kill` terminates the PTY/process immediately or after normal process-tree cleanup.

```ts
{ action: "kill"; sessionId: string; signal?: string }
```

### 5.10 `list`

Lists active sessions owned by the current Pibo session/agent.

```ts
{ action: "list"; includeExited?: boolean }
```

Output includes id, name, status, age, idle time, cwd, command preview, and active flag.

## 6. Optional active-terminal mode

A later improvement is an agent-visible “active terminal” concept.

Problem:

- Tool APIs with `sessionId` are explicit and safe, but verbose.
- The product goal includes “entering” another terminal context.

Proposed behavior:

- `terminal start` may set `enter: true`.
- `terminal enter` marks a session as active for the owning Pibo session.
- Tool descriptions tell the model that when a terminal is active, it should use `submit`/`paste` against that session for shell commands intended for that environment.
- `terminal leave` clears the active terminal but does not close it.
- `terminal close` exits and clears it if active.

Important: this is a product-level convenience, not hidden magic. The model should still call the `terminal` tool. We should avoid silently redirecting normal `bash` calls into a PTY because that would be surprising and dangerous.

## 7. Backend model

### 7.1 Local PTY backend

Recommended Node implementation:

- Use `@lydell/node-pty` for local PTYs.
- Spawn shell command through the platform shell.
- Set default `TERM=xterm-256color`.
- Default size: 120x30.
- Capture unified stdout/stderr stream, because PTYs do not separate stderr.

Potential alternatives:

- `node-pty` original package
- `bun-pty` if Pibo ever runs on Bun
- Rust helper using `portable-pty` if Node native package compatibility becomes a problem

### 7.2 Target abstraction

Terminal sessions should support targets eventually, but MVP can start local commands only.

```ts
type TerminalTarget =
  | { type: "local" }
  | { type: "docker"; container: string; shell?: string; user?: string; workdir?: string }
  | { type: "ssh"; host: string; user?: string; port?: number; shell?: string }
  | { type: "custom"; command: string };
```

A target can compile to a command:

- Docker: `docker exec -it [-u user] [-w workdir] <container> <shell>`
- SSH: `ssh -tt [-p port] user@host`
- Local: `bash`, `zsh`, `pwsh`, etc.

Target support should be explicit. Do not parse arbitrary `docker` or `ssh` commands to infer a target in MVP.

### 7.3 Session registry

Terminal sessions should be owned by a registry keyed by Pibo Session ID and terminal session id.

Session record:

```ts
type TerminalSessionRecord = {
  id: string;
  ownerPiboSessionId: string;
  name?: string;
  command: string;
  cwd?: string;
  envPreview?: Record<string, string>;
  pid?: number;
  status: "starting" | "running" | "exited" | "failed" | "killed";
  startedAt: string;
  updatedAt: string;
  lastInputAt?: string;
  lastOutputAt?: string;
  exitCode?: number | null;
  signal?: string | number | null;
  cols: number;
  rows: number;
  buffer: RingBuffer;
  cursor: number;
  stdin: WritableLike;
  dispose: () => Promise<void> | void;
};
```

MVP storage can be in-memory. Later persistence can store metadata/history, but live PTYs cannot survive process restart unless backed by tmux/screen or a remote daemon.

## 8. Output handling

### 8.1 Buffering

- Keep a bounded ring buffer per session.
- Default cap: 1-2 MB per session.
- Return truncation flags when output is cut.
- Store byte offsets/cursors for incremental polling.

### 8.2 ANSI handling

The PTY output will include ANSI escape sequences. Provide modes:

- `raw`: exact stream, for UI replay or advanced consumers
- `strip`: remove ANSI sequences for model-readable text
- `summary`: future mode, parse terminal screen state or summarize

MVP should implement at least `strip` and optionally `raw`.

### 8.3 Prompt and completion detection

Prompt detection is unreliable. The MVP should not promise “command completed” for arbitrary shell commands sent into a PTY.

Instead:

- `submit` returns immediately after writing.
- `poll` reads output.
- Agents can use idle time and prompt text heuristically.
- For deterministic command completion, agents should use normal `bash` or structured runtime tools.

Future enhancement:

- A `run_in_terminal` helper can inject sentinel markers around a command:

```bash
printf '\x1ePIBO_START:<id>\x1e\n'; <command>; printf '\x1ePIBO_DONE:<id>:%s\x1e\n' "$?"
```

This is useful for shell sessions but not safe for arbitrary TUIs/REPLs.

## 9. Security and policy

Terminal PTY sessions are at least as powerful as shell execution. They may be more dangerous because state persists.

Policy requirements:

1. The tool must be profile-selectable like other native tools.
2. It should inherit shell/exec security restrictions where available.
3. Host execution may require approvals depending on Pibo policy.
4. Docker/SSH target creation should be policy-gated.
5. Environment overrides should be filtered similarly to exec tools where host security matters.
6. Sessions must be scoped to the owning Pibo Session by default.
7. Cross-session attach/share should be explicit and not in MVP.
8. Logs may contain secrets. Avoid broad visibility by default.

## 10. Lifecycle and cleanup

Default lifecycle:

- session starts in `running`
- output updates `lastOutputAt`
- input updates `lastInputAt`
- idle timer can close or kill after a configured period
- owner session disposal kills child PTYs unless configured otherwise
- gateway shutdown kills all in-memory PTYs

Recommended defaults:

- idle timeout: configurable, maybe disabled initially or 30-60 minutes
- max lifetime: optional, e.g. 4 hours
- output buffer: 2 MB
- close grace period: 2 seconds
- kill fallback: process tree kill where possible

## 11. Cross-platform notes

Unix/macOS/Linux:

- `@lydell/node-pty` should use native PTY support.
- Signals like SIGINT/SIGKILL are available.
- EOF is Ctrl-D (`\x04`).

Windows:

- PTY support relies on ConPTY through the library.
- Shell defaults may be `pwsh` or Windows PowerShell.
- EOF/termination semantics differ.
- ANSI support and key encoding need testing.

MVP can be best-effort on Windows if Pibo’s primary deployment is Linux, but the API should not bake in Unix-only assumptions.

## 12. Failure modes and mitigations

### 12.1 Session hangs waiting for input

Mitigations:

- `poll` should show idle time.
- `interrupt` sends Ctrl-C.
- `kill` is always available.
- Tool guidance should warn that PTY commands may not auto-complete.

### 12.2 Agent loses track of state

Mitigations:

- `list` shows active sessions.
- `log` shows recent output.
- Optional `name` field for sessions.
- Active-terminal mode should be visible in tool results/system reminders.

### 12.3 Prompt detection fails

Mitigation:

- Do not rely on prompt detection for correctness in MVP.
- Use runtime tools or normal Bash for deterministic one-off execution.

### 12.4 Output contains escape noise

Mitigations:

- ANSI stripping mode.
- Byte caps.
- Future terminal-screen parser.

### 12.5 PTY native module fails to install/load

Mitigations:

- Return clear error.
- Optionally fall back to normal child process with warning only when caller allows fallback.
- Doctor command can check PTY availability.

### 12.6 Persistent shell state causes wrong assumptions

Mitigations:

- Make persistence explicit.
- Show command history/recent input in logs.
- Encourage closing and restarting sessions for clean state.

## 13. Implementation plan

### Phase 0: Design and docs

- Land this spec.
- Land runtime spec separately.
- Decide final tool names: recommended `terminal` and `runtime`.

### Phase 1: Local PTY MVP

- Add dependency on `@lydell/node-pty` if accepted.
- Implement `TerminalSessionRegistry`.
- Implement local PTY adapter.
- Implement native tool `terminal` with actions:
  - `start`
  - `submit`
  - `paste`
  - `write`
  - `poll`
  - `log`
  - `interrupt`
  - `close`
  - `kill`
  - `list`
- Scope sessions to Pibo Session ID.
- Add basic tests for start/write/poll/close.

### Phase 2: Agent ergonomics

- Add guide/context file for agents.
- Add active-terminal metadata/actions if needed.
- Add better key encoding.
- Add ANSI strip mode.

### Phase 3: Targets

- Add `target: docker` helper.
- Add `target: ssh` helper.
- Add policy gates for target types.

### Phase 4: UI

- Show active terminal sessions in Chat Web.
- Stream logs live.
- Optional human terminal attach.

## 14. Acceptance criteria for MVP

1. Agent can start `bash` in a PTY.
2. Agent can submit `pwd`, `cd`, and `pwd` again and observe persisted cwd.
3. Agent can start `python` in a PTY and interact with it manually, though structured Python work should prefer `runtime`.
4. Agent can close the session.
5. Agent can recover from a hung command using `interrupt` or `kill`.
6. `list` shows the active session.
7. Output is bounded and pollable.
8. Session ownership prevents another unrelated Pibo session from controlling it.

## 15. Open questions

1. Should normal `bash` remain separate from `terminal`, or should `terminal start` be exposed as a yieldable tool only?
2. Should we support active-terminal mode in MVP or after basic sessions are stable?
3. Should Docker/SSH be first-class target types immediately or documented command recipes first?
4. How should terminal logs appear in Chat Web traces?
5. Should terminal sessions generate automatic completion/wakeup events on exit?
6. Do we need tmux/screen integration for restart-survivable terminal sessions later?

## 16. Recommended first implementation stance

Build `terminal` as a separate native tool, not as a replacement for Bash and not as the implementation substrate for Python/Node runtime sessions.

Use it when terminal semantics are required. For deterministic commands, keep normal one-shot Bash. For stateful Python/Node coding, use `runtime`.
