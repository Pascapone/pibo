# Desktop surface inventory

This inventory records every existing top-level route and session-related side surface found on `upstream/dev` at `2aef2443`.

| Existing surface | Current entry point | Desktop tab behavior | Mobile behavior |
| --- | --- | --- | --- |
| Sessions / Rooms | `/`, `/rooms/*`, `/sessions/*`; `SessionSidebar` | Focus and expand the fixed left navigation; no duplicate right tab | Existing route and drawer |
| Projects | `/projects/*`; `ProjectsArea` | Route tab; project identities may coexist | Existing route-owned area |
| VS Code | `/vscode`; `VscodeArea` | Singleton route tab; existing configuration state when unavailable | Existing route-owned area |
| Workflows | `/workflows*`; `MinimalWorkflowsArea` | Base singleton; distinct draft/view identities may coexist | Existing route-owned area |
| Cron | `/cron`; `CronArea` | Singleton route tab | Existing route-owned area |
| Loops / legacy Ralph | `/loops`, `/ralph`; `LoopArea` | Singleton route tab | Existing normalized route-owned area |
| Agents / Agent Designer | `/agents`; `AgentsView` | Singleton route tab | Existing route-owned area |
| Context | `/context`; `ContextSidebar` and views | Singleton route tab; session context updates its target | Existing route-owned area |
| Settings | `/settings/*`; `SettingsSidebar` and views | Singleton route tab; selected panel updates its target | Existing route-owned area |
| Preview | Session header Preview view; `SessionLivePreviewPanel` | Singleton session tool tab bound to current selected session | Existing session view |
| Raw Events | `RawEventsSidebar` | Singleton session tool tab | Existing session side panel |
| Web Annotations | Session header entry points and `WebAnnotationsSessionPanel` | Singleton session tool tab | Existing session panel/overlay path |
| Runtime Requests | `RuntimeRequestPanel` | Singleton session tool tab | Existing inline session panel |
| Session Inspector | Session metadata, signal snapshot, runtime status | Singleton session tool tab | Existing header/trace inspection remains |
| Terminal / Workflow session views | `SessionTracePane` registry | Terminal is fixed center; Workflow opens from the right-tab catalog and the Desktop center omits the view toggle | Existing route search and view toggle |
| Terminal/Preview fullscreen | `TerminalFullscreenTopBar`, `PreviewFullscreenTopBar` | Fullscreen remains an explicit shell exception | Existing behavior |

The `+` catalog includes all rows that represent destinations or tools. It excludes transient dialogs, delete confirmations, composer menus, upload drop targets, and fullscreen exit bars because they are actions or modal states rather than durable surfaces.
