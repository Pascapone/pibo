# Spec: Web Deployment Scripts

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md), [Docker Compute Workers](./docker-compute-workers.md), `AGENTS.md`

## Why

Pibo separates building host web artifacts from restarting host gateways. Deployment helpers must be safe for active agent work: they can compile the current checkout and prepare fallback assets, but they must not restart production or dev gateways implicitly.

This contract matters because the host production gateway can contain active routed sessions and yielded runs. Operators need scripts that prepare a deployment, print the exact activation command, and leave restart safety checks to the Pibo gateway CLI.

## Goal

Pibo MUST provide explicit web deployment scripts that build the current workspace, prepare the correct target artifacts, and require a separate Pibo CLI gateway start or restart command to activate the deployment.

## Background / Current State

The current workspace has two host deployment scripts:

- `scripts/deploy-web-dev.sh` builds the project, probes the configured dev public Chat Web URL, and prints `pibo gateway dev restart` / `pibo gateway dev start` guidance.
- `scripts/deploy-web.sh` builds the project, refreshes the stable fallback backup through the built Pibo CLI, and prints `pibo gateway web restart` / `pibo gateway web start` guidance.

Both scripts use `set -euo pipefail`, resolve the repository root from the script location, run from that root, and call `npm run build`. The build script compiles TypeScript and builds both Chat Web and Context Files Web UI bundles.

## Scope

### In Scope

- Dev and production web deployment helper behavior under `scripts/`.
- Build command and repository-root execution behavior.
- Dev public URL probe behavior and configurability.
- Production stable fallback backup refresh behavior.
- Activation guidance after deployment preparation.
- The rule that deployment scripts do not restart gateways by themselves.

### Out of Scope

- Gateway restart safety internals — covered by Local Gateway Protocol and Lifecycle.
- Docker compute worker development workflow — covered by Docker Compute Workers.
- CI/CD hosting, remote SSH, package publishing, or GitHub release automation.
- Web app feature behavior after deployment — covered by the relevant Chat Web and Context Files specs.

## Requirements

### Requirement: Deployment scripts run from the repository root

The scripts MUST resolve the repository root relative to their own path and execute deployment preparation from that root.

#### Current

Both deployment scripts compute `ROOT_DIR` with `dirname "${BASH_SOURCE[0]}"` and `cd "$ROOT_DIR"` before running build or CLI commands.

#### Acceptance

- Running either script from a different current working directory still builds the Pibo checkout that contains the script.
- If root-level build commands fail, the script stops because shell error handling is enabled.

#### Scenario: Operator runs script from another directory

- GIVEN the operator's shell is not in `/root/code/pibo`
- WHEN the operator runs `/root/code/pibo/scripts/deploy-web.sh`
- THEN the script changes to `/root/code/pibo` before running `npm run build`.

### Requirement: Dev deployment builds without restarting the dev gateway

The dev deployment script MUST build current web artifacts and MUST NOT start or restart the dev gateway.

#### Current

`scripts/deploy-web-dev.sh` runs `npm run build`, checks the dev public web app URL with `curl -fsS`, prints whether it was reachable, then prints activation commands. It does not invoke `pibo gateway dev start` or `pibo gateway dev restart`.

#### Acceptance

- The script calls `npm run build` before any public URL probe.
- Public URL probe failure does not fail the deployment script; it prints that the app is not reachable yet.
- The final output states that the dev gateway was not restarted.
- The final output shows `pibo gateway dev restart` and `pibo gateway dev start` as explicit follow-up commands.

#### Scenario: Dev gateway is not currently reachable

- GIVEN the dev public Chat Web URL does not respond successfully
- WHEN `scripts/deploy-web-dev.sh` runs after a successful build
- THEN it prints that the existing dev public web app is not reachable yet
- AND still completes without restarting the dev gateway.

### Requirement: Dev public URL is host-configured

The dev deployment script MUST derive the public URL used for the non-blocking reachability probe from host configuration, not from a repository-hard-coded hostname.

#### Current

The script loads an optional deploy env file from `PIBO_DEPLOY_ENV_FILE`, defaulting to repo-local `.env.developer-host`. It requires either `PIBO_DEV_PUBLIC_URL` or `PIBO_DEV_BASE_URL`; when only `PIBO_DEV_BASE_URL` is set, the script appends `/apps/chat`.

#### Acceptance

- Without `PIBO_DEV_PUBLIC_URL` and without `PIBO_DEV_BASE_URL`, the script exits before building and explains which environment variable to set.
- With `PIBO_DEV_PUBLIC_URL` set, the script probes that exact value.
- With only `PIBO_DEV_BASE_URL` set, the script probes `${PIBO_DEV_BASE_URL%/}/apps/chat`.
- Probe output names the URL that was checked.
- The repository does not hard-code a real hosted dev domain in active deploy scripts, context files, or skills.

#### Scenario: Custom dev URL probe

