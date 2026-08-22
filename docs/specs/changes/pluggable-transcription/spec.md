# Spec: Pluggable Audio Transcription

**Status:** Done
**Created:** 2026-08-22  
**Requester / Source:** User request and `codex-transcribe-chatgpt-subscription.md`

## Why

Pibo users need to dictate text into the Chat Web composer. Transcription provider selection must remain independent from model provider selection so installations can replace either capability without coupling them.

## Goal

Add provider-pluggable audio transcription that records in Chat Web, transcribes through the selected provider, and appends the result to the unsent composer draft.

## Scope

### In Scope

- A plugin registration contract for transcription providers.
- OpenAI API as the first built-in transcription provider.
- A persisted transcription-provider setting independent from model defaults.
- Browser microphone recording in the shared Chat Web composer.
- Appending completed transcripts without automatically sending a message.
- Repeated recordings that preserve existing composer text.

### Out of Scope

- Direct use of ChatGPT's internal `/backend-api/transcribe` endpoint.
- Treating a ChatGPT subscription as OpenAI API billing or authorization.
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

## Constraints

- **Security / Privacy:** The API requires an authenticated same-origin request. Audio is processed in memory and is not persisted by this capability.
- **Compatibility:** Existing user settings without transcription data load with the built-in OpenAI provider selected.
- **Provider boundary:** Provider-specific authentication and HTTP behavior stay behind the transcription provider interface.
- **Verification:** Unit, API, type/build, and authenticated browser validation are required.

## Success Criteria

- [x] SC-001: OpenAI and a fixture provider satisfy the common provider contract.
- [x] SC-002: Settings persist a provider separately from model settings.
- [x] SC-003: A real browser recording inserts text but does not send it.
- [x] SC-004: A second recording appends while preserving the first transcript and manually typed text.
