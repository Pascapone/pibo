# US-001 SQLite Owner/Principal Counts

Generated: 2026-05-30
PIBO_HOME: /workspace/.pibo/ralph-sandbox

Read-only inspection. No mutation performed.

## pibo.sqlite
### principal_room_stats
- rows: 0
- principal_id:
  - (no values)

### principal_session_stats
- rows: 321
- principal_id:
  - "shared:app": 302
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 19

### room_members
- rows: 30
- legacy room membership table present: yes
- principal_id:
  - "shared:app": 26
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 4

### rooms
- rows: 28
- owner_scope:
  - "shared:app": 25
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 3

### session_navigation
- rows: 514
- owner_scope:
  - "shared:app": 457
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 57

### sessions
- rows: 515
- owner_scope:
  - "shared:app": 458
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 57

### workflow_lifecycle_events
- rows: 0
- owner_scope:
  - (no values)

### workflow_prompt_asset_revisions
- rows: 0
- owner_scope:
  - (no values)

### workflow_prompt_assets
- rows: 0
- owner_scope:
  - (no values)

### workflow_ui_drafts
- rows: 0
- owner_scope:
  - (no values)

## chat-agents.sqlite
### chat_agents
- rows: 3
- owner_scope:
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 3

## pibo-ralph.sqlite
### pibo_ralph_jobs
- rows: 7
- owner_scope:
  - "shared:app": 4
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 3

### pibo_ralph_run_facts
- rows: 0
- owner_scope:
  - (no values)

### pibo_ralph_runs
- rows: 411
- owner_scope:
  - "shared:app": 360
  - "user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB": 51

## pibo-cron.sqlite
### pibo_cron_jobs
- rows: 1
- owner_scope:
  - "shared:app": 1

### pibo_cron_runs
- rows: 6
- owner_scope:
  - "shared:app": 6

## web-annotations.sqlite
### web_annotation_bindings
- rows: 1
- owner_scope:
  - "shared:app": 1

### web_annotations
- rows: 0
- owner_scope:
  - (no values)

## web-projects.sqlite
### projects
- rows: 1
- owner_scope:
  - "shared:app": 1

## pibo-events.sqlite
### pibo_runs
- rows: 3
- owner_pibo_session_id:
  - "ps_43d015b4-e9af-4502-8bb5-3ef266a0392e": 2
  - "ps_50e31534-e8c7-4466-a864-16d459a5d701": 1

## auth.sqlite
- No owner/principal columns or room_members table found.

