---
type: "Validation Report"
title: "Session prefix persistence implementation checkpoint"
description: "Records the partial prefix persistence implementation, deterministic Pi request evidence, cache diagnostics and outstanding all-runtime acceptance."
tags: ["runtime", "session", "prompt-caching", "validation"]
status: "draft"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-08T21:50:00Z"
sources:
  - id: "implementation-plan"
    resource: "scope: docs/prefix-persistence-plan commit e3720d03, docs/plans/persistent-session-prefix-and-cache-diagnostics.md"
    relation: "Owner-authorized implementation scope; remains incomplete."
  - id: "local-tests"
    resource: "scope: test/prefix-capsule.test.mjs, test/prefix-session.test.mjs, test/prefix-resources.test.mjs, test/pi-prefix-http.test.mjs, test/cache-diagnostics.test.mjs and test/model-inference-metrics.test.mjs in this branch"
    relation: "Reproducible deterministic tests in the isolated Docker worker."
---

# Status

This is a partial implementation checkpoint, not completion of the plan or a release acceptance report. Work started from upstream/dev `d631e8f0e88b9e25024e706d79dec62d864f7456` in branch `persist-session-prefix`. Checkpoint commits are `df90b200` and `6da17095`; continuation uses branch/worktree `prefix-runtime-integration` based on those commits. At that checkpoint no production rollout, controller gateway restart, Pibo2 acceptance, or code PR had occurred. The independent PR993 review and exact Pibo2 candidate checks below supersede that historical statement.

The normal router now supports opt-in protection for provably fresh Pi sessions through `sessionPrefixProtection`, defaulting off for new sessions. Existing protected Pi bindings restore even when that rollout switch is off. Other adapters still reject protected bindings before native initialization. This staging boundary must not be represented as all-runtime protection.

# Implemented and exercised

- `src/sessions/prefix-capsule.ts`: opaque content-addressed payload, bounded reference metadata, SHA-256 verification, exclusive temporary creation, file fsync, no-overwrite publication, directory and ancestor fsync, verified reads with bounded size and no symlink following. Unsupported directory fsync fails instead of claiming durability. Unknown/malformed protected metadata is never interpreted as absent. Binding metadata normalization affects metadata only, not model payload bytes.
- `src/sessions/prefix-session.ts`: audited existing binding persistence capability and CAS, sealing before the codec releases a request, duplicate initializer serialization, restart reads, explicit epoch advance primitive. Both SQLite session stores are covered. Legacy history cannot be sealed retrospectively as an invented historical original.
- `src/sessions/runtime-binding.ts`: rejects dropped references, within-epoch mutations, skipped epochs, and native identity/adapter mismatches, including initial imports. JSON property order in persisted metadata is immaterial.
- `src/agent-runtimes/pi/prefix-codec.ts`: Pi 0.85.0 `openai-codex-responses` codec wraps final `onPayload` after provider extensions. Captures instructions, ordered Tool definitions and supported static provider fields, restores that envelope, keeps native input/history owned by Pi, and rejects unsupported APIs or silent configuration/key changes. Executable closures and credential options are excluded. Proof is deliberately `adapter-inputs`.
- Shared metrics now count cache reads as hits; cache writes are displayed separately and missing cache usage stays unknown. CLI trace and Compact Terminal use the same cache-observation logic. A warm predecessor at least 80% cached followed by at most 10%, with both inputs at least 16,384 tokens and a decrease in absolute cache-read tokens, yields a warning. A large appended message with unchanged cached input does not trigger this rule. Missing continuity evidence yields a possible-collapse warning. Compaction/epoch boundaries suppress cross-epoch alarms. Restart and idle time remain correlations.
- Trace inference ownership remains stable across multiple Tools, Endturn and late repeated Usage. No second inference cost is created by a delayed update.

# Adapter matrix and native dependencies

| Adapter / actual identifier | Evidence available | Missing before protected product activation |
|---|---|---|
| Pi / `pi`, SDK 0.85.0, Codex Responses API | Actual loopback HTTP request recording using native ModelRuntime and native JSONL resume; changed base prompt and provider hooks; native Tool call/output; large history | All provider APIs/optional modes; full lifecycle and concurrent native ownership; process-kill fault matrix; complete T01/T04/T08 matrix |
| Codex-native / `codex-native`, installed binary 0.153.2 | Five actual-binary loopback HTTP tests now exercise unchanged resume, changed developer input, changed AGENTS.md, changed Websearch settings, and restored explicit selection. Original input/key remain stable; changed Websearch changes the global Tools envelope. Explicit replay of the original selection restores that envelope in the fixture. | Complete native version/mode/Tool/Reasoning matrix and capture/restore contract for native Tools/instructions/resources; configuration/resource freezing; native lifecycle integration. Local source HEAD is not proven to be the installed binary's exact revision. |
| OMP / `orp`, CLI 18.1.10 / Bun 1.4.0 | Installed exact versions in Docker. Actual HTTP controls identify changed instructions, swallowed request-hook errors, and calendar-dependent historical input. The experimental durable guard restores both envelope and calendar context and blocks dispatch on storage/CAS failure. | Normal adapter activation; native Tool/Reasoning/resource and late-hook matrix; lifecycle transitions; independent child ownership; complete source/version conformance |

Inspection of Codex base-instruction persistence is not proof that all hidden prompt components remain equal. Copying Pibo context files alone cannot satisfy the plan. These missing contracts are implementation dependencies, not accepted exceptions or user-approved scope reductions.

# Docker evidence

Tests ran in the isolated one-off worker `pibo-prefix-implementation`, with a 2 GiB memory limit and source copied into `/workspace`. A normal dev-worker spawn could not reuse the pre-created worktree, so the supported one-off worker was used. The complete `npm run typecheck` and `npm run build` passed. Vite reported large-chunk warnings. Compiler stages were run sequentially. Concurrent compiler attempts exceeded the worker limit (exit 137); this is not evidence of runtime performance.

