# Pibo Exec And Run-Control Handoff

Date: 2026-05-02

## Purpose

This handoff captures the current decision and the unresolved design questions around `pibo_exec`.

The next session should focus on how Pibo should expose command execution when `pibo-run-control` is enabled, and how that execution tool should relate to Pi Coding Agent's built-in `bash` tool.

## Current Decision

The old demo/tooling leftovers were removed from the main product surface:

- `pibo_echo` was removed.
- `pibo_workspace_info` was removed.
- the example plugin, example skill, example channel, and old example context files were removed.
- the gateway producer plugin was parked outside the default plugin registry, but remains available explicitly through the `gateway-producer` profile.

`pibo_exec` remains for now because it is currently the only Pibo-native process-style tool that participates in yielded runs through `pibo_run_start`.

This is a temporary state, not the final design.

## Product Direction

The preferred direction is:

- normal profiles should rely on Pi Coding Agent's built-in tools for normal coding work, especially built-in `bash`.
- Pibo should not permanently expose a worse duplicate shell tool next to Pi `bash`.
- command execution that is specific to Pibo run-control should belong to the `pibo-run-control` capability package.
- if `pibo-run-control` is selected, the package should bring the right executable/yieldable command tool with it automatically.
- the run-control command tool should replace the need for the current always-on `pibo_exec` surface.

In other words, `pibo_exec` should likely become package-owned behavior rather than a default core tool.

## Critical Requirement

The Pibo run-control command tool must not be lower quality than Pi's built-in `bash`.

It should preserve or match the important behavior users expect from Pi's shell execution:

- correct shell resolution and environment handling
- execution in the runtime working directory
- timeout support
- abort handling
- process-tree cleanup, not just killing the immediate shell process
- streamed output updates where Pi supports them
- bounded output returned to the model
- access to full output when truncated
- clear exit code and error reporting
- compatibility with normal synchronous use and yielded background use

If Pibo cannot preserve this level of functionality, keeping Pi `bash` as the primary visible shell tool is safer.

## Important Existing Surfaces

Relevant current code areas:

- `src/plugins/core-tools.ts`: current `pibo_exec` implementation.
- `src/runs/tools.ts`: generated `pibo_run_*` tools.
- `src/core/runtime.ts`: decides which profile tools are yieldable and when run-control tools are generated.
- `src/core/profiles.ts`: profile model for tools and packages.
- `src/plugins/builtin.ts`: built-in profile registration and parked gateway producer registry.
- `<HOME>/code/pi-mono/packages/coding-agent/src/core/tools/bash.ts`: Pi built-in `bash` implementation.
- `<HOME>/code/pi-mono/packages/coding-agent/src/core/tools/index.ts`: Pi built-in tool definitions.

## Design Questions For Next Session

1. Should the run-control package expose a Pibo-named tool such as `pibo_exec`, or should it make Pi's `bash` yieldable through Pibo's run-control wrapper?
2. Can Pibo reuse Pi's `createBashToolDefinition(...)` directly, instead of maintaining a second shell implementation?
3. If reusing Pi `bash`, where should Pibo attach run metadata, cancellation ownership, result persistence, and notifications?
4. Should run-control tools be generated from all visible yieldable tools, or should the package inject its own yieldable process tool when selected?
5. How should the Agent Designer present this so users do not see confusing duplicate command tools?
6. What should happen for profiles where Pi built-in tools are disabled?
7. Does the run-control package need a first-class "command execution" capability distinct from arbitrary yieldable tools?
8. How much policy should Pibo add around command execution now versus later?

## Likely Shape

A promising shape is:

- keep Pi built-in `bash` visible for normal shell work.
- remove `pibo_exec` from the default core profile.
- make `pibo-run-control` responsible for adding a yieldable command execution path.
- implement that path by wrapping or adapting Pi's built-in bash implementation where possible.
- ensure the yielded path uses Pibo's run registry for lifecycle, notifications, read/wait/cancel/ack, and durable state.

This should avoid a permanent duplicate shell tool while still giving Pibo the product-level run-control behavior it needs.

## Non-Goals For The Next Step

- Do not reintroduce `pibo_echo`, `pibo_workspace_info`, or the example plugin.
- Do not move the parked gateway producer back into the default registry.
- Do not add a broad plugin/package system redesign unless the exec/run-control boundary requires it.
- Do not accept a simplified shell implementation that loses Pi bash features.

## Suggested First Investigation

Start by reading Pi's `bash` implementation and Pibo's run-control generation path:

```text
<HOME>/code/pi-mono/packages/coding-agent/src/core/tools/bash.ts
src/core/runtime.ts
src/runs/tools.ts
src/plugins/core-tools.ts
```

Then decide whether `pibo-run-control` can wrap Pi `bash` directly or needs a thin Pibo adapter around Pi's bash definition.
