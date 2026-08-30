---
type: "Specification"
title: "Chat Web Composer, Delivery, Files, and Media"
description: "Defines the implemented Chat Web Composer, Delivery, Files, and Media contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T12:56:45Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_typecheck_package_execution: "performed in owned Docker after authoring; see implementation report"
  visual_provider_gateway_pibo2_execution: "unperformed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "WEB-COMPOSER-DRAFTS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/composer/Composer.tsx"
          symbol: "Composer"
        - path: "src/apps/chat-ui/src/composer/Composer.tsx"
          symbol: "appendTranscribedText"
        - path: "src/apps/chat-ui/src/composer/Composer.tsx"
          symbol: "resizeComposerInput"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "readStoredComposerDraft"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "writeStoredComposerDraft"
      source_inspected: true
      follow_up: "Add and run a focused browser-independent test for per-Session draft/history restoration, Enter/modified-Enter behavior, and selection changes; then validate focus headfully."
      public:
        - "POST /api/chat/sessions/:id/messages"
        - "POST /api/chat/sessions/:id/actions"
        - "/api/chat/files/upload"
        - "/api/chat/files/download"
        - "/api/chat/files/image-preview"
        - "/api/chat/transcription*"
        - "/api/chat/speech*"
        - "Composer"
      failures:
        - "Storage errors or Session changes must not send to the wrong Session."
        - "Accessibility/responsive boundary: Source exposes labeled controls and keyboard behavior; real focus/IME/mobile behavior remains unverified."
        - "Compatibility boundary: Draft storage is browser-local and non-authoritative."
      confidence: "medium"
    - id: "WEB-COMPOSER-DELIVERY-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/composer-send.ts"
          symbol: "createComposerSendPlan"
        - path: "src/apps/chat-ui/src/composer-send.ts"
          symbol: "withComposerSendDelivery"
        - path: "src/apps/chat-ui/src/composer-send.ts"
          symbol: "appendComposerOptimisticEvent"
        - path: "src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx"
          symbol: "PendingUserMessageDelivery"
      tests:
        - path: "test/chat-ui-composer-send.test.mjs"
          name: "chat composer send helpers plan optimistic queued messages and overlays"
        - path: "test/chat-ui-pending-message-delivery.test.mjs"
          name: "pending Queue and Steer feedback exposes stable live-region semantics"
        - path: "test/chat-ui-pending-message-delivery.test.mjs"
          name: "pending delivery metadata reaches both Terminal and trace-tree renderers"
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web forwards queue and steering delivery choices"
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web returns a conflict when the active turn cannot accept steering"
      public:
        - "POST /api/chat/sessions/:id/messages"
        - "POST /api/chat/sessions/:id/actions"
        - "/api/chat/files/upload"
        - "/api/chat/files/download"
        - "/api/chat/files/image-preview"
        - "/api/chat/transcription*"
        - "/api/chat/speech*"
        - "Composer"
      failures:
        - "Rejected steer/duplicate/API failure must remove or mark optimistic state without fabricating durable success."
        - "Accessibility/responsive boundary: Pending feedback must remain a stable live region in both renderers."
        - "Compatibility boundary: Queue/steer values are public request compatibility fields."
      confidence: "high"
    - id: "WEB-COMPOSER-COMMANDS-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/app-command-catalog.ts"
          symbol: "buildSlashCommands"
        - path: "src/apps/chat-ui/src/app-command-catalog.ts"
          symbol: "availableSkillsForSession"
        - path: "src/loops/plugin.ts"
          symbol: "parsePiboSessionGoalCommand"
      tests:
        - path: "test/loop-session-goal-command.test.mjs"
          name: "Goal slash command parser distinguishes objectives, pause, resume, and missing arguments"
        - path: "test/loop-session-goal-command.test.mjs"
          name: "Loop plugin advertises the session Goal slash command"
      public:
        - "POST /api/chat/sessions/:id/messages"
        - "POST /api/chat/sessions/:id/actions"
        - "/api/chat/files/upload"
        - "/api/chat/files/download"
        - "/api/chat/files/image-preview"
        - "/api/chat/transcription*"
        - "/api/chat/speech*"
        - "Composer"
      failures:
        - "Unavailable/malformed commands must remain text or return explicit local errors; Web must not invent runtime transitions."
        - "Accessibility/responsive boundary: Command discoverability and keyboard selection need headful verification."
        - "Compatibility boundary: Command availability follows registered plugins/capabilities."
      confidence: "high"
    - id: "WEB-COMPOSER-FILES-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-files.ts"
          symbol: "CHAT_UPLOAD_DIR"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "prepareChatFileAttachments"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "saveUploadedChatFiles"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "resolveDownloadPath"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "resolveImagePreviewPathWithinRoots"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "responseChatFileDownload"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "responseChatImagePreview"
        - path: "src/apps/chat-ui/src/api-chat-files.ts"
          symbol: "chatImagePreviewUrls"
        - path: "src/apps/chat-ui/src/api-chat-files.ts"
          symbol: "uploadChatFiles"
        - path: "src/apps/chat-ui/src/api-chat-files.ts"
          symbol: "downloadChatFile"
      tests:
        - path: "test/chat-ui-upload-attachments.test.mjs"
          name: "chat upload attachment helpers preserve per-session selection behavior"
        - path: "test/chat-ui-download-files.test.mjs"
          name: "downloadChatFile reports delayed download progress before triggering the browser download"
      public:
        - "POST /api/chat/sessions/:id/messages"
        - "POST /api/chat/sessions/:id/actions"
        - "/api/chat/files/upload"
        - "/api/chat/files/download"
        - "/api/chat/files/image-preview"
        - "/api/chat/transcription*"
        - "/api/chat/speech*"
        - "Composer"
      failures:
        - "Traversal, unapproved roots, unsupported image bytes, oversize/count limits, and failed downloads must fail without exposing filesystem structure."
        - "Accessibility/responsive boundary: Progress and image controls need labeled states, alternative text, and keyboard dialog behavior."
        - "Compatibility boundary: Low-level file transport/security stays SPC-SEC-002; preview lifecycle stays SPC-CMP-004."
      confidence: "high"
    - id: "WEB-COMPOSER-MEDIA-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "CHAT_TRANSCRIPTION_MAX_BYTES"
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "responseChatTranscriptionProviders"
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "responseChatTranscription"
        - path: "src/apps/chat/chat-transcription.ts"
          symbol: "readTranscriptionAudio"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "responseChatSpeechProviders"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "responseChatSpeechSessionStart"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "responseChatSpeechSessionSpeak"
        - path: "src/apps/chat/chat-speech.ts"
          symbol: "responseChatSpeechSessionStop"
        - path: "src/apps/chat-ui/src/api-transcription.ts"
          symbol: "getTranscriptionProviders"
        - path: "src/apps/chat-ui/src/api-transcription.ts"
          symbol: "transcribeChatAudio"
        - path: "src/apps/chat-ui/src/api-speech.ts"
          symbol: "getSpeechProviders"
        - path: "src/apps/chat-ui/src/api-speech.ts"
          symbol: "startChatSpeechSession"
        - path: "src/apps/chat-ui/src/api-speech.ts"
          symbol: "speakChatSpeech"
        - path: "src/apps/chat-ui/src/api-speech.ts"
          symbol: "stopChatSpeechSession"
        - path: "src/apps/chat-ui/src/components/MessageSpeechButton.tsx"
          symbol: "MessageSpeechButton"
      tests:
        - path: "test/chat-transcription-web.test.mjs"
          name: "chat transcription API uses the independently selected provider"
        - path: "test/chat-speech-web.test.mjs"
          name: "chat speech API uses the independently selected provider"
        - path: "test/chat-speech-web.test.mjs"
          name: "chat speech API enforces exact UTF-16 text and SDP boundaries before provider launch"
        - path: "test/chat-speech-web.test.mjs"
          name: "HTTP client disconnect aborts speech startup before session publication"
        - path: "test/chat-speech-web.test.mjs"
          name: "speech provider catalog failure is not treated as an empty authoritative catalog"
      public:
        - "POST /api/chat/sessions/:id/messages"
        - "POST /api/chat/sessions/:id/actions"
        - "/api/chat/files/upload"
        - "/api/chat/files/download"
        - "/api/chat/files/image-preview"
        - "/api/chat/transcription*"
        - "/api/chat/speech*"
        - "Composer"
      failures:
        - "Catalog failure differs from empty catalog; disconnect aborts startup; bounds fail before provider launch; stop is explicit."
        - "Accessibility/responsive boundary: Recording, permission denial, waveform, auto-send, and speech controls require headful assistive-technology checks."
        - "Compatibility boundary: Provider adapters/credentials are SPC-RES-005; runtime selection is SPC-RUN-008."
      confidence: "high"
