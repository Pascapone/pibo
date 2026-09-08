---
type: "Validation Report"
title: "Run-reminder admission validation — 2026-09-08"
description: "Records deterministic runtime and headful Chat Web acceptance for nonfatal run-reminder deferral."
tags: ["runtime", "reliability", "validation"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-08T20:00:00Z" }
sources:
  - resource: "../../test/run-reminder-admission.test.mjs"
  - resource: "scope:Implementation commit 75fccac5617c51ae936ccc8cb95c86be71dcbcee"
---

# Scope and result

Issue #988 is covered by the [runtime admission contract](/specs/runtime/capacity-and-scheduling.md#requirement-run-cap-005). The standalone upstream/dev-based candidate passed backend TypeScript compilation and 105 serial regression tests in an isolated Docker worker. A further nine focused yielded-run notification tests passed. Full documentation validation passed without errors or warnings.

The regression advances an injected queue clock beyond ten minutes while a real routed user turn remains active, replaces stale reminders, induces genuine ordinary queue-count pressure, and verifies eventual non-consuming delivery. It correlates the run registry, runtime queue, durable Session/navigation rows, live signals and trace projection.

# Headful Chat Web acceptance

The same deterministic fixture was held at its deferred state and exposed through the actual Chat Web app and Web host inside the isolated worker. Worker dev authentication was used; no host fake-auth gateway or real provider was involved. Browser Use navigated the app in headful Chromium; direct CDP inspected the same target at 1280×900.

- `/gateway/status`: HTTP 200, `processing=true`, `streaming=true`, 64 ordinary messages waiting, and a `Run reminder deferred` runtime warning.
- Durable Session and navigation status: `running`.
- Live latest turn: `running`; pending tracked notifications retained.
- Fatal output count and terminal-error trace-root count: zero.
- Chat Web remained ready, displayed the green running Session lamp and active terminal indicator, and showed no `Session Error` banner.
- The one tool-error badge is expected: the fixture intentionally fails one yielded run. It does not mark the active user turn failed.

Artifacts: [headful screenshot](/reports/artifacts/run-reminder-admission-2026-09-08/active-deferred.png) and [compact correlated assertions](/reports/artifacts/run-reminder-admission-2026-09-08/assertions.json).

# Limits

This is deterministic routed Chat Web acceptance, not a live-provider or Production incident replay. Two broader yielded-Bash lifetime tests could not run because the worker lacks required systemd isolation; resource safeguards were not bypassed. Production gateways and stores were not changed. The temporary test server was bounded and the owned worker/browser lease were released after validation.
