---
type: "Specification"
title: "Project Validation Contract"
description: "Defines the implemented project validation matrices, deterministic isolation boundaries, and separate real-path evidence classes."
tags:
  - "validation"
  - "testing"
  - "evidence"
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T14:11:18.679Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-10-DELIVERY-VALIDATION"
  package_parent: "ca8de98aaf1a536006b9e5f0e3a070da1d5070bd"
  source_evidence: "performed"
  focused_test_execution: "recorded by the package implementation audit; it does not expand normative scope"
  build_typecheck_package_execution: "recorded by the package implementation audit; it does not expand normative scope"
  live_external_execution: "unperformed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "VALIDATION-PROJECT-001"
      status: "implemented"
      sources:
        - path: "package.json"
          symbol: "scripts.test"
        - path: "scripts/run-test-suite.mjs"
          symbol: "defaultTestFiles"
        - path: "scripts/run-test-suite.mjs"
          symbol: "testRoot"
        - path: "scripts/run-test-suite.mjs"
          symbol: "childEnv"
        - path: "scripts/run-test-suite.mjs"
          symbol: "platformArgs"
        - path: "scripts/run-test-suite.mjs"
          symbol: "child.once(\"close\","
      tests:
        - path: "test/test-suite-home-isolation.test.mjs"
          name: "the canonical test runner cannot read from or write to the invoking Pibo home"
        - path: "test/fixtures/test-suite-home-probe.test.mjs"
          name: "normal test workers receive only the isolated suite home"
      public:
        - "npm test"
        - "scripts/run-test-suite.mjs"
      failures:
        - "Build/spawn/test failure returns nonzero; cleanup targets only the generated suite root."
        - "Replace HOME/USERPROFILE/PIBO_HOME/XDG and clear dangerous worker/MCP variables; Linux/macOS still inherit TEMP/TMP."
        - "Windows adds TEMP/TMP isolation and concurrency four; Linux/macOS use default concurrency and inherited temp variables."
      confidence: "high"
      follow_up: "Run the isolation regression on Linux and Windows, add Linux/macOS TMP/TEMP assertions or isolate them in the runner, and add a selection test proving exactly which nested directories defaultTestFiles includes."
    - id: "VALIDATION-PROJECT-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/testing/contract.ts"
          symbol: "exerciseAgentRuntimeAdapterContract"
        - path: "src/agent-runtime/testing/fake-adapter.ts"
          symbol: "FakeAgentRuntimeSession"
        - path: "src/agent-runtime/testing/fake-adapter.ts"
          symbol: "FakeAgentRuntimeAdapter"
        - path: "src/agent-runtime/testing/fake-adapter.ts"
          symbol: "createFakeAgentRuntimeDriver"
      tests:
        - path: "test/agent-runtime-boundaries.test.mjs"
          name: "generic runtime and router modules do not import Pi, Codex, or adapter implementations"
        - path: "test/app-context-fresh-schema.test.mjs"
          name: "fresh app-context schemas omit retired access-control structures"
        - path: "test/gateway-session-isolation.test.mjs"
          name: "persistSession false uses an in-memory store and leaves the external Pibo home unchanged"
        - path: "test/pibo-home-security.test.mjs"
          name: "default data stores protect Pibo Home outside the CLI"
        - path: "test/npm-package-contents.test.mjs"
          name: "npm package excludes generated VSIX artifacts while keeping runtime assets"
      public:
        - "Agent runtime testing contract"
        - "Deterministic contract and security fixtures"
      failures:
        - "Fixture setup or contract mismatch fails locally without requiring external services."
        - "Use synthetic secrets and isolated homes; boundary tests prohibit adapter-specific imports and unintended host-state access."
        - "Node fixtures are cross-platform where path/process assumptions permit; real host acceptance remains separate."
      confidence: "high"
      follow_up: "Run the named deterministic tests under the isolated runner, audit every test that binds a port or creates a store for temp-root cleanup, and add installed-package fixtures for contracts currently proven only by source text."
    - id: "VALIDATION-PROJECT-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "App"
        - path: "src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx"
          symbol: "ChatTerminalApp"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "main"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "validateStaticFixture"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "validateExistingTargetFixture"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "launchChrome"
      tests:
        - path: "test/chat-ui-integration.test.mjs"
          name: "live stream simulation: thinking -> assistant -> tool -> finish"
        - path: "test/chat-ui-integration.test.mjs"
          name: "incremental patch produces same result as full build for 50+ event stream"
        - path: "test/chat-ui-form-control-identifiers.test.mjs"
          name: "visible Chat Web form controls have stable unique identifiers"
        - path: "test/chat-vscode/integration.test.mjs"
          name: "inliner produces ~800 KB of HTML for the real chat-vscode bundle"
        - path: "test/chat-vscode/session-selector.test.mjs"
          name: "renders the right view for the mode prop"
      public:
        - "Chat Web UI tests"
        - "VS Code webview tests"
        - "Browser/CDP validation"
      failures:
        - "Source/component assertions fail deterministically; browser launch/target/console/network failures belong to separate evidence."
        - "Deterministic tests avoid real credentials; authenticated browser evidence must use isolated approved flows and redact artifacts."
        - "Node tests are the portable tier; browser binaries, fonts, focus, and rendering require target-platform acceptance."
      confidence: "high"
      follow_up: "Run deterministic UI tests, then use a headful browser/VS Code target at relevant viewports with CDP console/network/DOM evidence; retain headless web-annotations validation only as supplemental evidence."
    - id: "VALIDATION-PROJECT-004"
      status: "implemented"
      sources:
        - path: "packages/workflows/package.json"
          symbol: "scripts.test"
        - path: "scripts/run-test-suite.mjs"
          symbol: "defaultTestFiles"
        - path: "test/workflow-v2-release-coverage.test.mjs"
          symbol: "readProjectUiSourceBundle"
        - path: "test/workflow-v2-release-coverage.test.mjs"
          symbol: "readWorkflowUiSourceBundle"
      tests:
        - path: "packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts"
          name: "dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes"
        - path: "packages/workflows/src/testing/workflow-persistence-validation.test.ts"
          name: "recovers completed, failed, waiting, and resumed workflow run facts after SQLite restarts"
        - path: "test/workflow-v2-release-coverage.test.mjs"
          name: "Workflow V2 release unit coverage maps registry, diagnostics, versions, archive, and delete"
        - path: "test/workflow-v2-release-coverage.test.mjs"
          name: "Workflow V2 release integration coverage maps Project workflow snapshots and start gates"
        - path: "test/workflow-v2-release-coverage.test.mjs"
          name: "Workflow V2 release UI coverage maps Builder, routing, and human action surfaces"
      public:
        - "npm test --workspace @pasko70/pibo-workflows"
        - "Root workflow-v2 product tests"
      failures:
        - "A pass in one matrix does not mask or imply a pass in the other."
        - "Deterministic workflow fixtures should remain isolated from host credentials/state; no extra privilege is implied."
        - "Package tests use tsx --test; root tests use the Node runner and therefore have separate platform behavior."
      confidence: "high"
      follow_up: "Run both npm test and the workflows workspace test command, record counts separately, and add a top-level validation script only if the project intends one command to gate both matrices."
    - id: "VALIDATION-PROJECT-005"
      status: "implemented"
      sources:
        - path: "scripts/ink-cli-v2-pty-smoke.mjs"
          symbol: "scenarios"
        - path: "scripts/ink-cli-v2-pty-smoke.mjs"
          symbol: "debugPtyArgs"
        - path: "scripts/ink-cli-v2-pty-smoke.mjs"
          symbol: "parseArgs"
        - path: "scripts/goal-endurance-check.mjs"
          symbol: "runGoalVariant"
        - path: "scripts/goal-endurance-check.mjs"
          symbol: "runBrowserLifecycle"
        - path: "scripts/goal-endurance-check.mjs"
          symbol: "runGatewayRestart"
        - path: "scripts/goal-endurance-check.mjs"
          symbol: "parseArgs"
        - path: "scripts/ink-cli-web-derived-parity-validate.mjs"
          symbol: "checks"
        - path: "scripts/ink-cli-web-derived-parity-validate.mjs"
          symbol: "shouldRun"
        - path: "scripts/legacy-product-vocabulary-gate.mjs"
          symbol: "scanProductVocabulary"
        - path: "scripts/legacy-product-vocabulary-gate.mjs"
          symbol: "runCli"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "main"
        - path: "scripts/validate-web-annotations-browser.mjs"
          symbol: "launchChrome"
      tests:
        - path: "test/ink-cli-v2-pty-smoke.test.mjs"
          name: "Ink CLI V2 PTY smoke runner lists required reusable scenarios"
        - path: "test/ink-cli-v2-pty-smoke.test.mjs"
          name: "Ink CLI V2 PTY smoke runner dry-run emits bounded pibo debug pty commands"
        - path: "test/goal-endurance-check.test.mjs"
          name: "accelerated Goal endurance check covers restart, timeout, lease, pause, budget, and cleanup"
        - path: "test/legacy-product-vocabulary-gate.test.mjs"
          name: "active files fail on retired vocabulary"
        - path: "test/legacy-product-vocabulary-gate.test.mjs"
          name: "historical docs are allowed"
        - path: "test/legacy-product-vocabulary-gate.test.mjs"
          name: "current docs are not allowed"
      public:
        - "scripts/ink-cli-v2-pty-smoke.mjs"
        - "scripts/validate-web-annotations-browser.mjs"
        - "scripts/goal-endurance-check.mjs"
        - "scripts/ink-cli-web-derived-parity-validate.mjs"
        - "scripts/legacy-product-vocabulary-gate.mjs"
      failures:
        - "Timeout, lease, browser, PTY, gateway, or parity failures remain scoped to the invoked check and must be reported with mode/artifacts."
        - "Use bounded isolated artifact roots, avoid unrequested real credentials, and redact provider/browser/session evidence."
        - "PTY/browser/Docker/provider behavior is platform-dependent and requires target-host evidence beyond wrapper tests."
      confidence: "high"
      follow_up: "Run deterministic wrapper tests first, then execute selected real PTY and headful browser/CDP scenarios with bounded artifact roots; schedule real Goal/browser/provider/Pibo2 checks separately and record mode, limits, cleanup, and redaction evidence."