---
# Chat Web Composer, Delivery, Files, and Media

## Why

Per-Session composer state, queue/steer delivery, slash/local actions, bounded upload/download/preview, recording/transcription, and speech interaction.

## Scope

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns Chat Web composition/delivery interaction, optimistic feedback, bounded file UX, image-preview UX, recording/transcription controls, and message speech controls.

### Out of scope

- SPC-SEC-002 owns low-level same-origin file HTTP primitives and path security.
- SPC-CMP-004 owns preview allocation/proxy lifecycle.
- SPC-RES-005 owns media provider adapters/catalog semantics and credentials.
- SPC-RUN-008 owns runtime/provider/model/auth resolution.
- Workflow/Goal runtime semantics remain their orchestration owners.

## Current behavior

### Routes and state

Drafts, bounded history, selected attachments, delivery mode, and recording/speech controls are per selected Session browser state. Message and action routes target an existing Session.

### Cache, stream, files, and media

Queued/steered sends create optimistic events and pending overlays until durable/live reconciliation. Upload is bounded to selected files; download reports delayed progress; image previews resolve only within configured roots. Transcription and speech providers are independently selected.

### Lifecycle and failure

The delivery dialog closes before awaiting. Duplicate sends, rejected steering, failed uploads/transcription/speech, disconnects, and provider-catalog failures remain visible and recoverable.

