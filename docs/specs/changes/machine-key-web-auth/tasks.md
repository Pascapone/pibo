# Tasks: Machine-key Web authentication

**Status:** Active
**Created:** 2026-08-07

## Phase 1 — Contract and core

- [x] Document requirements and architecture.
- [x] Add token generation, record validation, atomic store, and hot-reloading authenticator.
- [x] Compose machine verification with Better Auth while preserving Google behavior.
- [x] Add config support for an alternate store path.
- [x] Add unit tests for valid, invalid, expired, revoked, and reloaded records.
- [x] Add a signed short-lived browser-session exchange whose cookies remain key-revocable.

## Phase 2 — Operator CLI

- [x] Add concise `pibo auth` discovery.
- [x] Add existing-identity lookup by email.
- [x] Add local generation with explicit `0600` secret and record outputs.
- [x] Add hash-only import, redacted list, and revoke commands.
- [x] Add CLI tests and secret-leak assertions.

## Phase 3 — Pibo2 validation

- [x] Build and test the focused branch.
- [x] Back up target auth/config and install candidate without releasing it.
- [x] Provision a Pibo2 key without leaving the raw secret on the server.
- [x] Verify Chat bootstrap, SSE, invalid key, and revocation through the public URL.
- [x] Establish authenticated headful Chrome/CDP access through the machine-session exchange.
- [x] Capture evidence and update the server-development skill.

## Phase 4 — Delivery

- [ ] Open and review an upstream PR against `upstream/dev`.
- [ ] Keep the candidate available for continued server workflow testing.
- [ ] Release only after the wider real-agent/browser scenarios pass.
