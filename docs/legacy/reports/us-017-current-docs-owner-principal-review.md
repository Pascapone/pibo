---
type: "Historical Record"
title: "US-017 Current Docs Owner/Principal Review"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/reports/us-017-current-docs-owner-principal-review.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "36ebb7a50bc5b83a9c0f1b7ae74c3ebc094966dc"
  source_bytes: 3309
  source_sha256: "394da8ba629da1f1c3d28bc94a49842fd0c00ead0706d234989200475ae79502"
  source_body_sha256: "394da8ba629da1f1c3d28bc94a49842fd0c00ead0706d234989200475ae79502"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# US-017 Current Docs Owner/Principal Review

Date: 2026-05-30

## Scope

Reviewed current project documentation for shared-app alignment, focusing on:

- `GLOSSARY.md`
- Auth, rooms/sessions, session routing, session store, custom agents, Ralph, Cron, Projects/Workflows, Web Annotations, settings, data-store, and data-maintenance capability specs
- Current project docs that mentioned Web Annotation, workflow, compute, and routing owner fields

## Changes made

- Updated `GLOSSARY.md` to define **Shared App Context**, mark **Owner Scope** as legacy compatibility vocabulary, and rename the default room concept to **Shared Default Chat Room**.
- Rewrote capability specs that described auth-derived owner isolation as current behavior:
  - `web-auth-and-same-origin-host.md`
  - `chat-web-rooms-and-event-streams.md`
  - `chat-web-bootstrap-and-navigation-api.md`
  - `pibo-session-routing.md`
  - `pibo-session-store.md`
  - `custom-agents.md`
  - `chat-web-projects-area.md`
  - `web-annotations-plugin.md`
  - `continuous-ralph-jobs.md`
  - `scheduled-pibo-jobs.md`
  - `chat-web-settings-area.md`
  - `model-provider-auth-and-session-selection.md`
  - `pibo-data-store-and-ingestion.md`
  - `local-store-ownership-and-canonical-data-boundaries.md`
- Updated current project docs that still described owner scope as current Web Annotation, workflow, or compute resource behavior.
- Kept owner/principal terms where they are explicitly legacy storage/migration/debug compatibility or where “owned” means technical lifecycle ownership by a Pibo Session, plugin, store, or process rather than auth-account product ownership.

## Remaining match categories

Remaining current-doc matches from the review search fall into these categories:

1. **Legacy migration/debug compatibility**: examples include `Owner Scope` in the glossary, legacy `owner_scope` columns, `principal_session_stats`, `room_members`, data-maintenance unread-baseline repair, and `ownerScope` routing fields shown as legacy compatibility metadata.
2. **Technical lifecycle ownership, not account ownership**: examples include yielded runs owned by a Pibo Session, runtime tool sessions owned by a profile session, store facts owned by a canonical store, or commands owned by a CLI module.
3. **Future-design open questions**: a small number of older capability specs still ask whether unrelated resources should become owner-scoped. These are open-question text, not current product behavior, and should be revisited in later dedicated spec cleanup.
4. **Architecture examples with legacy fields**: architecture/debug serialization examples still show `ownerScope` as a compatibility field to help operators interpret old traces.

## Search command used

```bash
/usr/bin/rg -n "ownerScope|owner_scope|principalId|principal_id|room_members|getOwned|listOwned|requireOwned|Owner Scope|owner scope|personal target|Personal Chat|Personal Project|personal room|current owner scope|owner-scoped|owned by|another owner|owner's|current owner|per owner|principal" \
  GLOSSARY.md docs/specs/capabilities docs/project --glob '*.md'
```

The remaining matches are no longer documented as auth-account product boundaries in the US-017 target specs. Broader cleanup of unrelated generic “owned by” terminology is not part of this story.
