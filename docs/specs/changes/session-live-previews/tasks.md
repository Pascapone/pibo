# Tasks: Session Live Previews

## 1. Foundation

- [ ] 1.1 Add preview config, types, SQLite store, URL construction, validation, and tests.
- [ ] 1.2 Add progressively discoverable `pibo preview` lifecycle commands and tests.

## 2. Authenticated proxy

- [ ] 2.1 Extend the web-app contract with hostname and upgrade routing.
- [ ] 2.2 Add authenticated management/open APIs and opaque ticket exchange.
- [ ] 2.3 Add streaming HTTP, SSE, redirect/cookie sanitation, and WebSocket proxying.
- [ ] 2.4 Add auth, isolation, proxy, and lifecycle integration tests.

## 3. Chat Web

- [ ] 3.1 Add Preview API client and session query.
- [ ] 3.2 Add Preview tab, selector, status controls, iframe, and empty/error states.
- [ ] 3.3 Add trusted Preview fullscreen top bar and application-shell behavior.
- [ ] 3.4 Add focused component/source tests and accessibility checks.

## 4. Validation

- [ ] 4.1 Run typecheck, build, and focused test suites.
- [ ] 4.2 Package and install the exact branch candidate on Pibo2.
- [ ] 4.3 Configure the development preview origin and validate authenticated HTTP/WebSocket traffic.
- [ ] 4.4 Validate inline/fullscreen UI in a headful authenticated browser with console/network evidence.
- [ ] 4.5 Record final validation evidence and open the feature PR to `upstream/dev`.
