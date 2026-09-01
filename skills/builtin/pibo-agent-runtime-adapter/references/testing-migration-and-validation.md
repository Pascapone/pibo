# Testing, Migration, and Pibo2 Validation

Use this reference when planning adapter verification, writing full/partial harness evals, migrating existing sessions, packaging, or validating the exact candidate on Pibo2.

## Verification layers

Do not substitute one layer for another.

1. **Static contracts** — typecheck, config schema, capabilities, import boundaries.
2. **Deterministic adapter tests** — fake/native protocol fixtures, lifecycle, events, failures.
3. **Product integration tests** — router, binding store, profiles, Agent Designer, tools/resources, trace/debug.
4. **Migration tests** — old stores, ids/revisions, rollback boundary.
5. **Full regression suite** — preserve existing Pi and product behavior.
6. **Package verification** — installed package contains runtime/skill/protocol assets.
7. **Exact-candidate Pibo2 validation** — real gateway, auth, persistence, restart, browser, cleanup.
8. **Real model proof** — required where streaming/model/tool parity is claimed; auth-failed turns do not count.

## Shared adapter contract

Run `exerciseAgentRuntimeAdapterContract()` against the adapter with deterministic inputs. It checks:

- configured instance/adapter identity;
- diagnostics and profile validation;
- open-session identity and workspace;
- live session contract;
- binding identity;
- prompt lifecycle with turn start and terminal event;
- settled status;
- abort;
- unsubscribe;
- double disposal.

Add adapter-specific tests for every optional capability and protocol behavior not covered by the shared contract.

## Deterministic protocol fixtures

For an RPC/process adapter, fixtures should cover:

- initialize/ready handshake and version negotiation;
- native session/thread create and resume;
- assistant deltas/final content;
- reasoning and content indexes;
- tool call/start/update/result;
- usage/context updates;
- model/reasoning option lists;
- approvals and structured user input;
- native history read/pagination;
- interrupt/abort;
- process crash and EOF;
- malformed JSON/message/schema;
- unknown notification/method;
- duplicate/out-of-order/late events;
- startup timeout and backpressure/overload;
- missing native session;
- cleanup after partial startup.

Pin fixtures to the exact official schema/version that generated them. Store provenance and supported version range.

## Capability contract tests

For each `true` capability, assert the operation and method exist and work. For each delivery capability, assert selected contributions actually arrive by the declared mode.

For each unsupported capability:

- profile selection returns an error diagnostic with a reason;
- Agent Designer remains intelligible and does not silently drop existing selections;
- the live session does not expose a misleading control method;
- direct API calls fail with capability-unavailable behavior;
- Context Build reports unsupported/failed delivery accurately.

Test degraded behavior for the documented fidelity loss, not merely successful startup.

## Full-harness evaluation

A full-harness assessment/scaffold should include:

- exact protocol/version evidence table;
- complete Pibo capability matrix;
- driver/config/adapter/session module map;
- binding state and resume design;
- semantic event and correlation map;
- native prompt/tool preservation plan;
- Pibo tool MCP and external MCP plan;
- selected skills/context delivery and verification;
- models/auth/reasoning/approvals/input/history mapping;
- Agent Designer and disabled-state behavior for any remaining gaps;
- contract/protocol/product/migration/full-suite tests;
- exact Pibo2 restart/resume/browser/failure/cleanup plan.

The output still may leave optional capabilities unsupported when evidence does not prove them.

## Partial-harness evaluation

A partial-harness assessment must:

- classify unsupported and unknown surfaces explicitly;
- avoid invented native ids, resume, history, tools, MCP, skills, context, approvals, model catalog, or reasoning controls;
- use the smallest truthful capability matrix;
- explain useful supported scope;
- map unsupported selections to visible disabled reasons and validation errors;
- avoid terminal scraping or global config hacks;
- identify the exact evidence/API needed to enable each pending capability;
- add negative tests that prevent accidental support claims.

A prompt demanding "full support" does not override protocol facts.

## Product integration matrix

At minimum test:

| Area | Required checks |
|---|---|
| Registry | duplicate ids, malformed config, unavailable instance, diagnostics |
| Router | selected instance, queue, events, abort, disposal, no hard-coded adapter branch |
| Binding | initial state, CAS bind, resume, missing/error, repair/rebind, restart |
| Profiles | default selection, frozen existing sessions, invalid options/resources |
| Designer | runtime catalog, support modes, disabled reasons, stale selection removal |
| Tools | direct/MCP delivery, non-portable rejection, progress, cancellation, payloads |
| MCP | selected-only, cross-session denial, revocation, actual connection inventory |
| Skills/context | selected-only, unselected absence, symlink/size bounds, native prompt intact |
| Subagents | child Pibo Session, cross-runtime target, correlation, cleanup |
| Events | assistant/reasoning/tool/usage/errors, ordering, duplicate/late handling |
| History | product-primary fresh trace, native provider, partial page, missing state, cursor scope |
| Debug/telemetry | runtime identity, payload hydration, redaction, native drill-down |
| Product jobs | Cron, Loop, workflow, run/goal control where supported |

Use the deterministic fake adapter for generic behavior so tests do not depend on a real harness.

## Import-boundary tests

