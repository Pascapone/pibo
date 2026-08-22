# Design: Pluggable Audio Transcription

## Context

Model providers are runtime concerns, while dictation is a product input capability. Coupling transcription to the active model would prevent independent provider selection and replacement.

## Decisions

### Decision: Register transcription providers through the plugin registry

- **Choice:** Add a transcription provider contract and `registerTranscriptionProvider` plugin API.
- **Rationale:** Existing plugins can add providers without changing Chat Web or model runtime code.
- **Boundary:** The gateway channel exposes provider metadata and transcription execution to web apps.

### Decision: Keep provider selection in product user settings

- **Choice:** Persist `transcription.providerId` in `user-settings.json`.
- **Rationale:** The setting applies to the Chat Web input experience and is independent from active sessions and model defaults.

### Decision: Use a dedicated authenticated multipart API

- **Choice:** Add `GET /api/chat/transcription/providers` and `POST /api/chat/transcription`.
- **Rationale:** Browser audio remains separate from chat file attachments and message delivery.
- **Limits:** Requests are same-origin, authenticated, and capped at 25 MiB.

### Decision: Use the official OpenAI API for the built-in provider

- **Choice:** Send multipart audio to `/v1/audio/transcriptions` with `gpt-4o-mini-transcribe` and the configured `openai` API credential.
- **Rationale:** The internal ChatGPT subscription endpoint is undocumented and is not an approved integration boundary.

### Decision: Record in the shared composer with MediaRecorder

- **Choice:** A compact microphone button toggles recording. Stop creates one browser audio file and starts transcription.
- **Draft behavior:** The transcript is appended to the latest controlled composer value with paragraph separation. Send is disabled while recording or transcribing.

## Risks / Trade-offs

- Browser recording MIME types differ; the client selects the first supported WebM, Ogg, or MP4 format.
- The first version waits for recording completion and does not stream partial text.
- Provider status can change after settings load; execution errors remain authoritative and visible to the user.

## Migration / Rollback

- Existing settings are sanitized with `openai` as the default transcription provider.
- Removing the provider plugin leaves the saved selection visible as unavailable and makes transcription return a controlled conflict response.
