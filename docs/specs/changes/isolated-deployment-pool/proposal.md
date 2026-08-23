# Proposal: Isolated Deployment Pool

## Why

A single shared Pibo2 deployment cannot safely validate multiple agent changes at the same time. Candidate activation and gateway restarts interrupt unrelated work, while ad hoc Docker containers lack stable URLs, ownership, expiration, authentication, and cleanup.

## What Changes

- Add a lease-based `pibo compute pool` CLI for fixed Docker deployment slots.
- Install exact npm artifacts in a content-addressed store and mount them into one shared runtime image.
- Give every slot an isolated Pibo home, workspace, ports, public URL, Better Auth configuration, and machine-auth records.
- Support `full`, `medium`, and `fresh` seed modes.
- Reap expired leases and retained failed snapshots automatically.

## Capabilities

### New Capabilities
- `isolated-deployment-pool`: Concurrent, expiring, authenticated Pibo deployments on one Docker host.

### Modified Capabilities
- `docker-compute-workers`: Reuse resource policy and Docker hygiene without treating pool deployments as ordinary workers.
- `compute-browser-resource-lifecycle`: Include deployment leases in automatic cleanup.

## Impact

- **Code:** New compute pool registry, seed copier, artifact store, Docker launcher, CLI, and reaper integration.
- **CLI:** New `pibo compute pool` command group.
- **Data:** Pool SQLite registry and bounded slot/artifact directories under the configured pool root.
- **Auth:** Every slot uses normal Better Auth plus Machine Auth; public local auth remains prohibited.
- **Host:** Fixed loopback ports and externally configured DNS/TLS/nginx slot routes.