Prevent adapter dependencies from leaking into generic modules. Scan imports or enforce module boundaries so:

- generic runtime/router/history/trace/debug/data/tools code does not import Pi/Codex/other harness packages;
- adapter directories may import their own SDK/protocol;
- compatibility facades are narrow and allowlisted;
- product code does not branch on literal adapter ids where capability dispatch is sufficient.

## Migration tests

When bindings or history metadata change, construct databases from prior schema versions and verify:

- schema upgrades once and is idempotent;
- every existing Pi session receives the correct compatibility binding/metadata;
- fresh sessions do not receive legacy fallback markers;
- Pibo Session ids remain unchanged;
- native ids and transcript paths remain unchanged;
- binding state and revision remain unchanged unless the migration explicitly requires it;
- message/event/payload counts and integrity remain stable;
- uniqueness is adapter-scoped;
- old binaries can ignore additive data within the documented rollback boundary;
- native non-Pi sessions are never silently converted to Pi during rollback.

Use row counts and stable digests before/after on real disposable data.

## Package verification

Build and inspect the tarball:

```text
npm run typecheck
npm run build
npm test
npm pack --dry-run --json
```

Verify it contains:

- compiled adapter/runtime modules;
- protocol schemas/fixtures needed at runtime;
- built-in skills and every referenced skill resource;
- no local credentials, generated runtime state, eval workspaces, or server fixtures.

Import the installed tarball for package-level integration rather than importing the source worktree.

## Exact Pibo2 workflow

Follow the server-development skill. The minimum sequence is:

1. Inspect current version, gateway/process, deployment commit, browser target, database schema/counts/integrity, and host resources.
2. Pack the clean exact implementation commit and record SHA-256.
3. Install under a commit-addressed candidate path.
4. Activate through the approved Pibo2 workflow.
5. Verify the active executable path and deployment commit immediately before validation requests.
6. Run authenticated API/CLI/browser scenarios through the real public gateway.
7. Restart the gateway and prove the same native binding resumes where supported.
8. Exercise missing native state, invalid profile/options, unsupported capability, abort/failure, and cleanup paths.
9. Recheck active executable/commit after requests because another deployment can replace the candidate.
10. Delete temporary sessions/agents/config/payloads/generated directories and restore disposable fixtures.
11. Record final counts, integrity, active processes, and public health.

Do not hard-code server addresses or expose machine keys/cookies/tokens in docs or logs.

## Pibo2 scenario checklist

For a full adapter, validate where supported:

- fresh native session/thread and first turn;
- resumed turn after gateway restart with identical native id;
- native assistant/reasoning/tool streaming;
- native standard tools unchanged;
- Pibo MCP tool in the same session;
- selected external MCP with actual connected inventory;
- selected built-in/plugin/user skill and selected context;
- unselected resource absence;
- model/reasoning/options and auth status;
- approvals/structured input;
- Pibo-managed and cross-runtime subagents;
- Cron/Loop/workflow compatibility;
- abort and process failure;
- missing native session diagnostic;
- product history, native history, trace, debug, telemetry;
- Agent Designer and Context Build;
- browser-visible rendering and performance;
- session/agent deletion and generation cleanup.

For a partial adapter, validate the supported path plus every visible disabled/rejected path. Do not run a scenario that assumes an unsupported feature and then count failure as support.

## Parity evidence

When preserving an existing adapter such as Pi, parity requires:

- full existing suite and build;
- old native sessions reopen without id/path rewrite;
- routing, controls, tools, jobs, subagents, TUI, Chat Web, context, trace, debug, telemetry, and reliability behavior;
- real model streaming/tool behavior on Pibo2.

A turn that reaches queue/idle but fails provider authentication proves only routing/failure handling. It does not prove assistant streaming, tool calls, compaction, or model parity.

## Validation report

Publish validation as an `Evidence Report` at `docs/reports/evidence/<adapter-or-milestone>-validation-YYYY-MM-DD.md`. Read `docs/project/documentation-profile.md` first, include all required frontmatter plus `evidence: { id, published_at }`, register the final SHA-256 in `docs/reports/artifacts/okf-migration/evidence-manifest.json`, and never edit the published bytes in place. Add the ledger record, run `npm run docs:indexes:write`, and update `docs/log.md` explicitly. Corrections and reruns receive a new identity and path.

The report body contains:

- status and scope;
- branch, PR, commits, package version/path/checksum;
- exact harness/protocol versions;
- local typecheck/build/focused/full-suite results;
- migration before/after counts/digests/integrity;
- exact Pibo2 process/commit checks;
- API, debug, telemetry, restart, browser, performance, failure, and cleanup evidence;
- screenshots cropped/redacted to omit identities and unrelated data;
- defects found and fixes made;
- remaining uncertainty and unsupported capabilities.

Do not write the report as if a blocked or untested capability passed.

## Completion gate

An adapter milestone is ready for review only when:

- code and docs agree with the capability matrix;
- all declared capability paths have tests/evidence;
- all unsupported selections have negative tests and visible reasons;
- full regression checks pass;
- the exact candidate was validated where real integration matters;
- cleanup completed;
- branch is clean, pushed, and represented by a focused/stacked PR.
