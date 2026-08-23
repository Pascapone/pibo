# Isolated Deployment Pool Validation Report

Date: 2026-08-23

## Result

The isolated deployment pool is installed, publicly activated, and operational on the dedicated Pibo2 development host. Slot lifecycle, isolation, authentication, model execution, live streaming, retention, cleanup, public HTTPS, and headful browser use passed.

Final publicly validated candidate:

- commit: `7f98b22732b1c8d2786d2083bb48d7f4bbe12664`
- package version: `1.7.2`
- package archive SHA-256: `1782d5382411c579c2165be3dc06460f82578f9a255aab9343ac228ea7a24c95`
- installed runtime digest: `c00f86999f55a25e04d1fb3e429cdf9bff7edf26369ab35cf509563c9094eba4`

The earlier internal validation candidate was `bfa014f3056c98d07630ed827655eb7d47f73150`. Public validation exposed one reverse-proxy origin issue: nginx reaches a slot from the Docker bridge rather than a loopback peer, so the request URL was incorrectly reconstructed as HTTP and same-origin POST requests returned HTTP 403. Commit `7f98b22732b1c8d2786d2083bb48d7f4bbe12664` makes an exact canonical-host match authoritative for the request origin and adds a regression test for the Docker-published-host path.

The installed-runtime identity implementation also hashes the complete installed `@pasko70/pibo` package tree. Its regression coverage proves identical package trees receive the same digest and a change outside the CLI entrypoint changes the digest.

## Repository validation

- `npm run typecheck`: passed on the final candidate.
- `npm run build`: passed on the final candidate.
- Reverse-proxy and Docker-published canonical-host mutation regressions: 2 passed.
- Earlier full repository suite before the final focused origin patch: 1900 passed, 0 failed, 0 skipped.
- Final full repository suite: 1901 passed, 0 failed, 0 skipped; duration 455.050 seconds.
- Shell syntax validation for both deployment-pool scripts: passed.

## DNS, TLS, and nginx

Public DNS resolves the pool base and all ten fixed slot names to the development host IPv4 address.

The `pibo-deployment-pool` Let's Encrypt certificate covers:

- the configured pool base host
- `slot-01` through `slot-10` under that pool base host

The certificate expires on 2026-11-21 at 19:31:27 UTC and uses the existing automated Certbot renewal path. nginx passed configuration validation and serves HTTPS slot routing with current HTTP/2 syntax. An inactive slot returns HTTP 503. The pool base currently has no application page and returns HTTP 404 over valid HTTPS.

No `AAAA`, DNS-01, TXT, CNAME, individual slot record, per-slot OAuth origin, or per-slot OAuth callback was added.

## Host integration

The host has:

- 10 fixed slots and a maximum of 3 active leases.
- Ports beginning at 5000 with a stride of 10.
- Shared `pibo:latest` runtime image.
- Host CLI wrapper at `/usr/local/bin/pibo-pool`.
- Pool configuration loaded into the canonical gateway through a systemd environment file.
- Pool cleanup integrated with the Resource Reaper.
- nginx HTTPS mappings for all fixed slots.

After public validation:

- pool status: 0 active, 10 free.
- inactive `slot-01` health request: HTTP 503.
- canonical Chat Web: HTTP 200.
- active canonical candidate: `7f98b22732b1c8d2786d2083bb48d7f4bbe12664`.
- supervised headful validation browser: stopped and cleaned up.

The configured 1536 MiB memory and 10 GiB disk reserves pass. Capacity should remain at 3 until longer-running operation confirms acceptable latency and disk behavior.

## Concurrent slot validation

Three concurrent leases from the internal validation candidate reached `ready`:

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

A separate two-candidate test ran commits `2cb532f3a66c454b7e85c3914bef3bcd42062304` and `bfa014f3056c98d07630ed827655eb7d47f73150` concurrently. Their installed-runtime digests were distinct, and both health endpoints passed.

## Isolation and seed behavior

A room named `Pool Isolation Probe` was created in the fresh slot. Bootstrap results showed it only in that slot and not in the concurrent medium or full slots.

Observed seed behavior:

- `fresh` started with new product state.
- `medium` and `full` copied representative rooms and sessions using SQLite online backup.
- source Better Auth sessions were not copied.
- source secrets, backups, tools, candidate packages, and editor runtime state were absent from medium/full slot homes.
- `auth.sqlite` created after startup was newly generated slot state, not a copied source database.

## Public authentication, API, streaming, and browser path

A fresh public lease on `slot-01` used the final candidate and passed:

- `/health`: HTTP 200 while active.
- unauthenticated bootstrap: HTTP 401.
- Machine Auth bootstrap: HTTP 200.
- public same-origin message POST: HTTP 200.
- real model response: `PUBLIC_POOL_OK`.
- public live SSE response: `PUBLIC_STREAM_OK`.
- SSE lifecycle included `user.message.accepted`, `message_queued`, `RUN_STARTED`, `message_started`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `assistant_usage`, `TEXT_MESSAGE_END`, `assistant_message`, `RUN_FINISHED`, and `message_finished`.

The supervised non-headless Chrome/Xvfb browser was authenticated through a short-lived Machine Auth session cookie and navigated to the public slot URL. The rendered Chat Web UI showed the previous API turns. A message submitted through the visible composer returned `PUBLIC_BROWSER_OK` in approximately one second. The final accessibility snapshot and screenshot showed all three user/assistant pairs, and the browser console had no warnings or errors.

The browser profile and tunnel were stopped after validation. The screenshot was not added to the repository because the authenticated shell displays identity information.

## Canonical Google OAuth boundary

The canonical social sign-in initiation returned HTTP 200 and generated a Google authorization URL at `accounts.google.com`. Its `redirect_uri` remained the configured canonical development origin plus `/api/auth/callback/google`.

This confirms the existing canonical callback remains in use. No callback was registered for a pool slot. Completing a fresh interactive Google consent flow was outside this automated Machine Auth validation; the canonical application remained reachable before and after pool activity.

## Lease and cleanup validation

- Renew changed a live lease expiry and recorded `renewedAt`.
- Explicit release stopped and removed the container, removed active slot data, and returned the slot to `free`.
- A one-minute lease expired and was automatically released by the gateway Resource Reaper. The reaper recorded one deployment lease cleaned at `2026-08-23T19:38:14.993Z`.
- A deliberately labeled orphan container was selected in dry-run with reason `no-active-registry-lease` and removed by apply.
- A forced port conflict failed acquisition safely, returned the slot to `free`, and created a retained failure snapshot with a two-hour expiry.
- The retained-failure count stayed within the configured cap of 3.
- Package-archive installation used its archive SHA-256. First installation took approximately 34 seconds; a second acquisition reused the content-addressed artifact in approximately 3 seconds.

## Remaining operator action

Rotate the previously exposed credential. It was not reproduced in this report.
