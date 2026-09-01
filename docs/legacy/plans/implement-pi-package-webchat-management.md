---
type: "Historical Record"
title: "Implement Pi Package Webchat Management"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/plans/implement-pi-package-webchat-management.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "218603801ecf8dfa0a28d909cc7e08b35f4780d6"
  source_bytes: 1481
  source_sha256: "905c56959bb3b26b394dcc42e21acc92a28cf92c1c6851313f76cc5a4537efd9"
  source_body_sha256: "905c56959bb3b26b394dcc42e21acc92a28cf92c1c6851313f76cc5a4537efd9"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Implement Pi Package Webchat Management

Date: 2026-05-02

## Assumptions

- No package discovery, gallery, iframe, or HTML proxy is part of this iteration.
- Browser-origin adds accept only `https://pi.dev/packages/...` URLs.
- CLI/local path registration remains unchanged.
- `Unregister` removes the global Pibo package registration.
- Adding a package does not auto-select it for the current agent.

## Plan

1. Harden package registration state.
   - Add `enabled` to stored package metadata.
   - Default existing package entries to `enabled: true`.
   - Skip disabled packages at runtime and emit a warning diagnostic when a selected package is disabled.
   - Verify with package store/runtime tests.

2. Extend Chat Web package APIs.
   - Keep `GET`, `POST`, `GET /:id`, and `DELETE /:id`.
   - Restrict browser `POST /api/chat/pi-packages` to `https://pi.dev/packages/...`.
   - Add `PATCH /api/chat/pi-packages/:id` for `enabled`.
   - Verify invalid browser sources and patch behavior.

3. Build Agent Designer package management.
   - Add a URL input and add button inside the `Pi Packages` panel.
   - Show package cards with status, rich metadata, resources, links, diagnostics, and trust warning.
   - Add per-package enable/disable and unregister controls.
   - Keep per-agent package selection separate from global registration.
   - Remove unregistered packages from the current draft selection.

4. Validate.
   - Run `npm run typecheck`.
   - Run `npm test`.
