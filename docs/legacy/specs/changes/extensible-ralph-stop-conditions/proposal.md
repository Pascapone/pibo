# Proposal: Extensible Ralph Stop Conditions

## Why

Ralph currently stops continuous work through a small set of hardcoded controls: manual stop, cancel, `maxIterations`, timeouts, restart recovery, and the `<promise>COMPLETE</promise>` final-answer token. Those controls are useful, but they do not cover project-specific signals such as “stop after three runs without a commit,” “stop when no database record appears,” “stop when a webhook reports success,” or “stop when a custom verifier passes.”

Pibo already treats plugins as the product-boundary extension mechanism. Pi Coding Agent extensions can observe runtime events inside an agent run. Ralph should use both layers: Pibo plugins define durable loop-stop policies, while optional Pi extensions can report run facts that those policies evaluate.

## What Changes

Add an extensible Ralph stop-condition framework.

Pibo plugins will be able to register Ralph stop-condition types. A Ralph job will be able to attach one or more configured condition instances. The Ralph service will evaluate those conditions around each run and combine their decisions deterministically. Built-in conditions will preserve the current behavior for maximum iterations and `<promise>COMPLETE</promise>`.

Users and operators will be able to add custom stop-condition logic through trusted plugin/package registration, then attach configured instances to Ralph jobs through Chat Web or CLI. Custom conditions can evaluate stored Ralph state, the latest run result, job configuration, and optional run facts emitted by runtime extensions.

## Capabilities

### New Capabilities

- `extensible-ralph-stop-conditions`: Pibo plugin API, job policy model, evaluator, UI, CLI, and test coverage for Ralph stop-condition registration and composition.
- `ralph-run-facts`: optional product-level event/signal bridge for runtime extensions and tools to record facts consumed by stop conditions.

### Modified Capabilities

- `continuous-ralph-jobs`: replaces hardcoded stop checks with a condition policy while preserving existing behavior by default.
- `pibo-plugin-system`: gains stop-condition registration as a first-class plugin capability.
- `operator-cli-discovery-and-dispatch`: gains Ralph condition catalog and policy commands.
- `chat-web-browser-shell-state`: the Ralph area gains condition-management UI without changing its route.

## Impact

- **Code:** Add stop-condition types, plugin registry support, evaluator, built-in conditions, persistent policy/state fields, run-fact storage, Chat Web API/UI, and CLI commands.
- **APIs / CLI:** Extend Ralph job create/edit/read payloads with stop policy. Add endpoints and CLI paths for condition catalog and policy editing.
- **Data:** Add durable stop-policy JSON, per-condition state, evaluation diagnostics, and optional run facts. Existing jobs must continue to run with equivalent default behavior.
- **Auth / Security:** Chat Web condition policy mutations remain owner-scoped and same-origin protected. User-authored condition code is trusted-local/operator-controlled and must not be editable by untrusted browser input.
- **Runtime:** Optional Pi Coding Agent extensions may emit run facts for Ralph sessions. They do not directly stop Ralph; Pibo stop-condition evaluation remains authoritative.
- **Docs:** Add this change spec and update `docs/specs/capabilities/continuous-ralph-jobs.md` after implementation lands.
