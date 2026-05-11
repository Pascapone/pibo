# Spec: Simple Agent HTTP API

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-05-11
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md), [Pibo Session Routing](./pibo-session-routing.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md)

## Why

Some service clients need a small HTTP surface that can submit a message to an existing Pibo Session and wait for the assistant's final text without speaking the newline-delimited gateway protocol or using the Chat Web App.

The API must stay narrow because it bypasses browser session auth. It authenticates with a configured API key, addresses only existing Pibo Sessions, and returns one correlated assistant response.

## Goal

Expose a minimal same-origin HTTP API for health checks and authenticated service-to-agent message submission against existing routed Pibo Sessions.

## Background / Current State

The web host checks canonical redirects, health endpoints, gateway status, auth routes, then delegates `/api/health` and `/api/send-message` to the simple agent API before registered web apps handle their own app and API prefixes.

`/api/health` returns JSON health without API-key auth. `/api/send-message` requires an API key from options or `PIBO_SIMPLE_API_KEY`, validates a JSON body with `sessionId` and `message`, emits a Pibo message event with source `service`, and waits for output events that match the generated request event id.

## Scope

### In Scope

- HTTP behavior for `/api/health` and `/api/send-message`.
- API-key candidate extraction and validation.
- Input validation for service message submission.
- Correlation between a submitted message event and returned assistant text.
- Error and timeout behavior observable by HTTP clients.

### Out of Scope

- Creating or listing Pibo Sessions — clients must already know the target Pibo Session ID.
- Browser Better Auth or dev-auth login flows — those are covered by the web auth spec.
- Streaming partial model output over this API — this endpoint returns after the correlated message finishes.
- Gateway newline-delimited JSON frames — those are covered by the local gateway protocol spec.

## Requirements

### Requirement: Health checks are public and method-limited

The web host MUST respond to `/api/health` with a JSON health payload for `GET` and `HEAD`, and MUST reject other methods with `405` and an `Allow: GET, HEAD` header.

#### Acceptance

- `GET /api/health` returns status `200` and JSON `{ "status": "ok" }`.
- `HEAD /api/health` is accepted by the same handler.
- `POST /api/health` returns status `405` with `Allow: GET, HEAD`.

#### Scenario: Service probes health

- GIVEN the web host is running
- WHEN a service sends `GET /api/health`
- THEN it receives JSON with `status` equal to `ok`

### Requirement: Send-message accepts only POST

The API MUST route only `/api/send-message` to service message submission and MUST reject non-`POST` methods with `405` and `Allow: POST`.

#### Acceptance

- `POST /api/send-message` proceeds to API-key and body validation.
- `GET /api/send-message` returns status `405` with `Allow: POST`.
- Any other path returns `undefined` to the web host so app routing or not-found handling can continue.

#### Scenario: Wrong method is rejected

- GIVEN a client has a valid API key
- WHEN it sends `GET /api/send-message`
- THEN the API returns `405`
- AND no Pibo input event is emitted

### Requirement: Send-message requires a configured API key

The API MUST reject `/api/send-message` when no expected API key is configured by options or `PIBO_SIMPLE_API_KEY`.

#### Acceptance

- Missing configured API key returns status `503`.
- The error body describes that the simple agent API key is not configured.
- No request body fields are emitted as Pibo events when the key is missing.

#### Scenario: Operator forgot to configure the key

- GIVEN the web host starts without `PIBO_SIMPLE_API_KEY` and without an explicit API key option
- WHEN a client sends `POST /api/send-message`
- THEN the API returns `503`

### Requirement: API-key candidates are accepted from supported headers

The API MUST compare candidates from `x-api-key`, `api-key`, `Authorization: Bearer ...`, `Authorization: Token ...`, raw `Authorization`, and Basic-auth credential parts against the configured key using length-checked timing-safe equality.

#### Acceptance

- A matching `x-api-key` value authorizes the request.
- A matching bearer or token value authorizes the request after stripping the scheme prefix.
- A matching Basic-auth username or password authorizes the request after Base64 decoding and trimming.
- Non-matching or malformed candidates return status `401`.

#### Scenario: Bearer token authorizes a service client

