---
type: "Historical Record"
title: "Proposal: Supported Installation Profiles"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["installation-profiles", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Proposal: Supported Installation Profiles

**Status:** Implemented
**Created:** 2026-08-28
**Source:** GitHub issue #575

## Why

The npm package contains Pibo integrations, but a new host still requires manual service, proxy, browser, and MCP configuration. Operators need a supported complete workstation path and a predictable minimal path without adding side effects to `npm install`.

## What Changes

- Add `batteries-included` and `vanilla` profiles under `pibo setup`.
- Add plan, install, component-add, status, doctor, upgrade, and uninstall lifecycles.
- Record owned files and component versions in a private installation manifest.
- Configure loopback VS Code Web behind the authenticated Pibo origin for Batteries Included.
- Keep the package-manager install side-effect free.

## Impact

- **CLI:** New progressive setup commands and JSON output.
- **Host:** Explicitly confirmed setup may install packages, tools, services, and proxy configuration.
- **Security:** VS Code Web remains loopback-only; the public route uses the Pibo auth gate.
- **Data:** Uninstall preserves Pibo Home and workspaces unless a separate destructive option is requested.
