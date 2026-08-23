# Pluggable Transcription Validation — 2026-08-22

## Scope

Validated the transcription provider registry, OpenAI adapter, Chat Web API, persisted provider setting, Settings UI, and composer recording/append behavior from feature commit `e58d54e5dd9e8a439978cc4125420427ed910954`.

## Automated validation

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused provider, API, settings, route, and composer tests — passed.
- Full `npm test` — 1,850 passed, 0 failed.

## Pibo2 integrated validation

The candidate was installed under `/opt/pibo-candidates/transcription-provider/e58d54e5dd9e8a439978cc4125420427ed910954`, activated through `pibo-web.service`, validated through the public authenticated Chat Web path, and then the previously active development candidate was restored.

Observed behavior:

- Settings → Transcription rendered OpenAI API as a provider independently from model settings.
- The authenticated provider catalog returned the `openai` provider, plugin ownership metadata, and the persisted `openai` selection.
- Chrome's native `MediaRecorder` recorded a generated Web Audio stream as `audio/webm;codecs=opus`; the resulting file was 6,092 bytes.
- The completed transcript was appended to an existing draft and no `/api/chat/message` request occurred.
- Two sequential recordings produced two appended passages while preserving manually typed text.
- A real authenticated `POST /api/chat/transcription` reached the selected OpenAI adapter. Because Pibo2 has no OpenAI API credential configured, it returned the expected `409` guidance and preserved the composer draft.
- The browser console had no unexpected warnings or errors during the successful append scenario. The expected failed-resource entry appeared for the intentional `409` authentication scenario.

## Remaining uncertainty

A paid live OpenAI transcription response was not exercised because the Pibo2 provider catalog reported OpenAI API authentication as unconfigured. Multipart request construction and response handling are covered by the OpenAI adapter tests, while the real public path was validated through its authentication failure boundary.
