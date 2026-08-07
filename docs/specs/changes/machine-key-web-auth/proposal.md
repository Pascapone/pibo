# Proposal: Machine-key Web authentication

**Status:** Draft
**Created:** 2026-08-07

## Why

Pibo Production currently supports interactive Google OAuth and loopback-only local auth. Automated browser/CDP validation of the public Web UI cannot use either safely: Google login is interactive, while local auth is intentionally forbidden on public binds.

## Goal

Add an opt-in, revocable machine identity that can authenticate normal Pibo Web API and event-stream requests without weakening Google OAuth or exposing a shared auth bypass.

## Scope

### In scope

- high-entropy machine-key generation;
- hash-only server records tied to an existing Pibo user identity;
- header authentication in the Better Auth service boundary;
- a short-lived signed HttpOnly/Secure browser-session exchange backed by the same revocable key;
- expiration, revocation, listing, and identity lookup tooling;
- root-only local secret and server store files;
- tests for positive, invalid, expired, and revoked keys.

### Out of scope

- replacing Google OAuth;
- browser-side key storage in the Pibo bundle;
- URL/query-string credentials;
- general delegated authorization or fine-grained scopes;
- an in-app key-management UI.

## Success criteria

- [ ] Google sessions behave unchanged when no machine-key header is present.
- [ ] A valid machine key receives the configured existing user identity.
- [ ] Invalid, expired, and revoked keys do not authenticate.
- [ ] The raw key is never persisted in the server record.
- [ ] A key can be generated locally, imported remotely, listed without its secret, and revoked.
- [ ] An authenticated browser can load Chat bootstrap and an event stream through the public Pibo2 URL.