---
# Project Validation Contract

## Authority and evidence boundary

- Stable concept: `SPC-VAL-001`.
- Current-behavior authority: upstream/dev refresh `39090b8850758293e69380a52bb7498d7c955bc2`.
- Raw-package parent: accepted commit `ca8de98aaf1a536006b9e5f0e3a070da1d5070bd`.
- Source and named-test locators identify regular upstream/dev refresh blobs. Executed package checks prove candidate/parent parity only; they do not prove live or external behavior.
- This specification contains implemented current behavior only. Follow-ups and gaps are non-normative.

## Scope

### In scope

- Default build/test runner selection and isolation, deterministic contract fixtures, UI/source tests, workflow package/product matrices, and opt-in PTY/browser/endurance/parity/vocabulary checks.
- The distinction between deterministic default evidence and separately invoked real-path, headful, provider, Docker, and Pibo2 evidence.

### Out of scope

- Subsystem behavior under test; each capability specification owns its implementation contract.
- Build/package/release/deploy implementation, which SPC-DEL-001 owns.
- Automatic execution of workflow-package, test/vscode, browser, Docker, provider, or Pibo2 checks unless the runner or package scripts explicitly invoke them.
- CI policy or release approval.

## Current behavior

### Public surfaces

- npm test and scripts/run-test-suite.mjs.
- Root test/*.test.mjs, test/chat-vscode/*.test.mjs, explicit nested tests, and packages/workflows/src/testing/*.test.ts.
- Ink PTY smoke, web-annotations browser/CDP, Goal endurance, terminal parity, and product vocabulary scripts.

### State

- The runner creates one mkdtemp root with isolated HOME, USERPROFILE, PIBO_HOME, and XDG directories; it clears MCP/test-worker/compute-worker variables and forces yielded-run isolation off.
- On Windows only, the runner also sets TEMP and TMP to its isolated temp directory and caps Node test concurrency at four.
- Fixtures use temporary SQLite stores, fake runtime adapters, local servers, synthetic data/secrets, and one checked-in XState snapshot.

### Lifecycle

- npm test completes npm run build before spawning the isolated Node runner.
- Without explicit paths, the runner sorts and executes only top-level test/*.test.mjs and test/chat-vscode/*.test.mjs, forwards SIGINT/SIGTERM, and removes only its mkdtemp root on child close.
- The workflows package has an independent tsx --test src/**/*.test.ts command; root npm test does not invoke it.
- Real PTY/browser/provider modes remain separate and bounded by script flags, timeouts, scenario lists, durations, and artifact paths.