### Security

Same-origin mutation checks, exact resource/path validation, byte/text/SDP limits, and credential-free browser provider catalogs apply. Browser clients never receive provider credentials.

### Accessibility and responsive behavior

Composer controls expose labels, recording state, dialogs, pending live regions, preview alt text, and responsive sizing in source. Media permission/focus behavior is not headfully verified.

### Compatibility and integration

Local/slash commands depend on registered capabilities. Attachments and media APIs degrade independently; speech and transcription do not share an implicit provider.

## Requirements and invariants

### Requirement: WEB-COMPOSER-DRAFTS-001

Composer drafts, bounded history, keyboard submission, attachments, and delivery controls MUST follow the selected Pibo Session and MUST NOT leak when navigation changes selection.

#### Current

Foundation source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/composer/Composer.tsx` — `Composer`; `src/apps/chat-ui/src/composer/Composer.tsx` — `appendTranscribedText`; `src/apps/chat-ui/src/composer/Composer.tsx` — `resizeComposerInput`; `src/apps/chat-ui/src/app-storage.ts` — `readStoredComposerDraft`; `src/apps/chat-ui/src/app-storage.ts` — `writeStoredComposerDraft`
- Tests: No named test exists in the Foundation evidence set; this requirement remains source-only.
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Storage errors or Session changes must not send to the wrong Session.
- Accessibility/responsive boundary: Source exposes labeled controls and keyboard behavior; real focus/IME/mobile behavior remains unverified.
- Compatibility boundary: Draft storage is browser-local and non-authoritative.
- Confidence: **medium**
- Verification follow-up: Add and run a focused browser-independent test for per-Session draft/history restoration, Enter/modified-Enter behavior, and selection changes; then validate focus headfully.

### Requirement: WEB-COMPOSER-DELIVERY-002

Sending MUST preserve the selected Session, support queue and steer choices, create an optimistic queued event and pending feedback, reject duplicates, and reconcile explicit steering conflicts.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/composer-send.ts` — `createComposerSendPlan`; `src/apps/chat-ui/src/composer-send.ts` — `withComposerSendDelivery`; `src/apps/chat-ui/src/composer-send.ts` — `appendComposerOptimisticEvent`; `src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx` — `PendingUserMessageDelivery`
- Tests: `test/chat-ui-composer-send.test.mjs` — “chat composer send helpers plan optimistic queued messages and overlays”; `test/chat-ui-pending-message-delivery.test.mjs` — “pending Queue and Steer feedback exposes stable live-region semantics”; `test/chat-ui-pending-message-delivery.test.mjs` — “pending delivery metadata reaches both Terminal and trace-tree renderers”; `test/chat-web-app-sessions.test.mjs` — “Chat Web forwards queue and steering delivery choices”; `test/chat-web-app-sessions.test.mjs` — “Chat Web returns a conflict when the active turn cannot accept steering”
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Rejected steer/duplicate/API failure must remove or mark optimistic state without fabricating durable success.
- Accessibility/responsive boundary: Pending feedback must remain a stable live region in both renderers.
- Compatibility boundary: Queue/steer values are public request compatibility fields.
- Confidence: **high**
- Verification follow-up: Execute composer, pending-delivery, and API tests; add latency/race coverage for duplicate send and navigation during delivery.

