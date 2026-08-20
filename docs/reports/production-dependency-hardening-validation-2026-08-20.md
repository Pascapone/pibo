# Production Dependency Hardening Validation — 2026-08-20

**Status:** PASS for source, packed-install, integrated, and deployed production-audit validation. Direct Windows/NTFS validation remains an external gate for the separately scoped Better Auth migration.

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
- `@mdxeditor/editor` is classified as a build-only development dependency, so the prebuilt production package does not install the editor or its exact vulnerable YAML dependency.
- The source/build tree overrides `js-yaml` to `4.3.1` without requiring an MDX Editor major upgrade.
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
- Focused Pi/auth/provider/runtime suite: **95/95 passed**.
- Canonical partitioned suite: **1,782/1,782 passed across 309 files**, with zero failures, skips, or cancellations.
- Canonical manifest uniqueness and aggregate accounting were asserted.
- `test/fixtures/omp-rpc-fake.mjs` was restored to mode `0644` after test execution.

## Packed-install validation

An initial packed-install audit exposed a packaging-specific issue that source-tree `npm audit` could not prove: npm ignores `overrides` declared by an installed dependency package. The first candidate therefore installed MDX Editor's exact `js-yaml@4.1.1` dependency and reported three production advisories.

The dependency boundary was corrected by moving `@mdxeditor/editor` to `devDependencies`; Pibo publishes prebuilt UI assets and does not require the editor package at runtime. A regression test now enforces this classification.

The corrected working tree was then repacked and installed into an isolated prefix:

- package: `pasko70-pibo-1.7.2.tgz`;
- SHA-256: `cb58d7fb797e5763a8828df7f3294705ce7f0001c1fe1ed871e87ada5526b76d`;
- installed production audit: **0 advisories**;
- MDX Editor present in production install: **no**;
- installed Pi Coding Agent: `0.84.2`;
- installed Better Auth: `1.6.30`;
- packed Pi credential-store write/read/delete round trip: passed;
- isolated local-auth Chat gateway: HTTP 200;
- isolated bootstrap endpoint: HTTP 200;
- graceful shutdown: passed.

## Integrated deployment validation

The focused branch was assembled with Runtime Portability v4.1, the Windows Better Auth migration branch, and the resource-reaper home-scope fix in disposable integration commit `b01becb068619e43ab3dcbafd894bbb6944d5b4d`.

The exact integrated archive:

- had SHA-256 `eb6b18c72c5a9ac8489e24c32d3abf77967931b722616c752140c96043a38a84`;
- passed typecheck and production build;
- passed **216/216** focused tests;
- passed **1,813/1,813** canonical tests across 311 files;
- passed packed credential-store and local Chat gateway smoke checks;
- installed with **0 production advisories**;
- omitted `@mdxeditor/editor` from the production installation;
- resolved Pi Coding Agent `0.84.2`, Better Auth `1.6.30`, and `js-yaml@4.3.1`.

The checksum-verified archive was activated on Pibo2 as `runtime-portability-v4-1-secure` at that exact commit. The installed candidate's own `npm audit --omit=dev` remained zero, machine-key bootstrap authenticated successfully, and the public Chat UI rendered through the real browser path with no console warnings or errors. No package was published and no branch was merged.

## Remaining external gate

Direct Windows validation remains required for the Better Auth SQLite migration on an actual Windows/NTFS host. Linux/POSIX validation does not prove Windows startup, NTFS ACL behavior, recovery naming, rollback, restart idempotence, or packed global-install behavior. No configured host in this environment provides Windows.