### Failure

- The runner refuses a resolved HOME/PIBO_HOME outside or equal to the caller's locations and propagates child failure/signal status.
- Deterministic tests fail on import-boundary, schema, isolation, security, rendering, and source-gate violations.
- System scripts report bounded failures and clean temporary processes/roots, but headful and external-provider acceptance is not part of the default suite.

### Security

- Default validation must not touch the invoking PIBO_HOME or inherit compute-worker mode; provider/browser credentials are not required for deterministic tests.
- Synthetic secret fixtures must remain redacted from PTY artifacts.
- Source-string tests prove selected forbidden/required constructs but do not substitute for runtime acceptance.

### Platform and compatibility

- The default Node runner uses Windows concurrency and temp overrides only on win32; Linux/macOS inherit TMP/TEMP even though HOME/PIBO_HOME/XDG remain isolated.
- Some tests import dist output, some inspect source text, and some spawn tsx; the suite is not exclusively an installed-package test.
- Browser validation script validate-web-annotations-browser.mjs launches headless Chromium; headful design acceptance remains separate.

## Requirements and invariants

## Requirement: VALIDATION-PROJECT-001: Current implemented contract

Project validation MUST build before tests, then run sorted top-level and chat-vscode Node tests in an isolated HOME/PIBO_HOME/XDG environment, with Windows-only TEMP/TMP isolation and concurrency four, dangerous environment cleanup, signal forwarding, and exact temporary-root removal.

