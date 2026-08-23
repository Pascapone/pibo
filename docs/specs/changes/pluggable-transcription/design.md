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

### Decision: Default to the Codex ChatGPT subscription path

- **Choice:** Register `openai-chatgpt` as the default provider. It sends multipart audio to `/backend-api/transcribe` with the existing `openai-codex` OAuth bearer token, optional `ChatGPT-Account-Id`, the sanitized recording browser user agent, and the ChatGPT `Origin`/`Referer` product context required by the endpoint boundary.
- **Codex parity:** The request contains only the `file` part and does not send a transcription model. The ChatGPT backend selects the model and applies subscription entitlement.
- **Boundary:** This endpoint is internal and undocumented, so all request behavior remains isolated behind the provider contract and failures stay visible to the user.

### Decision: Retain the official OpenAI API as an alternative

- **Choice:** Register `openai-api` separately. It sends multipart audio to `/v1/audio/transcriptions` with `gpt-4o-mini-transcribe` and the configured `openai` API credential.
- **Rationale:** API-key users retain a documented fallback without coupling it to the ChatGPT subscription provider.

### Decision: Record in the shared composer with MediaRecorder

- **Choice:** A compact microphone button toggles recording. Stop creates one browser audio file and starts transcription.
- **Draft behavior:** The transcript is appended to the latest controlled composer value with paragraph separation. Send is disabled while recording or transcribing.

### Decision: Show a three-second live waveform above the input

- **Choice:** While recording, a separate `RecordingWaveform` component samples microphone amplitude through Web Audio every 50 ms and retains only the latest three seconds.
- **Placement:** The component spans the composer width directly above the textarea/button row. It is not embedded inside the text input.
- **Visual language:** The waveform uses the near-black code surface, terminal-cyan border and bars, compact monospaced timing, and a red recording indicator. Its `rounded-full` pill shape is an intentional recording-state exception to the normal small-radius container guidance in `DESIGN.md`.
- **Fallback:** MediaRecorder remains authoritative. If AudioContext visualization is unavailable, recording and transcription continue without failing.

## Risks / Trade-offs

- Browser recording MIME types differ; the client selects the first supported WebM, Ogg, or MP4 format.
- Waveform amplitude is local visual feedback only and is not persisted or sent separately.
- The first version waits for recording completion and does not stream partial text.
- Provider status can change after settings load; execution errors remain authoritative and visible to the user.
- The ChatGPT subscription endpoint can change independently of Pibo and may return product or Cloudflare errors even when OAuth remains valid.

## Migration / Rollback

- Existing settings without a provider select `openai-chatgpt`.
- The unreleased legacy value `openai` migrates to `openai-chatgpt`; the API alternative now persists as `openai-api`.
- Removing a provider plugin leaves the saved selection visible as unavailable and makes transcription return a controlled conflict response.
