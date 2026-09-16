---
type: "Validation Report"
title: "Pibo 4 Beta optimistic send and Run Control acceptance"
description: "Records the exact Pibo2 candidate and acceptance evidence for immediate composer clearing, failure restoration, and Run Control delegation under the gateway resource guard."
tags: ["pibo-4", "beta", "chat-web", "optimistic-updates", "run-control", "delegation", "pibo2", "acceptance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-16T17:31:20Z"
sources:
  - id: "accepted-code"
    resource: "commit:699ff36b46f78444a59553c4b89d289f02722606"
  - id: "prior-acceptance"
    resource: "/reports/pibo-4-beta-core-delegation-pibo2-acceptance-2026-09-16.md"
---

# Accepted candidate

Canonical Pibo2 runs the exact committed Pibo 4.0 Beta candidate below. The source commit is pushed to `upstream/beta/4.0-plugin-system`. The controller gateway was not changed, and no npm publication, release, or merge into `dev` or `main` occurred.

| Item | Accepted value |
| --- | --- |
| Source commit | `699ff36b46f78444a59553c4b89d289f02722606` |
| Candidate Assembly SHA-256 | `7147c768911c4389966b24f759da7f298f66a6df153add049606b26e65189331` |
| Core artifact SHA-256 | `cee93595ad9e3b5a8bd65567b9706480f25d05123923db8881387a11ecc1ec7a` |
| Standard artifact SHA-256 | `ca959ed14207c3f8e86dd3f3c5fc2e1cef68495210bf9ac7dc33e53fea3a158a` |
| Cutover plan SHA-256 | `0746df1a06dae5c9ded7327474bdec05714524c6f0e1bd4c660d665e7c304d9c` |
| Candidate contents | 23 Pibo tarballs plus the official Codex CLI and Linux x64 platform tarballs |
| Active command | Content-addressed `@pasko70/pibo-standard@4.0.0-beta.1` with the new prepared Cutover plan |

The active `pibo-web.service` remained stable with zero systemd restarts after activation. Eight consecutive public Chat checks returned HTTP 200 during the activation gate.

# Implemented behavior

The controlled composer clears its draft in the same send interaction that creates the optimistic user message. A transaction-specific draft owner restores the submitted text when delivery fails only while that transaction still owns an unchanged empty draft. A newer edit or send invalidates the older transaction's restoration claim.

The yielded-run resource guard continues to block low host-memory reserve, low V8 heap reserve, yielded-run reservation exhaustion, and configured gateway or Session concurrency. Crossing the gateway RSS threshold alone now produces a warning instead of rejecting the run. This keeps the independent reserve checks as the admission authority and avoids the reported false rejection when the host and heap still have usable capacity.

# Local validation

Focused composer, delivery, resource-guard, run, and Pibo 4 Cutover coverage passed 67 tests with one expected skip and no failures. The production build passed TypeScript, all UI builds, Minimal Core, Standard with 20 plugins, and the 25-tarball Candidate Assembly.

The broad suite reported 3,048 passes, six failures, and ten skips out of 3,064 tests under concurrent execution. Five failed files passed when rerun without competing package builds; the sixth exposed a stale Cutover fixture that still used the retired Delegation plugin as a generic replacement and passed after correction. The exact post-commit Assembly was then rebuilt with its full source commit embedded in the manifest.

# Pibo2 activation and recovery

The installed Pibo2 pool wrapper predates Candidate Assembly support and rejected the outer archive as an ordinary npm package. The current checksum-validating Assembly installer from the accepted build installed all 25 manifest-bound artifacts under the Assembly hash.

Two activation guards then worked as designed. Reusing the preceding Cutover plan rejected the new Core checksum, and starting without a plan rejected an SDK ownership change outside a stopped composition boundary. Each failed attempt was rolled back immediately to the preceding accepted candidate. A newly prepared plan binds the old accepted Core as source, the new Core as target, all 20 plugin artifacts, and the retained active plugin snapshot. That plan performed the atomic stopped-boundary SDK handoff and started successfully.

Before final activation, SQLite's online backup API copied 17 databases. Every copy returned `ok` from `PRAGMA quick_check`. Configuration and systemd drop-ins were retained with the backup. The prior 15 September 12 GB rollback snapshot was removed after the newer snapshot passed verification; Pibo2 then had 17 GB free instead of a full filesystem.

# Headful browser acceptance

Acceptance used the authenticated supervised Pibo2 Chrome instance and the existing Pi profile `pibo2-beta4-acceptance-pi`. The parent and configured child both used GPT-5.6 Luna with Reasoning Effort Medium.

| Scenario | Observation |
| --- | --- |
| Immediate optimistic send | Immediately after the Enter key event, the textarea value was empty and one `Sending message` optimistic row was visible. The same state remained after 100 ms. |
| Failed-send recovery | CDP intercepted one `/api/chat/message` request and returned an intentional HTTP 503. The textarea was empty while the optimistic row existed, then restored exactly `RESTORE_ME_ACCEPTANCE_699ff36b` after rejection while the row disappeared. The draft was cleared after the check. |
| Run Control delegation | Session `ps_5b919181-ec29-4095-a472-9a327a2f826e` completed `pibo_run_start` for `pibo_agents_send_message`, `pibo_run_wait`, and `pibo_run_read`. Run `run_a3b43c9c-0e55-429b-a1e6-d88db9a40658` completed and child Session `ps_1e2daf92-89b8-4934-8388-d59763135f69` returned `RUN_CONTROL_OK`; the parent returned `PARENT_OK: RUN_CONTROL_OK`. |
| Tool and debug presentation | The real Run Control tool rows rendered successfully. Debug mode displayed call duration, estimated call tokens, model input/output, cached and uncached tokens, cache percentage, and cache-write tokens. |

Headful screenshots are retained on the controller at `/root/pibo-recovery/beta-feedback-20260916/pibo2-optimistic-run-control-699ff36b.png` and `/root/pibo-recovery/beta-feedback-20260916/pibo2-run-control-success-699ff36b.png`.

# Remaining operational limitation

The Pibo2 host-level deployment-pool wrapper still needs an update before it can install a Candidate Assembly and select Standard without the scoped installer fallback. This did not affect the exact canonical candidate or the accepted browser and model flows, but it remains a blocker for unattended pool-slot acceptance.
