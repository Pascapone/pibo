# Tasks: Session Live Previews

## 1. Foundation

- [x] 1.1 Add preview config, types, SQLite store, URL construction, validation, and tests.
- [x] 1.2 Add progressively discoverable `pibo preview` lifecycle commands and tests.

## 2. Authenticated proxy

- [x] 2.1 Extend the web-app contract with hostname and upgrade routing.
- [x] 2.2 Add authenticated management/open APIs and opaque ticket exchange.
- [x] 2.3 Add streaming HTTP, SSE, redirect/cookie sanitation, and WebSocket proxying.
- [x] 2.4 Add auth, isolation, proxy, and lifecycle integration tests.

## 3. Chat Web

- [x] 3.1 Add Preview API client and session query.
- [x] 3.2 Add Preview tab, selector, status controls, iframe, and empty/error states.
- [x] 3.3 Add trusted Preview fullscreen top bar and application-shell behavior.
- [x] 3.4 Add focused component/source tests and accessibility checks.

## 4. Validation

- [x] 4.1 Run typecheck, build, and focused test suites.
- [x] 4.2 Package and install the exact branch candidate on Pibo2.
- [x] 4.3 Configure the development preview origin and validate authenticated HTTP/WebSocket traffic.
- [x] 4.4 Validate inline/fullscreen UI in a headful authenticated browser with console/network evidence.
- [x] 4.5 Record final validation evidence and open the feature PR to `upstream/dev`.
