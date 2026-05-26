# Spec: Standalone Docker Runtime

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Docker Compute Workers](./docker-compute-workers.md), [Browser Automation Desktop Environment](./browser-automation-desktop-environment.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md)

## Why

Pibo has two Docker-facing operator paths. The `pibo compute` CLI creates isolated development workers. The repository root also ships a standalone Docker image and Compose service that can run Pibo directly with the built CLI, web gateway, dev auth, browser automation dependencies, and persistent volumes.

That standalone path is executable product surface. It needs its own behavior contract so future changes do not accidentally break default container startup, browser-use readiness, persisted container state, or command dispatch while only updating compute-worker specs.

## Goal

The standalone Docker image and Compose service MUST start a built Pibo runtime with predictable gateway commands, Docker-only dev auth for web mode, browser automation prerequisites, and persistent Pibo/browser-use/agent-browser state.

## Background / Current State

The repository root `Dockerfile` builds from `node:24-slim`, installs Python, Chromium, Xvfb, uv, build tools, and fonts, runs `npm install`, copies the workspace, runs `npm run build`, installs `browser-use[cli]==0.12.6` into `/root/.pibo/tools/browser-use/.venv`, installs `agent-browser@0.27.0` into `/root/.pibo/tools/agent-browser/node`, prepares both Pibo browser wrappers, creates persistent state directories, exposes ports `4788`, `4789`, and `56663`, and uses `scripts/docker-entrypoint.sh` as the entrypoint.

`docker-compose.yml` builds the same image as `pibo:latest`, runs one `pibo` service, persists `/root/.pibo` and `/root/.browser-use` with named volumes, exports gateway and CDP ports through Docker-assigned host ports, sets browser-use environment variables, and starts the default image command `gateway:web`.

The entrypoint starts Xvfb on display `:99` when needed, ensures the browser-use and agent-browser wrappers exist, sets `PATH`, sets `BROWSER_USE_HOME` and `AGENT_BROWSER_HOME`, and dispatches `gateway`, `gateway:web`, shell commands, or arbitrary Pibo CLI arguments.

## Scope

### In Scope

- Standalone Docker image build contents and exposed ports.
- Default image command and entrypoint command dispatch.
- Compose service environment, volumes, restart policy, and port publishing.
- Browser automation readiness inside the container.
- Dev-auth behavior for the standalone web gateway.
- Persistence boundaries for Pibo state, browser-use state, and agent-browser state.

### Out of Scope

- `pibo compute` worker lifecycle, labels, worktrees, and dynamic worker JSON output — covered by Docker Compute Workers.
- Host gateway management outside Docker — covered by Local Gateway Protocol and Lifecycle.
- Production deployment scripts — covered by Web Deployment Scripts.
- Browser CLI semantics beyond wrapper availability and environment setup — covered by Browser Automation Desktop Environment and Curated CLI Tools.

## Requirements

### Requirement: The image builds a ready-to-run Pibo CLI

The Docker image MUST contain a built Pibo package that can run gateway commands and arbitrary Pibo CLI commands without rebuilding at container start.

#### Current

The `Dockerfile` installs npm dependencies, copies the workspace, runs `npm run build`, and dispatches fallback commands with `node dist/bin/pibo.js`.

#### Target

An operator can build the image once and start containers that use the compiled `dist/` artifact directly.

#### Acceptance

- A successful image build runs `npm run build` before the final image can start.
- The default working directory is `/app`.
- Passing an unrecognized entrypoint command runs `node dist/bin/pibo.js <args>`.
- CLI dispatch does not require `npm run dev` or TypeScript source execution at container runtime.

#### Scenario: Run a CLI command in the container

- GIVEN the standalone image has been built
- WHEN an operator runs the container with arguments such as `config --help`
- THEN the entrypoint executes the built Pibo CLI with those arguments.

### Requirement: Gateway commands bind to container-visible interfaces

The entrypoint MUST expose gateway services on all container interfaces so Docker port publishing can make them reachable from the host.

#### Current

The `gateway` command calls `runGatewayServer({ host: '0.0.0.0' })`. The `gateway:web` command calls `runWebGatewayServer({ devAuth: true, web: { host: '0.0.0.0' } })`.

#### Target

The same image can run the local gateway or web gateway without requiring operators to know internal Node import paths.

#### Acceptance

- `gateway` starts the local gateway on host `0.0.0.0` and container gateway port `4789`.
- `gateway:web` starts the web gateway on host `0.0.0.0` and uses the web gateway's configured HTTP port.
- The image declares exposed ports `4788`, `4789`, and `56663` for web UI, gateway, and CDP-style browser automation traffic.
- Startup logs name the selected gateway mode before execing the server process.

#### Scenario: Start default web gateway