### Acceptance and boundaries

- Exact source evidence: `package.json:56` — `scripts.test`; `scripts/run-test-suite.mjs:14` — `defaultTestFiles`; `scripts/run-test-suite.mjs:27` — `testRoot`; `scripts/run-test-suite.mjs:48` — `childEnv`; `scripts/run-test-suite.mjs:68` — `platformArgs`; `scripts/run-test-suite.mjs:89` — `child.once("close",`
- Exact named tests: `test/test-suite-home-isolation.test.mjs:8` — “the canonical test runner cannot read from or write to the invoking Pibo home”; `test/fixtures/test-suite-home-probe.test.mjs:7` — “normal test workers receive only the isolated suite home”
- Public surfaces: `npm test`; `scripts/run-test-suite.mjs`
- Failure boundary: Build/spawn/test failure returns nonzero; cleanup targets only the generated suite root.
- Security boundary: Replace HOME/USERPROFILE/PIBO_HOME/XDG and clear dangerous worker/MCP variables; Linux/macOS still inherit TEMP/TMP.
- Platform and compatibility boundary: Windows adds TEMP/TMP isolation and concurrency four; Linux/macOS use default concurrency and inherited temp variables.
- Confidence: **high**
- Evidence gap and follow-up: Run the isolation regression on Linux and Windows, add Linux/macOS TMP/TEMP assertions or isolate them in the runner, and add a selection test proving exactly which nested directories defaultTestFiles includes.

#### Later validation commands

```text
npm test
```


## Requirement: VALIDATION-PROJECT-002: Current implemented contract

Project validation MUST use deterministic fake adapters, temporary stores, fresh schemas, loopback servers, and source-boundary checks to verify runtime, data, gateway, Pibo Home, package, and security contracts without live credentials or host product state.

### Acceptance and boundaries

