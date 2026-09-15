---
type: "Validation Report"
title: "Pibo 4.0 plugin system: Pibo2 acceptance"
description: "Records the canonical Pibo2 cutover, retained-session runtime checks, restart idempotence, and authenticated Web acceptance for the Pibo 4.0 plugin candidate."
tags: ["plugins", "pibo-4", "pibo2", "migration", "acceptance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T15:48:23Z"
sources:
  - id: "completion-plan"
    resource: "/plans/pibo-4-0-plugin-completion.md"
  - id: "task-ledger"
    resource: "/plans/pibo-4-0-plugin-completion-todo.md"
  - id: "candidate-commit"
    resource: "commit:cb975d3e91aec82763990ab76b0626d23bd8f2d9"
---

# Accepted candidate

The canonical Pibo2 service accepted the exact locally tested candidate below. No source was edited on Pibo2.

| Item | Accepted value |
|---|---|
| Source commit | `cb975d3e91aec82763990ab76b0626d23bd8f2d9` |
| Standard candidate SHA-256 | `b5f5219b8958584902afdb13c9f6dd3eb889a3c1e9aae8cfe9b73ee5f2ba1f38` |
| Core artifact SHA-256 | `5f624d548907638ddf7a5e31f90ce853895ed339fb5b68039566a5b78945b8ed` |
| Cutover plan SHA-256 identity | `5dcd0e8036a8a503470e065f33f06bd1a0094d2b12917243133cad287f3014c6` |
| Completion receipt file SHA-256 | `7adf5c351dcddcd61bdb072b902fa4186a12443134599be56fb8ed1e8fe18de9` |

# Cutover result

The retained `@pasko70/pibo@1.7.2` package and full installation snapshot were verified before the service switched to Standard 4.0.0 Beta 1. The cutover produced 20 active independent plugin installations. The five aggregate owners `pibo.core`, `pibo.product-ui`, `pibo.standard-shell`, `pibo.user-resources`, and `pibo.web-product` remain only as uninstalled migration tombstones.

The runtime SDK link points to the exact content-addressed candidate Core. Four representative pre-cutover Sessions retained their room, profile, status, history, workspace, and runtime binding. The cutover receipt and the 20-active/5-uninstalled installation state remained unchanged across a canonical service restart.

# Runtime and Web checks

- An existing `pibo-agent-v2` Pi Session resumed its native binding and returned `PIBO4_N033_PI_REPLY_OK`.
- An existing `codex-native` Session resumed and returned `PIBO4_N033_CODEX_REPLY_OK`.
- After the canonical restart, the existing Pi Session returned `PIBO4_RESTART_PI_OK`.
- The authenticated headful browser loaded the existing Desktop Session with retained history and the new response visible.
- The session-owned workspace opened a new tab, then opened Core Settings. General and Plugins rendered in the established sidebar layout.
- The Plugins screen showed the active target packages and the expected uninstalled migration tombstones. Browser DevTools reported no console errors or warnings.
- The new service emitted no retained `maintain-okf-docs` resolution warning. Similar lines found during investigation belonged to the stopped pre-cutover process.

# Scope and remaining actions

This report accepts the implementation and Pibo2 deployment of the Beta candidate. OMP remains within its documented function-preservation boundary and did not receive new reconstruction guarantees. npm publication, a release, a merge into `dev` or `main`, and production rollout beyond Pibo2 were not performed.