The focused regression run passed 70 tests across prefix persistence/controller, Pi HTTP, cache diagnostics, inference projection, session binding, portability, restart recovery, adapter registry and debug trace checks. The final rerun passed 72 tests, including all three Pi input sizes, after the final code edits; the complete build also passed again. An additional native-adapter/base-prompt/telemetry regression group passed 134 tests. That group logged two output-identity collision diagnostics during the Codex first-message fixture while all assertions passed; this is retained as an observation, not asserted to be a baseline defect. This is not the entire project's test suite. OKF strict, core, migration, index and log checks passed without warnings; the focused documentation validator suite passed 84 tests.

The Pi fixture uses a loopback Fake Provider, an in-memory test-only credential, and 4,250 / 425,000 / 850,000 characters of repeated history (approximately 1k/100k/200k token-like fixtures, not tokenizer measurements). It generates a native Tool request/result, disposes the actual Pi runtime, changes the custom base prompt and provider hook, then resumes the same native session. The test compares actual HTTP instructions, Tools and cache key, asserts old request input remains a prefix, and checks the old native JSONL bytes remain unchanged. No paid provider call is made. It does not prove arbitrary Reasoning payloads, all extension behaviors, resource restoration or all model APIs.

The pure metadata comparator's 10,000-call microbenchmark passes the p95 1 ms check. It does not measure the full gateway, trace replay, event-loop lag, cold seal I/O, concurrency, TTFT or resume overhead required by T13. Trace reconstruction still scans the loaded projection; it is not a demonstrated constant-cost gateway pipeline.

# Native HTTP follow-up

`test/codex-native-prefix-http.test.mjs` ran with `PIBO_CODEX_PREFIX_BINARY=/tmp/codex-0.153.2` inside Docker: 5 tests passed, zero skipped. It calls Pibo's actual thread controller and the exact installed native executable against an isolated unauthenticated loopback provider. Without an explicitly provisioned binary these tests skip and provide no conformance evidence.

The changed-developer experiment initially also changed AGENTS.md. A failed assertion revealed that the additional message came from AGENTS.md, not the new developer text. The final tests separate these changes: old developer input remains; changed project instructions append. The negative control changes Websearch from disabled to cached and observes nine versus ten global Tools despite identical old input/key. Restoring the captured explicit selection prevents that change. Per-turn `client_metadata` changes are recorded separately from model input; provider internals remain unobserved.

OMP 18.1.10 and Bun 1.4.0 were installed only under the disposable worker's `/tmp/pibo-omp-prefix-native`. The current dev worker is `pibo-dev-prefix-runtime-integration`, holding the complete owner Session ID. Docker events show the earlier one-off worker received SIGTERM, exited with code 0 and was destroyed despite its eight-hour TTL labels; the initiating caller is not identified. The new dev worker rebuilt successfully after an initial compile/install overlap exceeded its 2 GiB limit.

The local checkout's OMP package version is 18.0.0 and is not a version-equivalence proof. A scratch actual-RPC/HTTP probe using custom `models.yml`, `--no-tools`, and native `--resume` records a changed global `instructions` field when `--append-system-prompt` changes. Its old input array and prompt cache key remain identical. The follow-up `test/omp-prefix-http.test.mjs` ran against the exact installed versions with 4 passing native tests and zero skips. Its negative control shows that `--system-prompt` does not restore the final prefix: native project framing and append input are added again. A final `before_provider_request` extension restores the entire non-input OpenAI Responses envelope exactly in this no-tools fixture. The complete durable parent/native dispatch handshake, Tool/Reasoning/resource support and final-hook ordering remain implementation work.

# Pi early restore follow-up

The experimental Pi codec is now version 2 and restores its stored system prompt and Skill catalog before the Pi resource loader runs. This bypasses current selected-context and base-prompt reads in the direct protected runtime path. The catalog itself stores metadata only. The resource follow-up below now supplies durable selected Skill files when the resource service receives the controller; normal router activation remains open. Existing version-1 experimental capsules require recovery rather than silent reinterpretation.

The actual Pi 0.85.0 API exposes the system prompt through `agent.state.systemPrompt`; an attempted setter caused the second request of the native Tool roundtrip to fail and was corrected before validation. Backend TypeScript compilation and 14 focused capsule/controller/Pi HTTP tests passed in `pibo-dev-prefix-runtime-integration`. All three HTTP fixture sizes monitor synchronous and asynchronous reads of the changed selected-context and base-prompt files during resume and observe none. They also verify the original selected context survives in the final HTTP instructions. This remains direct adapter-input evidence, not activation of protected sessions in normal routing.

# Durable resource follow-up

`src/sessions/prefix-resources.ts` captures selected Skill trees, including binary references and executable scripts, and ordered context contributions into one bounded resource capsule. Its private, content-addressed delivery tree has stable paths independent of runtime generation. Publication syncs files and directories before the resource reference is committed through the existing binding CAS. Resolved MCP configuration and process environment are not inputs to this archive. Capture bounds are 2,048 files and 64 MiB of file content; the enclosing capsule remains bounded by the common store.

`SessionPrefixController` now restores or first-seals these resources. The resource service accepts that controller, skips current context/Skill discovery on restore, and continues preparing current MCP credentials separately. Resource disposal removes only temporary generation state. Missing delivery trees can be reproduced from the integrity-checked original capsule; corrupt existing delivered files and missing capsules fail restoration. Binding transitions reject silent resource replacement/removal and adapter mismatches. Codex Skill discovery derives roots from actual selected paths so durable resources do not depend on a generation directory.

