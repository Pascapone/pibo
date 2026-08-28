# Spec: Supported Installation Profiles

**Status:** Implemented
**Created:** 2026-08-28
**Source:** GitHub issue #575

## Goal

Pibo MUST offer a complete Batteries Included host profile and a minimal Vanilla host profile through an inspectable, idempotent, ownership-aware setup lifecycle.

## Requirements

### Profile planning

`pibo setup plan --profile <profile>` MUST report components, versions, packages, services, ports, files, security boundaries, commands, and restart effects. Discovery and planning MUST support JSON without mutating the host.

### Batteries Included

The profile MUST include the production gateway, Chat Web, loopback VS Code Web, authenticated same-origin proxying, Browser Use, Agent Browser, managed Chromium/CDP prerequisites, Web Annotations, and allowlisted MCP defaults. VS Code Web MUST be advertised at `/apps/vscode/` after installation.

### Vanilla

The profile MUST include only the core gateway and Chat Web host requirements. It MUST NOT install or start optional IDE, browser, annotation, or MCP services.

### Lifecycle and ownership

Install, component add, upgrade, and uninstall MUST use a private manifest containing the selected profile, component versions, owned file checksums, and applied timestamps. Re-running an unchanged plan MUST make no file changes. Uninstall MUST preserve modified files, Pibo Home, workspaces, browser profiles, and product data.

### Security

VS Code Web MUST bind to loopback, run as an explicit service account, and be reachable publicly only through a same-origin route protected by Pibo authentication. Privileged mutation MUST require `--apply --yes`. Secrets MUST NOT appear in plans, manifests, or logs.

### Diagnostics

Status and doctor MUST identify missing commands, files, services, unsafe binds, proxy configuration, browser tools, MCP configuration, and manifest drift, with a focused repair command.

## Acceptance Criteria

- [x] BI plan includes every maintained default component and an authenticated VS Code Web route.
- [x] Vanilla plan contains no optional component, service, listener, or package.
- [x] Staged install, second install, upgrade, and uninstall tests prove ownership and idempotency.
- [x] Profile and component versions are available in compact and JSON status.
- [x] Apply mode uses safe gateway lifecycle commands and preserves user data.
- [x] Documentation explains profile choice, resource cost, security, and migration.
