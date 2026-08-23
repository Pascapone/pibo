# Design: Isolated Deployment Pool

## Context

Pibo already has Docker worker resource limits, package candidate installation, machine auth, Better Auth, and automatic resource reaping. The missing boundary is a concurrency-safe host registry that combines those pieces into stable deployment slots.

## Goals / Non-Goals

- Allow three concurrent self-service Pibo deployments on the initial host.
- Avoid one Docker image per candidate.
- Keep canonical Pibo2 and every slot independent.
- Do not provide hostile multi-tenant isolation for agents sharing root access.
- Do not replace nginx or dynamically mutate nginx on every lease.

## Decisions

### Decision: Fixed slots and ports

- **Choice:** Preconfigure slot ordinals, hostnames, and loopback port blocks.
- **Rationale:** Acquire/release needs no proxy reload; OAuth callback URLs are stable.

### Decision: SQLite lease registry

- **Choice:** Reserve slots with `BEGIN IMMEDIATE` transactions and reconcile registry state with Docker labels.
- **Rationale:** Concurrent agents cannot acquire the same slot.

### Decision: Shared image plus mounted npm runtime

- **Choice:** Install package artifacts by SHA-256 and mount the installed runtime read-only into `pibo:latest`.
- **Rationale:** Candidate deployments reuse one large image and do not accumulate branch images.

### Decision: Three seed modes

- **Full:** Copy nearly all source Pibo home/workspace state except locks, browser profiles, pool state, temporary files, and active runtime metadata.
- **Medium:** Copy operational config plus representative product SQLite databases and user-managed profiles/skills, omitting payloads, tools, browsers, backups, debug artifacts, generated media, and runtime state.
- **Fresh:** Copy only operational config, auth configuration, machine-key hashes, model defaults, prompts, and selected user definitions; create new product databases on startup.

SQLite files are copied with the Node SQLite backup API rather than raw live-file copies.

### Decision: Explicit TTL

- **Choice:** A lease expires after 60 minutes unless renewed.
- **Rationale:** Traffic and CPU usage are not reliable ownership signals.

### Decision: Failed snapshot retention

- **Choice:** Retain failed slot homes/logs for two hours, capped at three snapshots.
- **Rationale:** Preserve diagnostics without unbounded disk growth.

## Risks / Trade-offs

- Full seeds are large and slower to prepare.
- Fixed slots require their OAuth callbacks to be registered before use.
- The shared image must remain compatible with mounted package runtimes.
- Three active deployments are a starting policy, not a claim that the host can support more.

## Migration / Rollback

The pool is inactive unless its base URL and runtime image are configured. Rollback disables new acquires, reaps pool containers, and removes the dedicated nginx slot routes without changing the canonical gateway.