### Requirement: WEB-COMPOSER-COMMANDS-003

The composer MUST expose only currently available local/slash actions and skills for the selected Session, parse Goal commands locally, and delegate Goal lifecycle effects to the Goal/workflow owners.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/app-command-catalog.ts` — `buildSlashCommands`; `src/apps/chat-ui/src/app-command-catalog.ts` — `availableSkillsForSession`; `src/loops/plugin.ts` — `parsePiboSessionGoalCommand`
- Tests: `test/loop-session-goal-command.test.mjs` — “Goal slash command parser distinguishes objectives, pause, resume, and missing arguments”; `test/loop-session-goal-command.test.mjs` — “Loop plugin advertises the session Goal slash command”
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Unavailable/malformed commands must remain text or return explicit local errors; Web must not invent runtime transitions.
- Accessibility/responsive boundary: Command discoverability and keyboard selection need headful verification.
- Compatibility boundary: Command availability follows registered plugins/capabilities.
- Confidence: **high**
- Verification follow-up: Run Goal command tests and add capability-catalog changes while the composer is open.

### Requirement: WEB-COMPOSER-FILES-004

Upload, attachment, download, and image-preview flows MUST enforce configured count/path/root/format/size bounds, retain per-Session attachment selection, and report delayed download progress before browser transfer.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/chat-files.ts` — `CHAT_UPLOAD_DIR`; `src/apps/chat/chat-files.ts` — `prepareChatFileAttachments`; `src/apps/chat/chat-files.ts` — `saveUploadedChatFiles`; `src/apps/chat/chat-files.ts` — `resolveDownloadPath`; `src/apps/chat/chat-files.ts` — `resolveImagePreviewPathWithinRoots`; `src/apps/chat/chat-files.ts` — `responseChatFileDownload`; `src/apps/chat/chat-files.ts` — `responseChatImagePreview`; `src/apps/chat-ui/src/api-chat-files.ts` — `chatImagePreviewUrls`; `src/apps/chat-ui/src/api-chat-files.ts` — `uploadChatFiles`; `src/apps/chat-ui/src/api-chat-files.ts` — `downloadChatFile`
- Tests: `test/chat-ui-upload-attachments.test.mjs` — “chat upload attachment helpers preserve per-session selection behavior”; `test/chat-ui-download-files.test.mjs` — “downloadChatFile reports delayed download progress before triggering the browser download”
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Traversal, unapproved roots, unsupported image bytes, oversize/count limits, and failed downloads must fail without exposing filesystem structure.
- Accessibility/responsive boundary: Progress and image controls need labeled states, alternative text, and keyboard dialog behavior.
- Compatibility boundary: Low-level file transport/security stays SPC-SEC-002; preview lifecycle stays SPC-CMP-004.
- Confidence: **high**
- Verification follow-up: Execute file tests plus SPC-SEC-002 traversal/same-origin tests, then headfully validate picker, drop, progress, preview, and download.

### Requirement: WEB-COMPOSER-MEDIA-005

