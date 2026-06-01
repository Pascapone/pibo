# Spec: Chat Web Static Shell and PWA Assets

**Status:** Draft
**Created:** 2026-05-10
**Owner / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md), [Chat Web Safe Content Rendering](./chat-web-safe-content-rendering.md)

## Why

Chat Web must remain reachable through deep links, reloads, and installed-browser entry points. The same web app also serves built JavaScript, CSS, icons, manifest data, and a service worker from the authenticated same-origin host. If static shell routing and asset caching are ambiguous, users can see stale application code, broken deep links, or cached API responses that should never be cached.

This spec captures the static delivery contract implemented by the current workspace. It complements API, room, cache, and rendering specs without redefining Chat Web data behavior.

## Goal

Pibo MUST serve the Chat Web browser shell, built assets, public PWA files, and service-worker behavior with deterministic routing, cache headers, content types, and compression.

## Background / Current State

`createChatWebApp` registers the Chat Web app at `/apps/chat` and API prefix `/api/chat`. Before API routing, it serves built files from the Vite output directory when present. Asset paths under `/apps/chat/assets/` are immutable. Public PWA files `/apps/chat/manifest.webmanifest` and `/apps/chat/sw.js` are served with `no-cache`. Deep app paths under `/apps/chat/...` fall back to the built `index.html`, or to an inline fallback shell when no built index exists.

The frontend registers `/apps/chat/sw.js` on browser load when service workers are supported. The service worker caches only app assets and skips API and navigation responses.

## Scope

### In Scope

- Static Chat Web app routing under `/apps/chat`.
- Built asset and public PWA file delivery.
- Deep-link fallback to the browser shell.
- Static file content types, cache headers, and optional Brotli/gzip compression.
- Service-worker cache boundaries for Chat Web assets.

### Out of Scope

- Auth session creation and app-space mapping — covered by Web Auth and Same-Origin Host.
- Chat Web API semantics for rooms, sessions, traces, cron, prompts, tools, or settings — covered by their capability specs.
- Browser UI state after the shell loads — covered by Chat Web Browser Shell State.
- Deployment and build script behavior — covered by Web Deployment Scripts.

## Requirements

### Requirement: Deep app links return the Chat Web shell

The app MUST return the Chat Web browser shell for `GET` requests to `/apps/chat` and non-static paths beneath `/apps/chat/`.

#### Current

`isChatAppPath` excludes assets, manifest, service worker, and icon paths. Matching `GET` requests return built `index.html` when it exists, otherwise `createChatHtml()`.

#### Target

A browser refresh on a room, session, settings, context, cron, project, or agent-designer route loads the shell instead of returning `404`.

#### Acceptance

- `GET /apps/chat` returns HTML.
- `GET /apps/chat/rooms/<roomId>/sessions/<piboSessionId>` returns HTML.
- Static paths such as `/apps/chat/assets/app.js`, `/apps/chat/manifest.webmanifest`, and `/apps/chat/sw.js` are not treated as deep-link shell paths.
- Non-GET requests to deep app paths do not receive the shell fallback.

#### Scenario: Reload a canonical Chat URL

- GIVEN a user has a browser URL `/apps/chat/rooms/room_1/sessions/ps_1`
- WHEN the browser reloads that URL with `GET`
- THEN the app responds with the Chat Web HTML shell
- AND client routing can restore the selected room and Pibo Session from the URL.

### Requirement: Built assets are immutable and typed

The app MUST serve files under `/apps/chat/assets/` from the built Chat UI directory with immutable caching and explicit content types.

#### Current

`responseBuiltChatAsset` maps asset paths to files under `CHAT_UI_DIST_DIR` and uses `public, max-age=31536000, immutable`. `contentTypeFor` maps JavaScript, CSS, SVG, PNG, webmanifest, and JSON extensions.

#### Target

Browsers can cache hashed Vite assets aggressively without confusing them with API responses or shell HTML.

#### Acceptance

- Existing asset files under `/apps/chat/assets/` return status `200`.
- Asset responses include `cache-control: public, max-age=31536000, immutable`.
- `.js`, `.css`, `.svg`, `.png`, `.webmanifest`, and `.json` use the implemented content type mapping.
- Paths that resolve outside the Chat UI dist directory are not served.
- Missing assets fall through to app routing and ultimately return `404` from the web host.

#### Scenario: Fetch a built JavaScript asset

- GIVEN the built shell references `/apps/chat/assets/index-abc123.js`
- WHEN the browser requests that file
- THEN the response has JavaScript content type
- AND immutable cache control.

### Requirement: Public PWA files are revalidated

The app MUST serve `/apps/chat/manifest.webmanifest` and `/apps/chat/sw.js` as public app files with `no-cache`.

#### Current

`responseBuiltChatPublicFile` allows only those two paths and delegates to the same static-file responder with `cache-control: no-cache`.

#### Target

Browsers can update the service worker and manifest after deployment without waiting for long immutable asset expiry.

#### Acceptance

- `GET /apps/chat/manifest.webmanifest` returns the built manifest when present.
- `GET /apps/chat/sw.js` returns the built service worker when present.
- Both responses include `cache-control: no-cache`.
- Other public-looking paths are not served unless they are under `/apps/chat/assets/`.

#### Scenario: Service worker update check

- GIVEN a browser has registered `/apps/chat/sw.js`
- WHEN the browser checks for a service-worker update
- THEN the server responds with `no-cache`
- AND the browser may revalidate the current worker script.

### Requirement: Static compression follows client support

The app MUST compress eligible static assets only when the client advertises a supported encoding.

