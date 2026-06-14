# Local Auth Gateway Implementation Plan

**Date:** 2026-06-14
**Status:** Draft
**Related spec:** `docs/specs/capabilities/web-auth-and-same-origin-host.md`
**Related skill:** `src/skills/pibo-debug-auth/SKILL.md`
**Related ops doc:** `docs/ops/install-user-host.md`
**Investigation source:** internal discussion on 2026-06-14, prior research into current `pibo.better-auth` and `pibo.dev-auth` behaviour
**Last revision:** 2026-06-14 — initial draft

## Goals

1. Allow `pibo gateway:web` to run on a developer laptop without Google OAuth configuration, by selecting an explicit "local" auth mode that does not require `auth.googleClientId` / `auth.googleClientSecret` / `auth.allowedEmails`.
2. Use the **same local auth code path** for the Docker worker runtime and the host runtime. The current `isDockerRuntime()` split is replaced by a loopback-bind check that applies to both contexts.
3. Replace the legacy `PIBO_DEV_AUTH=1` environment switch with an explicit, discoverable CLI flag (`--auth=local`) and an optional `auth.mode` config key. The legacy env var keeps failing closed and is marked deprecated.
4. Add a third, **independent** safety layer: per-request check of the actual TCP socket peer address (`nodeRequest.socket.remoteAddress`), in addition to the existing `Host` and `X-Forwarded-Host` header checks. This closes the "reverse proxy rewrites both headers" exploit scenario.
5. Update the spec, skill, ops doc, and setup doctor to reflect the new model. Keep the security model documented in a single place.
6. Validate the change with typecheck, full test suite, and a manual smoke on the host and in a Docker worker.

## Non-Goals

- Refactor the `PiboAuthService` interface. `dev-auth` and `better-auth` already share the contract; we do not need a third service type.
- Change the Chat Web App's authentication UX. The "Sign in with Google" button continues to drive both `better-auth` (real Google) and local auth (fake Google callback). Future work may rename the button to "Sign in (local)" when in local mode, but that is out of scope here.
- Change the Better Auth configuration schema, migrations, or required fields. Better Auth still requires its five values when `auth.mode = "better-auth"`.
- Touch the VSCode extension auth bridge. It uses the same `pibo_dev_session` cookie shape and remains compatible.
- Add a new auth provider. Only Better Auth and local auth remain.
- Auto-detect bind address at runtime from environment. The bind is always explicit (`--web-host` flag or default `127.0.0.1`).
- Move dev-auth selection to a runtime network-interface check. That would be more complex than the proposed loopback bind check and would not add safety because Docker and host both have loopback bind as the natural safe default.

## Architectural Decisions

### A. Loopback bind is the new primary safety gate

Replace `isDockerRuntime()` in `src/gateway/web.ts` with `isLoopbackBind(host)` as the gate for local auth. A bind is loopback when `host` is one of `127.0.0.1`, `::1`, `localhost`. The default bind in `src/web/channel.ts` (`DEFAULT_WEB_CHANNEL_HOST = "127.0.0.1"`) already meets this requirement, so a developer who runs `pibo gateway:web --auth=local` with no `--web-host` flag is safe by default.

The new `resolveWebGatewayAuthMode()` rule is:

```text
mode = options.auth ?? config.auth.mode ?? "better-auth"
if mode == "local":
  bind = options.web?.host ?? DEFAULT_WEB_CHANNEL_HOST
  require isLoopbackBind(bind) else throw
  return "dev-auth"
if mode == "better-auth":
  return "better-auth"
if options.devAuth == true:   # legacy alias
  bind = options.web?.host ?? DEFAULT_WEB_CHANNEL_HOST
  require isLoopbackBind(bind) else throw
  return "dev-auth"
if process.env.PIBO_DEV_AUTH == "1":
  throw "PIBO_DEV_AUTH is deprecated, use --auth=local with --web-host=127.0.0.1"
return "better-auth"
```

This keeps backward compatibility with the existing `devAuth: true` option (used by the Docker entrypoint until phase 5) and with the existing `PIBO_DEV_AUTH=1` fail-closed behaviour (now with a clearer error message).

### B. Three independent request-time safety layers

Local auth must satisfy all three checks on every request that touches an auth route or a session-requiring web app route. Each layer covers a different attacker model.

| Layer | Check | Catches |
|---|---|---|
| 1. Startup bind | `isLoopbackBind(server.bindAddress)` | Operator misconfiguration (e.g. `--auth=local --web-host=0.0.0.0`) |
| 2. Host headers | `isLoopbackHost(Host) && (!X-Forwarded-Host \|\| isLoopbackHost(X-Forwarded-Host))` (existing) | Browser hitting a non-loopback host; reverse proxy that passes the public host name |
| 3. Socket peer | `isLoopbackAddress(nodeRequest.socket.remoteAddress)` (new) | Reverse proxy that rewrites both `Host` and `X-Forwarded-Host` to `localhost` while accepting public traffic |