- GIVEN `PIBO_SIMPLE_API_KEY` is `secret-value`
- WHEN a client sends `Authorization: Bearer secret-value`
- THEN API-key validation passes

### Requirement: Request body contains a target session and message

The API MUST accept only JSON object bodies with non-empty string `sessionId` and `message` fields.

#### Acceptance

- Invalid JSON or a non-object JSON body returns status `400`.
- Missing, non-string, or blank `sessionId` returns status `400`.
- Missing, non-string, or blank `message` returns status `400`.
- Validation returns the original string value when it is a non-empty string; it does not trim the submitted message before emission.

#### Scenario: Blank message is rejected

- GIVEN a client has a valid API key
- WHEN it posts `{ "sessionId": "ps_123", "message": "" }`
- THEN the API returns `400`
- AND no message is emitted

### Requirement: Target session must already exist

The API MUST reject a valid service request when `channelContext.getSession(sessionId)` does not return a session.

#### Acceptance

- Unknown `sessionId` returns status `404`.
- The response body contains an error message.
- No message event is emitted for unknown sessions.

#### Scenario: Client addresses an unknown session

- GIVEN the web host has no session `ps_missing`
- WHEN a client posts a valid message for `ps_missing`
- THEN the API returns `404`

### Requirement: Submitted service messages use a generated correlation id

The API MUST generate a new event id for each accepted request, emit one Pibo input event with type `message`, the requested Pibo Session ID, the submitted message text, and source `service`, then wait for output events that match both the Pibo Session ID and generated event id.

#### Acceptance

- Each accepted HTTP request emits one message event with a unique id.
- Output from other Pibo Sessions is ignored while waiting.
- Output for the same Pibo Session but a different event id is ignored while waiting.

#### Scenario: Concurrent service requests do not cross replies

- GIVEN two requests are submitted to the same Pibo Session
- WHEN assistant events arrive with different event ids
- THEN each HTTP response uses only events with its own generated id

### Requirement: The response returns the final correlated assistant message

The API MUST remember the latest correlated `assistant_message` text and return it when the correlated `message_finished` event arrives.

#### Acceptance

- A successful response is JSON with `message`, `eventId`, and `sessionId`.
- If multiple correlated `assistant_message` events arrive before finish, the last one is returned.
- If `message_finished` arrives without a prior correlated assistant message, the response message is an empty string.

#### Scenario: Agent finishes normally

- GIVEN an accepted service message has event id `e1`
- AND the router emits a correlated `assistant_message` with text `Done`
- WHEN the router emits correlated `message_finished`
- THEN the HTTP response body includes `message: "Done"`, `eventId: "e1"`, and the target `sessionId`

### Requirement: Correlated errors and timeouts become HTTP failures

The API MUST convert a correlated `session_error` into a `500` response and MUST return `504` if no correlated finish or error event arrives before the configured timeout.

#### Acceptance

- A correlated `session_error` returns status `500` with the session error text.
- The default timeout is 10 minutes.
- An explicit `timeoutMs` option overrides the default.
- Timeout cleanup unsubscribes from future events.

#### Scenario: Agent run times out

- GIVEN an accepted service message has no correlated finish or error event
- WHEN the configured timeout elapses
- THEN the API returns `504`
- AND the request listener is removed

## Edge Cases

- Basic-auth decoding failures produce no candidates and therefore fail with `401` unless another supported header matches.
- API-key candidates may include scheme-prefixed and raw authorization values; both are considered.
- Candidate comparison first checks Buffer length to avoid timing-safe comparison errors.
- A session-level error without a matching generated event id is ignored for the waiting request.
- The web host's global request body limit applies before JSON parsing.

## Constraints

- **Compatibility:** The API must not reserve paths beyond `/api/health` and `/api/send-message`; unknown paths must fall through to the web host.
- **Security / Privacy:** `/api/send-message` must not fall back to browser auth. API-key auth is required for service access.
- **Performance:** Waiting for agent completion must unsubscribe on success, error, or timeout.
- **Dependencies:** The API depends on `PiboChannelContext.getSession`, `emit`, and `subscribe`.

## Success Criteria

