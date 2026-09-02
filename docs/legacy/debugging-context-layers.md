---
type: "Historical Record"
title: "Debugging Context Layers"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/debugging-context-layers.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "02e6e267d7fd05268f93d8ac9d3f2ce88c375e9a"
  source_bytes: 2521
  source_sha256: "cb05afc58d3045af6dd7ff2cce1d51cd33efae4e75cc3f329fcdb60479e93f7a"
  source_body_sha256: "cb05afc58d3045af6dd7ff2cce1d51cd33efae4e75cc3f329fcdb60479e93f7a"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Debugging Context Layers

This note records where debugging knowledge should live so future agents do not have to rediscover the same setup paths.

## Layer Responsibilities

`AGENTS.md` is for short project-specific rules that every coding agent must see before work starts. Put mandatory Pibo debugging habits there, such as using `pibo debug session` first for Pibo Sessions and starting Chat Web browser debugging from an existing authenticated CDP target.

`RULES.md` is for stable project truths and design constraints. Do not put incident recovery steps, local ports, shell snippets, or one-off browser notes there unless they become a fundamental project rule.

`GLOSSARY.md` is for shared vocabulary. Add or update terms only when a debugging lesson reveals naming ambiguity, such as confusing Pibo Sessions with Pi Session IDs or MCP servers with curated CLI tools.

`docs/tools.md` and `pibo tools guide ...` are the source of truth for curated operator tools. Browser Use setup, authenticated template profiles, leases, CDP target discovery, and direct CDP fallback belong here because `browser-use` is managed by `pibo tools`, not by MCP or agent profiles.

`docs/mcp.md` and MCP Tool Context are for external MCP servers. They should describe how to configure and discover DevTools MCP and how it attaches to a browser CDP port. They should not duplicate the full Browser Use guide.

`docs/browser-use-mcp-debugging-report.md` and handoff documents are incident records. Keep detailed timelines, failed paths, hypotheses, and proposed tooling work there. Promote only durable lessons into `AGENTS.md`, `docs/tools.md`, `docs/mcp.md`, specs, or implementation.

Specs are for behavior that should be implemented and tested. Implemented commands such as `pibo tools browser-use targets` and `pibo tools browser-use attach-chat` belong in the tool CLI spec. A temporary manual workaround does not.

## Current Lessons Promoted

- Browser debugging starts with `pibo tools browser-use targets`, which discovers existing CDP targets and classifies authentication/composer state.
- Authenticated Browser Use work should use an auth template plus isolated leases.
- DevTools MCP should attach to the same browser through `--browserUrl`; if Codex cannot see MCP resources, `pibo tools browser-use attach-chat` plus direct CDP is the recovery path.
- Auth and debug browser state are separate from gateway/channel debugging. Restart a gateway only after the selected tab and its backend port have been identified.