- Exact source evidence: `src/agent-runtime/testing/contract.ts:14` — `exerciseAgentRuntimeAdapterContract`; `src/agent-runtime/testing/fake-adapter.ts:39` — `FakeAgentRuntimeSession`; `src/agent-runtime/testing/fake-adapter.ts:169` — `FakeAgentRuntimeAdapter`; `src/agent-runtime/testing/fake-adapter.ts:229` — `createFakeAgentRuntimeDriver`
- Exact named tests: `test/agent-runtime-boundaries.test.mjs:45` — “generic runtime and router modules do not import Pi, Codex, or adapter implementations”; `test/app-context-fresh-schema.test.mjs:40` — “fresh app-context schemas omit retired access-control structures”; `test/gateway-session-isolation.test.mjs:56` — “persistSession false uses an in-memory store and leaves the external Pibo home unchanged”; `test/pibo-home-security.test.mjs:64` — “default data stores protect Pibo Home outside the CLI”; `test/npm-package-contents.test.mjs:65` — “npm package excludes generated VSIX artifacts while keeping runtime assets”
- Public surfaces: `Agent runtime testing contract`; `Deterministic contract and security fixtures`
- Failure boundary: Fixture setup or contract mismatch fails locally without requiring external services.
- Security boundary: Use synthetic secrets and isolated homes; boundary tests prohibit adapter-specific imports and unintended host-state access.
- Platform and compatibility boundary: Node fixtures are cross-platform where path/process assumptions permit; real host acceptance remains separate.
- Confidence: **high**
- Evidence gap and follow-up: Run the named deterministic tests under the isolated runner, audit every test that binds a port or creates a store for temp-root cleanup, and add installed-package fixtures for contracts currently proven only by source text.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/agent-runtime-boundaries.test.mjs test/app-context-fresh-schema.test.mjs test/gateway-session-isolation.test.mjs test/pibo-home-security.test.mjs test/npm-package-contents.test.mjs
```


## Requirement: VALIDATION-PROJECT-003: Current implemented contract

Project validation MUST keep deterministic Chat Web and VS Code source/component/integration checks in the Node matrix while treating real browser/CDP and headful visual, focus, keyboard, responsive, and accessibility acceptance as a separate evidence class.

### Acceptance and boundaries

- Exact source evidence: `src/apps/chat-ui/src/App.tsx:259` — `App`; `src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx:47` — `ChatTerminalApp`; `scripts/validate-web-annotations-browser.mjs:22` — `main`; `scripts/validate-web-annotations-browser.mjs:57` — `validateStaticFixture`; `scripts/validate-web-annotations-browser.mjs:113` — `validateExistingTargetFixture`; `scripts/validate-web-annotations-browser.mjs:289` — `launchChrome`
- Exact named tests: `test/chat-ui-integration.test.mjs:631` — “live stream simulation: thinking -> assistant -> tool -> finish”; `test/chat-ui-integration.test.mjs:873` — “incremental patch produces same result as full build for 50+ event stream”; `test/chat-ui-form-control-identifiers.test.mjs:12` — “visible Chat Web form controls have stable unique identifiers”; `test/chat-vscode/integration.test.mjs:14` — “inliner produces ~800 KB of HTML for the real chat-vscode bundle”; `test/chat-vscode/session-selector.test.mjs:69` — “renders the right view for the mode prop”
- Public surfaces: `Chat Web UI tests`; `VS Code webview tests`; `Browser/CDP validation`
- Failure boundary: Source/component assertions fail deterministically; browser launch/target/console/network failures belong to separate evidence.
- Security boundary: Deterministic tests avoid real credentials; authenticated browser evidence must use isolated approved flows and redact artifacts.
- Platform and compatibility boundary: Node tests are the portable tier; browser binaries, fonts, focus, and rendering require target-platform acceptance.
- Confidence: **high**
- Evidence gap and follow-up: Run deterministic UI tests, then use a headful browser/VS Code target at relevant viewports with CDP console/network/DOM evidence; retain headless web-annotations validation only as supplemental evidence.

#### Later validation commands

```text
node scripts/run-test-suite.mjs test/chat-ui-integration.test.mjs test/chat-ui-form-control-identifiers.test.mjs test/chat-vscode/integration.test.mjs test/chat-vscode/session-selector.test.mjs
node scripts/validate-web-annotations-browser.mjs
```


## Requirement: VALIDATION-PROJECT-004: Current implemented contract

Project validation MUST run the workflows package's independent TypeScript test matrix and the root product workflow tests as separate matrices; do not represent root npm test as executing packages/workflows/src/testing.

### Acceptance and boundaries

- Exact source evidence: `packages/workflows/package.json:18` — `scripts.test`; `scripts/run-test-suite.mjs:14` — `defaultTestFiles`; `test/workflow-v2-release-coverage.test.mjs:9` — `readProjectUiSourceBundle`; `test/workflow-v2-release-coverage.test.mjs:20` — `readWorkflowUiSourceBundle`
- Exact named tests: `packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts:38` — “dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes”; `packages/workflows/src/testing/workflow-persistence-validation.test.ts:95` — “recovers completed, failed, waiting, and resumed workflow run facts after SQLite restarts”; `test/workflow-v2-release-coverage.test.mjs:43` — “Workflow V2 release unit coverage maps registry, diagnostics, versions, archive, and delete”; `test/workflow-v2-release-coverage.test.mjs:73` — “Workflow V2 release integration coverage maps Project workflow snapshots and start gates”; `test/workflow-v2-release-coverage.test.mjs:89` — “Workflow V2 release UI coverage maps Builder, routing, and human action surfaces”
- Public surfaces: `npm test --workspace @pasko70/pibo-workflows`; `Root workflow-v2 product tests`
- Failure boundary: A pass in one matrix does not mask or imply a pass in the other.
- Security boundary: Deterministic workflow fixtures should remain isolated from host credentials/state; no extra privilege is implied.
- Platform and compatibility boundary: Package tests use tsx --test; root tests use the Node runner and therefore have separate platform behavior.
- Confidence: **high**
- Evidence gap and follow-up: Run both npm test and the workflows workspace test command, record counts separately, and add a top-level validation script only if the project intends one command to gate both matrices.

#### Later validation commands

```text
npm test --workspace @pasko70/pibo-workflows
node scripts/run-test-suite.mjs test/workflow-v2-release-coverage.test.mjs
```


## Requirement: VALIDATION-PROJECT-005: Current implemented contract

Project validation MUST keep PTY, browser/CDP, Goal endurance, terminal parity, and product-vocabulary checks explicit and bounded; deterministic wrapper tests may validate scenario generation or accelerated modes, while real-time, real-browser, real-gateway, headful, provider, Docker, release, and Pibo2 evidence remains separately invoked and recorded.

### Acceptance and boundaries

- Exact source evidence: `scripts/ink-cli-v2-pty-smoke.mjs:12` — `scenarios`; `scripts/ink-cli-v2-pty-smoke.mjs:258` — `debugPtyArgs`; `scripts/ink-cli-v2-pty-smoke.mjs:314` — `parseArgs`; `scripts/goal-endurance-check.mjs:98` — `runGoalVariant`; `scripts/goal-endurance-check.mjs:241` — `runBrowserLifecycle`; `scripts/goal-endurance-check.mjs:353` — `runGatewayRestart`; `scripts/goal-endurance-check.mjs:505` — `parseArgs`; `scripts/ink-cli-web-derived-parity-validate.mjs:4` — `checks`; `scripts/ink-cli-web-derived-parity-validate.mjs:33` — `shouldRun`; `scripts/legacy-product-vocabulary-gate.mjs:118` — `scanProductVocabulary`; `scripts/legacy-product-vocabulary-gate.mjs:191` — `runCli`; `scripts/validate-web-annotations-browser.mjs:22` — `main`; `scripts/validate-web-annotations-browser.mjs:289` — `launchChrome`
- Exact named tests: `test/ink-cli-v2-pty-smoke.test.mjs:10` — “Ink CLI V2 PTY smoke runner lists required reusable scenarios”; `test/ink-cli-v2-pty-smoke.test.mjs:18` — “Ink CLI V2 PTY smoke runner dry-run emits bounded pibo debug pty commands”; `test/goal-endurance-check.test.mjs:11` — “accelerated Goal endurance check covers restart, timeout, lease, pause, budget, and cleanup”; `test/legacy-product-vocabulary-gate.test.mjs:46` — “active files fail on retired vocabulary”; `test/legacy-product-vocabulary-gate.test.mjs:76` — “historical docs are allowed”; `test/legacy-product-vocabulary-gate.test.mjs:85` — “current docs are not allowed”
- Public surfaces: `scripts/ink-cli-v2-pty-smoke.mjs`; `scripts/validate-web-annotations-browser.mjs`; `scripts/goal-endurance-check.mjs`; `scripts/ink-cli-web-derived-parity-validate.mjs`; `scripts/legacy-product-vocabulary-gate.mjs`
- Failure boundary: Timeout, lease, browser, PTY, gateway, or parity failures remain scoped to the invoked check and must be reported with mode/artifacts.
- Security boundary: Use bounded isolated artifact roots, avoid unrequested real credentials, and redact provider/browser/session evidence.
- Platform and compatibility boundary: PTY/browser/Docker/provider behavior is platform-dependent and requires target-host evidence beyond wrapper tests.
- Confidence: **high**
- Evidence gap and follow-up: Run deterministic wrapper tests first, then execute selected real PTY and headful browser/CDP scenarios with bounded artifact roots; schedule real Goal/browser/provider/Pibo2 checks separately and record mode, limits, cleanup, and redaction evidence.

#### Later validation commands

```text
node scripts/ink-cli-web-derived-parity-validate.mjs --run
node scripts/ink-cli-v2-pty-smoke.mjs --list && node scripts/ink-cli-v2-pty-smoke.mjs --dry-run
node scripts/legacy-product-vocabulary-gate.mjs --json
```


## Interfaces and ownership

### Owned capability IDs

- `pibo.validation.node-suite`
- `pibo.validation.contracts`
- `pibo.validation.ui`
- `pibo.validation.workflows`
- `pibo.validation.system`

### Public surfaces

- npm test and scripts/run-test-suite.mjs.
- Root test/*.test.mjs, test/chat-vscode/*.test.mjs, explicit nested tests, and packages/workflows/src/testing/*.test.ts.
- Ink PTY smoke, web-annotations browser/CDP, Goal endurance, terminal parity, and product vocabulary scripts.

### Linked owners

- [SPC-OP-002](/specs/operator/debug-web-and-pty.md) — linked owner; this specification does not duplicate its contract.
- [SPC-CMP-001](/specs/compute/workers-and-resource-lifecycle.md) — linked owner; this specification does not duplicate its contract.
- [SPC-CMP-003](/specs/compute/browser-pools-and-leases.md) — linked owner; this specification does not duplicate its contract.
## Evidence accounting

- Requirements: 5; confidence: 5 high, 0 medium, 0 low.
- Source-only requirements: 0; requirements with named tests: 5.
- Exact source locators: 33; exact named-test locators: 23.
- Reconciled stale-claim rejections: 7; preserved evidence gaps: 5.

| Evidence class | Rebound status | Boundary |
| --- | --- | --- |
| source inspection | performed | Runner, test fixtures, fake adapter, UI/workflow tests, package scripts, and optional system scripts were inspected. |
| focused tests | unperformed | Named tests were inspected but not run. |
| build package checks | unperformed | No build, package, or installed-artifact check was run. |
| local real path pty headful browser validation | unperformed | No PTY scenario, browser/CDP flow, real path, or headful UI acceptance was run. |
| external provider pibo2 acceptance | unperformed | No real provider or Pibo2 acceptance was run. |

The rebound statuses describe the input audit before this package's deterministic execution. The external and real-path gaps below remain unverified regardless of candidate/parent test parity.

## Reconciled stale-claim rejections

20. Reject the legacy npm test = npm run build && node --test test/*.test.mjs description; current npm test calls scripts/run-test-suite.mjs.
21. Reject claims that root npm test runs workflow package tests; it does not invoke packages/workflows test.
22. Reject claims that root npm test runs test/vscode/*.test.mjs or arbitrary nested test directories; only test/chat-vscode is added to top-level tests.
23. Reject claims that all platforms receive isolated TEMP/TMP; that override is Windows-only.
24. Reject claims that all tests import compiled dist artifacts; several inspect source or run TypeScript through tsx.
25. Reject claims that default validation performs headful browser, Docker, real provider, external Pibo2, release, or deployment acceptance.
26. Reject claims that PTY wrapper tests execute interactive scenarios; current focused tests cover scenario listing and dry-run command generation.

## Evidence gaps and non-normative follow-ups

13. Default root coverage omits workflow package tests and test/vscode tests unless called separately.
14. Linux/macOS temp-path isolation is weaker than HOME/PIBO_HOME isolation because TMP/TEMP are inherited.
15. No single command in package.json composes root, workflows, nested VS Code, headful, Docker, release, and external acceptance matrices.
16. Release and Docker behavior lack focused tests.
17. No local headful or external-provider/Pibo2 evidence was performed in this read-only turn.

These gaps do not define intended behavior. Any implementation change requires a separate plan and later source/test reconciliation.

## Verification and traceability

- Every requirement traces to exact regular files at upstream/dev refresh `39090b8850758293e69380a52bb7498d7c955bc2`.
- Named tests are identified by exact test names. Source-only requirements set `source_inspected: true` and carry a concrete follow-up.
- Deterministic wrappers, source guards, archive checks, and accelerated fixtures are bounded evidence. They are not substitutes for headful VS Code, real workspace activation, real PTY, live browser/CDP, provider, controller gateway, Docker runtime, release publication, deployment, or Pibo2 acceptance.
- Package execution results belong to the implementation audit, not to the normative current-behavior claim.

## Related concepts

- [SPC-OP-002](/specs/operator/debug-web-and-pty.md) — linked owner; this specification does not duplicate its contract.
- [SPC-CMP-001](/specs/compute/workers-and-resource-lifecycle.md) — linked owner; this specification does not duplicate its contract.
- [SPC-CMP-003](/specs/compute/browser-pools-and-leases.md) — linked owner; this specification does not duplicate its contract.