- [ ] SC-001: Health requests pass and method errors include the correct `Allow` header.
- [ ] SC-002: Missing, invalid, and valid API-key cases produce `503`, `401`, and successful validation respectively.
- [ ] SC-003: Invalid JSON, blank fields, and unknown sessions are rejected before event emission.
- [ ] SC-004: A successful service message emits one Pibo message event with source `service` and returns the final correlated assistant text.
- [ ] SC-005: Correlated `session_error` and timeout paths return `500` and `504` and release subscriptions.

## Verification Coverage

This section records the current verification state for the Simple Agent HTTP API. The implementation is source-backed, but the workspace does not currently include a dedicated simple-agent HTTP test file.

### Source-Inspected Behavior

- Route selection, public health handling, method checks, and fallthrough are implemented in `handleSimpleAgentApiRequest` in `src/api/simple-agent-api.ts` and reached from the web host before registered app routing in `src/web/channel.ts`.
- API-key configuration, candidate extraction, Basic-auth decoding, Bearer/Token stripping, and timing-safe comparison are implemented in `src/api/simple-agent-api.ts`.
- JSON body parsing and HTTP error conversion rely on `readJsonBody`, `PiboWebHttpError`, and `responseJson` from `src/web/http.ts`.
- Session existence checks, service-source event emission, output subscription, event-id correlation, assistant-message aggregation, session-error conversion, timeout handling, and unsubscribe cleanup are implemented in `src/api/simple-agent-api.ts` against the `PiboChannelContext` contract from `src/channels/types.ts`.

### Test Gaps

- Add a focused HTTP-handler test that asserts `/api/health` `GET`, `HEAD`, and method rejection without requiring a live gateway.
- Add API-key validation tests for missing config, invalid candidates, `x-api-key`, Bearer/Token authorization, and Basic-auth username/password matching.
- Add send-message tests with a fake `PiboChannelContext` for invalid JSON/body fields, unknown sessions, emitted service messages, correlated assistant output, unrelated output ignored, correlated `session_error`, and timeout unsubscribe cleanup.
- Add or extend a web-host route-order test proving `/api/health` and `/api/send-message` are handled by the Simple Agent API before registered web app routes.

## Assumptions and Open Questions

### Assumptions

- Service clients obtain Pibo Session IDs through another trusted channel.
- Returning only the final assistant text is intentional for this simple API.

### Open Questions

- Should future versions add a streaming endpoint instead of extending `/api/send-message`?
- Should API keys become owner-scoped records instead of one process-level secret?

## Traceability

| Requirement | Scenario / Story | Code Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Health checks are public and method-limited | Service probes health | `src/api/simple-agent-api.ts` | Dedicated test missing | Source-inspected only |
| REQ-002 Send-message accepts only POST | Wrong method is rejected | `src/api/simple-agent-api.ts` | Dedicated test missing | Source-inspected only |
| REQ-003 Send-message requires a configured API key | Operator forgot to configure the key | `src/api/simple-agent-api.ts` | Dedicated test missing | Source-inspected only |
| REQ-004 API-key candidates are accepted from supported headers | Bearer token authorizes a service client | `src/api/simple-agent-api.ts` | Dedicated test missing | Source-inspected only |
| REQ-005 Request body contains a target session and message | Blank message is rejected | `src/api/simple-agent-api.ts`, `src/web/http.ts` | Dedicated test missing | Source-inspected only |
| REQ-006 Target session must already exist | Client addresses an unknown session | `src/api/simple-agent-api.ts`, `src/channels/types.ts` | Dedicated test missing | Source-inspected only |
| REQ-007 Submitted service messages use a generated correlation id | Concurrent service requests do not cross replies | `src/api/simple-agent-api.ts`, `src/core/events.ts` | Dedicated test missing | Source-inspected only |
| REQ-008 The response returns the final correlated assistant message | Agent finishes normally | `src/api/simple-agent-api.ts`, `src/core/events.ts` | Dedicated test missing | Source-inspected only |
| REQ-009 Correlated errors and timeouts become HTTP failures | Agent run times out | `src/api/simple-agent-api.ts`, `src/core/events.ts` | Dedicated test missing | Source-inspected only |

## Verification Basis

- `src/api/simple-agent-api.ts`
- `src/web/channel.ts`
- `src/web/http.ts`
- `src/core/events.ts`
