---
type: "Historical Record"
title: "Pi Packages"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/pi-packages.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "9e5c54d47b292f70bbd82d54dde5da09db93af4b"
  source_bytes: 2305
  source_sha256: "8f7a4c27868233493547465191e521c0f3a6c65e7150cd38c5c9a1ab5aff8880"
  source_body_sha256: "8f7a4c27868233493547465191e521c0f3a6c65e7150cd38c5c9a1ab5aff8880"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Pi Packages

`pibo pi-packages` registers Pi Coding Agent packages for opt-in use by Pibo profiles and custom agents.

Pi Packages can provide Pi-owned extensions, skills, prompt templates, and themes. Pibo keeps package registration separate from activation: a package is stored in `.pibo/pi-packages.json`, but it affects a runtime only after an agent/profile selects it.

## Commands

```bash
npm run dev -- pi-packages list
npm run dev -- pi-packages add https://pi.dev/packages/pi-web-access
npm run dev -- pi-packages add https://pi.dev/packages/@ollama/pi-web-search
npm run dev -- pi-packages add ./local-pi-package
npm run dev -- pi-packages inspect pi-web-access
npm run dev -- pi-packages remove pi-web-access
npm run dev -- pi-packages doctor
```

`add` accepts:

- `https://pi.dev/packages/<name>` package detail URLs.
- local file or directory paths, relative to the current workspace or absolute.

Other web URLs are rejected. Local paths must exist.

## Runtime Boundary

Pibo does not mirror global Pi settings into every profile. At runtime, Pibo resolves the selected `piPackages` from the Pibo store and passes only the selected Pibo-managed install paths or resolved local package paths to Pi's package loader.

Pi package resources remain Pi resources. Extensions execute inside the Pi runtime, skills are loaded as Pi skills, and prompt/theme resources stay in Pi's resource system. Pibo's native MCP servers, subagents, provider-backed tools, and `pibo-run-control` package remain separate product capabilities.

## Agent Designer

The Chat Web Agent Designer shows registered packages in the `Pi Packages` section. Selecting a package saves its id on the custom agent. New sessions for that custom agent load the selected packages; other profiles do not inherit them.

Package registration management is CLI-first in the current UI. Backend endpoints exist for listing, adding, inspecting, refreshing, and removing registrations, and the next UI iteration can expose add/remove controls after adding browser-origin validation and confirmation flows.

Package rows show resource types, version/install status, and diagnostics when available. The first Agent Designer version is selection-only; rich package metadata and global enable/disable controls are planned follow-up work.
