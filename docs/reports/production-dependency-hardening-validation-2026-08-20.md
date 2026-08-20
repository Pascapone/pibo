# Production Dependency Hardening Validation — 2026-08-20

## Scope

This report records the focused dependency-hardening work performed on `fix/production-dependency-hardening`. The branch is based on `upstream/dev` and is intentionally separate from Runtime Portability v4.1, the Better Auth SQLite migration branch, and the resource-reaper fix.

The objective was to close the known npm production advisories without using `npm audit fix --force`, while preserving Pi runtime behavior and validating every required API migration caused by the Pi package upgrade.

## Baseline

The integrated portability + Better Auth candidate was audited before remediation:

| Audit | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| `npm audit --omit=dev` | 3 | 10 | 10 | 1 | 24 |
| `npm audit` | 3 | 10 | 11 | 1 | 25 |

The production paths included:

- `@earendil-works/pi-coding-agent` through vulnerable `undici` and related transitive packages;
- `@hono/node-server` and Hono/TanStack Start paths;
- MDX Editor through `js-yaml`;
- TanStack Start server/RSC packages and `seroval`;
- `@babel/core`, `body-parser`, `brace-expansion`, `fast-uri`, `ip-address`, `nanoid`, `postcss`, `protobufjs`, `qs`, `vite`, and `ws`.

## Remediation

### Pi runtime packages

The four Pi runtime packages remain exactly aligned and exactly pinned at `0.84.2`:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

Pibo was migrated from the removed Pi `AuthStorage`/`modelRegistry` APIs to the current `CredentialStore`, `ModelRuntime`, and compatibility `ModelRegistry` surfaces. Pi credential persistence remains isolated behind `src/agent-runtimes/pi/credentials.ts`; other runtimes do not import or manipulate Pi credential storage.

The migration also updated:

- Pi model lookup and model-catalog construction;
- provider registration while preserving native provider-owned authentication;
- provider usage and Codex image authentication resolution;
- runtime binding protocol reporting from `0.80.6` to `0.84.2`;
- Pi Bash execution tests for the current native execution context;
- deterministic fast-mode HTTP validation through an injected in-memory `ModelRuntime`.

### Other dependency changes

- `better-auth` is exactly pinned at `1.6.30`, matching the migration-hardening branch requirement.
- `js-yaml` is overridden to `4.3.1` without requiring an MDX Editor major upgrade.
- `esbuild` is upgraded to `0.28.2`.
- The lockfile resolves compatible patched releases for the affected Hono, TanStack, Babel, body parser, serializer, parser, networking, and WebSocket paths.

No forced audit remediation was used.

## Audit result

| Audit | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| `npm audit --omit=dev` | 0 | 0 | 0 | 0 | 0 |
| `npm audit` | 0 | 0 | 0 | 0 | 0 |

The exact declared and locked versions were also checked for all four Pi packages, Better Auth, esbuild, and the `js-yaml` override.

## Local validation

Completed on the final source tree represented by this report:

- TypeScript typecheck: passed.
- Production build: passed.
- Focused Pi/auth/provider/runtime suite: **94/94 passed**.
- Canonical partitioned suite: **1,781/1,781 passed across 309 files**, with zero failures, skips, or cancellations.
- Canonical manifest uniqueness and aggregate accounting were asserted.
- `test/fixtures/omp-rpc-fake.mjs` was restored to mode `0644` after test execution.

## Packed-install validation

The exact working tree was packed and installed into an isolated prefix:

- package: `pasko70-pibo-1.7.2.tgz`;
- SHA-256: `a453557a9313335b7003e37f934c9eb6f1eb41f3841bb72b3e60096063e12470`;
- installed Pi Coding Agent: `0.84.2`;
- installed Better Auth: `1.6.30`;
- packed Pi credential-store write/read/delete round trip: passed;
- isolated local-auth Chat gateway: HTTP 200;
- isolated bootstrap endpoint: HTTP 200;
- graceful shutdown: passed.

## Deployment validation

The combined Pibo2 validation results will be appended after the focused branch is committed and assembled into the disposable integration candidate. No package has been published and no branch has been merged.

## Remaining external gate

Direct Windows validation remains required for the Better Auth SQLite migration on an actual Windows/NTFS host. Linux/POSIX validation does not prove Windows startup, NTFS ACL behavior, recovery naming, rollback, restart idempotence, or packed global-install behavior.
