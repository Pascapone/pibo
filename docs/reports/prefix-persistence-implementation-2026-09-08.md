---
type: "Validation Report"
title: "Session prefix persistence implementation checkpoint"
description: "Records the partial prefix persistence implementation, deterministic Pi request evidence, cache diagnostics and outstanding all-runtime acceptance."
tags: ["runtime", "session", "prompt-caching", "validation"]
status: "draft"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-08T15:23:00Z"
sources:
  - id: "implementation-plan"
    resource: "scope: docs/prefix-persistence-plan commit e3720d03, docs/plans/persistent-session-prefix-and-cache-diagnostics.md"
    relation: "Owner-authorized implementation scope; remains incomplete."
  - id: "local-tests"
    resource: "scope: test/prefix-capsule.test.mjs, test/prefix-session.test.mjs, test/prefix-resources.test.mjs, test/pi-prefix-http.test.mjs, test/cache-diagnostics.test.mjs and test/model-inference-metrics.test.mjs in this branch"
    relation: "Reproducible deterministic tests in the isolated Docker worker."
---

# Status

This is a partial implementation checkpoint, not completion of the plan or a release acceptance report. Work started from upstream/dev `d631e8f0e88b9e25024e706d79dec62d864f7456` in branch `persist-session-prefix`. Checkpoint commits are `df90b200` and `6da17095`; continuation uses branch/worktree `prefix-runtime-integration` based on those commits. No production rollout, controller gateway restart, Pibo2 acceptance, or code PR has occurred.

The general adapter open paths do not yet automatically seal new sessions. They explicitly reject an existing sealed binding before loading sources or starting a native harness, because those paths do not yet implement complete restore. The direct Pi runtime constructor accepts an explicit controller for the narrow codec and deterministic integration tests. This staging boundary must not be represented as all-runtime protection.

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
| Pi / `pi`, SDK 0.85.0, Codex Responses API | Actual loopback HTTP request recording using native ModelRuntime and native JSONL resume; changed base prompt and provider hooks; native Tool call/output; large history | Shared router resource/controller activation; all provider APIs/optional modes; native first-dispatch skeleton durability; crash-safe compaction/history transitions; full router binding lifecycle; complete T01/T04/T08 matrix |
| Codex-native / `codex-native`, installed binary 0.153.2 | Five actual-binary loopback HTTP tests now exercise unchanged resume, changed developer input, changed AGENTS.md, changed Websearch settings, and restored explicit selection. Original input/key remain stable; changed Websearch changes the global Tools envelope. Explicit replay of the original selection restores that envelope in the fixture. | Complete native version/mode/Tool/Reasoning matrix and capture/restore contract for native Tools/instructions/resources; configuration/resource freezing; native lifecycle integration. Local source HEAD is not proven to be the installed binary's exact revision. |
| OMP / `orp`, CLI 18.1.10 / Bun 1.4.0 | Installed exact versions in Docker. Actual HTTP probe proves changed append-system-prompt changes `instructions` while native input history/key remain equal; `get_state` exposes systemPrompt and Tool schemas. | Supported restoration of full native prompt and ordered Tools, final provider seam proof, resources, all lifecycle transitions and exact version conformance |

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

# Debug UI and CLI evidence

The Docker gateway was authenticated through worker-only dev auth. A disposable Chat session received deterministic warm/cold/warm Usage events, with no provider invocation. The headful Browser Use flow opened Debug and expanded the cache warning. Direct CDP checks at 1365×900 and 390×844 found one warning, three inference metric groups and no horizontal document overflow. The warning displayed 150,543 / 154,255 uncached input, 97.4% previous cache, 2.4% current cache, and explicitly unknown restart/epoch/eviction cause. The following inference displayed 1,953 uncached tokens.

Artifacts are [desktop](artifacts/prefix-persistence-2026-09-08/desktop.png), [mobile](artifacts/prefix-persistence-2026-09-08/mobile.png) and [CDP observations](artifacts/prefix-persistence-2026-09-08/cdp.json). A preview-event SSE request returned HTTP 503; there were no captured JavaScript exceptions. These fixture checks are not exact-final-candidate or Pibo2 acceptance. Native details expansion closes across viewport virtualization/remount and was reopened through pointer input for each viewport.

`pibo debug trace <fixture-session> --check` reported zero issues and the same possible-collapse values and insufficient-evidence classification. The fixture gateway used an earlier local build containing the UI changes; the latest persistence/controller code was compiled and tested separately in `/workspace`. No final package equivalence is claimed.

# Remaining implementation and acceptance

1. Finish the shared protected-open contract, first-use durable native binding and explicit transition/recovery markers. Wire protection into normal session routing only after it is safe. Model changes and compaction require durable boundaries, not merely a helper that increments an epoch.
2. Activate the implemented resource capsule/controller path before normal router resource preparation; complete native implicit-resource coverage and lifecycle/backup references. Keep execution credentials and current authorization separate. Validate Tool implementation compatibility.
3. Complete all Pi provider/mode tests and native Codex/OMP contracts and request recordings. Implement required native extensions/version pinning; preserve the plan's guarantee rather than downgrading it to file equality.
4. Integrate fork/import/export, backup/restore, reference-aware retention, explicit refresh, upgrade/downgrade rules and honest legacy inventory. The current backup path does not include prefix artifacts; no GC is enabled. Windows directory durability remains unsupported until a tested implementation exists.
5. Produce compact inference evidence in each adapter and persist it in the existing isolated telemetry pipeline. The new optional `cacheEvidence` field has no automatic runtime producer yet. Add visible prefix/legacy/recovery status and diagnostic loss counters.
6. Complete crash/fault-injection, model/Reasoning/Tool variants, T13 integrated before/after measurements and T14 telemetry failure/secret tests. Complete remaining relevant full test gates, then build and commit the exact integrated package and accept it on Pibo2 before a code PR.

The plan remains open. None of these items is waived by passing the tests above.
