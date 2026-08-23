# Spec: Pluggable Audio Transcription

**Status:** Done
**Created:** 2026-08-22  
**Updated:** 2026-08-23
**Requester / Source:** User request, correction, and `codex-transcribe-chatgpt-subscription.md`

## Why

Pibo users need to dictate text into the Chat Web composer. Transcription provider selection must remain independent from model provider selection so installations can replace either capability without coupling them.

## Goal

Add provider-pluggable audio transcription that defaults to the user's ChatGPT/Codex subscription, retains the OpenAI API as an alternative, and appends results to the unsent Chat Web composer draft.

## Scope

### In Scope

- A plugin registration contract for transcription providers.
- ChatGPT Subscription as the default built-in provider using the existing `openai-codex` OAuth login.
- OpenAI API-key transcription as an independently selectable alternative provider.
- A persisted transcription-provider setting independent from model defaults.
- Browser microphone recording in the shared Chat Web composer.
- Appending completed transcripts without automatically sending a message.
- Repeated recordings that preserve existing composer text.
- A live three-second waveform above the composer input while audio is being recorded.

### Out of Scope

- Treating ChatGPT's internal transcription endpoint as a stable public API contract.
- Treating ChatGPT subscription authorization as OpenAI API-key authorization.
- Realtime partial transcripts, speaker diarization, or stored audio history.
- CLI/Ink microphone recording.

## Requirements

### REQ-001: Provider registration

Pibo MUST let plugins register uniquely identified transcription providers and MUST resolve transcription requests through the selected provider.

#### Acceptance

- Duplicate provider IDs are rejected.
- Provider metadata is discoverable by Chat Web.
- A non-OpenAI fixture provider can complete a transcription through the same contract.

### REQ-002: Independent provider setting

Chat Web MUST persist the selected transcription provider independently from model defaults and active session models.

#### Scenario: Select a transcription provider

- GIVEN multiple registered transcription providers
- WHEN the user selects one under Settings → Transcription
- THEN later audio requests use that provider
- AND no model default or active model changes.

### REQ-003: Authenticated audio API

Chat Web MUST accept authenticated same-origin multipart audio requests, enforce a bounded audio size, and return transcription text without storing or sending the recording as a chat message.

### REQ-004: Composer recording

The shared composer MUST expose a compact recording control when a session can accept input.

#### Scenario: Complete a recording

- GIVEN an editable composer
- WHEN the user starts and stops recording
- THEN Pibo sends the recording to the selected transcription provider
- AND inserts the returned text into the composer
- AND does not submit the chat message.

### REQ-005: Preserve and append text

A completed transcript MUST preserve all current composer text and append the new transcript. Later recordings MUST append again instead of replacing earlier text.

### REQ-006: Failure visibility

Microphone, authentication, provider, empty-audio, and unsupported-browser failures MUST remain visible in the composer without clearing the draft.

### REQ-007: ChatGPT subscription provider

The default provider MUST reuse the existing `openai-codex` OAuth credential and follow Codex's ChatGPT transcription request shape.

#### Acceptance

- The request targets `/backend-api/transcribe`.
- The request contains the audio `file` and no API transcription model field.
- The request uses the OAuth bearer token, includes `ChatGPT-Account-Id` when available, and carries the sanitized recording browser's user agent plus ChatGPT product origin context required by the endpoint boundary.
- An OpenAI API key alone does not mark this provider as configured.

### REQ-008: OpenAI API alternative

The official OpenAI Audio Transcriptions API MUST remain available as a separate `openai-api` provider using the `openai` API-key credential.

### REQ-009: Live recording waveform

While recording, Chat Web MUST show a dedicated waveform component above the text input so users can see that microphone audio is being captured.

#### Acceptance

- The waveform visualizes the latest three seconds of microphone amplitude.
- The component appears only while recording and is outside, directly above, the input row.
- The container uses a 100% pill radius as an intentional special-state exception to the normal compact radii in `DESIGN.md`.
- The waveform uses the terminal palette, includes a compact recording indicator and elapsed time, and does not interfere with recording or transcription when Web Audio visualization is unavailable.

## Constraints

- **Security / Privacy:** The API requires an authenticated same-origin request. Audio is processed in memory, OAuth tokens remain server-side, only the sanitized browser user agent crosses the provider boundary, and recordings are not persisted by this capability.
- **Compatibility:** Existing settings without transcription data select `openai-chatgpt`; the unreleased legacy value `openai` migrates to that provider, while explicit API selection persists as `openai-api`.
- **Provider boundary:** Provider-specific authentication and HTTP behavior stay behind the transcription provider interface.
- **Verification:** Unit, API, type/build, and authenticated browser validation are required.

## Success Criteria

- [x] SC-001: ChatGPT Subscription, OpenAI API, and a fixture provider satisfy the common provider contract.
- [x] SC-002: Settings persist a provider separately from model settings.
- [x] SC-003: A real browser recording inserts text but does not send it.
- [x] SC-004: A second recording appends while preserving the first transcript and manually typed text.
- [x] SC-005: An authenticated Pibo2 recording returns text through the ChatGPT subscription provider without an OpenAI API key.
- [x] SC-006: During a real browser recording, a pill-shaped waveform above the input updates from live audio and represents only the latest three seconds.