The direct resource-service integration passes after the original Skill directory and context file are deleted and the current profile points to nonexistent replacements. Pi's three actual HTTP fixtures now also prepare resources through that service, delete the original Skill directory before resume, read the original Skill from the durable path, and verify unchanged old request instructions/Tools/input. The native history remains Pi-owned. OKF strict validation, index and log checks passed without warnings. The 84 documentation tests passed after removing the Git override used for bundle validation: applying that override to fixture tests incorrectly made their isolated repositories point at the validation repository. The final backend TypeScript compilation and the combined 47-test capsule/controller/resource-service/Pi HTTP/Codex resource/OMP resource suite passed with zero failures or skips. This includes competing captures (one binding commit), missing-capsule failure, and rejection of unexpected delivered files. These tests do not activate protection in normal routing or prove complete native Codex/OMP request restoration.

# Normal router and transition follow-up

The router prepares the audited controller before resources, persists selected resources before native initialization, and forwards the controller into the Pi adapter. The adapter merges the current controller binding metadata when reporting native state, preventing a stale adapter snapshot from dropping a newly committed prefix. First-use Pi state gets a durable native JSONL header before the first model dispatch; the first user input is synced before prefix sealing. A missing native file for an already sealed prefix fails restoration before any request.

The normal-router loopback test seals a fresh session, executes a native Tool roundtrip, disposes the router, deletes the original context file, changes the base prompt, and resumes with rollout disabled. Actual HTTP instructions, Tools, old input and cache key remain equal. Usage includes bounded generation and digest evidence, while native history continuity remains unknown. Deliberately missing native history prevents another HTTP request. The fixture forces SSE and rejects non-loopback fetches. During initial fixture development an invalid test credential reached the real OAuth endpoint because native URL selection overrode the test registry URL; no successful provider completion was observed. Guards and direct native-stream loopback selection now prevent that path.

Compaction has a bounded durable pending receipt before summarization. Native completion and receipt/epoch completion are separate stores; recovery inspects the native ancestry and syncs the native file before the completion CAS. An unchanged head aborts without advancing; a newly appended compaction advances once while retaining the same base capsule. Missing or unrelated ancestry fails closed. Concurrent recovery callbacks share one promise. Pi swallows extension errors, so the first compaction hook explicitly returns cancellation when preparation fails; an unfinished completion receipt gates the next protected dispatch.

The controller fixtures exercise pre-mutation and post-mutation recovery in both session stores, receipt mutation rejection, concurrent callbacks and ambiguous history rejection. These are deterministic state fault fixtures, not the complete process-kill matrix. The 850,000-character actual Pi fixture additionally performs native manual compaction and a further restart, retaining the original instructions/Tools while the history changes and the epoch advances. A larger second turn triggered an overlapping native context-guard compaction and exposed a native `compactionAbortController` race; the final isolated manual-compaction fixture stays below that guard threshold. The overlapping native path still requires explicit acceptance and is not covered by the passing manual case.

The standard Usage stream now emits only bounded identifiers, hashes and known enums. Malformed diagnostic payloads and producer exceptions are dropped without suppressing Usage or assistant output; dropped observations appear in status. No raw prompt or arbitrary extra field is forwarded. The final backend TypeScript compilation and the combined 47-test prefix/controller/resource/Pi HTTP/router/cache group passed with zero failures or skips. This does not establish complete T13/T14 or all-runtime protection.

# Native ownership follow-up

Protected Pi construction and normal router resource preparation now acquire separate SQLite file locks for the Pibo identity and native identity. Each lock uses its own private file, so active sessions do not hold an exclusive transaction on the shared session database. There are no lease heartbeats, expiry guesses or per-turn lock writes. Successful runtime disposal releases ownership; kernel process death releases the operating-system lock. Lock files are never unlinked on release and must not be treated as portable backup artifacts.

The process test kills the owner with SIGKILL and immediately reacquires its lock. It also checks that a failed partial acquisition does not retain an unrelated identity, and that same-process contention cannot accidentally unlock ownership for a third process. The latter test first reproduced a POSIX close-related defect: opening and closing an already existing SQLite inode outside SQLite could release that process's lock. The corrected implementation exclusively creates only absent files and delegates existing file descriptors to SQLite. Release closures refer to the acquired ownership object, so a repeated old release cannot release a later generation. A competing normal router is rejected before another HTTP dispatch while the first runtime remains active.

Backend TypeScript compilation and the combined 49-test prefix/ownership/controller/resources/Pi HTTP/router/cache group passed with zero failures or skips. OKF strict validation also passed without warnings. These claims apply to the in-process Pi path and the tested local Docker filesystem. Independent native child lifetimes for Codex/OMP and shared network filesystem behavior are not yet proven. Integrated memory, file-descriptor, startup and concurrency costs remain part of T13.

# OMP dispatch and calendar follow-up

Two additional actual OMP 18.1.10 controls expose native limitations. A thrown `before_provider_request` error still permits an HTTP request: the runner catches handler errors/timeouts. A changed calendar date on cold resume changes historical input while the native session and cache key stay equal. The native `DateCwdReminderInjector` retains its injection map only in memory; its initial first-user decoration is not persisted in the JSONL history.

`NativePrefixBridge` now provides private authenticated loopback startup/capture IPC. It acknowledges a snapshot only after opaque artifact publication and the existing audited binding CAS. Rejected identity, invalid UTF-8, unavailable snapshot storage and a losing binding CAS do not produce an acknowledgement. Raw native prefix text and thrown errors are not forwarded to standard diagnostics. Ordinary inference requests do not traverse this bridge.

The experimental `createOmpPrefixGuardSource` extension uses the installed native reminder transformer with frozen calendar/CWD arguments, preserves the non-input provider envelope, forces and syncs first-use native persistence, and waits for the durable parent acknowledgement before dispatch. It verifies the acknowledged payload digest, accepts only known request fields, and emits only bounded phase names on fatal failure. Because ordinary native hook errors are swallowed, persistence failure or hook timeout terminates the child instead of allowing the original request to continue. A per-generation readiness nonce lets the parent test reject a missing/unloaded guard before prompting. An initial strict-field check incorrectly rejected fields with `undefined` values that never reach JSON; validation now ignores those non-wire properties and recognizes the native obfuscation transport setting.