Layer 3 closes the exploit described by the user: a reverse proxy that strips the public hostname from both headers, which would defeat layer 2 alone. The TCP socket peer cannot be rewritten by a proxy on the same machine, so layer 3 is the strongest check.

### C. The legacy `PIBO_DEV_AUTH=1` env var fails closed with a migration message

The env var was previously "no longer activates dev auth for gateway:web; use the Docker worker entrypoint instead." After this plan, the message changes to "PIBO_DEV_AUTH is deprecated. Use `--auth=local` with `--web-host=127.0.0.1` on the host, or `pibo compute dev spawn` in a worker." The behaviour remains fail-closed.

### D. Auth mode is explicit in the CLI and optional in config

`--auth=<mode>` is the primary surface. `auth.mode` in `config.json` is a convenience for operators who run the gateway under systemd. Both default to `"better-auth"`, which preserves the current production-safe behaviour. Setting `auth.mode = "local"` is an explicit operator choice that the setup doctor then validates.

### E. Docker workers use the same code path

`scripts/docker-entrypoint.sh` switches from `{ devAuth: true, web: { host: "0.0.0.0" } }` to `{ auth: "local", web: { host: "0.0.0.0" } }`. Inside the container, the bind is `0.0.0.0` because that is required for the host-side port mapping. The safety here is:

- The container's own loopback-bind check is **not** enforced for Docker workers (intentional), because the Docker network is the real boundary.
- Layers 2 and 3 still run for every request, so a misconfigured host-side reverse proxy cannot trick the worker.
- The skill `pibo-debug-auth` documents the recommended host-side port mapping as `127.0.0.1:<port>:<container-port>`.

## Implementation Steps

### Phase 0 — Spec update (lock the contract first)

Update `docs/specs/capabilities/web-auth-and-same-origin-host.md` before any code change. The spec is the contract that the code, tests, and ops doc must all follow.

Changes:

- **REQ-001** (auth service selection): add the `auth: "local" | "better-auth"` option as the new selection mechanism. Keep the duplicate-service rejection requirement.
- **REQ-004** (Docker-only dev auth): rewrite as "Local auth requires loopback bind on host gateways; Docker workers may opt in with `0.0.0.0` inside the container."
- **REQ-010 (new)**: local auth must run three independent safety layers: startup bind check, request header check, request socket-peer check. The new requirement states each layer and the failure mode it prevents.
- **Assumption block**: replace "Dev auth is meant for isolated Docker workers only" with "Local auth is safe when bound to loopback. Docker workers and host loopback are both valid use cases; non-loopback binds require better-auth."
- **Success criteria**: add SC-006 for the new safety layers, SC-007 for the loopback bind failure, and SC-008 for the `auth.mode` config key.
- **Verification basis**: add `test/local-auth.test.mjs` and `test/auth-mode-config.test.mjs` to the test inventory.

Success criteria: spec diff reviewed and merged as part of the feature branch.

### Phase 1 — Add the socket peer check (new safety layer)

This is the new code that closes the exploit. It is small and self-contained, so it lands first to keep each phase reviewable.

Files touched:

- `src/web/channel.ts`: add `isLoopbackSocketAddress(address: string | undefined): boolean` next to the existing `isLoopbackAddress`. Re-export it for the dev-auth plugin to import.
- `src/plugins/dev-auth.ts`: in `handleRequest`, after the existing `isLoopbackDevAuthRequest` check, also check the socket peer. If the request is an HTTP `Request` passed from the channel, the channel must expose the underlying socket peer. If we cannot get it (because the auth service is called with a plain `Request` and not a `Request & { remoteAddress }`), add a small extension type to thread the peer through.
- `src/web/channel.ts`: in the `handleRequest` function, when delegating to `auth.handleRequest(request)`, build a new `Request` whose headers include a sentinel like `x-pibo-socket-peer: <remoteAddress>` (or pass it via a side channel). The dev-auth plugin then reads the sentinel as a third check.

Alternative considered: thread `remoteAddress` via a request-init property (`Request` does not support custom init properties in the standard). The sentinel header is the simplest cross-version solution and is stripped from the response before reaching the browser.

Success criteria:

- `test/dev-auth.test.mjs` includes a new case where `Host: localhost`, `X-Forwarded-Host` is absent, and the simulated socket peer is a public IP. The handler returns `403`.
- The existing `isLoopbackDevAuthRequest` cases still pass.

