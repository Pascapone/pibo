---
type: "Historical Record"
title: "Installed Pibo Tool Context"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/pibo-tools-context.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "7583ea20a0b83733a8fc6580e11d38dbf5885d4d"
  source_bytes: 1190
  source_sha256: "14ff38470ca93df7cd02e6852351f9b1077fb6a233aeac35f95f718be21bbce9"
  source_body_sha256: "14ff38470ca93df7cd02e6852351f9b1077fb6a233aeac35f95f718be21bbce9"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Installed Pibo Tool Context

Installed curated CLI tools can publish a short runtime-context snippet through the `pibo tools` registry.

## Runtime Injection

At runtime, Pibo reads the currently installed curated tools and collects their `agentContextSnippet` entries. The snippets are combined into one synthetic context document:

- label: `Installed Pibo Tools`
- path: `.pibo/context/installed-pibo-tools.md`
- lifecycle: generated from the current installed-tool state on each runtime build

This keeps agent profiles small while still giving the agent a minimal hint that a curated tool exists and how to begin discovery. Full operational detail stays in the CLI surface such as `pibo tools show <tool>` and `pibo tools guide <tool>`.

If a curated tool is removed, its snippet disappears automatically because the synthetic document is rebuilt from the current installation state.

## Chat Web Visibility

The Chat Web Context area at `/apps/chat/context` exposes the same injected tool hints in a dedicated `Pibo Tools` sidebar panel. That panel is read-only and mirrors the high-level context the agent receives, while the CLI remains the primary discovery and usage interface.