The complete guard/bridge group passed 14 tests with zero failures or skips against the actual native binary. This includes a stalled seal: the guard's five-second fatal deadline precedes the native runner's swallowed 30-second handler timeout. A real native `read` Tool roundtrip before and after restart preserves the original Tool result in historical input while a later execution reads the changed file. Freezing native-owned Tool schemas initially broke the second inference; capture now clones those objects once before freezing the stored copy. Capture connection credentials are removed from the child environment after startup and are absent from recorded model requests. Nested provider-managed remote Tool definitions remain rejected until a compatible codec can separate execution credentials from model-visible state.

The actual no-tools native fixture closes and reopens both the child and parent session store, changes append context and calendar getters, and preserves old HTTP instructions/Tools/input/key. Native filesystem failure and binding conflict both exit with code 78 and zero provider requests. These are experimental conformance fixtures, not normal OMP activation. The initial guard rejected compaction, switch and branch operations; the compaction follow-up below adds a durable transition for the tested native path. Switch and branch remain rejected by the experimental guard. Native implicit resources, full Tools/Reasoning behavior, hook ordering across optional extensions and independent child ownership remain open. No all-runtime guarantee follows from this fixture.

# OMP request-hook ordering

Read-only inspection of native OMP 18.1.10 `sdk.ts:771` shows configured extension paths follow CLI paths; `extensibility/extensions/loader.ts:451` binds the resulting order, and `runner.ts:1665` executes request handlers in that order. A last CLI guard is therefore not necessarily the final request handler. The experimental guard now checks the pinned runner's effective handler inventory before capture/dispatch and exits with bounded `hook-order` diagnostics if another request handler follows it. It also detects removal from an already observed protected runner. The bounded inventory walk does not inspect message history.

All nine guarded actual-native HTTP scenarios passed, including a late handler that would replace instructions: zero provider requests and no sealed capsule. Earlier restart, Tool, persistence-failure and compaction fixtures remain green. This is fail-closed coverage, not support for arbitrary extension reloads, new runner replacement or native subagent extension propagation. Those native lifecycle contracts must be completed before normal protected OMP activation.

# OMP compaction transition follow-up

The private IPC now carries bounded compaction preparation/completion receipts in addition to first-use capture. The native extension durably marks the old native head before summarization, flushes and syncs the resulting native history, and completes the existing binding CAS while retaining the base capsule. Native summarization uses OMP's side stream, separate from the main agent's provider-payload hook; its summary prompt is not replaced by the frozen conversation envelope.

Recovery walks bounded native ancestry and accepts only the original head or a descendant containing a compaction entry. An unchanged head aborts without advancing; a completed native compaction advances once. Missing or unrelated ancestry remains a recovery error. The SIGKILL test initially exposed incorrect timing: resolving only at the next provider dispatch sees the already appended next user message. Recovery now also runs at native session start and input acceptance, before that append.

The actual OMP fixtures pass native manual compaction/restart, a rejected parent completion after the native file is persisted, and SIGKILL after durable preparation but before native mutation. Reopening the parent store and child either completes the pending epoch once or aborts it without rewriting the old HTTP input. The combined native HTTP/bridge suite passed 19 tests without failures or skips before the subsequent ownership bootstrap integration. This does not prove automatic/overlapping compaction, shake, remote/snapcompact modes or the complete normal adapter lifecycle.

# Native child ownership bootstrap follow-up

The experimental OMP path now imports the existing ownership implementation inside Bun before importing the native CLI. The child retains its Pibo-identity and known native-identity SQLite locks for its own lifetime. The initial native identity is claimed at native session start, before its first input. A private one-use bootstrap callback connects that claim to the guard; a missing bootstrap blocks guard initialization. Resume claims the known native identity before loading history. This reuses the same lock-file protocol as Node/Pi, with no heartbeat or per-turn lock writes.

A process fixture kills the Node parent with SIGKILL while its Bun child stays alive. Both a Node claimant and a competing Bun bootstrap remain excluded; the competing bootstrap exits before entering the simulated native history loader. Killing the original child releases the lock and permits immediate recovery. The actual OMP date-restore and three compaction/recovery scenarios also passed with this bootstrap: five focused tests, zero failures or skips. The final combined actual-native HTTP, bridge and child-ownership suite passed 20 tests with zero failures or skips. Backend TypeScript and strict OKF validation passed. The complete normal-adapter startup/resource ordering and other native entry distributions remain unproven; these fixtures do not establish production rollout or Codex ownership.

# Startup ordering and native shutdown

A one-use authenticated startup gate lets the Bun bootstrap acquire ownership before the parent prepares resources, then supplies bounded native arguments without shell interpolation. Native module import waits for activation. Rejection, disconnection and a bounded startup deadline prevent import and release child ownership on exit. Four tests cover authentication, duplicate activation, argument bounds, absent-child timeout, actual Bun ownership before resource preparation, and parent cancellation. The guarded actual OMP HTTP fixtures now use this rendezvous on both initial startup and restart. Normal protected-adapter startup ordering remains to be integrated.

Inspection also identified a normal OMP shutdown defect: `ChildProcess.killed` means a signal was sent, not that the child exited. Its use in the escalation timer prevented SIGKILL after an ignored SIGTERM. The new regression test failed against the previous compiled client and passes with the corrected exit/signal-state check. `close()` now awaits process closure with a bounded deadline; normal adapter cleanup awaits it before deleting generation resources. Concurrent and repeated close calls are covered. The first expanded native suite had one compaction-restart startup failure; after the shutdown change and activation integration, all 55 native HTTP/IPC/ownership/runtime/resource tests passed with zero skips. The startup failure's precise cause was not independently established, so this result does not classify it as a proven ownership collision.

# OMP bound-resume recovery follow-up

