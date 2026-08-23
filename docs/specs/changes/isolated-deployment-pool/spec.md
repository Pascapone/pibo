# Spec: Isolated Deployment Pool

**Status:** Implemented and publicly activated
**Created:** 2026-08-23
**Requester / Source:** User request in Pibo Session `ps_d0fb25d0-2b64-467c-b79d-a1d058db598b`
**Related docs:** [Proposal](./proposal.md), [Design](./design.md), [Tasks](./tasks.md)

## Why

Parallel agents need independent Pibo2 deployments. A shared gateway cannot provide candidate isolation, stable ownership, automatic expiration, and independent restarts.

## Goal

Pibo MUST provide a bounded lease pool where an agent can deploy an exact package artifact into an isolated authenticated slot, use its stable URL, renew or release it, and rely on automatic cleanup after expiration.

## Scope

### In Scope

- Fixed deployment slots and loopback port blocks.
- Concurrency-safe acquire, status, doctor, renew, release, and reap commands.
- Exact runtime directories and checksum-addressed npm package artifacts.
- Full, medium, and fresh seed modes.
- Machine Auth slot configuration while retaining the single existing canonical Google OAuth callback.
- Docker limits, labels, health checks, failed retention, artifact cleanup, and reaper integration.

### Out of Scope

- DNS-provider-specific credentials in the repository.
- Automatic Git branch fetching or merging.
- Anonymous access.
- Strong isolation from a root user on the Docker host.
- Automatic scaling beyond the configured active limit.

## Requirements

### Requirement: Allocation is bounded and race-safe

The pool MUST reserve no more than the configured active limit and MUST NOT allocate one slot to two concurrent callers.

#### Acceptance

- Default active limit is three.
- Concurrent acquire attempts return unique slots or a capacity error.
- Capacity errors include active leases and nearest expiry.

### Requirement: Slots run exact isolated runtimes

Each lease MUST run the selected package runtime with its own Pibo home, workspace, ports, and container.

#### Acceptance

- The runtime mount is read-only.
- Slot web and gateway ports bind only to host loopback.
- Docker socket is not mounted.
- Restarting one slot does not restart another slot or the canonical gateway.

### Requirement: Seed modes are explicit

Acquire MUST require or default a seed mode from `full`, `medium`, or `fresh`.

#### Acceptance

- Full includes nearly complete product state while excluding transient and unsafe runtime state.
- Medium includes representative product databases but omits heavy payload/browser/debug areas.
- Fresh starts without existing rooms, sessions, projects, cron jobs, or traces.
- Live SQLite databases are cloned through a consistent backup operation.

### Requirement: Public slots use Machine Auth

Each slot MUST support Machine Auth. Public local auth MUST NOT be enabled, and the pool MUST NOT require a separate Google OAuth callback for each slot.

#### Acceptance

- Slot config contains its own canonical base URL and trusted origin.
- Machine-key hash records are available without copying the raw key.
- Unauthenticated app requests remain unauthenticated.
- The existing canonical Google OAuth callback remains unchanged.

### Requirement: Leases expire and can be renewed or released

The default lease TTL MUST be 60 minutes.

#### Acceptance

- Renew extends only a matching active holder lease.
- Release removes only the selected lease container and writable slot state.
- Expired leases are selected by dry-run and removed by automatic reaping.

### Requirement: Cleanup is bounded and inspectable

The system MUST expose dry-run cleanup and MUST avoid unbounded containers, failed homes, logs, artifacts, or images.

#### Acceptance

- Failed homes/logs remain for two hours, capped at three snapshots.
- Artifacts are addressed by checksum and reused.
- Candidate deployment does not create one Docker image per artifact.
- Cleanup never performs an unscoped global Docker prune.

## Edge Cases

- A container starts but never becomes healthy.
- A lease expires during a long browser test.
- Registry state exists without a container or vice versa.
- A fixed slot port is occupied by an unrelated process.
- Source databases receive writes while a seed is created.
- Docker disappears during release or reap.

## Success Criteria

- [ ] Three slots can be acquired concurrently with unique URLs and isolated state.
- [ ] All three seed modes pass focused tests.
- [ ] Renew, release, expiration, failed retention, and reconciliation pass tests.
- [ ] Two exact candidates run concurrently on Pibo2 through authenticated public URLs.
- [ ] Repeated candidates reuse one runtime image and checksum-addressed artifacts.
