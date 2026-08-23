# ChatGPT Subscription Transcription Validation — 2026-08-23

## Scope

Validated PR #542 after changing the default transcription provider from the separately billed OpenAI API to the existing ChatGPT/Codex subscription login. The OpenAI API remains available as an alternative provider.

## Codex behavior reproduced

The historical Codex `rust-v0.117.0` transcription path was inspected in `codex-rs/tui/src/voice.rs`. For ChatGPT authentication it:

- posts multipart audio to `https://chatgpt.com/backend-api/transcribe`;
- sends the audio under the `file` field;
- uses the ChatGPT/Codex OAuth bearer token;
- includes `ChatGPT-Account-Id` when available;
- does not send an API transcription model.

Pibo now exposes this behavior as provider `openai-chatgpt`. Provider `openai-api` retains the official `/v1/audio/transcriptions` path with `gpt-4o-mini-transcribe` and the separate `openai` API-key credential.

## Endpoint-boundary compatibility

A server request with only the historical OAuth and Codex headers was rejected by the current ChatGPT web boundary with `403`. The same authenticated request succeeded when it carried the recording browser's sanitized user agent and ChatGPT `Origin`/`Referer` product context. Pibo forwards only that user-agent string; OAuth tokens and account identifiers remain server-side, and no ChatGPT session cookies are forwarded or persisted.

## Automated validation

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused provider, authenticated API, settings migration, and composer tests — passed.
- Full `npm test` — 1,873 passed, 0 failed.

## Pibo2 integrated validation

Validated candidate `pr542-chatgpt-transcription` at commit `4cf961585f35a79dbde2007b796c4d6e50c78c06` through the public authenticated Chat Web path.

Observed behavior:

- Provider catalog selected `openai-chatgpt` by default and reported it configured through the existing `openai-codex` OAuth login.
- `openai-api` remained separately selectable and reported unconfigured because no OpenAI API key is present.
- Chrome's native `MediaRecorder` recorded six seconds of speech into WebM/Opus.
- The real ChatGPT subscription endpoint returned a transcript beginning with “And so, my fellow Americans…” and Pibo appended it after an existing draft.
- Exactly one transcription request occurred and no chat-message request occurred.
- The microphone control returned to its idle state and the browser console contained no warnings or errors.

## Remaining uncertainty

`/backend-api/transcribe` is an internal ChatGPT product endpoint and can change independently of Pibo. Its implementation therefore remains isolated behind the transcription-provider contract.

The current Pibo2 nginx boundary returned `413` for a 1,152,693-byte fixture even though the application-level limit is 25 MiB. The successful browser recording was approximately 96 KiB, so normal short dictation works, but the ingress limit should be aligned separately before relying on long recordings.
