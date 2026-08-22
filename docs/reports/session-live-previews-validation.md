# Session Live Previews Validation Report

Date: 2026-08-22

## Scope

Validated the session-linked live preview capability from CLI registration through the authenticated public Chat Web UI, including isolated preview authentication, HTTP streaming, SSE, WebSocket upgrades, Session and Project views, application fullscreen, and lifecycle revocation.

## Source and package

- Branch: `feature/session-live-previews`
- Base: `upstream/dev` at `f084a7f66b0bd18d2817ad050d4340d66c292fdc`
- Integrated code candidate: `be0c808a1b9705c2c50bd9d8de7eefcedc98f19e`
- Package SHA-256: `451a604c2d8d0d29574e6bac23d2eb1d89821ee5bdecfc13f7cb45f25ef46fce`
- Pibo2 active candidate after validation: `session-live-previews` at the integrated code candidate above

## Automated validation

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused preview, configuration, plugin, web-channel, WebSocket, UI, and fullscreen tests: passed.
- Full `npm test`: 1,854 passed, 0 failed, 0 skipped.
- Listener-replacement test confirmed that a Linux exposure pinned to one listener reports offline after a different process occupies the same port.
- Auth integration confirmed that two distinct accepted accounts can independently create tickets for the same active preview.
- Public API assertions confirmed that workspace and target-process diagnostics are not returned to browser clients.

## Pibo2 public-path validation

The exact candidate was installed in the versioned candidate directory, activated through `pibo-web.service`, and verified through the public Chat Web origin.

A temporary loopback fixture and temporary exact-host TLS certificates were used to validate the public preview path. The fixture exercised:

- HTML and nested JavaScript assets;
- streaming HTTP and SSE (`stream-ready`);
- WebSocket upgrade and traffic (`hmr-ready`);
- one-time authenticated ticket exchange;
- preview-only partitioned browser cookies;
- isolated preview origin rendering inside Chat Web;
- HTTP 401 for direct unauthenticated preview access.

The authenticated headful browser confirmed:

- Preview appears only when the selected Pibo Session has an active exposure;
- Session Preview renders HTTP, SSE, and WebSocket state correctly;
- Project session Preview renders the same exposure workflow;
- application fullscreen hides normal Pibo chrome while retaining the trusted preview name, health, reload, open-window, and exit controls;
- mobile-width layout remains usable;
- closing a preview from Chat Web removes the Preview view and revokes the exposure;
- final console inspection reported no messages;
- the public management API returned only browser-safe preview fields.

After validation, temporary fixture processes, exact-host nginx configuration, certificates, active exposures, and the temporary `preview.baseURL` were removed. The candidate remains deployed and healthy; permanent operation still requires operator-provided wildcard DNS and TLS for the configured preview base hostname.

## Review

- Feature PR: `Pascapone/pibo#543`, targeting `upstream/dev`.

## Final health

- Local gateway health: HTTP 200.
- Public Chat Web: HTTP 200.
- `pibo-web.service`: active on the exact candidate.
- Headful authenticated browser: active and reaper-exempt.
