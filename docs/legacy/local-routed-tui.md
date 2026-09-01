---
type: "Historical Record"
title: "Local Routed TUI"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/local-routed-tui.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "2e4e37a7288eca37c16866d79fc81da1359dcc2c"
  source_bytes: 5096
  source_sha256: "e4e87a71ba8489f79551c7b2cc8fbd8f460356b19c86fa708be445d24c1e910d"
  source_body_sha256: "e4e87a71ba8489f79551c7b2cc8fbd8f460356b19c86fa708be445d24c1e910d"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Local Routed TUI

The local routed TUI is an explicit optional adapter for running a Pibo routed session directly in a terminal without starting the gateway daemon.

```bash
npm run tui:routed -- <profile>
```

Use it when local terminal ergonomics matter but the selected profile needs routed-only capabilities such as subagents or yielded runs.

## Boundary

The local TUI is not a second runtime. It is a small adapter around the existing router:

```text
Pi TUI shell
  -> local routed TUI extension
  -> LocalRoutedTuiClient
  -> PiboSessionRouter
  -> RoutedSession
  -> createPiboRuntime(profile, router controllers)
  -> Pi Coding Agent
```

The adapter owns terminal input and rendering only. `PiboSessionRouter` still owns subagent routing, yielded-run state, run notifications, session disposal, and plugin event delivery.

The direct Pi TUI command remains separate:

```bash
npm run tui -- <profile>
```

`npm run tui` does not auto-switch to routed mode in V1.

## Files

- `src/local/client.ts` creates the in-process router, local Pibo Session, and local client methods.
- `src/local/extension.ts` contains the Pi TUI extension, command filtering, autocomplete filtering, and the adapter from normalized routed events to Pi TUI render components.
- `src/local/tui.ts` wires the client and extension into `runPiboTui`.
- `test/local-routed-tui.test.mjs` covers local routing behavior without starting an interactive TUI.

## Sessions

V1 uses an in-memory Pibo Session store. The local routed adapter creates one local Pibo Session for the selected profile and session name:

```text
channel: local-tui
kind: local
profile: <resolvedProfile>
title: <sessionName>
```

The default session name is `default`, so:

```text
npm run tui:routed -- codex
```

routes through a local Pibo Session with `profile: "codex-compat-openai-web"` and `title: "default"`.

Pi session persistence still follows the normal routed runtime option. The controller shell runtime is non-persistent and exists only to host the terminal UI.

## Slash Commands

Normal text input is routed to the Pibo session.

`/quit` stays local so the user can leave the terminal UI.

Execution actions registered by plugins can appear as routed slash commands only after filtering. Commands that can be confused with Pi TUI controller-session operations are blocked in local routed mode, including:

```text
/session
/tree
/clone
/fork
/compact
/reload
/new
```

This keeps the user from accidentally operating on the controller shell when they expect to operate on the routed Pibo session.

Because Pi handles built-in slash commands before extension `input` events, the local routed extension also installs a submit guard for the editor. The guard checks the current editor text only when Enter is pressed and consumes the submit if the text begins with a blocked command such as `/fork`, `/tree`, or `/clone`. Mentions later in normal text, such as `explain /fork`, are still routed as ordinary messages.

## Lifecycle

`runLocalRoutedTui` creates one local client and disposes it in a `finally` block. Closing the client unsubscribes from router events and calls `router.disposeAll()`, which cancels owned runs and disposes routed sessions.

The extension also closes the client on Pi `session_shutdown`, but the entry point remains the hard cleanup boundary.

## Streaming

Assistant deltas from the routed session are rendered into a temporary live widget above the editor. The widget is updated in place so streaming does not append one chat entry per delta. When the final assistant message arrives, the widget is removed and the completed assistant response is rendered as the normal local assistant message.

The local routed TUI does not keep a parallel legacy message renderer. User, assistant, thinking, and tool blocks are rendered through Pi TUI components so local routed output stays visually aligned with the direct Pi CLI. The routed adapter only creates synthetic Pi-compatible message objects at the channel boundary.

Tool calls from the routed session are rendered with Pi's `ToolExecutionComponent`. While a tool is running the component is shown live above the editor; when the tool finishes the same Pi-style tool block is persisted in the local transcript.

Thinking deltas use the same live widget but are hidden by default. `--show-thinking` only controls display; `--thinking` enables the initial Pi thinking level for the routed session. Start with:

```bash
npm run tui:routed -- --thinking high --show-thinking <profile>
```

During a session, `/thinking` keeps the Pi meaning and changes model effort: `/thinking` cycles the level and `/thinking high` sets a specific level. Use `/thinking-show` only to toggle local visibility of thinking tokens. Thinking visibility is local to the routed TUI display; the router still emits thinking events for other channels that want to opt in.

## Verification

Run:

```bash
npm run typecheck
npm test
node dist/bin/pibo.js --help
node dist/bin/pibo.js profile codex
```

Manual interactive smoke test:

```bash
npm run tui:routed -- codex
```
