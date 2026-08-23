# Isolated Deployment Pool Validation Report

Date: 2026-08-23

## Result

The isolated deployment pool is installed and active on the dedicated Pibo2 development host. Internal slot lifecycle, isolation, authentication, model execution, streaming, retention, and cleanup passed. Public slot access remains intentionally disabled because wildcard DNS, automated DNS-01 issuance, and Google OAuth redirect registration require operator-controlled external configuration.

Validated candidate:

- commit: `bfa014f3056c98d07630ed827655eb7d47f73150`
- package version: `1.7.2`
- package archive SHA-256: `7f50a47c426e2868723ffa629e139c270badf3da0e0476385a2048d5a778d100`
- installed runtime digest: `4227766f267aaa2e1f98f857d209e15f0ab673469fc592d1f7777d8f840ad0fc`

The digest implementation was corrected during validation to hash the complete installed `@pasko70/pibo` package tree. A focused regression test confirms identical package trees receive the same digest and a change outside the CLI entrypoint changes the digest.

## Repository validation

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused deployment-pool, compute-resource-policy, and resources-CLI tests: passed.
- Full repository suite: 1900 passed, 0 failed, 0 skipped; duration 130.143 seconds.
- Shell syntax validation for both deployment-pool scripts: passed.

## Host integration

The host has:

- 10 fixed slots and a maximum of 3 active leases.
- Ports beginning at 5000 with a stride of 10.
- Shared `pibo:latest` runtime image.
- Host CLI wrapper at `/usr/local/bin/pibo-pool`.
- Pool configuration loaded into the canonical gateway through a systemd environment file.
- Optional pool cleanup active in the Resource Reaper.
- nginx slot routing intentionally absent until valid wildcard TLS is available.

After final validation:

- pool status: 0 active, 10 free.
- reconciliation plan: no leases, orphans, dirty slots, failure snapshots, or artifacts selected for cleanup.
- canonical gateway: active and reachable.
- canonical Chat Web: HTTP 200 with approximately 51 ms time to first byte in the final check.
- host available memory: approximately 6.0 GiB.
- host swap available: approximately 7.0 GiB.
- host filesystem available: approximately 45 GiB.

The configured 1536 MiB memory and 10 GiB disk reserves pass. Capacity should remain at 3 until longer-running operation confirms acceptable latency and disk behavior.

## Concurrent slot validation

Three concurrent leases from the final candidate reached `ready`:

| Seed | Slot | Product rooms | Product sessions | Machine Auth |
| --- | --- | ---: | ---: | --- |
| `fresh` | `slot-01` | 1 | 1 | HTTP 200 |
| `full` | `slot-02` | 45 | 43 | HTTP 200 |
| `medium` | `slot-03` | 45 | 43 | HTTP 200 |

All three containers used:

- 1536 MiB memory limit.
- 1 CPU limit.
- 512 PID limit.
- 512 MiB shared memory.
- loopback-only published ports.
- separate home, Pi home, and workspace mounts.
- read-only installed runtime mount.
- no Docker socket mount.

A fourth acquisition failed as expected with `Deployment pool capacity reached (3 active)` and reported the nearest expiry.

A separate two-candidate test ran commits `2cb532f3a66c454b7e85c3914bef3bcd42062304` and `bfa014f3056c98d07630ed827655eb7d47f73150` concurrently. Their corrected installed-runtime digests were distinct, and both health endpoints passed.

## Isolation and seed behavior

A room named `Pool Isolation Probe` was created in the fresh slot. Bootstrap results showed it only in that slot and not in the concurrent medium or full slots.

Observed seed behavior:

- `fresh` started with new product state.
- `medium` and `full` copied representative rooms and sessions using SQLite online backup.
- source Better Auth sessions were not copied.
- source secrets, backups, tools, candidate packages, and editor runtime state were absent from medium/full slot homes.
- `auth.sqlite` created after startup was newly generated slot state, not a copied source database.

## Authentication and model path

- Requests without authentication returned HTTP 401.
- Machine Auth bootstrap returned HTTP 200 on all three concurrent slots.
- Slot configuration used Better Auth with slot-specific base URLs and trusted origins.
- Google credentials required for the configured provider were present without being printed in validation output.
- The final candidate completed a real model turn through Machine Auth and returned exactly `FINAL_POOL_OK`.
- The live SSE stream included `RUN_STARTED`, `message_started`, `TEXT_MESSAGE_START`, multiple `TEXT_MESSAGE_CONTENT` frames, `TEXT_MESSAGE_END`, `assistant_message`, `RUN_FINISHED`, and `message_finished`.

Public Google OAuth and headful browser validation remain pending because public wildcard DNS and TLS are not configured.

## Lease and cleanup validation

- Renew changed a live lease expiry and recorded `renewedAt`.
- Explicit release stopped and removed the container, removed active slot data, and returned the slot to `free`.
- A one-minute lease expired and was automatically released by the gateway Resource Reaper. The reaper recorded one deployment lease cleaned at `2026-08-23T19:38:14.993Z`.
- A deliberately labeled orphan container was selected in dry-run with reason `no-active-registry-lease` and removed by apply.
- A forced port conflict failed acquisition safely, returned the slot to `free`, and created a retained failure snapshot with a two-hour expiry.
- The retained-failure count stayed within the configured cap of 3.
- Package-archive installation used its archive SHA-256. First installation took approximately 34 seconds; a second acquisition reused the content-addressed artifact in approximately 3 seconds.
- The current artifact cache contains one inactive artifact of approximately 367 MiB and remains below its retention cap.

## External activation still required

The operator must complete these external steps before public slot URLs can be enabled:

1. Add the pool-base and wildcard `A` records described in `docs/project/isolated-deployment-pool-operations.md`.
2. Do not add `AAAA` until a stable IPv6 address and inbound IPv6 route are confirmed.
3. Provide a DNS provider API credential, or a delegated automated ACME challenge zone, for unattended DNS-01 renewal.
4. Issue a certificate covering the pool base and wildcard slot hostname.
5. Add all 10 exact Google OAuth callback URIs and, if used by the client configuration, all 10 JavaScript origins.
6. Rerun host setup with the wildcard certificate and key paths to generate and activate nginx routing.
7. Validate Google sign-in and Chat Web in a headful authenticated browser.

Until those steps are complete, the pool is ready for host-local and SSH-driven Machine Auth testing, but its public URLs are not expected to resolve.
