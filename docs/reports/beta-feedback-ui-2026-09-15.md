---
type: "Validation Report"
title: "Pibo 4 Beta feedback UI implementation"
description: "Records isolated implementation and acceptance evidence for Settings scrolling, Room switching, Preview, Web Annotations, and VS Code workspace plugins."
tags: ["pibo-4", "beta", "chat-web", "plugins", "validation"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T21:05:00Z"
sources:
  - id: "candidate-commit"
    resource: "commit:c6e3943096bd45158393d59519b525b4365679c7"
  - id: "research"
    resource: "file:/root/pibo-recovery/beta-feedback-20260915/ui-research.md"
  - id: "baseline"
    resource: "file:/root/pibo-recovery/beta-feedback-20260915/pibo2-ui-baseline.md"
---

# Candidate and isolation

Implementation commit: `c6e3943096bd45158393d59519b525b4365679c7`, based on `upstream/beta/4.0-plugin-system` commit `c10d6cabfdbcdbc4156174a2c9314d6334d7318f`.

All mutable implementation and browser testing ran in the isolated `beta-feedback-ui` worktree and `pibo-dev-beta-feedback-ui` Docker worker. The authenticated parent browser, controller gateway, and Pibo2 runtime were not changed.

# Implemented behavior

- Settings uses a complete `h-full min-h-0` height chain. The selected panel owns vertical scrolling on desktop and mobile while the app shell remains bounded.
- Room selection caches the last committed Session or empty state per Room. A→B→A restores target content, route, history, and `pibo.chat.lastSelection` immediately while forced validation runs. Generation and abort guards reject stale bootstrap/navigation completions.
- Preview is a route-less ordinary plugin workspace view and remains discoverable in the generic New Tab catalog.
- Annotation-intent profiles expose the Web Annotations UI family needed for testing without enabling unrelated mutation tools or overriding explicit contribution disables.
- Packaged browser modules consume the host's React Query peer, fixing Web Annotations rendering under the existing application `QueryClientProvider`.
- `pibo.vscode-web` is the twenty-first Standard plugin package. It supplies an ordinary workspace view, authenticated integration metadata, same-origin URL validation, optional workspace-folder construction, genuine Monaco workbench readiness checks, and bounded unavailable/error/retry states.
- The Pibo 4 Candidate now contains 21 plugin packages and 24 total tarballs.

# Browser evidence

Authenticated headful Chromium evidence in the isolated worker covered desktop and mobile viewports.

- Settings desktop 1440×900: selected panel `clientHeight=820`, `scrollHeight=2034`, and terminal `scrollTop=1214`.
- Settings mobile 390×844: selected panel `clientHeight=748`, `scrollHeight=2010`, and terminal `scrollTop=1262`.
- Delayed and reordered Room requests preserved the latest A→B→A choice. On return to A, the URL, stored selection, and cached Session content updated before validation settled.
- Preview displayed its empty-Session state as an ordinary tab.
- Web Annotations rendered functional content after the shared React Query bridge correction.
- VS Code displayed the intentional unconfigured fallback because no VS Code Web binary was installed.
- Preview, Web Annotations, and VS Code switched without document navigation, survived reload according to the Session tabset, and persisted explicit close behavior.

Evidence images include:

- `/tmp/beta-settings-desktop-fixed.png`
- `/tmp/beta-settings-mobile-fixed.png`
- `/tmp/beta-room-return-pending-fixed.png`
- `/tmp/beta-preview-tab.png`
- `/tmp/beta-web-annotations-tab-fixed.png`
- `/tmp/beta-plugin-tabs-three.png`
- `/tmp/beta-vscode-unavailable.png`

# Verification

The isolated worker passed:

- `npm run build`
- `npm run typecheck`
- `npm run workflows:build`
- the Chat UI production Vite build
- focused Settings, Room navigation, Session workspace, browser-host, Preview, VS Code, annotation-profile, and plugin-selection tests
- Pibo 4 Minimal-Core, packed-distribution, Standard cutover, and Candidate invariants
- `npm run pibo4:artifacts`, which built 21 plugin package artifacts

Only normal Vite chunk-size warnings remained. No failed test or typecheck is accepted by this report.

# Prepared Pibo2 test profile

No Pibo2 state was mutated. For a coordinated future Pibo2 acceptance run, prepare a dedicated test profile with these effective choices:

1. Keep `pibo.preview`, `pibo.web-annotations`, and `pibo.vscode-web` installed and active.
2. Select at least one explicit annotation intent, preferably the read-only `web_annotations_list` tool or the `web-annotations` skill.
3. Confirm the derived `pibo.web-annotations` contributions `annotations`, `build-context`, `terminal`, and the skill view are enabled unless an operator previously stored an explicit disable.
4. Preserve every stored explicit contribution disable; do not bulk-enable the package.
5. Leave mutation tools such as `web_annotations_resolve` unselected unless the test explicitly needs them.
6. Use a fresh Session bound to the dedicated profile, then open Preview, Web Annotations, and VS Code from New Tab.
7. To test VS Code readiness rather than the unavailable state, configure a patched same-origin VS Code Web service through `PIBO_VSCODE_WEB_URL` and optionally `PIBO_VSCODE_WEB_WORKSPACE_ROOT` before the coordinated restart.

The isolated acceptance fixture used profile name `pibo2-ui-test-annotations-20260915` and Session `ps_6cde4f76-ab9e-401c-9b55-9d563d2b3bc0`; those worker-local identifiers are evidence only and are not Pibo2 configuration authority.

# Limits

No Pibo2 deployment, restart, or browser mutation occurred. No real VS Code Web workbench was available, so live ready-state integration remains deployment acceptance work. No controller gateway, runtime adapter, release, publication, push, PR, or merge changed as part of this package.