- GIVEN a container starts with the image default command
- WHEN Docker runs `/app/scripts/docker-entrypoint.sh gateway:web`
- THEN the web gateway starts with dev auth on `0.0.0.0`.

### Requirement: Dev auth remains explicit and Docker-scoped

The standalone web gateway command MUST request dev auth only through the Docker entrypoint path and MUST still rely on the web gateway's Docker-only dev-auth guard.

#### Current

`gateway:web` in `scripts/docker-entrypoint.sh` passes `{ devAuth: true }` to `runWebGatewayServer`. The normal host gateway contract rejects dev auth outside Docker.

#### Target

Standalone containers are convenient for local Docker use, but the repository does not make dev auth available to non-Docker host gateways.

#### Acceptance

- The entrypoint requests dev auth only for the `gateway:web` command.
- The plain `gateway` command does not start the same-origin web host or request dev auth.
- If the web gateway's Docker runtime detection rejects dev auth, container startup fails closed instead of falling back silently to another auth mode.
- Documentation or logs must not imply that `PIBO_DEV_AUTH` is safe for host production gateways.

#### Scenario: Web gateway auth mode is intentional

- GIVEN an operator starts the default standalone container
- WHEN `gateway:web` is dispatched
- THEN the process requests dev auth for the Docker web gateway
- AND any non-Docker use remains blocked by the web-auth guard.

### Requirement: Browser automation prerequisites are prepared before command dispatch

The entrypoint MUST prepare the browser automation environment before running gateways, shells, or CLI commands.

#### Current

The image installs Chromium, Chromium Driver, Xvfb, uv, browser-use, and agent-browser. The entrypoint starts Xvfb on `:99` if it is not already running, exports `DISPLAY=:99`, prepares wrappers if missing, prepends wrapper and runtime bin paths to `PATH`, and exports `BROWSER_USE_HOME` and `AGENT_BROWSER_HOME`.

#### Target

Agents inside the standalone container can run browser-use or agent-browser checks without a separate desktop setup step.

#### Acceptance

- Container startup starts Xvfb only when no `Xvfb` process is already running.
- `DISPLAY` is set to `:99` for all dispatched commands.
- `PIBO_BROWSER_USE_CHROME` defaults to `/usr/bin/chromium` in the image.
- `BROWSER_USE_HOME` resolves to `$HOME/.pibo/tools/browser-use/home` after entrypoint setup.
- `AGENT_BROWSER_HOME` resolves to `$HOME/.pibo/tools/agent-browser/home` after entrypoint setup.
- The browser wrapper directories and runtime bin directories are prepended to `PATH`.
- If a wrapper is missing from the persisted home, the entrypoint runs the matching prepare script before dispatch.

#### Scenario: Persisted volume lacks wrapper

- GIVEN `/root/.pibo` is mounted from a fresh or older volume without a browser wrapper
- WHEN the container starts
- THEN the entrypoint prepares the missing wrapper before executing the requested command.

### Requirement: Compose preserves Pibo and browser-use state

The Compose service MUST persist product state and browser-use state outside the container filesystem.

#### Current

`docker-compose.yml` mounts named volumes `pibo-data` to `/root/.pibo` and `browser-use-data` to `/root/.browser-use`.

#### Target

Restarting or recreating the Compose container keeps local Pibo state, auth/config databases, browser-use home files, and browser-use profile/CDP state according to their existing filesystem contracts.

#### Acceptance

- Compose defines a `pibo` service built from the root `Dockerfile` and tagged as `pibo:latest`.
- `/root/.pibo` is a named volume mount.
- `/root/.browser-use` is a named volume mount.
- The service sets `BROWSER_USE_HOME=/root/.pibo/tools/browser-use/home`.
- The service uses `restart: unless-stopped`.
- The service keeps stdin and TTY enabled for interactive container use.

#### Scenario: Container is recreated

- GIVEN the Compose service has created local Pibo state under `/root/.pibo`
- WHEN the container is removed and recreated with the same named volumes
- THEN Pibo state remains available to the new container.

### Requirement: Compose publishes operator-facing ports through Docker

The Compose service MUST expose the web gateway and CDP-style browser automation port through Docker port publishing without hard-coding host ports.

#### Current

`docker-compose.yml` publishes container ports `4789` and `56663` without specifying host ports. The Dockerfile also exposes `4788`.

#### Target

Compose can start without colliding with host gateway ports, while operators can discover assigned host ports through Docker/Compose inspection.

#### Acceptance

- Compose publishes gateway port `4789` with Docker-assigned host port selection.
- Compose publishes CDP port `56663` with Docker-assigned host port selection.
- The service does not bind fixed host ports for those entries.
- Operators must inspect Docker/Compose port mappings before connecting from the host.

