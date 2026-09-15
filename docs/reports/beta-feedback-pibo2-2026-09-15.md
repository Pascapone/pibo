---
type: "Validation Report"
title: "Pibo 4 Beta feedback integration and Pibo2 acceptance"
description: "Records the integrated Beta fixes, exact Pibo2 artifact, native runtime recovery, browser acceptance, and remaining operator workflow gaps."
tags: ["pibo-4", "beta", "plugins", "runtime", "validation"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T22:15:54.548972Z"
sources:
  - id: "accepted-code"
    resource: "commit:f519fc78253b158abf3297d3bb2b8872ee557ff1"
  - id: "operator-evidence"
    resource: "file:/root/pibo-recovery/beta-feedback-20260915/MANAGER.md"
---

# Result

The reported Settings, Room navigation, missing workspace tabs, Codex Native startup, and OMP queue problems were corrected and accepted on the canonical Pibo2 instance on September 15, 2026. The upstream `beta/4.0-plugin-system` branch preserves the work. This is Beta acceptance, not a release or a merge into `dev` or `main`.

## Exact candidate

- Code commit: `f519fc78253b158abf3297d3bb2b8872ee557ff1`.
- Version: `4.0.0-beta.1`, Standard with 21 plugins and 24 assembly tarballs.
- Assembly SHA-256: `5e356509159fa77f5476b5ce4ab9a5dbb407db18a83999023c56bc869eec3059`.
- The live process uses the Standard binary inside that content-addressed runtime. Both deployment commit environment fields and the checksum identify this candidate.
- All 21 current plugins are active; five old migration tombstones remain uninstalled.

The integrated parent commit `0e9089fbf4c81dd516024af54610ca882faaf856` combines the UI worker and runtime worker. The final code change adds valid native skill metadata to the packaged Web Annotations SKILL.md.

## Local Docker evidence

The isolated integration worker passed build and typecheck. Its complete test run passed 3,063 tests, skipped 10, and failed none, out of 3,073 tests; elapsed time was 719 seconds. The worker used a 6 GiB memory limit and recorded no OOM events. Earlier runtime-worker failures under a 2 GiB limit did not recur.

After the skill metadata correction, all 21 plugin artifacts were rebuilt. The packed-distribution and profile-visibility checks passed 7/7. The final assembly was rebuilt sequentially with the full source commit supplied explicitly, then packed and checksum-verified on Pibo2. No source was edited on Pibo2.

[UI implementation evidence](/reports/beta-feedback-ui-2026-09-15.md) records the focused regressions and isolated headful checks.

## Public authenticated acceptance

| Scenario | Observation |
| --- | --- |
| Settings desktop, 1431 × 908 | Content viewport 868 px, content 2468 px; a wheel gesture reached scrollTop 1600. |
| Settings mobile, 390 × 844 | Content viewport 748 px, content 2460 px; a real CDP touch swipe reached scrollTop 588. |
| Room Pibo → Personal Chat → Pibo | Browser Use clicks returned to the Pibo Room without reload; URL, stored selection, and selected Session agreed after settling. |
| Preview | Discoverable ordinary plugin tab; its empty Session state renders and survives reload. No live Preview server was created in this acceptance pass. |
| VS Code | Existing authenticated same-origin code-server loaded a genuine Monaco workbench. The iframe became visible with aria-hidden=false. |
| Web Annotations | The selected plugin view rendered without a missing QueryClient error; tab state survived reload. |
| Original OMP Session | Final command completed in 5,191 ms. Queue empty, queueState idle, processing and streaming false. |
| Original Codex Native Session | Unchanged active model gpt-6-astra answered OK. Final command completed in 5,984 ms; binding reports Codex protocol version 0.153.2, queueState idle, no runtime errors. |
| Separate Codex test profile | gpt-5.6-sol answered PIBO_BETA_CODEX_SOL_OK in 3,494 ms with the packaged Web Annotations skill enabled. |

Original sessions: Codex `ps_e9618f0f-8635-43c3-8fd3-a6604c6e9771`; OMP `ps_6c1df667-01bb-4e7e-b0b3-a49e8bd10cd9`. The dedicated profile `pibo2-beta4-acceptance` and Session `ps_3a53e9a0-428d-4c92-bbec-b07bff338e62` remain in Room `room_209cf2ff-6b46-4705-a216-a6d2138604bd` for user testing. Only that profile explicitly selects the annotation views and read tool; existing profile disables were preserved.

Headful screenshots and API receipts are retained under the operator-evidence directory: `settings-after-desktop.png`, `settings-after-mobile.png`, `vscode-ready.png`, `annotations-ready.png`, `final-codex-tabs.png`, `final-original-codex.png`, and `final-runtime-receipts.json`.

## Runtime and deployment corrections

The Pibo2 systemd configuration selected Codex CLI 0.147.0 through a lexically later override. The already installed 0.153.2 binary was hidden by that PATH. A final override now selects the supported binary while preserving the Bun path for OMP. The original gpt-6-astra configuration was never replaced; the earlier absent-model result came from the older executable.

The runtime code also validates the effective native model before binding, exposes queue blocking reasons, reports known pre-dispatch failures as failed commands, and reads OMP fork candidates passively instead of holding a live native-operation gate.

The first Codex request had remained interrupted. After inspecting its unbound native identity and prior error, the existing message-queue reconciliation API marked that exact command failed using its expected state, token, and timestamp. An operator audit event was recorded; the command was not replayed.

## Preserved state and controlled recovery

Before canonical activation, eight SQLite databases were backed up through SQLite's online backup API, together with configuration, service overrides, and migration inputs. The remote private backup is `/root/pibo-acceptance/beta-feedback-0e9089fb/preupgrade`.

Cold activation refused old reserved generation admissions. Each failed activation rolled its database transaction back, and the previous working candidate was restored. After proving a later gateway start and control-group termination of the prior process, exact old reservation snapshots were released through the existing PluginManager API with revision checks. Twenty historical reservations and three subsequent test reservations were recovered in separate recorded batches. Sessions, bindings, messages, and payloads were retained; no uncertain message was replayed.

The operator API bundles were built from the tested source inside Docker and transferred with checksums. These were scoped recovery tools, not remote edits to the product or controller gateway.

## Follow-up work

1. Provide a supported, discoverable stopped-process generation-admission recovery workflow. Normal cold upgrades currently block on retained reservations, including reservations from completed or failed test turns.
2. Update the Pibo2 pool operator installation. Its old wrapper neither installs the new assembly nor selects Standard when handed an installed runtime; it launched Minimal-Core with zero plugins. Lease `lease_704253b034cca9df3b` was released, and that slot was not counted as acceptance.
3. Keep the installed debug/operator CLI aligned with the Standard candidate. The older host CLI lacked the message-queue command referenced by the API error.
4. Correct the agent PATCH route's rejection of a pluginSelection-only update. The acceptance profile migration succeeded when accompanied by its description field; contribution choices were unchanged.

These operator gaps do not invalidate the tested user flows, but require work before claiming unattended upgrade or release readiness. GitHub issue lookup/creation was unavailable in this operator environment (`gh` missing and delegated native tools returned Auth required); the confirmed findings are retained here for subsequent triage.
