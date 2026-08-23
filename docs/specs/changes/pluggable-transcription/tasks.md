# Tasks: Pluggable Audio Transcription

## 1. Provider foundation

- [x] 1.1 Add transcription provider types and errors.
- [x] 1.2 Extend plugin registry and gateway channel capability.
- [x] 1.3 Register the built-in OpenAI API transcription provider.
- [x] 1.4 Register the ChatGPT Subscription provider using `openai-codex` OAuth and make it the default.

## 2. Settings and API

- [x] 2.1 Persist and validate an independent transcription provider setting.
- [x] 2.2 Add provider catalog and multipart transcription endpoints.
- [x] 2.3 Add Settings → Transcription UI.

## 3. Composer

- [x] 3.1 Add browser audio recording control.
- [x] 3.2 Insert transcripts without sending.
- [x] 3.3 Preserve existing text and append repeated recordings.
- [x] 3.4 Render recording and provider failures without clearing drafts.

## 4. Validation

- [x] 4.1 Run typecheck and production build.
- [x] 4.2 Run provider, API, settings, route, and composer tests.
- [x] 4.3 Validate microphone recording and repeated append behavior in the authenticated Pibo2 Chat Web UI.
- [ ] 4.4 Validate a real transcription through the ChatGPT subscription provider on Pibo2.