#### Scenario: Host already uses standard Pibo ports

- GIVEN another host process already uses port `4789`
- WHEN the Compose service starts
- THEN Docker can assign a different host port for container port `4789` instead of requiring the fixed host port.

### Requirement: Shell dispatch gives operators an escape hatch

The entrypoint MUST support interactive shell commands without starting a gateway.

#### Current

Arguments `shell`, `bash`, and `sh` all execute `/bin/sh`.

#### Target

Operators can inspect the built image, run manual diagnostics, or execute Pibo CLI commands interactively inside the prepared container environment.

#### Acceptance

- `shell`, `bash`, and `sh` do not start gateway processes.
- Shell dispatch still happens after Xvfb, `DISPLAY`, `PATH`, and `BROWSER_USE_HOME` are prepared.
- The shell process replaces the entrypoint process with `exec /bin/sh`.

#### Scenario: Open an interactive shell

- GIVEN an operator starts the container with `bash`
- WHEN the entrypoint dispatches the command
- THEN the operator receives `/bin/sh` in the prepared Pibo/browser-use environment.

## Edge Cases

- Xvfb may already be running in the container; startup MUST not launch a duplicate process in that case.
- A persisted `/root/.pibo` volume can mask files prepared at image build time; entrypoint wrapper repair handles that case.
- Compose publishes `4789` and `56663` dynamically, so clients that assume fixed host ports can fail even though the container is healthy.
- The Dockerfile exposes `4788`, but the current Compose file does not publish it explicitly. Operators relying on host access to the web HTTP port must inspect or extend port publishing accordingly.
- `gateway:web` convenience uses dev auth and is therefore suitable for local Docker use, not as a production authentication policy.

## Constraints

- **Security / Auth:** Dev auth remains guarded by the web gateway's Docker/runtime checks and is not a host production auth mode.
- **Compatibility:** Node 24, Chromium, Xvfb, uv, and browser-use wrapper paths are part of the current image contract.
- **Persistence:** Product state lives under `/root/.pibo`; browser-use legacy/profile state can live under `/root/.browser-use`; Compose keeps both as named volumes.
- **Operational Safety:** Compose avoids fixed host port bindings for the published ports it defines.

## Success Criteria

- [ ] SC-001: Building the Dockerfile succeeds and produces an image with compiled `dist/` output.
- [ ] SC-002: Running the image with `gateway` starts the local gateway on `0.0.0.0:4789`.
- [ ] SC-003: Running the image with default command `gateway:web` starts the web gateway through Docker-scoped dev auth.
- [ ] SC-004: Running the image with a shell command opens `/bin/sh` after browser-use environment preparation.
- [ ] SC-005: Recreating the Compose service with the same named volumes preserves `/root/.pibo` and `/root/.browser-use` state.
- [ ] SC-006: Browser-use wrapper repair runs when a mounted `/root/.pibo` volume lacks the wrapper executable.

## Assumptions and Open Questions

### Assumptions

- The standalone Docker image is a supported local/operator convenience path distinct from `pibo compute` workers.
- Dev auth is acceptable for the default standalone Docker web command because the command runs inside the Docker runtime guard.
- Dynamic host port assignment is intentional for Compose to avoid collisions with host gateways.

### Open Questions

- Should `docker-compose.yml` publish container port `4788` explicitly, since the Dockerfile exposes it and the compute system treats it as a web port?
- Should the standalone Compose path have a documented production-safe command that uses Better Auth instead of dev auth?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Image builds a ready-to-run Pibo CLI | Run a CLI command in the container | None | Source-inspected |
| REQ-002 Gateway commands bind to container-visible interfaces | Start default web gateway | None | Source-inspected |
| REQ-003 Dev auth remains explicit and Docker-scoped | Web gateway auth mode is intentional | None | Source-inspected |
| REQ-004 Browser automation prerequisites are prepared before command dispatch | Persisted volume lacks wrapper | None | Source-inspected |
| REQ-005 Compose preserves Pibo and browser-use state | Container is recreated | None | Source-inspected |
| REQ-006 Compose publishes operator-facing ports through Docker | Host already uses standard Pibo ports | None | Source-inspected |
| REQ-007 Shell dispatch gives operators an escape hatch | Open an interactive shell | None | Source-inspected |

## Verification Basis

This spec is based on current workspace inspection of:

- `Dockerfile`
- `docker-compose.yml`
- `scripts/docker-entrypoint.sh`
- `scripts/prepare-browser-use-wrapper.sh`
- `docs/specs/capabilities/docker-compute-workers.md`
- `docs/specs/capabilities/browser-automation-desktop-environment.md`
- `docs/specs/capabilities/web-auth-and-same-origin-host.md`
