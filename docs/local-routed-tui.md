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
- `src/local/extension.ts` contains the Pi TUI extension, command filtering, autocomplete filtering, and custom message rendering.
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

## Lifecycle

`runLocalRoutedTui` creates one local client and disposes it in a `finally` block. Closing the client unsubscribes from router events and calls `router.disposeAll()`, which cancels owned runs and disposes routed sessions.

The extension also closes the client on Pi `session_shutdown`, but the entry point remains the hard cleanup boundary.

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