Recording/transcription and message speech MUST use independently selected runtime-aware provider catalogs, keep credentials server-side, enforce request bounds, support cancellation/stop, and make auto-send an explicit UI choice.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/chat-transcription.ts` — `CHAT_TRANSCRIPTION_MAX_BYTES`; `src/apps/chat/chat-transcription.ts` — `responseChatTranscriptionProviders`; `src/apps/chat/chat-transcription.ts` — `responseChatTranscription`; `src/apps/chat/chat-transcription.ts` — `readTranscriptionAudio`; `src/apps/chat/chat-speech.ts` — `responseChatSpeechProviders`; `src/apps/chat/chat-speech.ts` — `responseChatSpeechSessionStart`; `src/apps/chat/chat-speech.ts` — `responseChatSpeechSessionSpeak`; `src/apps/chat/chat-speech.ts` — `responseChatSpeechSessionStop`; `src/apps/chat-ui/src/api-transcription.ts` — `getTranscriptionProviders`; `src/apps/chat-ui/src/api-transcription.ts` — `transcribeChatAudio`; `src/apps/chat-ui/src/api-speech.ts` — `getSpeechProviders`; `src/apps/chat-ui/src/api-speech.ts` — `startChatSpeechSession`; `src/apps/chat-ui/src/api-speech.ts` — `speakChatSpeech`; `src/apps/chat-ui/src/api-speech.ts` — `stopChatSpeechSession`; `src/apps/chat-ui/src/components/MessageSpeechButton.tsx` — `MessageSpeechButton`
- Tests: `test/chat-transcription-web.test.mjs` — “chat transcription API uses the independently selected provider”; `test/chat-speech-web.test.mjs` — “chat speech API uses the independently selected provider”; `test/chat-speech-web.test.mjs` — “chat speech API enforces exact UTF-16 text and SDP boundaries before provider launch”; `test/chat-speech-web.test.mjs` — “HTTP client disconnect aborts speech startup before session publication”; `test/chat-speech-web.test.mjs` — “speech provider catalog failure is not treated as an empty authoritative catalog”
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Catalog failure differs from empty catalog; disconnect aborts startup; bounds fail before provider launch; stop is explicit.
- Accessibility/responsive boundary: Recording, permission denial, waveform, auto-send, and speech controls require headful assistive-technology checks.
- Compatibility boundary: Provider adapters/credentials are SPC-RES-005; runtime selection is SPC-RUN-008.
- Confidence: **high**
- Verification follow-up: Run media tests, then exercise microphone and speech with bounded real providers in an approved environment; verify credential absence in browser network payloads.

## Interfaces and ownership

**Capability IDs:** None; this concept projects capabilities owned by linked services.

**Public surfaces:**

- POST /api/chat/sessions/:id/messages
- POST /api/chat/sessions/:id/actions
- /api/chat/files/upload
- /api/chat/files/download
- /api/chat/files/image-preview
- /api/chat/transcription*
- /api/chat/speech*
- Composer

**Non-owned links:**

- SPC-SEC-002 owns low-level same-origin file HTTP primitives and path security.
- SPC-CMP-004 owns preview allocation/proxy lifecycle.
- SPC-RES-005 owns media provider adapters/catalog semantics and credentials.
- SPC-RUN-008 owns runtime/provider/model/auth resolution.
- Workflow/Goal runtime semantics remain their orchestration owners.

## Failure and security behavior

- The delivery dialog closes before awaiting. Duplicate sends, rejected steering, failed uploads/transcription/speech, disconnects, and provider-catalog failures remain visible and recoverable.
- Same-origin mutation checks, exact resource/path validation, byte/text/SDP limits, and credential-free browser provider catalogs apply. Browser clients never receive provider credentials.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Composer controls expose labels, recording state, dialogs, pending live regions, preview alt text, and responsive sizing in source. Media permission/focus behavior is not headfully verified.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Local/slash commands depend on registered capabilities. Attachments and media APIs degrade independently; speech and transcription do not share an implicit provider.

## Known limits

- Evidence gap: No headful microphone permission, recording, keyboard, file picker/drop, image dialog, or speech validation.
- Evidence gap: No external media provider path executed.

## Reconciled stale claims

- Reject: Speech and transcription necessarily share one provider.
- Reject: Browser media APIs receive provider credentials.
- Reject: File preview accepts arbitrary local paths.
- Reject: Optimistic messages are durable history.
- Reject: Goal slash commands own Goal runtime semantics.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-composer-send.test.mjs test/chat-ui-pending-message-delivery.test.mjs test/chat-ui-upload-attachments.test.mjs test/chat-ui-download-files.test.mjs test/chat-transcription-web.test.mjs test/chat-speech-web.test.mjs test/loop-session-goal-command.test.mjs`

## Related concepts

- SPC-CMP-004
- SPC-RES-005
- SPC-SEC-002
- SPC-RUN-008
- SPC-WEB-002