### Phase 2 — Add the `auth.mode` config key

Files touched:

- `src/config/config.ts`:
  - Extend `PiboConfig["auth"]` with `mode?: "better-auth" | "local"`.
  - Add a new entry to `PIBO_CONFIG_KEYS` for `auth.mode` (not secret, type string, values constrained to `"better-auth"` or `"local"`).
  - Add length/value validation in `parseConfigValue` (reject other strings).
- `src/cli.ts` (`pibo config keys` help output): nothing changes because `PIBO_CONFIG_KEYS` is the single source.
- `docs/specs/capabilities/local-config-cli.md`: add a small section for the new key. Update SC-001 to list `auth.mode` alongside the other auth keys.

Success criteria:

- `pibo config set auth.mode local` persists the value.
- `pibo config set auth.mode bogus` is rejected.
- `pibo config get auth.mode` prints the stored value, redacted only for secret keys (this is not a secret).

### Phase 3 — Add the `auth` option to the web gateway

Files touched:

- `src/gateway/web.ts`:
  - Extend `WebGatewayServerOptions` with `auth?: "better-auth" | "local"`.
  - Rewrite `resolveWebGatewayAuthMode` according to architectural decision A.
  - Update `createWebPiboPluginRegistry` to read the mode from options first, then from `loadPiboConfig().auth?.mode`, then default to `"better-auth"`.
  - The `devAuth: true` legacy option becomes a thin alias for `auth: "local"` (kept for one release, removed in a follow-up).
  - Add a loud startup warning when `auth: "local"` is active, naming the bind address and reminding the operator that local auth is unsafe if the port is exposed publicly.
- `src/auth/better-auth.ts`:
  - In `createBetterAuthService`, when the mode is `"local"`, do **not** instantiate Better Auth at all. Return a wrapper that throws on `getSession` and `requireSession` with "Auth service is in local mode and does not expose Better Auth." This prevents a misconfigured gateway from silently downgrading.
- `src/plugins/better-auth.ts`: pass `mode` into the service factory.
- `src/plugins/dev-auth.ts`: no internal changes; the existing dev-auth plugin already implements the `PiboAuthService` contract.

Success criteria:

- `resolveWebGatewayAuthMode({ auth: "local", web: { host: "127.0.0.1" } })` returns `"dev-auth"`.
- `resolveWebGatewayAuthMode({ auth: "local", web: { host: "0.0.0.0" } })` throws.
- `resolveWebGatewayAuthMode({ auth: "better-auth" })` returns `"better-auth"` regardless of bind.
- `resolveWebGatewayAuthMode({ devAuth: true, web: { host: "127.0.0.1" } })` still returns `"dev-auth"` (legacy alias).
- `resolveWebGatewayAuthMode({ devAuth: true, web: { host: "0.0.0.0" } })` throws (legacy alias also requires loopback bind).
- `resolveWebGatewayAuthMode({})` with `config.auth.mode = "local"` returns `"dev-auth"` and requires loopback bind.
- `resolveWebGatewayAuthMode({})` with no config still returns `"better-auth"`.
- `process.env.PIBO_DEV_AUTH = "1"` throws the new migration error.
- The startup warning prints once on `local` mode startup.

### Phase 4 — Wire the `--auth` flag into the CLI

Files touched:

- `src/cli.ts` (`gateway:web` subcommand):
  - Add `--auth <mode>` option, value `"better-auth"` or `"local"`.
  - When the option is set, pass it into `runWebGatewayServer`.
  - When `--web-host` is also set, do a pre-flight check: if `--auth=local` and `--web-host` is non-loopback, refuse with a clear error before importing the gateway.
  - Update the subcommand `description` to mention the auth option.
  - Update the parent `printRootDiscoveryText()` to mention the new option in the gateway:web line.

Success criteria:

- `pibo gateway:web --auth=local` starts in local mode bound to `127.0.0.1:4788`.
- `pibo gateway:web --auth=local --web-host=0.0.0.0` fails before importing the gateway.
- `pibo gateway:web --auth=better-auth` starts in better-auth mode (and fails with the usual config error if `config.json` is incomplete).
- `pibo gateway:web --help` shows the new flag.

### Phase 5 — Update the Docker entrypoint

Files touched:

- `scripts/docker-entrypoint.sh`:
  - In the `gateway:web` case, replace `{ devAuth: true, web: { host: '0.0.0.0' } }` with `{ auth: "local", web: { host: "0.0.0.0" } }`.

No other Docker-time changes. The container's internal bind remains `0.0.0.0`. The host-side port mapping is the operator's responsibility and is documented in the skill.