The normal adapter previously swallowed `switch_session` errors and rebound the fresh startup session. It now requires the persisted native transcript path, an explicitly non-cancelled native acknowledgement, and matching native session ID and transcript in `get_state`. Any failure exits initialization through the existing child/resource cleanup path; the original conversation is not silently replaced. A focused test covers missing paths, RPC failure, cancellation, missing acknowledgement and wrong/missing restored identity. The actual OMP 18.1.10 `switch_session` fixture also passed with equal historical HTTP input, instructions, Tools and cache key. This corrects the prior adapter comment claiming that switching necessarily regenerates the session ID; that claim does not hold in the tested native resume path.

# Codex model-catalog conformance follow-up

The source for the exact tested Codex release was resolved through official `rust-v0.153.2` to commit `657a993cbee87acf52d14b758ce49dbd46d1b8eb`. The controller's existing `/root/code/codex` checkout remains unchanged; only the release object was fetched for read-only comparison. The request builder derives Tool formatting, reasoning and Responses Lite prefix placement from model metadata, independently of stored native history.

Three additional actual-binary controls use a small synthetic-prompt catalog fixture with that release's model metadata shape. Changing `use_responses_lite` after restart inserts native `additional_tools` and base-instruction elements ahead of the old history while keeping the cache key. Applying the old catalog only through `thread/resume` configuration is too late: the native model manager was initialized at process startup. Applying the immutable catalog at process startup preserves the tested HTTP prefix and envelope. The complete Codex conformance suite passes eight tests with no failures or skips. This is evidence for required startup ordering, not a completed Codex capsule/dispatch implementation or all-mode proof.

# Prefix status inspection follow-up

The existing `pibo debug session` and `pibo debug session <id> runtime` output now includes a compact prefix status. It distinguishes absent/unverified state, resource preparation, a stored sealed reference, a pending native transition and invalid/contradictory metadata. Every result says `verification: metadata-only`: no capsule or native history is read, and no wire equality or cache hit is implied. Invalid serialized binding metadata is not silently classified as legacy. The CLI tests verify the inspection does not alter the stored value and does not expose secret metadata values. Backend TypeScript compilation passed; the complete debug CLI, prefix inventory and native IPC group passed 90 tests with zero failures or skips. Restoration from backups, explicit rebaseline actions and product UI recovery remain implementation work.

# Provider authorization and diagnostic failure follow-up

The Pi codec checks current authorization before restoring provider-executed Web search. A revoked Tool, narrowed domain filter or changed external-network permission blocks dispatch instead of restoring an obsolete authorization envelope. Unknown provider Tool fields are rejected before sealing so execution credentials cannot enter the capsule through that route. Local executable Tools remain current and separate from their frozen model-visible schema. The four actual Pi HTTP tests pass with these negative controls and the existing restart/compaction scenarios.

Inference evidence production is best-effort independently of operational prefix validation. A producer exception clears prior evidence, allows dispatch to proceed and lets the routed collector count the unavailable observation. It cannot falsely associate the previous request's evidence with a later one. Both durable store fixtures test failure and recovery; the combined controller/Pi HTTP/routed-session group passed 28 tests without failures or skips. This is focused failure coverage, not the complete integrated T13/T14 gate.

# Pi Responses and model-serialization follow-up

The Pi codec now covers both `openai-codex-responses` and `openai-responses`. The latter places static instructions in leading system/developer input entries. Only these bounded entries are captured and restored; the implementation does not copy or scan the native message history. Changed prefix layout blocks dispatch. The capsule also records effective model compatibility and reasoning mappings, because these determine historical Tool and Reasoning serialization. Equivalent explicit defaults remain compatible; changed effective settings or API require an explicit transition. The experimental Codex Responses codec advances to v3; older experimental capsules require recovery rather than silent conversion.

After system recovery, the combined Pi HTTP, controller, capsule, resources, routed-session and cache diagnostic group passed 50 tests with no failures or skips. The seven HTTP tests cover both APIs at 4,250, 425,000 and 850,000 input characters plus normal routed restore. Native Tool results and opaque encrypted Reasoning survive restart, and large histories retain the existing manual compaction coverage. Negative controls reject unexpected cache-option fields, obsolete provider authorization and incompatible serialization before HTTP dispatch. This remains a partial provider/mode matrix, not all-runtime acceptance.

# Debug UI and CLI evidence

The Docker gateway was authenticated through worker-only dev auth. A disposable Chat session received deterministic warm/cold/warm Usage events, with no provider invocation. The headful Browser Use flow opened Debug and expanded the cache warning. Direct CDP checks at 1365×900 and 390×844 found one warning, three inference metric groups and no horizontal document overflow. The warning displayed 150,543 / 154,255 uncached input, 97.4% previous cache, 2.4% current cache, and explicitly unknown restart/epoch/eviction cause. The following inference displayed 1,953 uncached tokens.

Artifacts are [desktop](artifacts/prefix-persistence-2026-09-08/desktop.png), [mobile](artifacts/prefix-persistence-2026-09-08/mobile.png) and [CDP observations](artifacts/prefix-persistence-2026-09-08/cdp.json). A preview-event SSE request returned HTTP 503; there were no captured JavaScript exceptions. These fixture checks are not exact-final-candidate or Pibo2 acceptance. Native details expansion closes across viewport virtualization/remount and was reopened through pointer input for each viewport.

`pibo debug trace <fixture-session> --check` reported zero issues and the same possible-collapse values and insufficient-evidence classification. The fixture gateway used an earlier local build containing the UI changes; the latest persistence/controller code was compiled and tested separately in `/workspace`. No final package equivalence is claimed.

# Remaining implementation and acceptance

