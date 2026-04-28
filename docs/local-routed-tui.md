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

- `src/local/client.ts` creates the in-process router, profile-scoped binding, and local client methods.
- `src/local/extension.ts` contains the Pi TUI extension, command filtering, autocomplete filtering, and the adapter from normalized routed events to Pi TUI render components.
- `src/local/tui.ts` wires the client and extension into `runPiboTui`.
- `test/local-routed-tui.test.mjs` covers local routing behavior without starting an interactive TUI.

## Sessions

V1 uses an in-memory binding store. The routed session key includes the resolved profile name:

```text
local-tui:<resolvedProfile>:<sessionName>
```

The default session name is `default`, so:

```text
npm run tui:routed -- run-yield-qa
```

routes through:

```text
local-tui:pibo-run-yield-qa:default
```

This avoids reusing a local routed binding created for a different profile.

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
node dist/bin/pibo.js profile run-yield-qa
```

Manual interactive smoke test:

```bash
npm run tui:routed -- run-yield-qa
```