Success criteria: `pibo compute dev spawn --worktree feature-local-auth` reaches the local auth login screen, sets the dev cookie on `curl -L -c /tmp/cookie.txt http://localhost:<port>/api/auth/sign-in/social`, and the worker session list is reachable.

### Phase 6 — Update the setup doctor

Files touched:

- `src/setup/cli.ts`:
  - In `authConfigChecks`, read `auth.mode` first. When `mode = "local"`, the four required strings (`auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`) and the required array (`auth.allowedEmails`) become "warn" instead of "fail".
  - Add a new check `auth.mode` that prints the active mode and the bind address it requires.
  - When `mode` is unset or `"better-auth"`, behaviour is unchanged from today (all five keys required).
  - Update the "not ready" message to point to `--auth=local` when the user clearly wants local dev.
- `docs/ops/install-user-host.md`: add a short "Local development" section under the "Configure auth" block. The section describes the new flow:
  1. `pibo config set auth.mode local`
  2. `pibo gateway:web --auth=local` (or rely on the config key)
  3. Open `http://localhost:4788/apps/chat`, click the existing sign-in button, land on the chat.

Success criteria:

- With `auth.mode = "local"` and no Google config, the doctor prints `auth.ready: OK (local mode)` and the gateway starts.
- With `auth.mode` unset and no Google config, the doctor prints `auth.ready: FAIL` exactly as today.
- The doctor explicitly prints the bind address that local mode requires.

### Phase 7 — Update the skill and the spec wording

Files touched:

- `src/skills/pibo-debug-auth/SKILL.md`:
  - Rename the skill description from "Log into a Pibo Docker compute worker with dev authentication" to "Use the Pibo local auth gateway, both on host and in Docker workers."
  - Add a new "Local on host" section before the "Docker worker" section, with the exact `pibo gateway:web --auth=local` workflow.
  - Update the "Notes" section to reflect the new loopback-bind requirement and the deprecated env var.
- `docs/specs/capabilities/web-auth-and-same-origin-host.md`: bring the assumptions, requirements, and verification basis in line with the code change (already drafted in phase 0, but skill references must match the spec).

Success criteria: a developer reading the skill alone can start local auth on a fresh host without reading the spec.

### Phase 8 — Tests

New tests:

- `test/local-auth.test.mjs`:
  - `resolveWebGatewayAuthMode` table-driven: all combinations of `options.auth`, `options.web.host`, `options.devAuth`, `config.auth.mode`, and `process.env.PIBO_DEV_AUTH`.
  - `createWebPiboPluginRegistry` with `auth: "local"` and loopback bind returns a registry whose auth service is `dev-auth`.
  - With `auth: "local"` and non-loopback bind, registry construction throws.
  - The startup warning is captured and contains the bind address and the words "local auth".
- `test/auth-mode-config.test.mjs`:
  - `pibo config set auth.mode local` persists and round-trips.
  - `pibo config set auth.mode foo` is rejected.
  - `pibo config get auth.mode` prints the stored value.
- `test/dev-auth-socket-peer.test.mjs` (or extend `test/dev-auth.test.mjs`):
  - Handler returns `403` when `Host` is loopback, `X-Forwarded-Host` is loopback, but the socket peer is `203.0.113.7`.
  - Handler accepts when all three are loopback.
  - Handler returns `403` when socket peer is `0.0.0.0` (defensive).

Updated tests:

- `test/web-gateway.test.mjs`:
  - The "legacy env var" test now expects the new migration error message.
  - Add: "loopback bind with no auth option starts in better-auth".
  - Add: "non-loopback bind with no auth option starts in better-auth" (no regression).
- `test/better-auth-config.test.mjs`:
  - The test "Better Auth rejects empty `allowedEmails`" is now scoped to `auth.mode = "better-auth"` only.
  - Add a sibling test "local mode does not require allowedEmails".

Success criteria: `npm run test` passes locally with the new and updated tests.

### Phase 9 — Validation

Run in this order:

1. `npm run typecheck`
2. `npm run build`
3. `npm run test`
4. Manual host smoke (no Docker):
   - `pibo config set auth.mode local`
   - `pibo gateway:web --auth=local`
   - `curl -L -c /tmp/cookie.txt http://localhost:4788/api/auth/sign-in/social` returns the local cookie.
   - `curl -b /tmp/cookie.txt http://localhost:4788/api/auth/session` returns the dev identity.
   - Open `http://localhost:4788/apps/chat` in a browser, click the sign-in button, verify the chat loads.
   - Restart the gateway with `--auth=local --web-host=0.0.0.0`, verify the pre-flight check refuses.