1. Finish the shared protected-open contract, first-use durable native binding and explicit transition/recovery markers. Extend the opt-in Pi router path to the complete supported matrix. Model changes need durable boundaries; compaction has initial receipt/recovery coverage but still needs overlapping native paths and process-kill validation.
2. Complete native implicit-resource coverage and lifecycle/backup references beyond the now-wired normal Pi router resource/controller path. Keep execution credentials and current authorization separate. Validate Tool implementation compatibility.
3. Complete all Pi provider/mode tests and native Codex/OMP contracts and request recordings. Implement required native extensions/version pinning; preserve the plan's guarantee rather than downgrading it to file equality.
4. Integrate fork/import/export, backup/restore, reference-aware retention, explicit refresh, upgrade/downgrade rules and honest legacy inventory. The current backup path does not include prefix artifacts; no GC is enabled. Windows directory durability remains unsupported until a tested implementation exists.
5. Produce compact inference evidence in each adapter and persist it in the existing isolated telemetry pipeline. Pi now produces generation, capsule, epoch, configuration and key digests; other adapters only produce generation/unknown evidence. Add visible prefix/legacy/recovery status and diagnostic loss counters.
6. Complete crash/fault-injection, model/Reasoning/Tool variants, T13 integrated before/after measurements and T14 telemetry failure/secret tests. Complete remaining relevant full test gates, then build and commit the exact integrated package and accept it on Pibo2 before a code PR.

The plan remains open. None of these items is waived by passing the tests above.


# PR993 independent review and Pibo2 acceptance — 2026-09-08

This follow-up supersedes the earlier statement that no exact package was installed on Pibo2. The original PR head was `cb3a13ed43a759caa63accca3ad92e7406421a8c`; the first reviewed candidate was `2452662b2c13dfd5ab824dbb40b11bb831ee9ce6`; the final code candidate adds durable evidence persistence in `9d0e7f4c`. It remains a partial implementation and does not satisfy the full all-runtime plan.

## Reproduced defects and corrections

- **Live Pi Tool compatibility (high):** after sealing, removing a Tool or replacing its schema within the same runtime still dispatched the frozen definition. Compatibility was checked only on restore. Both actual Pi Responses HTTP fixtures reproduced the removed-Tool case (`5` requests instead of the expected `4`). The codec now verifies both the current executable set and the incoming request Tool set before restoring frozen definitions. Missing or incompatible Tools stop before HTTP dispatch. Structural schema comparison also avoids treating property order as a compatibility change.
- **Frozen Skill executable mode (medium):** removing execute permission from a captured script left resource restore successful because verification only compared bytes. A regression reproduced the missing rejection. The bounded file-descriptor read now also verifies the captured executable flag; restore reports recovery required on a mismatch.

## Local Docker validation

Worker: `pibo-dev-review-pr993`, worktree `.worktrees/review-pr993`.

- Full build and `npm pack` prepack build passed; all backend, workflow, Web UI and VS Code typechecks passed.
- Prefix/controller/resource/native IPC/Pi HTTP/cache/projection/router/OMP/Codex-resource/debug checks: **184 passed, 0 failed, 2 skipped** in the serial run. The two skips require Bun for native ownership/startup fixtures. The initial parallel run had one Codex maintenance timeout; the serial rerun passed it.
- Additional OMP/turn/metrics group: **45 passed**, no failures or skips.
- Runtime binding CAS, resource delivery, durable ingest and native-turn boundary group: **55 passed**, no failures or skips. Groups overlap; these counts are not a unique full-suite total.
- Strict OKF validation passed with zero warnings after giving the Docker validator an isolated bare copy of the repository history. The initial worker-only invocation could not resolve traceability commits through the host worktree Git pointer.
- Documentation validator tests: **84 passed**, no failures or skips. They run without the Git environment override because each test owns an isolated fixture repository; the first invocation inherited that override and failed against the wrong repository. Index generation, strict validation and log checks passed.
- The complete repository test suite and the complete real-provider/native-binary matrix were not run in this review.

## First exact Pibo2 candidate

- Package: `@pasko70/pibo@1.7.2`, built from committed code `2452662b2c13dfd5ab824dbb40b11bb831ee9ce6`.
- Archive SHA-256: `c903e241c57009c4d804f4b1b75ee4ca64c75febd0c4a6f1463c60f7627f03ed`.
- Installed runtime: `/opt/pibo-candidates/review-pr993/2452662b/runtime` on the configured Pibo2 SSH target. The installation helper verified the archive hash before installation.
- Isolated lease: `lease_d3e3951ec3bdb0b880`, `slot-01`, holder `ps_3f0abb12-8e2f-48ed-bfc5-556ecb72abe1`, acquired `2026-09-08T20:48:03.590Z`, medium seed.
- Public path: `https://slot-01.pool.pibo2.neuralnexus.me/`. Pool `doctor` confirmed the matching candidate and running container without reconciliation errors. The pool's installed-runtime identity `f0670710aa6d76cb1a0de94d9187fa5fc489ecda28a3a2e099d46478597afd82` is distinct from the archive checksum above.
- Installed-package Pi HTTP/resource checks: **12 passed, 0 failures/skips**, 9.57 seconds. These execute the actual installed Pi runtime against deterministic loopback HTTP, including 4,250/425,000/850,000-character histories, native Tool/Reasoning preservation, compaction, cold restore, ownership contention, rollout-off restore and both review corrections. They are not public real-provider cache-hit measurements.

## Public-path observations and remaining blockers

Machine Auth exchange and authenticated bootstrap succeeded through public HTTPS. The remote browser runs headful Chrome under Xvfb, with loopback CDP tunneled to the controller. No controller gateway was changed.

A newly created normal Web Pi session (`ps_3e0c4789-59be-465d-b270-e0d6f7c4411f`) accepted the exact composer text at `2026-09-08T20:50:26.693Z`, but its durable receipt became `interrupted` before native binding. A separate direct API control (`ps_4b3d1261-4222-4312-a30a-67e31d0a6a1a`) returned HTTP 500 in 82 ms with `Profile "base" requires configured auth for openai-codex/gpt-5.6-sol.` The slot seed lacks that provider authentication. A separate Codex control (`ps_2c646bc2-ad37-4fdb-bda4-0244ff4f6d53`) returned HTTP 500 in 73 ms because Codex App Server could not start; no Codex executable is available on the slot PATH. These failed controls are preserved as environment limitations, not successful model acceptance. The first receipt's generic interrupted status also did not expose the auth failure in the visible trace; existing durable-command recovery issues include #981.

