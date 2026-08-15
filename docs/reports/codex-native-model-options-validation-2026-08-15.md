# Native Codex Model, Options, and Context-Usage Validation — 2026-08-15

## Scope

This report records native Codex checkpoint 9.7 for `@pasko70/pibo@1.7.2` at implementation commit `2d8417c3c15ad78c23a5ad82ef5b3ae8808d8a20`.

The checkpoint adds official native Codex model and runtime-option behavior:

- bounded pagination over stable `model/list`;
- runtime-scoped model metadata, selectable reasoning efforts, native-only effort metadata, service tiers, modalities, defaults, and personality support;
- idle model, reasoning, and Fast Mode controls applied through stable thread/turn fields;
- adapter-native `serviceTier`, `personality`, and `reasoningSummary` profile options;
- active-runtime `/model` menus and model-specific Agent Designer reasoning choices;
- cumulative context usage from `thread/tokenUsage/updated`, including resume replay;
- safe binding metadata for model/reasoning/tier/summary/personality continuity across owned App Server restarts;
- a private child file-creation mask in addition to private Pibo-owned runtime boundaries.

The implementation does not use experimental `thread/settings/update`, scrape terminal output, mutate global Codex configuration, or change the Pi-backed meaning of existing `codex` compatibility references.

## Implemented contract

### Model catalog

The adapter reads visible models through stable `model/list` with bounded pages, entries, cursors, strings, reasoning choices, service tiers, and modalities. Duplicate model, reasoning, or tier identifiers fail closed.

Each runtime model entry includes:

- Pibo provider id `openai-codex`;
- model id and display name;
- Pibo-selectable reasoning options;
- the full native reasoning catalog in bounded `options.nativeReasoningEfforts`;
- default reasoning effort;
- service-tier ids, names, descriptions, and default tier;
- input modalities and personality support.

Native efforts outside Pibo's selectable reasoning vocabulary remain inspectable in model metadata but are not falsely exposed as selectable controls. Agent Designer intersects runtime reasoning values with the selected model, so changing models removes unsupported values such as `max` where appropriate.

### Stable controls

Model, reasoning effort, service tier, reasoning summary, and personality are sent through official stable fields on `thread/start`, `thread/resume`, and `turn/start`.

Controls change only while the session is idle:

- `setModel` validates provider and catalog membership;
- `setReasoning` validates the selected model's advertised efforts;
- Fast Mode maps to the native `priority` service tier only when the selected model advertises it;
- turning Fast Mode off returns to the native default tier;
- App Server's `default` service-tier sentinel is normalized to Pibo normal mode.

The generic `/model` action now requests the active runtime's catalog. Legacy direct Pi routing keeps its existing fallback, while generic runtimes without model support no longer receive an unrelated Pi catalog.

### Restart continuity

Safe selections are stored in binding metadata, not native locators or diagnostics:

- model id;
- reasoning effort;
- service tier;
- personality;
- reasoning-summary mode.

This metadata contains no credentials or user prompt content. It preserves Pibo controls when Codex `0.147.0` reconstructs a resumed thread with catalog defaults rather than the prior turn's reasoning setting. Persisted Pibo active-model selection remains authoritative when present.

### Context usage

The session settings controller subscribes before native resume so it can capture the stable token-usage replay even when the notification follows the JSON-RPC response in the same process read. It keeps cumulative total tokens and model context window, computes percentage when possible, ignores foreign-thread updates, bounds pending thread state, and exposes the result through generic runtime and Pibo status.

## Security and isolation

- Catalog pages, identifiers, descriptions, options, pending thread-state snapshots, and context values are bounded.
- Foreign thread settings, reroutes, and usage never alter the active session.
- Runtime binding metadata contains only safe selections and remains omitted from normal product diagnostics.
- Pibo-owned runtime roots remain private `0700` boundaries and the managed config remains `0600`.
- The owned child process inherits a `0077` file-creation mask without changing the gateway process mask.
- Global Codex state was unchanged by exact validation.
- No OAuth data, API key, access token, refresh token, account metadata, device code, or local developer credential was read, copied, transferred, or emitted.

## Deterministic validation

Primary coverage:

