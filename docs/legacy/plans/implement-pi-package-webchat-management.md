# Implement Pi Package Webchat Management

Date: 2026-05-02

## Assumptions

- No package discovery, gallery, iframe, or HTML proxy is part of this iteration.
- Browser-origin adds accept only `https://pi.dev/packages/...` URLs.
- CLI/local path registration remains unchanged.
- `Unregister` removes the global Pibo package registration.
- Adding a package does not auto-select it for the current agent.

## Plan

1. Harden package registration state.
   - Add `enabled` to stored package metadata.
   - Default existing package entries to `enabled: true`.
   - Skip disabled packages at runtime and emit a warning diagnostic when a selected package is disabled.
   - Verify with package store/runtime tests.

2. Extend Chat Web package APIs.
   - Keep `GET`, `POST`, `GET /:id`, and `DELETE /:id`.
   - Restrict browser `POST /api/chat/pi-packages` to `https://pi.dev/packages/...`.
   - Add `PATCH /api/chat/pi-packages/:id` for `enabled`.
   - Verify invalid browser sources and patch behavior.

3. Build Agent Designer package management.
   - Add a URL input and add button inside the `Pi Packages` panel.
   - Show package cards with status, rich metadata, resources, links, diagnostics, and trust warning.
   - Add per-package enable/disable and unregister controls.
   - Keep per-agent package selection separate from global registration.
   - Remove unregistered packages from the current draft selection.

4. Validate.
   - Run `npm run typecheck`.
   - Run `npm test`.
