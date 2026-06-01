# Final Owner Scope Removal Baseline - US-001

Generated: 2026-06-01T04:36Z from inside Docker worker `pibo-dev-final-owner-scope-removal-ralph`.

## Safety boundary

- Normal validation home: `/workspace/.pibo/ralph-test-home`.
- Migration sandbox home: `/workspace/.pibo/ralph-migration-sandbox` (symlink to copied backup sandbox).
- SQLite inspection opened databases with Python `sqlite3` URI `mode=ro`; no migration inspect/dry-run/apply command was run.
- Host `/root/.pibo`, host Dev, Production, and host gateways were not touched.

## Baseline search counts

Active source/docs scope: `src packages scripts skills test docs/project docs/specs docs/plans`.
Full worktree scope: `AGENTS.md GLOSSARY.md IMPLEMENTATION_PROGRESS.md IMPLEMENTATION_INSIGHTS.md docs src packages scripts skills test`, which intentionally includes current reports and raw inventory.

| Pattern | Scope | Files | Matches |
|---|---|---:|---:|
| `ownerScope` | active source/docs | 157 | 1380 |
| `owner_scope` | active source/docs | 59 | 350 |
| `OwnerScope` | active source/docs | 43 | 327 |
| `owner-scope` | active source/docs | 88 | 291 |
| `shared:app` | active source/docs | 23 | 140 |
| `principalId` | active source/docs | 44 | 216 |
| `principal_id` | active source/docs | 17 | 84 |
| `room_members` | active source/docs | 14 | 51 |
| `listOwned` | active source/docs | 7 | 18 |
| `getOwned` | active source/docs | 11 | 31 |
| `requireOwned` | active source/docs | 9 | 25 |
| `personal target` | active source/docs | 15 | 29 |
| `active owner` | active source/docs | 21 | 40 |
| `--owner-scope` | active source/docs | 36 | 102 |
| `ownerScope` | full worktree docs/source/test | 189 | 3736 |
| `owner_scope` | full worktree docs/source/test | 73 | 1223 |
| `OwnerScope` | full worktree docs/source/test | 47 | 1102 |
| `owner-scope` | full worktree docs/source/test | 110 | 1677 |
| `shared:app` | full worktree docs/source/test | 30 | 588 |
| `principalId` | full worktree docs/source/test | 54 | 736 |
| `principal_id` | full worktree docs/source/test | 27 | 374 |
| `room_members` | full worktree docs/source/test | 29 | 273 |
| `listOwned` | full worktree docs/source/test | 13 | 111 |
| `getOwned` | full worktree docs/source/test | 17 | 140 |
| `requireOwned` | full worktree docs/source/test | 15 | 119 |
| `personal target` | full worktree docs/source/test | 20 | 85 |
| `active owner` | full worktree docs/source/test | 25 | 72 |
| `--owner-scope` | full worktree docs/source/test | 45 | 364 |

Command evidence: counts were produced with `node_modules/@vscode/ripgrep-linux-x64/bin/rg -F` because the worker image does not expose a global `rg` binary.

## Fresh test home inventory

- No SQLite databases currently exist in the fresh test home. This is expected for the untouched baseline and keeps it separate from the copied migration sandbox.

## Migration sandbox read-only schema inventory

### `auth.sqlite`

- Tables: 4
- Indexes: 9
- Owner/principal-like tables: none
- Owner/principal-like columns: none
- Owner/principal-like indexes: none

### `chat-agents.sqlite`

- Tables: 1
- Indexes: 3
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `chat_agents.owner_scope` (TEXT)
- Owner/principal-like indexes: `idx_chat_agents_owner`

### `context-files/context-files.sqlite`

- Tables: 2
- Indexes: 4
- Owner/principal-like tables: none
- Owner/principal-like columns: none
- Owner/principal-like indexes: none

### `pibo-cron.sqlite`

- Tables: 2
- Indexes: 6
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `pibo_cron_jobs.owner_scope` (TEXT)
  - `pibo_cron_runs.owner_scope` (TEXT)
- Owner/principal-like indexes: `idx_pibo_cron_jobs_owner`, `idx_pibo_cron_runs_owner_created`

### `pibo-events.sqlite`

- Tables: 5
- Indexes: 13
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `pibo_runs.owner_pibo_session_id` (TEXT)
- Owner/principal-like indexes: `idx_pibo_runs_owner_updated`

### `pibo-ralph.sqlite`

- Tables: 3
- Indexes: 9
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `pibo_ralph_jobs.owner_scope` (TEXT)
  - `pibo_ralph_run_facts.owner_scope` (TEXT)
  - `pibo_ralph_runs.owner_scope` (TEXT)
- Owner/principal-like indexes: `idx_pibo_ralph_jobs_owner`, `idx_pibo_ralph_runs_owner_created`

### `pibo.sqlite`

- Tables: 27
- Indexes: 89
- Owner/principal-like tables: `principal_room_stats`, `principal_session_stats`, `room_members`
- Owner/principal-like columns:
  - `principal_room_stats.principal_id` (TEXT)
  - `principal_session_stats.principal_id` (TEXT)
  - `room_members.principal_id` (TEXT)
  - `rooms.owner_scope` (TEXT)
  - `session_navigation.owner_scope` (TEXT)
  - `sessions.owner_scope` (TEXT)
  - `workflow_lifecycle_events.owner_scope` (TEXT)
  - `workflow_prompt_asset_revisions.owner_scope` (TEXT)
  - `workflow_prompt_assets.owner_scope` (TEXT)
  - `workflow_ui_drafts.owner_scope` (TEXT)
- Owner/principal-like indexes: `idx_room_members_principal`, `idx_session_navigation_owner_room_sort`, `idx_sessions_owner_activity`, `idx_workflow_lifecycle_events_owner`, `idx_workflow_lifecycle_events_project_session`, `idx_workflow_lifecycle_events_workflow`, `idx_workflow_prompt_assets_owner`, `sqlite_autoindex_principal_room_stats_1`, `sqlite_autoindex_principal_session_stats_1`

### `web-annotations.sqlite`

- Tables: 2
- Indexes: 6
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `web_annotation_bindings.owner_scope` (TEXT)
  - `web_annotations.owner_scope` (TEXT)
- Owner/principal-like indexes: `idx_web_annotation_bindings_session`, `idx_web_annotations_session_created`, `idx_web_annotations_session_status_created`

### `web-projects.sqlite`

- Tables: 6
- Indexes: 18
- Owner/principal-like tables: none
- Owner/principal-like columns:
  - `projects.owner_scope` (TEXT)
- Owner/principal-like indexes: none