- `test/codex-native-models.test.mjs`;
- `test/codex-native-client.test.mjs`;
- `test/codex-native-process.test.mjs`;
- `test/codex-native-protocol-checkpoint.test.mjs`;
- `test/codex-native-thread.test.mjs`;
- `test/codex-native-turn.test.mjs`;
- `test/codex-native-requests.test.mjs`;
- `test/fixtures/codex-app-server-thread-fake.mjs`;
- `test/chat-ui-agent-designer-autosave.test.mjs`;
- `test/plugin-registry.test.mjs`;
- `test/session-actions.test.mjs`;
- `test/fast-mode-http.test.mjs`.

Covered scenarios include:

1. Stable model-list pagination and protocol defaults.
2. Bounded malformed, duplicate, oversized, and repeated-cursor responses.
3. Runtime capability and options-schema advertisement.
4. Profile option validation and provider validation.
5. Model-specific reasoning and Fast Mode support.
6. Stable turn parameters for model, effort, tier, summary, and personality.
7. Active-runtime model gateway actions and routed status.
8. Foreign notification suppression and native model rerouting.
9. Cumulative context usage and resume replay.
10. Binding-backed model/reasoning/tier continuity when native resume reports defaults.
11. Private child file creation without changing the parent process mask.
12. Agent Designer model-specific reasoning intersections and updated runtime model-card copy.

Final focused Codex suite:

- 52 tests;
- 52 passed;
- 0 failed.

Final workspace validation:

- `npm run typecheck` — passed;
- `npm run build` — passed;
- canonical full suite — 1,717/1,717 passed across 12 suites;
- `git diff --check` — passed.

## Exact Codex 0.147.0 validation on Pibo2

The exact committed package was installed and activated on the dedicated Pibo2 development service.

Validated artifacts:

- implementation commit: `2d8417c3c15ad78c23a5ad82ef5b3ae8808d8a20`;
- package SHA-256: `acd72a44d3d062fb6a4c443392f75a9fd3eaea81f5fd77ce7addf52fa6305113`;
- Codex CLI/App Server: `0.147.0`;
- exact Codex native binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`.

The exact binary used an isolated loopback Responses-compatible provider with deterministic SSE. Authentication remained Pibo2-managed and was not copied into the test runtime.

Exact scenarios passed:

1. `model/list` returned five visible models in order: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.2`.
2. `gpt-5.6-sol` was the default, advertised native `ultra` metadata and the `priority` tier, while Pibo exposed only selectable reasoning values through `max`.
3. A first turn used `gpt-5.6-sol`, reasoning `max`, `priority`, and detailed reasoning summaries through stable turn fields.
4. The same live session disabled Fast Mode, switched to `gpt-5.2`, selected reasoning `low`, and completed a normal-tier turn.
5. Generic status reported the selected model, reasoning, tier support, cumulative tokens, context window, and percentage.
6. After owned App Server shutdown, the same native thread resumed with `gpt-5.2`, restored reasoning `low` from safe binding metadata, replayed cumulative context usage, and completed another turn.
7. App Server's native `default` service-tier response normalized to Pibo normal mode.
8. Pibo-owned runtime boundaries and managed config retained private permissions; child default file creation used the private mask.
9. Global Codex state remained unchanged.
10. All owned Codex processes exited; process counts were zero before and after validation.

The exact validation issued three deterministic provider requests and completed all three model loops.

## Authenticated public Chat validation

After candidate activation, the existing authenticated headful browser loaded the public Chat application successfully.

The active Pi session's `/model` action exercised the new runtime-scoped gateway path and returned four configured provider groups containing 58 models. Chat rendered the model card with the updated text, “Choose a model exposed by the active runtime.” The application had no browser console warnings or errors during the validation.

A public native Codex profile remains intentionally unregistered at this checkpoint, so native model selection through a public Chat session belongs to task 9.11 and later integrated scenarios. Exact native behavior was validated directly through the installed candidate and official App Server.

## Deliberate boundary after checkpoint 9.7

Still pending:

- Pibo MCP tools, external MCP, skills, and context delivery (9.8);
- broader native-tool inspection (9.9);
- Pibo-managed subagents (9.10);
- distinct `codex-native` profile and public Designer/session registration (9.11);
- remaining protocol fixtures and final Codex contract audit (9.12–9.14);
- public native service-restart and cross-runtime integrated scenarios in Milestone 10.

## Result

Task 9.7 is complete. Native Codex now exposes a bounded stable model catalog, model-aware reasoning and service-tier controls, adapter-native options, runtime-scoped model UI, durable safe settings, and cumulative context usage with resume replay. Exact Codex `0.147.0` evidence proves catalog fidelity, stable turn parameters, model/tier/reasoning changes, child-process restart continuity, isolation, and cleanup.