Browser Use's text-input operation duplicated the beginning of the composer value. Read-back detected this before Send; an atomic native textarea setter corrected it and verified the full value before sending. An earlier Browser Use call omitted the explicit CDP URL and unsuccessfully attempted local Chrome startup; all subsequent calls explicitly targeted the remote browser. Neither automation error is counted as a Pibo candidate regression.

The normal `PiboGatewayServer` does not forward `sessionPrefixProtection` to the router, and the standard CLI callers do not enable it. Fresh Web sessions therefore remain unprotected; the opt-in is presently a programmatic router capability. Normal protected Codex/OMP open, explicit transitions/refresh, fork/import/export, backup artifact coverage, recovery/GC and full T13/T14 validation remain outstanding. **Full end acceptance and merge approval are withheld.** Passing installed-package fixtures cannot waive these gaps.


## Final review correction: durable cache evidence

A further integration defect was confirmed while preparing the persistent browser fixture: `ChatDataIngestService` omitted `assistant_usage.cacheEvidence`, and the V2 row mapper did not restore it. Reload/replay therefore lost runtime generation, epoch, configuration and prefix evidence even though live events carried them. The new roundtrip regression failed with stored evidence `undefined`. Commit `9d0e7f4c` preserves the existing bounded allowlist on write and replay; arbitrary extra fields and malformed digests are discarded. The focused ingest/cache/projection/debug group passed **113 tests, no failures/skips**.

The exact native test programs were then provisioned inside the review Docker worker, without changing another worker's sources. All **33 Codex 0.153.2 / OMP 18.1.10 / Bun ownership / native IPC tests passed**, no skips, in 97.67 seconds. These are actual native processes with deterministic HTTP fixtures, not real provider cache-hit measurements. This supersedes the earlier native-binary skip limitation for these fixtures; the complete provider/mode matrix and repository-wide suite remain unproven.


## Final exact Pibo2 candidate and browser acceptance

The final code candidate is `9d0e7f4c`, packaged as `@pasko70/pibo@1.7.2`. Its archive SHA-256 is `8ceeb50625b601e8e9b30b4d0847425905f4797c939dc4e9c2b41d11495bfa90`. The same committed package built and tested locally was installed at `/opt/pibo-candidates/review-pr993/9d0e7f4c/runtime`. Only test fixtures were transferred separately; installed source was not edited.

Pibo2 lease `lease_7b729272b70235e926` used `slot-01`, medium seed, holder `ps_3f0abb12-8e2f-48ed-bfc5-556ecb72abe1`, from `2026-09-08T21:06:12.217Z` through release at `2026-09-08T21:11:29.819Z`. Installed-runtime identity was `325475644a3cc0ca301ca441579c31dc0b07d6437d4ba1d1f811dfa36cd481fc`. The first candidate lease was released at `2026-09-08T21:04:30.667Z`.

The exact installed package passed **27 Pi HTTP, resource and durable-ingest tests**, no failures or skips, in 9.61 seconds. See [installed-package results](artifacts/pr993-review-2026-09-08/runtime-tests.log).

The public HTTPS path successfully exchanged Machine Auth and loaded authenticated bootstrap. A fresh disposable session `ps_5ff0cf7e-ef4b-4163-a737-c204b4240f0a` received deterministic warm/cold/recovery usage through the installed durable ingest and query services. The headful browser reloaded persisted rows, opened Debug and expanded the warning through pointer input. This verifies durable evidence replay and rendering, not actual provider caching or a protected native session.

- Desktop **1365×900** and mobile **390×844** each displayed three inference metric groups, exactly one cache-collapse warning and no horizontal document overflow.
- The warning retained epoch `1`, previous cache `97.4%`, current cache `2.4%`, and `150,543 / 154,255` uncached input. The runtime-generation change was correctly described as observed correlation only, with insufficient evidence and unknown provider eviction cause. The recovery row showed `1,953` uncached input.
- The installed debug trace check reported **zero issues**, with the same cache-collapse values and insufficient-evidence classification.
- A bounded browser capture recorded **zero JavaScript exceptions and zero console errors**. The preview-event SSE path returned HTTP **503**, as in the earlier fixture; network acceptance is therefore not entirely clean. Native details expansion was reopened after viewport remount.

Artifacts: [desktop screenshot](artifacts/pr993-review-2026-09-08/desktop.png), [desktop measurements](artifacts/pr993-review-2026-09-08/desktop.json), [mobile screenshot](artifacts/pr993-review-2026-09-08/mobile.png), [mobile measurements](artifacts/pr993-review-2026-09-08/mobile.json), [browser capture](artifacts/pr993-review-2026-09-08/browser-monitor.json), and [trace check](artifacts/pr993-review-2026-09-08/trace.log).

**Verdict:** the three review corrections pass their regression checks, including exact-package Pibo2 checks and persisted diagnostic UI acceptance. Full feature end acceptance and merge approval remain withheld for the implementation gaps and real-provider environment blockers above. No production rollout or controller-gateway mutation was performed.


## Real-provider follow-up and final code candidate — 2026-09-08

The owner completed Device Code authentication for the standalone Codex CLI and separately for Pibo's isolated Codex and Pi runtime credential stores. This follow-up supersedes the earlier missing-provider-auth and missing-Codex-binary blockers. It does not close the outstanding all-runtime/lifecycle implementation work.

### Additional reproduced defect and correction

The first real protected Pi request using `openai-codex/gpt-5.6-sol` failed before dispatch with `Session prefix recovery required: unsupported reasoning mapping`. The real model catalog contains `thinkingLevelMap: {xhigh: "xhigh", max: "max", minimal: "low"}`; the validator's finite key allowlist omitted `max`. Both local Responses HTTP regression cases reproduced the same error with zero requests instead of two. Commit **`c9231d30`** accepts the supported `max` key while continuing to reject changed mappings before dispatch. Regression coverage exercises the real mapping shape through restart and rejects changing its `max` mapping.