5. Manual Docker worker smoke:
   - `pibo compute dev spawn --worktree feature-local-auth`
   - From the host, follow the same `curl` flow against the printed worker port.
   - Verify the worker entrypoint log shows the new `auth: "local"` option, not the old `devAuth: true`.

### Phase 10 — Rollout

- Branch: `feature/local-auth-gateway` in a dedicated worktree, following the standard github-server-flow strategy.
- Push to `origin` as a focused branch, open an upstream PR against `upstream/dev`.
- Deploy to dev first with `./scripts/deploy-web-dev.sh` and `pibo gateway dev restart`. Do **not** touch the production gateway.
- After dev is verified, ask the user for production approval. The production gateway keeps `auth.mode = "better-auth"` (default) and is unaffected by the change.
- A follow-up cleanup PR (out of scope here) can remove the `devAuth: true` legacy alias and the `PIBO_DEV_AUTH` env var detection in a later release.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Operator runs `pibo gateway:web --auth=local` on a server that is also reachable from the public internet. | Layer 1 (loopback bind) refuses the startup. The CLI pre-flight check (`src/cli.ts`) catches the same case before importing the gateway, so the operator gets a fast error. |
| Reverse proxy in front of the host gateway rewrites both `Host` and `X-Forwarded-Host` to `localhost` and exposes a public hostname. | Layer 3 (socket peer check) catches this. The skill `pibo-debug-auth` warns explicitly against putting a reverse proxy in front of a local-auth gateway. |
| Agent sets `auth.mode = "local"` in `config.json` during a misconfigured automation run. | The setup doctor now prints the active mode and the required bind, so the operator sees the mode in the doctor output. The startup warning is also loud. |
| `devAuth: true` legacy alias is removed too early and breaks existing Docker workers in the field. | Kept for one release. Removal is a follow-up PR with its own changelog entry. |
| Better Auth in local mode is still instantiated and accepts Google requests in some edge case. | Phase 3 explicitly skips Better Auth instantiation in local mode. A test asserts the registry's auth service name is `dev-auth`, not `better-auth`. |
| The new `auth.mode` config key is set to a typo and silently misbehaves. | The config parser rejects unknown values in `parseConfigValue`. A test asserts the rejection. |
| The socket peer sentinel header leaks into the browser response. | The channel must strip `x-pibo-socket-peer` from the response after the auth handler runs. Add a test in `test/web-channel.test.mjs` that the response headers do not contain the sentinel. |
| The legacy `PIBO_DEV_AUTH=1` env var is still set in some operator shell. | The error message points the operator to the new flag. The env var is documented as deprecated. |

## Open Questions

These were raised during planning and need an explicit answer before phase 3 starts:

- **Q1 (Naming)**: `--auth=local` vs `--auth=dev` vs `--local-auth` as a flag. Recommendation: `--auth=local`, with `auth.mode = "local"` in config. The internal plugin name stays `pibo.dev-auth` to avoid a needless rename.
- **Q2 (Config persistence)**: Should `auth.mode` be a config key, or CLI-only? Recommendation: both. The config key is for systemd / `pibo compute dev` workflows; the CLI flag overrides it for one-off runs.
- **Q3 (Doctor behaviour)**: Should missing Google config be a `warn` or a `fail` in local mode? Recommendation: `warn`, with a clear "not required in local mode" line.
- **Q4 (Spec order)**: Update the spec before or after the code? Recommendation: update the spec first in phase 0 so the spec is the contract; the code is the implementation. Both ship in the same PR.
- **Q5 (Worktree)**: Standard `feature/local-auth-gateway` branch in a new worktree, following the github-server-flow. Recommendation: yes.

## Success Criteria Summary

- SC-01: A developer can run `pibo gateway:web --auth=local` on a laptop and reach the Chat Web App without configuring any Google credentials.
- SC-02: `pibo gateway:web --auth=local --web-host=0.0.0.0` is refused with a clear error message.
- SC-03: `pibo compute dev spawn` produces a worker that uses the same local auth code path as the host.
- SC-04: A reverse proxy that rewrites `Host` and `X-Forwarded-Host` to `localhost` cannot trick local auth, because the socket peer check fails.
- SC-05: The legacy `PIBO_DEV_AUTH=1` env var fails closed with the new migration error.
- SC-06: All existing tests pass after the change; new tests cover the new safety layers, the new config key, the new CLI flag, and the updated doctor behaviour.
- SC-07: The spec, skill, and ops doc are updated together with the code, and the new wording is consistent across all three.
- SC-08: The dev gateway is verified with the new code path before any production rollout is considered.
