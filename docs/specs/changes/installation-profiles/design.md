# Design: Supported Installation Profiles

**Status:** Implemented
**Created:** 2026-08-28

## Decisions

### Profiles are component sets

Vanilla selects `core`. Batteries Included selects `core`, `vscode-web`, `browser-tools`, `managed-browser`, `web-annotations`, and `mcp-defaults`. `component add` extends an installed profile without changing its identity.

### Plans are deterministic and apply is explicit

Planning is pure. `--write-to` materializes artifacts in a staging root for review and tests. Real host changes require `--apply --yes`.

### The manifest owns generated resources

The manifest lives under `$PIBO_HOME/setup/installation.json` with mode `0600`. Each owned file stores a SHA-256 checksum. Uninstall removes only unchanged owned files and records drifted files as preserved.

### VS Code Web uses Caddy as the authenticated same-origin boundary

`code-server` binds to loopback with its own public authentication disabled. Caddy gates `/apps/vscode/*` through the authenticated Chat bootstrap endpoint before proxying HTTP and WebSocket traffic. The auth subrequest strips WebSocket upgrade headers so the gateway evaluates it as a normal HTTP request. The gateway receives only integration metadata and remains the source of Chat authentication.

### Downloads and tools are pinned

The plan pins code-server archives and checksums per supported architecture, uses the versions already pinned by Pibo's curated browser-tool registry, and pins allowlisted MCP packages.

## Risks

- Distribution package availability differs by Linux family; apply supports systemd hosts with `apt-get`, `dnf`, or `pacman` and fails with a focused diagnostic when none is available.
- Gateway restart can be blocked by active sessions; setup does not bypass the existing safety gate.
- OAuth and domain secrets remain operator-provided because setup must not invent or print credentials.