- GIVEN `PIBO_DEV_PUBLIC_URL=http://127.0.0.1:4808/apps/chat`
- WHEN the dev deployment script runs
- THEN the reachability message refers to `http://127.0.0.1:4808/apps/chat`.

### Requirement: Production deployment refreshes the stable fallback backup

The production deployment script MUST refresh the stable fallback backup after a successful build and before reporting deployment completion.

#### Current

`scripts/deploy-web.sh` runs `npm run build` and then runs `node dist/bin/pibo.js gateway backup update`. Backup behavior is specified by the gateway lifecycle spec.

#### Acceptance

- If `npm run build` fails, backup update is not attempted.
- If backup update fails, deployment completion is not printed.
- Backup update uses the freshly built `dist/bin/pibo.js` from the current workspace.

#### Scenario: Build succeeds before backup update

- GIVEN the current workspace builds successfully
- WHEN `scripts/deploy-web.sh` runs
- THEN it refreshes the stable fallback backup through `node dist/bin/pibo.js gateway backup update`
- AND only then prints deployment completion.

### Requirement: Production deployment never restarts the production gateway directly

The production deployment script MUST leave production activation to the Pibo gateway CLI so active-work restart checks remain in force.

#### Current

`scripts/deploy-web.sh` prints that the gateway was not restarted and instructs the operator to run `pibo gateway web restart` or `pibo gateway web start`. It also reminds that the CLI will block restart if active agent work is running.

#### Acceptance

- The script does not call `pibo gateway web restart`, `pibo gateway web start`, `systemctl`, or other process-manager restart commands.
- The final output states that the gateway was not restarted.
- The final output includes the production restart and first-start commands.
- The final output mentions that restart can be blocked for active agent work.

#### Scenario: Deployment prepared while agents are active

- GIVEN active agent work is running on the production gateway
- WHEN `scripts/deploy-web.sh` runs successfully
- THEN it does not interrupt the gateway
- AND the subsequent `pibo gateway web restart` command remains subject to CLI safety checks.

## Edge Cases

- A dev public URL probe can fail because the dev gateway has not been started yet; this is informational and not a deployment failure.
- A production build can succeed while stable backup update fails; the script must stop before claiming deployment completion.
- The scripts assume Node, npm, and project dependencies are available in the operator environment.
- The deployment scripts prepare host artifacts only; they do not perform Docker compute worker validation by themselves.

## Constraints

- **Safety:** Deployment preparation must not implicitly restart gateways or bypass gateway CLI safety checks.
- **Compatibility:** The scripts use Bash with `set -euo pipefail` and must remain runnable as repository-local helper scripts.
- **Dependencies:** `npm run build` must continue to build TypeScript, Chat Web UI, and Context Files UI artifacts needed by the web gateway.
- **Operational boundary:** Production activation uses `pibo gateway web ...`; dev activation uses `pibo gateway dev ...`.

## Success Criteria

- [ ] SC-001: Both deployment scripts can be run from outside the repository and still execute from the repository root.
- [ ] SC-002: Dev deployment builds artifacts, performs a non-blocking public URL probe, and does not restart the dev gateway.
- [ ] SC-003: Production deployment builds artifacts, refreshes stable fallback backup, and does not restart the production gateway.
- [ ] SC-004: Production deployment output directs operators to Pibo CLI gateway commands and preserves active-work restart protection.

## Assumptions and Open Questions

### Assumptions

- Operators run these scripts only after validating changes through the Docker compute worker flow described in project instructions.
- Gateway process activation remains managed by `pibo gateway web|dev start|restart`, not by deployment scripts.

### Open Questions

- Should deployment scripts get automated tests that assert they do not call restart commands?
- Should dev deployment also refresh a dev-specific fallback backup, or is fallback backup intentionally production-only?
- Should the default dev public URL move to configuration instead of being embedded in the script?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Deployment scripts run from root | Operator runs script from another directory | `scripts/deploy-web-dev.sh`, `scripts/deploy-web.sh` | Unverified |
| REQ-002 Dev deployment builds without restart | Dev gateway is not currently reachable | `scripts/deploy-web-dev.sh` | Unverified |
| REQ-003 Dev public URL is configurable | Custom dev URL probe | `scripts/deploy-web-dev.sh` | Unverified |
| REQ-004 Production refreshes fallback backup | Build succeeds before backup update | `scripts/deploy-web.sh` | Unverified |
| REQ-005 Production never restarts directly | Deployment prepared while agents are active | `scripts/deploy-web.sh`, `src/gateway/cli.ts` | Unverified |

## Verification Basis

This spec is based on current workspace inspection of:

- `AGENTS.md`
- `scripts/deploy-web-dev.sh`
- `scripts/deploy-web.sh`
- `package.json`
- `docs/specs/capabilities/local-gateway-protocol-and-lifecycle.md`

No source code was changed. No automated tests or deployment scripts were run for this documentation-only update.
