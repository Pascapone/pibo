---
type: "Specification"
title: "Transcription and Speech Provider Services"
description: "Defines the implemented transcription and speech provider services contract and its current ownership, security, and verification boundaries."
tags: ["resources", "security-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T08:51:56Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-RES-005"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed: 383 passed, 2 baseline failures in local-auth.test.mjs"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "RES-MED-001"
      status: "implemented"
      sources:
        - path: "src/plugins/registry.ts"
          symbol: "registerTranscriptionProvider"
        - path: "src/plugins/registry.ts"
          symbol: "getTranscriptionProviderInfos"
        - path: "src/plugins/registry.ts"
          symbol: "registerSpeechProvider"
        - path: "src/plugins/registry.ts"
          symbol: "getSpeechProviderInfos"
      tests:
        - path: "test/transcription-provider.test.mjs"
          name: "plugins register discoverable and replaceable transcription providers"
        - path: "test/speech-provider.test.mjs"
          name: "plugins register discoverable speech providers and route sessions"
        - path: "test/chat-transcription-web.test.mjs"
          name: "chat transcription API uses the independently selected provider"
        - path: "test/chat-speech-web.test.mjs"
          name: "chat speech API uses the independently selected provider"
        - path: "test/chat-speech-web.test.mjs"
          name: "speech provider catalog failure is not treated as an empty authoritative catalog"
      public:
        - "GET /api/chat/transcription/providers"
        - "POST /api/chat/transcription"
        - "GET /api/chat/speech/providers"
        - "POST and lifecycle routes under /api/chat/speech/sessions"
      failures:
        - "Authenticated media endpoints cap bodies, formats, duration, and provider scope; provider services do not intentionally return or persist credentials, while end-to-end product-history behavior remains owned by WEB-003 and unproven."
      confidence: "high"
    - id: "RES-MED-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "CHAT_TRANSCRIPTION_MAX_BYTES"
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "responseChatTranscription"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "CHAT_SPEECH_MAX_CHARACTERS"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "CHAT_SPEECH_MAX_OFFER_CHARACTERS"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "responseChatSpeechSessionStart"
        - path: "src/speech/openai-codex-realtime-call-proxy.ts"
          symbol: "startOpenAiCodexRealtimeCallProxy"
      tests:
        - path: "test/chat-speech-web.test.mjs"
          name: "chat speech API enforces exact UTF-16 text and SDP boundaries before provider launch"
        - path: "test/speech-provider.test.mjs"
          name: "OpenAI Codex realtime call adapter bounds both request and upstream response bodies"
        - path: "test/speech-provider.test.mjs"
          name: "OpenAI Codex realtime call adapter bounds stalled request bodies and closes active sockets"
      public:
        - "GET /api/chat/transcription/providers"
        - "POST /api/chat/transcription"
        - "GET /api/chat/speech/providers"
        - "POST and lifecycle routes under /api/chat/speech/sessions"
      failures:
        - "Authenticated media endpoints cap bodies, formats, duration, and provider scope; provider services do not intentionally return or persist credentials, while end-to-end product-history behavior remains owned by WEB-003 and unproven."
      confidence: "high"
    - id: "RES-MED-003"
      status: "implemented"
      sources:
        - path: "src/plugins/registry.ts"
          symbol: "startSpeechSession"
        - path: "src/plugins/registry.ts"
          symbol: "stopSpeechSession"
        - path: "src/plugins/registry.ts"
          symbol: "dispose"
        - path: "src/speech/openai-codex.ts"
          symbol: "createOpenAiCodexSpeechProvider"
      tests:
        - path: "test/speech-provider.test.mjs"
          name: "speech admission reserves pending capacity and releases rejected, failed, and aborted starts exactly once"
        - path: "test/speech-provider.test.mjs"
          name: "duplicate provider session ids close only the unpublished owner"
        - path: "test/speech-provider.test.mjs"
          name: "gateway disposal aborts and drains provider startup before provider disposal"
        - path: "test/speech-provider.test.mjs"
          name: "idle expiry and restart disposal close every published session exactly once"
      public:
        - "GET /api/chat/transcription/providers"
        - "POST /api/chat/transcription"
        - "GET /api/chat/speech/providers"
        - "POST and lifecycle routes under /api/chat/speech/sessions"
      failures:
        - "Authenticated media endpoints cap bodies, formats, duration, and provider scope; provider services do not intentionally return or persist credentials, while end-to-end product-history behavior remains owned by WEB-003 and unproven."
      confidence: "high"
    - id: "RES-MED-004"
      status: "implemented"
      sources:
        - path: "src/transcription/openai.ts"
          symbol: "createOpenAiTranscriptionProvider"
        - path: "src/transcription/openai-chatgpt.ts"
          symbol: "createOpenAiChatGptTranscriptionProvider"
        - path: "src/speech/openai-codex.ts"
          symbol: "createOpenAiCodexSpeechProvider"
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "responseChatTranscription"
      tests:
        - path: "test/transcription-provider.test.mjs"
          name: "OpenAI API transcription provider reports missing API authentication without sending audio"
        - path: "test/transcription-provider.test.mjs"
          name: "ChatGPT subscription transcription provider requires Codex OAuth"
        - path: "test/speech-provider.test.mjs"
          name: "OpenAI Codex speech refuses API-key accounts"
        - path: "test/speech-provider.test.mjs"
          name: "OpenAI Codex realtime call adapter uses loopback-only unpredictable routes"
      public:
        - "GET /api/chat/transcription/providers"
        - "POST /api/chat/transcription"
        - "GET /api/chat/speech/providers"
        - "POST and lifecycle routes under /api/chat/speech/sessions"
      failures:
        - "Authenticated media endpoints cap bodies, formats, duration, and provider scope; provider services do not intentionally return or persist credentials, while end-to-end product-history behavior remains owned by WEB-003 and unproven."
      confidence: "medium"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "local real-path/PTY/headful browser validation"
    - "external-provider/Pibo2 acceptance"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to Foundation commit 38bb6e57f118c1543e7263c68d27e5103d3b1262."
    - evidence_class: "focused tests"
      status: "performed_with_baseline_failures"
      detail: "Exact parent/candidate inventory ran in the same fresh isolated worker: 385 tests, 383 passed, and 2 identical local-auth baseline assertions failed; no source or test files were changed."
    - evidence_class: "build/package checks"
      status: "performed"
      detail: "npm run typecheck and npm run build passed; build emitted existing Vite chunk-size warnings only."
  unperformed:
    - evidence_class: "local real-path/PTY/headful browser validation"
      status: "unperformed"
      reason: "No browser, PTY, or real-path acceptance flow was performed for this package."
    - evidence_class: "external-provider/Pibo2 acceptance"
      status: "unperformed"
      reason: "No real provider, external MCP, package-manager, host lifecycle, or Pibo2 acceptance was performed."
stale_claims_to_reject:
  - id: "WP03-STALE-001"
    claim: "Raw transcription/speech media can never enter product history."
    reason: "Provider backends do not write history, but product message/history behavior is owned and must be validated under WEB-003."
open_evidence_gaps:
  - id: "WP03-GAP-004"
    specs: ["SPC-RES-005"]
    gap: "No browser or real-provider end-to-end evidence confirms raw media/credentials remain absent from persisted product history and diagnostics."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

Provider discovery and backend session contracts for OpenAI/API and ChatGPT transcription plus Codex realtime speech.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Implemented behavior:
- "GET /api/chat/transcription/providers"
- "POST /api/chat/transcription"
- "GET /api/chat/speech/providers"
- "POST and lifecycle routes under /api/chat/speech/sessions"
- "PiboPluginRegistry registers unique transcription/speech providers, reports configured state without allowing provider probe failure to crash discovery, and routes explicit provider IDs."
- "Transcription accepts a required nonempty file up to 25 MiB, sanitizes metadata, maps provider errors, and independently selects API-key or ChatGPT-subscription providers."
- "Speech bounds text to 32,000 UTF-16 code units and SDP offers to 256,000, reserves pending capacity, rejects duplicate IDs, and applies startup/idle/disposal/abort cleanup exactly once."
- "Codex realtime speech requires subscription auth, uses an unpredictable loopback proxy route, bounds proxy bodies, and keeps provider session ownership ephemeral."

Public surfaces:
- "GET /api/chat/transcription/providers"
- "POST /api/chat/transcription"
- "GET /api/chat/speech/providers"
- "POST and lifecycle routes under /api/chat/speech/sessions"

# State, lifecycle, and invariants

- "Media providers are explicit and bounded; transcription never auto-sends; speech sessions are ephemeral."
- "Default speech capacity is eight active-or-pending starts; pending capacity remains owned until a noncooperative provider settles and late cleanup finishes."
- "Raw media and provider credentials are request/session data; backend code returns transcript/session results and performs no product-history write."
- "Whether transcript text is sent as a product message is WEB-003 policy, not this provider service."
- "Provider error detail is bounded and credentials are not included in responses."

Persistence and lifecycle state: Provider registration and ephemeral transcription/speech session ownership.

# Requirements and invariants

## Requirement: RES-MED-001: Register unique transcription and speech providers, report configured state safely, and route requests through the independently selected provider ID

Register unique transcription and speech providers, report configured state safely, and route requests through the independently selected provider ID.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/plugins/registry.ts` — `registerTranscriptionProvider`
- `src/plugins/registry.ts` — `getTranscriptionProviderInfos`
- `src/plugins/registry.ts` — `registerSpeechProvider`
- `src/plugins/registry.ts` — `getSpeechProviderInfos`

**Named test traceability:**
- `test/transcription-provider.test.mjs` — `plugins register discoverable and replaceable transcription providers`
- `test/speech-provider.test.mjs` — `plugins register discoverable speech providers and route sessions`
- `test/chat-transcription-web.test.mjs` — `chat transcription API uses the independently selected provider`
- `test/chat-speech-web.test.mjs` — `chat speech API uses the independently selected provider`
- `test/chat-speech-web.test.mjs` — `speech provider catalog failure is not treated as an empty authoritative catalog`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MED-002: Bound transcription uploads, speech text/offer inputs, proxy request/response bodies, metadata, and provider error details before or at provider boundaries

Bound transcription uploads, speech text/offer inputs, proxy request/response bodies, metadata, and provider error details before or at provider boundaries.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/apps/chat/chat-transcription.ts` — `CHAT_TRANSCRIPTION_MAX_BYTES`
- `src/apps/chat/chat-transcription.ts` — `responseChatTranscription`
- `src/apps/chat/chat-speech.ts` — `CHAT_SPEECH_MAX_CHARACTERS`
- `src/apps/chat/chat-speech.ts` — `CHAT_SPEECH_MAX_OFFER_CHARACTERS`
- `src/apps/chat/chat-speech.ts` — `responseChatSpeechSessionStart`
- `src/speech/openai-codex-realtime-call-proxy.ts` — `startOpenAiCodexRealtimeCallProxy`

**Named test traceability:**
- `test/chat-speech-web.test.mjs` — `chat speech API enforces exact UTF-16 text and SDP boundaries before provider launch`
- `test/speech-provider.test.mjs` — `OpenAI Codex realtime call adapter bounds both request and upstream response bodies`
- `test/speech-provider.test.mjs` — `OpenAI Codex realtime call adapter bounds stalled request bodies and closes active sockets`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MED-003: Reserve speech start capacity across pending and active sessions, enforce unique publication, startup/idle bounds, caller abort, and exactly-once close during failure, stop, expiry, or disposal

Reserve speech start capacity across pending and active sessions, enforce unique publication, startup/idle bounds, caller abort, and exactly-once close during failure, stop, expiry, or disposal.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/plugins/registry.ts` — `startSpeechSession`
- `src/plugins/registry.ts` — `stopSpeechSession`
- `src/plugins/registry.ts` — `dispose`
- `src/speech/openai-codex.ts` — `createOpenAiCodexSpeechProvider`

**Named test traceability:**
- `test/speech-provider.test.mjs` — `speech admission reserves pending capacity and releases rejected, failed, and aborted starts exactly once`
- `test/speech-provider.test.mjs` — `duplicate provider session ids close only the unpublished owner`
- `test/speech-provider.test.mjs` — `gateway disposal aborts and drains provider startup before provider disposal`
- `test/speech-provider.test.mjs` — `idle expiry and restart disposal close every published session exactly once`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MED-004: Keep provider credentials and raw media ephemeral to backend request/session handling, return only bounded transcript/session responses, and leave any product-history write to WEB-003

Keep provider credentials and raw media ephemeral to backend request/session handling, return only bounded transcript/session responses, and leave any product-history write to WEB-003.

**Implementation state:** `implemented_backend_boundary; end-to-end privacy validation unperformed` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `medium`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/transcription/openai.ts` — `createOpenAiTranscriptionProvider`
- `src/transcription/openai-chatgpt.ts` — `createOpenAiChatGptTranscriptionProvider`
- `src/speech/openai-codex.ts` — `createOpenAiCodexSpeechProvider`
- `src/apps/chat/chat-transcription.ts` — `responseChatTranscription`

**Named test traceability:**
- `test/transcription-provider.test.mjs` — `OpenAI API transcription provider reports missing API authentication without sending audio`
- `test/transcription-provider.test.mjs` — `ChatGPT subscription transcription provider requires Codex OAuth`
- `test/speech-provider.test.mjs` — `OpenAI Codex speech refuses API-key accounts`
- `test/speech-provider.test.mjs` — `OpenAI Codex realtime call adapter uses loopback-only unpredictable routes`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability-map status: no dedicated capability-map node; this specification remains the canonical normative owner for the provider service contract.

Exact source files inspected for this owner:
- "src/apps/chat/chat-speech.ts"
- "src/apps/chat/chat-transcription.ts"
- "src/plugins/registry.ts"
- "src/speech/openai-codex-realtime-call-proxy.ts"
- "src/speech/openai-codex.ts"
- "src/transcription/openai-chatgpt.ts"
- "src/transcription/openai.ts"

Related ownership boundaries:
- SPC-RUN-008: [provider-model-controls.md](/specs/runtime/provider-model-controls.md) owns the linked contract; this specification does not duplicate it.
- SPC-SEC-001: [web-machine-and-dev-auth.md](/specs/security/web-machine-and-dev-auth.md) owns the linked contract; this specification does not duplicate it.
- SPC-WEB-003: [chat-web-file-upload.md](/specs/capabilities/chat-web-file-upload.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Authenticated media endpoints cap bodies, formats, duration, and provider scope; provider services do not intentionally return or persist credentials, while end-to-end product-history behavior remains owned by WEB-003 and unproven."

Compatibility and privacy limits:
- "Default speech capacity is eight active-or-pending starts; pending capacity remains owned until a noncooperative provider settles and late cleanup finishes."
- "Raw media and provider credentials are request/session data; backend code returns transcript/session results and performs no product-history write."
- "Whether transcript text is sent as a product message is WEB-003 policy, not this provider service."
- "Provider error detail is bounded and credentials are not included in responses."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** Raw transcription/speech media can never enter product history. — Provider backends do not write history, but product message/history behavior is owned and must be validated under WEB-003.

Open evidence gaps carried forward:
- `WP03-GAP-004` — No browser or real-provider end-to-end evidence confirms raw media/credentials remain absent from persisted product history and diagnostics.
- `WP03-GAP-009` — Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional unperformed evidence:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Exact focused test inventory from the WP-03 brief — 385 tests: 383 passed and 2 identical local-auth baseline failures in exact parent/candidate runs
- Foundation validator/authoring suite — 82 passed

# Related concepts

- [SPC-RUN-008](/specs/runtime/provider-model-controls.md)
- [SPC-SEC-001](/specs/security/web-machine-and-dev-auth.md)
- [SPC-WEB-003](/specs/capabilities/chat-web-file-upload.md)