Local worker `pibo-worker-pr993-live-fix` passed the full build, package prepack build, and **39 focused tests**, no failures/skips, in 11.66 seconds. The existing worktree attach failed because the directory already existed; a separately managed worker received an exact Git archive plus the reviewed changes. No controller gateway was changed.

### Exact final installation

- Candidate: **`c9231d30`**, `@pasko70/pibo@1.7.2`.
- Package archive SHA-256: **`ba7960b87a86dea633bc06bfaa09b07d6ec3ac0db836831af598b6ac22514c14`**.
- Installed runtime: `/opt/pibo-candidates/review-pr993/c9231d30/runtime`.
- Lease: `lease_930311280d4ae852a8`, `slot-02`, acquired `2026-09-08T21:43:42.345Z`; [lease identity](artifacts/pr993-live-2026-09-08/lease.json).
- Public URL: `https://slot-02.pool.pibo2.neuralnexus.me/`.
- Full official **`@openai/codex@0.153.2`** installation, including companion executables, was added to the isolated slot. Copying only the main binary initially left `codex-code-mode-host` unavailable; the complete package resolved that installation issue. The original binary checksum was `f8786262ebc0fa1337448a2977332beadec66c8d0cda0ce973c7849766d7943c`.
- Only the owner-authorized test OpenAI credentials were transferred from the preceding owned slot into the matching Pi/native runtime scopes, with file mode `0600`. Credentials and Device Codes are excluded from artifacts.
- The exact installed package passed the same **39 focused tests**, no failures/skips, in **12.60 seconds**; [results](artifacts/pr993-live-2026-09-08/installed-tests.log).

### Actual model and protected restoration evidence

The standalone Codex CLI called **`gpt-5.6-sol`** and returned exactly `PR993_DIRECT_MODEL_OK`; the clean repeat recorded 13,760 input tokens, 10,624 cached input tokens, and 9 output tokens. This provider-reported cache hit proves that invocation only, not the PR's protected prefix contract. See [CLI result](artifacts/pr993-live-2026-09-08/direct-codex.jsonl).

The final installed package's programmatic protected Pi router completed two real model calls in **4.46 seconds**, finishing `2026-09-08T21:44:37.995Z`, session `ps_a50d2c87-0eb9-43b5-93da-7975149b9619`. The first reply was `READY_COMET-993`. After `disposeAll()`, deleting the original context file, changing the host base prompt and reopening with protection rollout disabled, the second reply was exactly `COMET-993 ORBIT-993`. Assertions verified unchanged capsule digest, preserved native-history prefix, changed runtime generation and durable protected restore despite rollout-off. This is disposal/recreation of the native runtime, not a host reboot or a process-kill fault test. See [asserted live result](artifacts/pr993-live-2026-09-08/protected-live.json) and [fixture source](artifacts/pr993-live-2026-09-08/protected-live.mjs). The fixture runs in a disposable directory with `dist` and `node_modules` symlinked to the exact installed package; it uses the already authenticated Pi credential store without logging credentials.

### Public Chat path and qualified Codex result

Machine Auth and authenticated provider status succeeded on the final public slot. The fresh Pi session `ps_284293d6-5d15-468b-9cd4-e0bcb1e477e8` executed the requested shell calculation and returned `PR993_PI_TOOL_OK_437`; its follow-up returned `ORBIT-993`. These ordinary Web sessions remain legacy/unverified because Web rollout wiring is still absent.

The fresh Codex session `ps_c6777c55-6126-4eb5-b85a-4bdae26decd7` reached the real model and native shell tool. Its initial sandbox attempt failed because the pool container cannot create the required user namespace. The exact arithmetic action was then approved once through the headful Chat UI and completed successfully. The namespace failure remains visible as one failed Tool node; the trace consistency check itself has zero issues. No host security setting was weakened.

That final-candidate Codex session replied `437` instead of the requested formatted marker and again replied `437` to the subsequent marker-recall question. This semantic acceptance check **failed**. A bounded inspection of the native rollout confirms both correct user texts arrived and both `437` responses originated in the native assistant output; it is not an observed product-history replay substitution. A fresh no-Tool control, `ps_1d20a966-b3e6-4dc1-9b5f-a718f8a35fcb`, returned `READY` and then exactly `PLANET-993` at `2026-09-08T21:48:48.463Z`. The earlier candidate's tool-and-recall scenario also passed. The evidence does not establish a deterministic Pibo defect, and no speculative response-rewriting fix was applied.

Artifacts: [public final replies](artifacts/pr993-live-2026-09-08/public-finals.log), [public trace checks](artifacts/pr993-live-2026-09-08/public-traces.log), [bounded native message inspection](artifacts/pr993-live-2026-09-08/codex-native-message-check.jsonl), and [fresh Codex recall control](artifacts/pr993-live-2026-09-08/codex-control-final.log).

**Updated verdict:** actual installation, provider authentication, direct model invocation, protected Pi runtime restoration and ordinary Pi Tool/follow-up behavior are accepted for the tested candidate and scenarios. Codex model/Tool transport and a fresh follow-up control work, but its combined Tool/marker scenario did not pass consistently. Full all-runtime end acceptance and merge approval remain withheld for that qualified result and the previously documented product/lifecycle gaps. No merge, release publication or production rollout occurred.


The [headful final-candidate screenshot](artifacts/pr993-live-2026-09-08/codex-control.png) shows the fresh Codex control after navigation/reload with both persisted replies. Strict OKF validation passed with zero warnings; all **84 documentation validator tests** passed. The test-created OpenAI credential entries were removed from both owned slots before release. The preceding lease was released at `2026-09-08T21:51:27.294Z`, and the final lease at `2026-09-08T21:51:27.936Z`; see [cleanup evidence](artifacts/pr993-live-2026-09-08/release.log). The remote browser was stopped.