#### Current

`preferredAssetEncoding` chooses Brotli before gzip for `.js`, `.css`, `.html`, and `.json` files. `compressedAssetBody` caches compressed bytes by encoding and file path. Responses include `content-encoding` and `vary: accept-encoding` when compression is used.

#### Target

Large text assets transfer efficiently without changing binary images or sending encodings the client did not request.

#### Acceptance

- A compressible asset requested with `Accept-Encoding: br, gzip` returns `content-encoding: br`.
- A compressible asset requested with only gzip support returns `content-encoding: gzip`.
- PNG and SVG assets are not compressed by this static compression path unless the implementation's compressible allowlist changes.
- Uncompressed responses omit `content-encoding`.
- Compressed responses include `vary: accept-encoding`.

#### Scenario: Prefer Brotli for JavaScript

- GIVEN a built JavaScript asset exists
- WHEN the browser requests it with `Accept-Encoding: br, gzip`
- THEN the response body is Brotli-compressed
- AND the response varies on `accept-encoding`.

### Requirement: Service worker caches only Chat Web assets

The service worker MUST cache asset responses under `/apps/chat/assets/` and MUST avoid caching API, shell-navigation, and cross-origin responses.

#### Current

`sw.js` installs and activates without pre-caching. Its fetch handler only intercepts `GET` requests for the same-origin `/apps/chat/assets/` prefix. It reads from a named cache first, fetches from the network when missing, stores successful responses, and returns the network response. Other requests fall through.

#### Target

The service worker improves repeat asset loads without making live Chat Web APIs stale or hiding authentication changes.

#### Acceptance

- Non-GET requests are not intercepted.
- Cross-origin requests are not intercepted.
- `/api/chat/*`, `/api/auth/*`, and deep `/apps/chat/...` navigation requests are not cached by the service worker.
- Successful same-origin asset responses under `/apps/chat/assets/` may be cached.
- Failed asset fetches are not cached as successful entries.

#### Scenario: API request bypasses service worker cache

- GIVEN the service worker is active
- WHEN the browser fetches `/api/chat/navigation`
- THEN the service worker does not serve or store that response from the asset cache.

## Edge Cases

- The built UI directory may be absent in a development or partially built workspace; deep app paths still receive the inline fallback shell.
- A static path that resolves outside the built UI directory MUST NOT be served, even if the file exists elsewhere on disk.
- Service-worker registration failures are ignored by the browser app so shell loading continues without offline asset caching.
- The web host's global request and response handling still controls top-level errors and JSON compression for API responses.

## Constraints

- **Compatibility:** Static app paths MUST stay under `/apps/chat` so canonical Chat URLs and installed PWA metadata remain stable.
- **Security / Privacy:** The service worker MUST NOT cache authenticated API responses, traces, room data, provider settings, prompts, or file downloads.
- **Performance:** Hashed built assets should be immutable; update-sensitive files such as `sw.js` and the manifest should be revalidated.
- **Dependencies:** The behavior assumes the Vite build writes assets and public files into the Chat UI dist directory used by `CHAT_UI_DIST_DIR`.

## Success Criteria

- [ ] SC-001: Web-channel or Chat Web tests verify deep app links return the HTML shell.
- [ ] SC-002: Static asset tests verify content types, immutable cache headers, and path traversal rejection.
- [ ] SC-003: PWA file tests verify manifest and service-worker `no-cache` behavior.
- [ ] SC-004: Static compression tests verify Brotli preference, gzip fallback, and `vary: accept-encoding`.
- [ ] SC-005: Service-worker tests or review checks verify only same-origin `/apps/chat/assets/` GET requests use the asset cache.

## Assumptions and Open Questions

### Assumptions

- Built asset filenames are content-hashed by the frontend build, so immutable caching is safe for `/apps/chat/assets/`.
- The inline fallback shell exists only as a development or emergency fallback; normal production serves built `index.html`.

### Open Questions

- Should `/apps/chat/icons/` be supported explicitly, or should all icons remain under `/apps/chat/assets/`?
- Should static asset compression include precomputed build artifacts instead of runtime in-memory compression?

## Traceability

| Requirement | Scenario / Story | Code / Test Basis | Status |
|---|---|---|---|
| REQ-001 Deep app links return the shell | Reload a canonical Chat URL | `src/apps/chat/web-app.ts`, `test/web-channel.test.mjs` | Draft |
| REQ-002 Built assets are immutable and typed | Fetch a built JavaScript asset | `src/apps/chat/web-app.ts`, `test/web-channel.test.mjs` | Draft |
| REQ-003 Public PWA files are revalidated | Service worker update check | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/public/manifest.webmanifest`, `src/apps/chat-ui/public/sw.js` | Draft |
| REQ-004 Static compression follows client support | Prefer Brotli for JavaScript | `src/apps/chat/web-app.ts`, `test/web-channel.test.mjs` | Draft |
| REQ-005 Service worker caches only Chat Web assets | API request bypasses service worker cache | `src/apps/chat-ui/public/sw.js`, `src/apps/chat-ui/src/main.tsx` | Draft |

## Verification Basis

This spec was refreshed against current source code in `src/apps/chat/web-app.ts`, `src/apps/chat-ui/index.html`, `src/apps/chat-ui/src/main.tsx`, `src/apps/chat-ui/public/sw.js`, `src/apps/chat-ui/public/manifest.webmanifest`, and related web-channel tests in `test/web-channel.test.mjs`. Existing specs under `docs/specs/` were inspected to avoid duplicating broader web-host, browser-shell, cache, and rendering contracts.
