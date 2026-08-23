# Tasks: Isolated Deployment Pool

## 1. Registry and CLI

- [x] 1.1 Add pool configuration and types under `src/compute/pool/`.
- [x] 1.2 Add SQLite slot/lease registry with transactional allocation.
- [x] 1.3 Add progressive `pibo compute pool` commands.
- [x] 1.4 Add registry and CLI tests.

## 2. Seed and artifact preparation

- [x] 2.1 Add checksum-addressed artifact installation and reuse.
- [x] 2.2 Add full, medium, and fresh seed builders with SQLite backup.
- [x] 2.3 Rewrite slot auth base URL/trusted origin without exposing secrets.
- [x] 2.4 Add seed and artifact tests.

## 3. Docker lifecycle

- [x] 3.1 Add fixed port blocks, labels, mounts, resource limits, and runtime startup.
- [x] 3.2 Add health checks, rollback, renew, release, and doctor output.
- [x] 3.3 Add failed snapshot retention and reconciliation.
- [x] 3.4 Add Docker command-construction tests.

## 4. Automatic cleanup

- [x] 4.1 Add pool dry-run/apply planning.
- [x] 4.2 Integrate pool cleanup into the gateway Resource Reaper.
- [x] 4.3 Add expiration, orphan, failure-retention, and cap tests.

## 5. Pibo2 host integration

- [x] 5.1 Add host setup and controller helper scripts without hard-coded hostnames.
- [x] 5.2 Configure pool root, runtime image, environment file, slot hostnames, and ports.
- [x] 5.3 Provide exact Squarespace DNS records and preserve the single existing canonical Google OAuth callback.
- [x] 5.4 Configure nginx after DNS propagation and SAN certificate issuance.

## 6. Validation

- [x] 6.1 Run build, typecheck, focused tests, and full tests.
- [x] 6.2 Install an exact combined candidate on Pibo2.
- [x] 6.3 Validate fresh, medium, and full slots.
- [x] 6.4 Validate three concurrent leases, release, expiry, and reaping.
- [x] 6.5 Validate public Machine Auth, Chat Web, POST mutation, live SSE streaming, and a headful browser turn. Confirm the canonical Google OAuth initiation still uses the single existing callback.
- [x] 6.6 Record a durable validation report.
