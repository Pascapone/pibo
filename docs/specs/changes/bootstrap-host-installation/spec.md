# Spec: Bootstrap Host Installation

**Status:** Draft
**Created:** 2026-05-18
**Owner / Source:** Server migration and install streamlining discussion
**Related docs:** `docs/ops/install-user-host.md`, `docs/ops/install-developer-host.md`, `docs/ops/upgrade-user-to-developer-host.md`

## Why

Install friction blocks adoption. The default path must get a user to a working Pibo instance with the smallest possible number of concepts.

Developer hosts need more machinery, but that complexity should be opt-in and well explained. Production and development gateways must be isolated so dev deploys and agent worker restarts do not interrupt the main instance.

## Goal

Define and expose two host setup modes: `user-host` for normal use and `developer-host` for core development.

## Requirements

### Requirement: User-host setup stays minimal

The user-host setup MUST describe one gateway, one `PIBO_HOME`, and no mandatory Docker or GitHub App setup.

#### Acceptance

`pibo setup user-host --json` includes exactly one service and lists Docker only as optional.

### Requirement: Developer-host setup is isolated

The developer-host setup MUST describe separate production and dev services, ports, data directories, and source locations.

#### Acceptance

`pibo setup developer-host --json` includes `pibo-web` and `pibo-web-dev`, uses `4788/4789` for production, and uses `4808/4809` for development.

### Requirement: Dev gateway start avoids production port collision

The generated developer artifacts MUST start dev with an explicit internal gateway port that does not collide with production.

#### Current

`pibo gateway:web --web-port 4808` still binds the default internal gateway port `4789`, which collides with production.

#### Target

The generated developer setup includes a small Node wrapper that calls `runWebGatewayServer({ port: 4809, web: { port: 4808 } })`.

#### Acceptance

The generated file list includes `/usr/local/bin/pibo-web-dev-start.mjs`, and its content contains `port: 4809` and `port: 4808`.

### Requirement: Git remotes are explicit for developers

The developer-host setup MUST distinguish the server-specific fork from the canonical upstream.

#### Acceptance

The plan includes `origin` and `upstream` fields and warns when `origin` is omitted.

### Requirement: DNS/SSL is visible as an operator step

The setup plan MUST tell operators that Caddy/Let's Encrypt requires DNS to point at the host before certificates can issue.

#### Acceptance

Both setup modes include a next step that mentions DNS and certificates when Caddy artifacts are generated.

## Constraints

- **Compatibility:** Pibo requires Node `>=24`.
- **Security:** Generated plans must not print secrets. Secret setup remains explicit.
- **Safety:** Initial CLI behavior renders plans and files; it does not overwrite root-owned files.
- **Packaging:** The CLI path must work from the npm package, so core setup planning lives under `src/` and builds into `dist/`.

## Success Criteria

- [ ] SC-001: `npm run build` succeeds.
- [ ] SC-002: `pibo setup user-host --json` returns a parseable one-service plan.
- [ ] SC-003: `pibo setup developer-host --json` returns a parseable two-service plan with isolated ports.
- [ ] SC-004: Root CLI discovery lists `setup`.
- [ ] SC-005: Documentation explains when to use user-host vs developer-host.

## Open Questions

- Should a future `--apply` mode write systemd/Caddy files directly, or should root-level mutation stay in shell scripts?
- Should developer-host setup build both `main` and `dev`, or only render and validate the expected layout?
- Should dev `PIBO_HOME` copy user skills from production by default, or start empty?
