---
type: "Validation Report"
title: "Pibo 4 Beta Core delegation and Codex delivery acceptance"
description: "Records the exact Pibo2 candidate, conditional Core delegation, complete Codex Native delivery, and desktop and mobile scroll acceptance."
tags: ["pibo-4", "beta", "delegation", "codex-native", "pibo2", "acceptance"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-16T09:30:00Z"
sources:
  - id: "accepted-code"
    resource: "commit:2f3159cb64e66081c385668a965593e632f5ca40"
  - id: "completion-plan"
    resource: "/plans/pibo-4-0-plugin-completion.md"
  - id: "task-ledger"
    resource: "/plans/pibo-4-0-plugin-completion-todo.md"
---

# Accepted candidate

Canonical Pibo2 runs the exact committed Pibo 4.0 Beta candidate below. The controller gateway was not changed, no source was edited on Pibo2, and no npm package, release, merge into `dev`, or merge into `main` was performed.

| Item | Accepted value |
| --- | --- |
| Source commit | `2f3159cb64e66081c385668a965593e632f5ca40` |
| Candidate Assembly SHA-256 | `53d311acff2d15ff5effe97565aa80ef0bf90e8927d0d092ed90cf83c6ecf00c` |
| Core artifact SHA-256 | `a47154d8347c68121797cb8ac61bc13170822920c5e1782c5bfc763b5ea569a7` |
| Cutover plan identity | `sha256:0474ff3c3a847d675925d4a3942826a35ed9a82cfc2287e2b0a17546db745a0a` |
| Candidate contents | 23 Pibo tarballs plus the official Codex CLI and Linux x64 platform tarballs |
| Standard composition | 20 active plugin packages; Agent Delegation is Core-owned and absent from Standard |

The active `pibo-web.service` command resolves to the content-addressed Standard runtime for this Assembly. Local and public health checks returned HTTP 200 after activation. The Assembly manifest reports the exact accepted source commit. The bundled `codex-code-mode-host` exists at the official platform-package location and is executable.

# Local validation

The implementation checkpoint before the two presentation-only retirement filters passed the complete serial suite with 3,075 tests, 3,065 passes, no failures, and 10 skips. The final source then passed root and UI typechecking, the complete production build, exact 25-tarball Assembly construction, the packed Standard cutover test, and focused product-runtime, Agent Designer, authenticated Web-dispatch, and retirement tests. The final focused Agent Designer and Web-dispatch run passed 38/38.

The two final changes only remove the retired Delegation tombstone from the Plugin Management and Agent Designer catalog responses. Their tests retain the stored tombstone for migration safety while proving that neither user-facing catalog exposes it.

# Pibo2 browser acceptance

| Scenario | Observation |
| --- | --- |
| Settings desktop, 1440 × 900 | The Plugins content surface had 1,574 px of scroll range and reached its maximum scroll position. |
| Settings mobile, 390 × 844 | The same content surface had 1,622 px of scroll range and reached its maximum scroll position. |
| Session navigation | Room and Session scroll positions remained at 280 px and 430 px across a Session change. |
| Room navigation | The Room position remained at 260 px across Pibo → AI Research → Pibo; the final URL returned to `room_209cf2ff-6b46-4705-a216-a6d2138604bd` without a page reload. |
| Product modules | Preview, VS Code Web, and Web Annotations are active and visible in the installed Standard composition. |
| Tool presentation | Default, Full, Hide, and Slim were selected successfully. Debug mode displayed estimated tool tokens, model input/output, cached and uncached tokens, cache percentage, and context usage. |
| Retired Delegation package | Absent from both `/api/chat/plugins` and `/api/chat/agent-plugin-catalog`; no Agent Designer selection remains. |

Headful screenshots were captured as `/tmp/pibo2-final-settings-desktop.png`, `/tmp/pibo2-final-settings-mobile.png`, `/tmp/pibo2-final-tool-view-menu.png`, `/tmp/pibo2-final-debug-tools.png`, and `/tmp/pibo2-final-accepted.png` on the controller-side acceptance browser.

# Conditional Core delegation

Context Build for Codex Session `ps_ccf7ac91-1500-4819-933a-893685945ea3` reports exactly `pibo_agents_send_message`, `pibo_agents_list_agents`, `pibo_agents_observe`, and `pibo_agents_kill` from the configured `helper` Subagent. The profile does not select Run Control. Context Build for Pi Session `ps_66ad209d-4e4d-4bbe-88cc-f79af71c0aa2`, whose profile has no Subagents, reports no delegation tools.

The direct real-model delegation check used only `openai-codex/gpt-5.6-luna` with Reasoning Effort Medium. The main Codex agent invoked `pibo_agents_send_message` without a Run Control tool. The `helper` completed in eight seconds, read `package.json`, and returned `@pasko70/pibo`. This proves that direct Core delegation and the child runtime work without the optional Run Control plugin.

# Codex Code Mode Host

The same Luna Medium Session executed `codex_command` to read `GLOSSARY.md` and `AGENTS.md`. It returned `# Pibo Glossary` and `## Pi Coding Agent` in six seconds. The command itself completed in 8 ms. The UI exposed model token and cache metrics for the turn. Context Build reports Codex CLI 0.153.2 as available and the private Codex state as ready.

This closes the earlier failure where the runtime could start but local execution failed because `codex-code-mode-host` was absent from the delivered platform package.

# Deployment and source preservation

The old service override and each prepared cutover plan remain in private Pibo2 rollback directories. The final candidate was uploaded under its Assembly checksum, installed by the exact checksum-validating Assembly installer, and activated through a later systemd override. The upstream `beta/4.0-plugin-system` branch was verified at the accepted source commit before this report was added.
