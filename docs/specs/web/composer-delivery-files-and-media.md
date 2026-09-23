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
  at: "2026-09-23T12:39:00Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "Historical upstream/dev refresh source and named-test evidence"
  - id: "content-binding-source-and-tests"
    resource: "scope:direct-controller checkpoint 08830dfc08e2029746f06bad8337c5f321870399"
    title: "Opt-in content binding, local prepared submissions and focused tests"
  - id: "provider-admission-source-and-tests"
    resource: "scope:direct-controller checkpoint 72d60f5b720034abd2cc0d394d719736fccdc8ab"
    title: "Pinned typed JSON admission and structured product history"
  - id: "media-authority-source-and-tests"
    resource: "scope:direct-controller checkpoint 8cefa246f0f7e7a4bb921e98b4349eddfd330e0b"
    title: "Scoped durable media preparation, retrieval and atomic admission ownership"
  - id: "browser-draft-source-and-tests"
    resource: "scope:direct-controller checkpoint 7b64d34b378f713932ab4841e19d5ed240178a09"
    title: "Private transactional browser drafts, explicit legacy custody and real-browser module verification"
  - id: "browser-copy-source-and-tests"
    resource: "scope:direct-controller checkpoint df94a3a5cff2c944f81db64fd982109c0aba6556"
    title: "Private owner-scoped copy CAS, independent bytes and cross-Pibo-Session insertion"
implementation:
  state: "current"
  baseline_commit: "df94a3a5cff2c944f81db64fd982109c0aba6556"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "performed"
  focused_test_execution: "Private copy checkpoint: 26 focused module tests and 21 real-browser HeadlessChrome/native-IndexedDB cases; earlier draft foundation: 25 modules and 15 headed browser cases. These overlap and are not unique-coverage totals."
  build_typecheck_package_execution: "Narrow browser copy/draft/fixture type graph and owned browser fixture bundle passed. Earlier media types, behavioral emit and 22 artifacts remain scoped to their checkpoint. No full application/root compiler or installation pass."
  visual_provider_gateway_pibo2_execution: "Headed browser proof covers the earlier draft module foundation only; copy module cases ran in HeadlessChrome. No integrated Chat UI, real App auth, provider, gateway or Pibo2 acceptance."
traceability:
  commit: "df94a3a5cff2c944f81db64fd982109c0aba6556"
  requirements:
    - id: "WEB-COMPOSER-COPY-011"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/attachments/core-attachment-copy-state.ts"
          symbol: "readCopyBufferState"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-persistence.ts"
          symbol: "openAttachmentStores"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-indexed-draft.ts"
          symbol: "openIndexedAttachmentDraft"
      tests:
        - path: "test/chat-ui-attachment-transitions.test.mjs"
          name: "copy byte ids fail closed on collisions and legacy structured values do not gain typed authority"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "independent-copy-staging-and-cross-session-paste"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "copy-cas-tombstones-and-stale-source"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "copy-paste-rejects-stale-missing-and-foreign-owner"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "two-real-tabs-one-copy-cas-winner"
      failures:
        - "Copy replacement and clear use one per-owner monotonic revision and retain tombstones; stale writers cannot replace the last confirmed copy."
        - "Source identity/content and byte scope are checked transactionally; cross-Session paste mints new draft and byte identities. Missing bytes, owner mismatch, aborts and revision exhaustion fail without partial publication."
        - "Old untyped copy values retain exact structured-cloneable payloads and duplicate holders, but cannot acquire an invented provider type/schema or be pasted as typed content."
        - "This private browser repository does not establish productive copy UI, provider validation before staging, Composer sending, real App auth, visual acceptance or full V4 completion."
      confidence: "high"
    - id: "WEB-COMPOSER-STORAGE-010"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/attachments/core-attachment-database.ts"
          symbol: "openAttachmentDatabase"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-indexed-draft.ts"
          symbol: "openIndexedAttachmentDraft"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-transitions.ts"
          symbol: "transitionCoreAttachmentDraft"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-persistence.ts"
          symbol: "openAttachmentStores"
      tests:
        - path: "test/chat-ui-attachment-transitions.test.mjs"
          name: "synchronous commands preserve public Promise rejection and add/update/remove behavior"
        - path: "test/chat-ui-attachment-transitions.test.mjs"
          name: "legacy synchronous adapter never falls back to unowned content on login"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "two-real-tabs-one-cas-winner"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "same-owner-custody-and-text-restore-cas"
        - path: "test/fixtures/attachments/browser-persistence-lab.ts"
          name: "closed-byte-facade-hides-pending-read"
      failures:
        - "Stale entry revisions fail without overwriting newer state; aborted writes publish no successful result; corrupt source and retained backup text are not replaced."
        - "Legacy custody is explicit and globally first-wins for one source key, not proof of original authorship or an automatic login fallback."
        - "Closing a facade hides pending results without erasing the old owner's data; clearOwner is active-state reset, not logout or account erasure."
        - "Private native-IndexedDB draft evidence does not establish Composer wiring, actual quota exhaustion, real App auth or full-product acceptance; independent-copy semantics have a separate private requirement."
      confidence: "high"
    - id: "WEB-COMPOSER-RESOURCES-009"
      status: "implemented"
      sources:
        - path: "src/apps/chat/attachment-resource-http.ts"
          symbol: "handleAttachmentResourceRequest"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/attachments/resource-store.ts"
          symbol: "AttachmentResourceStore"
        - path: "src/data/chat-storage-worker.ts"
          symbol: "execute"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "K07 HTTP media upload, scoped preview, admission and retries preserve the same verified bytes"
        - path: "test/web-channel.test.mjs"
          name: "K07 HTTP media routes preserve login, origin, body bounds and inactive-content download guards"
        - path: "test/attachment-message-storage.test.mjs"
          name: "worker rejects corrupt or discarded media without admitting a message or consuming its transaction"
        - path: "test/storage-worker-isolation.test.mjs"
          name: "cold startup does not extend the default 500ms RPC queue deadline"
      public:
        - "POST /api/chat/attachment-resources"
        - "GET /api/chat/attachment-resources/:id"
        - "DELETE /api/chat/attachment-resources/:id"
      failures:
        - "Scope, frozen media and durable bytes must agree; hashes or client paths do not authorize a resource. Accepted resources cannot be discarded as pending uploads."
        - "Whole HTTP requests remain bounded to 4 MiB; the separate 15 MiB stored-resource ceiling is not a chunk-upload implementation."
        - "Core-managed paths deliberately enter persisted model text, not provider inputs or resource snapshots; relocation-stable command materialization is not implemented."
        - "Composer, copy/fork, multi-tab, real-login and headful acceptance are not established by fixture API tests."
      confidence: "high"
    - id: "WEB-COMPOSER-ATTACHMENTS-008"
      status: "implemented"
      sources:
        - path: "src/attachments/message.ts"
          symbol: "materializeAttachmentMessage"
        - path: "src/attachments/server-providers.ts"
          symbol: "acquireAttachmentProviders"
        - path: "src/attachments/provider-pins.ts"
          symbol: "attachmentProviderPin"
        - path: "src/apps/chat-ui/src/plugins/browser-host.tsx"
          symbol: "BrowserPluginHost"
        - path: "src/apps/chat/web-app.ts"
          symbol: "sendChatMessage"
      tests:
        - path: "test/attachment-message.test.mjs"
          name: "attachment selection, revision, declaration and registry ownership must all agree"
        - path: "test/attachment-message.test.mjs"
          name: "provider shutdown drains admitted work and short-lived scopes do not accumulate"
        - path: "test/attachment-message.test.mjs"
          name: "provider v1 validation and serialization reject asynchronous results without unhandled rejection"
        - path: "test/attachment-message.test.mjs"
          name: "Core attachment admission materializes validated JSON without a plugin or a ten-attachment cap"
        - path: "test/web-channel.test.mjs"
          name: "K07 HTTP admission validates scoped providers and stores materialized frozen data without starting a runtime"
        - path: "test/web-channel.test.mjs"
          name: "K07 HTTP admission rejects unowned media and authority fields while Core JSON needs no plugin service"
      failures:
        - "Wrong owner, missing selection, artifact drift and ambiguous registration fail closed; plugins cannot replace Core builtins."
        - "Media requires a matching Core resource grant; legacy or augmentation-injected paths cannot bypass typed bindings."
        - "Composer sending, rich history rendering and headful acceptance are not established by API and module tests."
      confidence: "high"
    - id: "WEB-COMPOSER-CONTENT-007"
      status: "implemented"
      sources:
        - path: "src/shared/message-content-binding.ts"
          symbol: "createMessageContentBinding"
        - path: "src/data/message-command-store.ts"
          symbol: "MessageCommandStore"
        - path: "src/apps/chat/web-app.ts"
          symbol: "sendChatMessage"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-draft.ts"
          symbol: "CoreAttachmentDraftStore"
        - path: "src/apps/chat-ui/src/attachments/core-attachment-receipts.ts"
          symbol: "reconcileAcceptance"
      tests:
        - path: "test/message-content-binding.test.mjs"
          name: "content binding has a canonical JSON/UTF-8 vector matching native SHA-256"
        - path: "test/message-command-content-binding.test.mjs"
          name: "accepted request binding is atomic, server-derived and durable across duplicates and worker restart"
        - path: "test/message-command-content-binding.test.mjs"
          name: "same transaction rejects changed raw content, resource refs, delivery, final text and binding downgrade"
        - path: "test/message-command-content-binding.test.mjs"
          name: "receipt binding survives model failure, interrupted execution and loss of the optional event projection"
        - path: "test/chat-ui-attachment-submission.test.mjs"
          name: "prepared wire body is persisted before send, immutable across reload and storage-failure atomic"
        - path: "test/chat-ui-attachment-submission.test.mjs"
          name: "a matched receipt ID or echoed fingerprint cannot consume missing or different local content"
        - path: "test/web-channel.test.mjs"
          name: "content-bound durable HTTP admission captures the original body before mutable augmenters"
        - path: "test/web-channel.test.mjs"
          name: "content-bound durable HTTP admission rejects invalid identity without upgrading old receipts"
      failures:
        - "Missing/mismatched content proof cannot consume through the K07 reconciliation seam; failed or interrupted model execution does not undo a proven admission."
        - "The digest is content identity, not provider/schema/resource authorization or proof that an arbitrary extension field was processed."
        - "Current Composer/provider/media wiring and multi-tab storage CAS are not completed by this seam."
      confidence: "high"
    - id: "WEB-COMPOSER-ADMISSION-006"
      status: "implemented"
      sources:
        - path: "src/data/message-command-store.ts"
          symbol: "MessageCommandStore"
        - path: "src/apps/chat/message-command-dispatcher.ts"
          symbol: "MessageCommandDispatcher"
        - path: "src/apps/chat/web-app.ts"
          symbol: "sendChatMessage"
        - path: "src/apps/chat-ui/src/composer-send.ts"
          symbol: "rememberPendingMessageTransaction"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "versioned durable admission acknowledges before cold runtime dispatch and preserves its receipt"
        - path: "test/web-channel.test.mjs"
          name: "web startup dispatches a committed command without an HTTP request"
        - path: "test/message-command-store.test.mjs"
          name: "process death preserves committed commands and fences uncertain dispatch"
        - path: "test/message-command-store.test.mjs"
          name: "independent dispatcher processes claim one committed command only once"
        - path: "test/message-command-store.test.mjs"
          name: "lease recovery monotonically honors every terminal output with a deterministic persistence barrier"
        - path: "test/message-command-store.test.mjs"
          name: "admission behind interrupted FIFO fails atomically while duplicate receipts and unrelated rooms remain available"
        - path: "test/web-channel.test.mjs"
          name: "Chat Web reports interrupted FIFO barriers as non-retryable reconciliation conflicts"
        - path: "test/chat-ui-pending-message-delivery.test.mjs"
          name: "message API distinguishes unknown acceptance from explicit rejection"
      failures:
        - "Expired dispatched ownership without terminal evidence becomes interrupted and is not automatically replayed."
        - "Admission behind an interrupted FIFO predecessor returns a Session-scoped, non-retryable reconciliation conflict without committing an event, payload, or command."
        - "Schema v11 cannot be opened by binaries that reject versions newer than v10."
      confidence: "high"
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
      tests:
        - path: "test/chat-ui-composer-ime.test.mjs"
          name: "composer keeps IME text until composition ends and preserves ordinary Enter controls"
        - path: "test/chat-ui-composer-suggestions-accessibility.test.mjs"
          name: "composer suggestions expose their popup, active option, status, and keyboard selection"
      follow_up: "Validate draft restoration, IME focus, and suggestion interaction headfully."
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

Private transactional browser-draft persistence is anchored at `7b64d34b378f713932ab4841e19d5ed240178a09`. Scoped binary-resource admission is anchored at `8cefa246f0f7e7a4bb921e98b4349eddfd330e0b`, following provider-pinned JSON admission at `72d60f5b720034abd2cc0d394d719736fccdc8ab` and content binding at `08830dfc08e2029746f06bad8337c5f321870399`. The remaining Composer/media description and its original package evidence derive from historical refresh `39090b8850758293e69380a52bb7498d7c955bc2` and package parent `ba3c2d6611ce8d234f887135af605837333bf751`; these are not new whole-product acceptance claims.

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

Drafts, bounded history, selected attachments, delivery mode, and recording/speech controls are per selected Session browser state. IME composition is preserved until composition ends; ordinary Enter controls remain distinct. Suggestions expose popup, active-option, status, and keyboard-selection semantics. Message and action routes target an existing Session.

### Cache, stream, files, and media

Queued/steered sends create optimistic events and pending overlays until durable/live reconciliation. Upload is bounded to selected files; download reports delayed progress; image previews resolve only within configured roots. Transcription and speech providers are independently selected.

### Lifecycle and failure

The delivery dialog closes before awaiting. Duplicate sends, rejected steering, failed uploads/transcription/speech, disconnects, and provider-catalog failures remain visible and recoverable.

### Security

Same-origin mutation checks, exact resource/path validation, byte/text/SDP limits, and credential-free browser provider catalogs apply. Browser clients never receive provider credentials.

### Accessibility and responsive behavior

Composer controls expose labels, recording state, suggestion listbox state, dialogs, pending live regions, preview alt text, and responsive sizing in source. Media permission/focus behavior is not headfully verified.

### Compatibility and integration

Local/slash commands depend on registered capabilities. Attachments and media APIs degrade independently; speech and transcription do not share an implicit provider.

## Requirements and invariants

### Requirement: WEB-COMPOSER-ADMISSION-006

An explicit `admissionVersion: 2` on the message route commits a durable command, receipt and accepted product event atomically before returning HTTP 202. The response contains `receipt` and `statusPath`. Unversioned callers retain the legacy response and dispatch contract; unsupported versions return 400. The browser uses version 2. Its accepted user history already carries the Pibo input identity, so a reload can resolve the receipt before any runtime output. Admission preserves existing runtime status.

The room/actor/client transaction key retains its scope. For version 2 it binds the target Session, effective message content and delivery mode. An unchanged retry returns the same receipt; conflicting reuse or a key already accepted under the legacy contract returns 409. Command materialized text plus any structured attachment snapshot are bounded to 1 MiB, with reference-backed durable storage. Compact receipts have no time-based expiry and remain independent of optional trace/telemetry retention for the lifetime of this database. This does not promise identity across database replacement or restore to a state before acceptance.

The startup dispatcher uses durable fenced claims, at most twelve local outstanding dispatches, including the reserved Steering allowance, and 30-second renewable leases. Normal commands remain FIFO per Session; Steering keeps its separate delivery mode and bypasses an active normal turn. Runtime outputs advance receipt state through `accepted`, `waiting_slot`, `initializing`, `session_queue`, `running` and `completed`/`failed`. Expired unstarted claims can be reclaimed. Lease recovery first rechecks persisted `message_finished`, `session_error`, and `message_steered` evidence and monotonically settles the matching receipt; only potentially dispatched claims without unambiguous terminal evidence become `interrupted`. Startup repeats this repair in bounded batches without appending output. Ambiguous work is never replayed. Unstarted normal successors behind a still-interrupted predecessor are explicitly failed as not dispatched, in bounded batches, rather than remaining silently accepted. This is not an exactly-once guarantee for provider/tool effects.

New normal admission behind an interrupted predecessor returns HTTP 409 `command_reconciliation_required`, `retryable: false`, Session scope, the blocking command identity, blocked-since age, and the supported inspection action. The rejected transaction commits no accepted product event, payload, or command. An unchanged retry of a transaction committed before the barrier still returns its existing receipt. Capacity pressure remains the separate retryable HTTP 429 `command_overloaded` response.

Authenticated `GET /api/chat/message-receipts/:id` returns one receipt after Session/Room access resolution. The Session receipt-list endpoint returns up to 70 active/uncertain entries plus 64 recent terminal entries, alongside bounded Session queue diagnostics. The UI polls that bounded metadata, displays durable acceptance separately from runtime queue/start, and preserves unchanged node identities. Unknown acceptance is explicitly reported; unchanged retries retain their transaction ID in memory and, when available, tab session storage. Explicit rejection preserves composer text and attachments. A trace refresh failure after acceptance does not roll back the accepted send.

The [runtime capacity contract](/specs/runtime/capacity-and-scheduling.md) owns normal/Steering count, byte and oldest-wait limits, database-wide claim limits, Room rotation, cold starts, provider reservations and control capacity. These implemented guards do not alone establish the integrated capacity SLOs in the [performance plan](/plans/pibo-performance-and-scalability.md).

A durable duplicate receipt remains authoritative when the optional accepted-event projection has been removed. The duplicate response may then omit `event`; it must not append accepted history again or repeat augmentation commit callbacks.

Schema v10 introduced durable commands; schema v11 also persists dispatch rotation. Rollback must preserve accepted commands: keep a compatible dispatcher until work is terminal or explicitly reconciled. A v10-only binary cannot open the current schema; dropping command data or lowering `user_version` is not a safe rollback.


### Requirement: WEB-COMPOSER-CONTENT-007

An optional `contentBindingVersion: 1` on `POST /api/chat/message` MUST require `admissionVersion: 2`, an explicit Pibo Session and a normalized, nonempty `clientTxnId`. Invalid versions/identities fail with 400. The server captures the JSON wire body before mutable/asynchronous message augmenters. The storage worker derives the shared canonical SHA-256 from that body, its resolved Session and normalized delivery; it MUST NOT accept a client-provided hash as authority. All submitted extension inputs participate without a feature-specific allowlist.

Opted-in commands store `pibo-content-v1:<request SHA-256>:<effective command SHA-256>` in the existing opaque fingerprint column. The suffix still binds materialized text, Room, Session, delivery and the content proof; typed attachment commands additionally bind their structured snapshot hash and byte count. The content-proof mechanism uses the existing atomic command insertion and adds no table, schema migration, proof sidecar, duplicate request envelope or receipt file read. The separately owned product-history snapshot below is user content, not receipt proof storage. POST and both GET receipt surfaces expose only the optional `contentBinding: {version: 1, sha256}`. Unknown/legacy stored formats have no proof. Existing unflagged fingerprints remain byte-identical. Bound↔unbound retries and changed bodies/delivery/materialization conflict with 409; there is no proofless downgrade or silent upgrade.

The private K07 draft seam's `prepareSubmission` checks the held original snapshot and persists the exact body and independently computed proof **before** a POST. A transaction cannot replace that body, delivery or prepared upload metadata. Write failures publish no new RAM state; reload validates body↔snapshot↔proof consistency. Old stored drafts remain readable without invented proof. `reconcileAcceptance` consumes only matching frozen revisions after a matching server proof and supported receipt-row shape; a receipt ID or POST-echoed fingerprint alone cannot consume. Missing/mismatched proof, rejected/unknown shapes or lookup failures preserve the draft. Every supported durable state, including `failed` and `interrupted`, proves admission when bound; model failure, cancellation or ambiguous execution never authorize an automatic new send. Already-consumed local duplicates consume/notify nothing and are honestly marked weak when no fresh proof is retained.

**Boundary:** this is canonical submission identity, not authorization, provider/schema validation, media-byte/handle validation, evidence that an arbitrary extension field was processed, or exactly-once external effects. The current Composer does not opt in yet. Typed JSON and authorized media admission are implemented below. The standalone synchronous engine's per-instance/reload checks do not prevent an unrelated stale tab from overwriting shared storage; the separate private IndexedDB facade below adds entry CAS. Actual Composer wiring remains separate work.

### Requirement: WEB-COMPOSER-ATTACHMENTS-008

`attachmentVersion: 1` opts into typed records and requires durable admission v2 plus content binding v1. Ordered records carry `id`, positive safe-integer `revision` and `schemaVersion`, `type`, JSON `payload`, and optional plural media descriptors. Provider pins carry `type`, `pluginId`, `contributionId`, artifact `revision` and `contentHash`; resource bindings associate one `draftResourceId` with one opaque `preparedUploadId`. Extra authority fields, ambiguous identities and nonempty legacy `fileAttachmentPaths` fail closed. Without this flag, legacy extension inputs keep their previous interpretation. The legacy ten-upload-file limit is not a total K07 attachment limit.

For plugin types, the server MUST reconcile the Session-effective contribution, requested artifact pin, live installation, registration owner and executable identity through the existing PluginHost index. Both declared contribution and resource registrations are supported, but exactly one matching registration is required. Current-plan reads use the live generation or pure preview without starting a runtime; historical delivery evidence is not selection authority. Core builtins require no plugin service and cannot be replaced by plugin registrations. Browser lookup and ownership pins are bound to the same Session-effective artifact selection.

Short-lived child scopes retain providers through admission, block ordinary removal and drain during host shutdown. Successful children retire their parent cleanup entry; failed children remain barriers. Selection is rechecked after asynchronous augmentation and before storage admission, not through a new cross-service profile/SQLite CAS.

Schema validation and synchronous v1 validation/serialization run on detached values. Promises are rejected rather than silently accepted as successful validation. Provider results are matching JSON parts or refs to Core-resolved resources, never roles, tools or admission identities. Canonical JSON is materialized as ordinary user content. Mutable augmentation cannot overwrite Core authority fields. This boundary is not a plugin sandbox or an exactly-once external-effects guarantee.

Structured snapshots and their byte/refcount ownership belong to [product history](/specs/data/product-store-history-and-read-models.md). Durable admission is independent of model outcome; the existing receipt proof remains readable after provider removal or missing snapshot files. It proves past admission, not present byte availability.

Typed media now resolves through the scoped Core grants below; missing or corrupt bytes fail closed. Providers receive opaque resource references, not filesystem paths. After provider serialization, Core appends a separate `[attached_resources]` block containing its verified managed paths for native file readers. This block is ordinary user content and is persisted with the materialized command/history text. The structured resource snapshot omits paths. Consequently, the effective-command fingerprint is currently host-path-dependent: moving a payload root is not a transparent unchanged-retry or dispatch migration. This is not a filesystem sandbox or a relocation guarantee.

### Requirement: WEB-COMPOSER-RESOURCES-009

Authenticated `POST /api/chat/attachment-resources` accepts same-origin multipart data containing exactly one `file` and exactly one each of `piboSessionId`, `clientTxnId` and `draftResourceId`; unexpected/duplicate fields fail. A persisted, available Pibo Session in a non-archived Room and file-backed storage are required. Preparation never recreates a deleted Session from a stale runtime handle. The response is HTTP 201 with `attachmentVersion: 1` and a descriptor containing an opaque `preparedUploadId`, draft identity, server-derived SHA-256, MIME, byte count, name and prepared/accepted state. No path or payload-store ID is returned in that descriptor.

`GET` and `DELETE /api/chat/attachment-resources/:id` require the same three scope values as query parameters. Knowing an opaque ID, hash or path alone is insufficient. Login grants access to the shared App Context, not a per-user server tenant. GET supports metadata-only `metadata=1`, verified bytes, and raster-only `preview=1`. Reads remain available in archived Rooms; mutations do not. Downloads force `application/octet-stream`, attachment disposition, `nosniff` and no-store headers. Inline preview requires recognized bytes matching the declared image MIME and the existing preview byte bound; HTML/SVG are not served inline. DELETE only discards unaccepted preparation owners; accepted bytes belong to product history.

The whole HTTP body remains limited to 4 MiB. The separate stored-resource limit is 15 MiB, not permission to send a 15 MiB multipart body. Chunk upload, Range serving and streaming are not implemented: verified reads buffer bounded bytes before responding, with no concurrency/throughput acceptance claim. Existing normal-upload, annotation and trace-image counts remain distinct; no total K07 attachment count cap is introduced.

Fresh message admission verifies bound media bytes in the worker before its transaction and rechecks ownership during promotion. Preparation and discard use the existing bounded storage worker; its 500 ms queue/execution limit and 10 s startup budget are unchanged. Admission tests explicitly wait for worker readiness, while a deterministic cold-start test verifies that startup does not extend an RPC deadline. A matching receipt still proves admission, not present media availability or successful model execution. Worker duplicate admission and receipt lookup do not re-read media bodies; a fresh HTTP materialization may fail on a missing file, so receipt lookup remains the reconciliation path.

The [product-store contract](/specs/data/product-store-history-and-read-models.md) owns grant/refcount/schema and deletion semantics. Private browser copy holders/CAS exist below; actual Composer freeze/preparation/retry, productive copy/fork UI, rich history rendering, auth/logout and integrated multi-tab behavior remain open. Fake-auth API fixtures and direct byte checks are not real-login, native-tool execution or headful acceptance.

### Requirement: WEB-COMPOSER-STORAGE-010

The private browser attachment repository uses `pibo-attachments-v1` database version 3. Its additive schema keeps `draft-blobs` and `copy-buffers`, adds `draft-states`, `legacy-claims` and `legacy-text-backups`, and adds owner indexes. Draft rows are keyed by `[ownerUserId, sessionId]`, where `sessionId` is a **Pibo Session**, not an authentication-session identifier. Browser owner isolation is distinct from shared server App Context access.

`openIndexedAttachmentDraft` captures plain-data commands and new byte arrays before waiting. Each mutation reads the current row, compares its expected safe-integer storage revision, runs the existing engine/serializer on a transaction-local scratch store, and commits the row plus associated byte changes in one IndexedDB transaction. `writerEpoch` is diagnostic; the row revision supplies CAS. A stale caller receives `ATT_STALE_REVISION` rather than overwriting newer state. No arbitrary provider or network await occurs inside that transaction; asynchronous provider work must precede a data-only command. The existing public `add`, `update` and `remove` APIs retain Promise rejection behavior despite the new private synchronous dispatcher.

New byte acquisition is atomic with a new draft record and MUST match its owner, Pibo Session, draft identity, MIME and size. Blob IDs are immutable: a collision cannot replace another row. Add/freeze checks byte availability. Frozen snapshots retain their byte holders after edits/removal; consume/release deletes only bytes no longer held by persisted owner drafts, open snapshots or the existing copy buffer. Admission reconciliation does not require local bytes still to exist. The unchanged per-blob limit is 15 MiB, not a new total attachment or storage quota. Independently owned copy bytes and copy-buffer CAS are specified separately below.

Success is returned only after transaction completion. Abort/error becomes `ATT_STORAGE_FAILED` unless a more specific attachment error applies; a blocked upgrade fails without later silently upgrading after the caller abandoned it. Version changes close the connection. Explicit `close()` prevents subsequent reads/writes and hides pending old-owner results even when an already-started transaction committed. It does not erase data. `clearOwner()` explicitly clears active drafts/bytes/copy, retaining draft tombstones with advanced revisions to prevent stale absent-state writes. It retains legacy custody, exact text backups and original localStorage: it is neither logout nor account/browser erasure. The copy row receives an advanced revision tombstone even if absent; a corrupt row fails the entire reset closed. A caller must reload its copy revision after reset.

There is no automatic unowned-localStorage fallback. `adoptLegacy` requires explicit custody confirmation, an absent entry and a globally first-wins claim for the legacy source key. The claim contains metadata, while exact original text is backed up under `[ownerUserId, sourceKey]` and round-trip checked atomically with the draft row. Foreign claimants are denied before reading that legacy content. The original localStorage string remains unchanged, and custody never invents proof of original authorship. Backup reads recheck owner, Pibo Session, key and a digest of the exact retained string. `restoreLegacyText` uses CAS and permits only an absent or explicitly cleared draft. It restores metadata/proofs, not deleted binary bytes; a later freeze still fails when required bytes are absent. A new login for the same owner may reopen the same Pibo Session. Copying into a different Pibo Session is not legacy restoration.

**Evidence boundary:** the private facade is not yet the productive Composer owner. Fifteen headed Chrome/native-IndexedDB module cases include a separate-tab CAS race, disposable version-2 upgrade, blocked upgrade, injected write abort, custody/recovery races, corrupt-state preservation and close guards. Injected abort is not actual quota exhaustion. Only uniquely named owned fixture databases were opened; no application/default database or valuable copied data was upgraded. This does not establish real App authentication, integrated logout, Composer editing/sending, retention/GC or product UI acceptance.

### Requirement: WEB-COMPOSER-COPY-011

The private browser copy buffer retains at most one confirmed entry per owner. Its version-3 database stores a monotonically increasing **in-row** revision; `stage(expectedRevision, entry)` and `clear(expectedRevision)` serialize through an IndexedDB readwrite transaction and fail with `ATT_STALE_REVISION` on a changed row. Clear writes a tombstone, never an ABA-prone bare delete. `clearOwner()` tombstones the copy row too, even if no row existed. Copy state is not a substitute for product history, a server resource grant or the Composer's existing upload list.

Staging captures plain typed input before the first asynchronous wait. It compares an existing **live** source draft's exact owner, Pibo Session, record ID, record revision, provider type, schema version, canonical payload and ordered media against that input. For each media descriptor it verifies the owner/Session/draft/MIME/size/actual stored bytes and makes a fresh independently owned immutable blob under a copy-holder identity. Copy row, byte acquisitions and cleanup of the replaced holder commit atomically; cleanup consults all transaction-current persisted draft, snapshot and copy holders. A failed write/byte collision cannot publish half a copy. Copying does not grant provider validity: productive callers must consult the selected browser provider outside the transaction, and the server independently revalidates pins/resources on message admission.

`pasteCopy(targetDraftExpectedRevision, copyExpectedRevision)` verifies both revisions in one readwrite transaction, refuses empty/cleared or legacy untyped rows, creates a **new** target-Pibo-Session attachment ID and distinct byte IDs under its new draft, and commits all target state and bytes together. It never carries source-scoped blob IDs or past server grants to a new Session. Source removal or copy clear after a committed paste cannot revoke its independent bytes. Model/provider outcome and product-history fork behavior are unrelated. A missing holder byte fails `ATT_BYTES_MISSING`; changed state fails `ATT_STALE_REVISION`; exhaustion fails `ATT_LIMIT_EXCEEDED`. `close()` hides results of old-owner operations without erasing their committed state.

Historical version-2 copy rows remain readable as `legacy`, with their structured-cloneable (possibly non-JSON) payload and duplicate media holders intact. This does **not** assign a type/schema or authorize typed paste; explicit replacement/clear under revision 1 is required. Corrupt owner/holder metadata fails closed. The in-memory test adapter covers byte scope but lacks the durable source-record/holder scan; it is not parity or cross-tab evidence.

**Evidence boundary:** the final copy-focused batch passed narrow copy/draft/fixture types and 26 overlapping pure/module tests. The final static module lab passed 21 Chrome 153 native-IndexedDB cases, including actual two-tab copy CAS, independent cross-Session bytes/paste, rollback, legacy structured-value retention, foreign-owner and failure/limit cases. Its UA explicitly reports **HeadlessChrome**, so neither this nor earlier misnamed copy-headful labels are headful evidence. A previous 15-case **headed** batch belongs to the earlier draft foundation, not this copy source. Only uniquely named disposable fixture databases were touched. There is no productive Composer copy button, browser/provider integration, real App auth/logout, end-to-end typed send, visual-product acceptance, actual quota exhaustion or installation proof.

### Requirement: WEB-COMPOSER-DRAFTS-001

Composer drafts, bounded history, keyboard submission, attachments, and delivery controls MUST follow the selected Pibo Session and MUST NOT leak when navigation changes selection.

#### Current

upstream/dev refresh source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/composer/Composer.tsx` — `Composer`; `src/apps/chat-ui/src/composer/Composer.tsx` — `appendTranscribedText`; `src/apps/chat-ui/src/composer/Composer.tsx` — `resizeComposerInput`; `src/apps/chat-ui/src/app-storage.ts` — `readStoredComposerDraft`; `src/apps/chat-ui/src/app-storage.ts` — `writeStoredComposerDraft`
- Tests: No named test exists in the upstream/dev refresh evidence set; this requirement remains source-only.
- Public surfaces: `POST /api/chat/sessions/:id/messages`; `POST /api/chat/sessions/:id/actions`; `/api/chat/files/upload`; `/api/chat/files/download`; `/api/chat/files/image-preview`; `/api/chat/transcription*`; `/api/chat/speech*`; `Composer`
- Failure/security boundary: Storage errors or Session changes must not send to the wrong Session.
- Accessibility/responsive boundary: Source exposes labeled controls and keyboard behavior; real focus/IME/mobile behavior remains unverified.
- Compatibility boundary: Draft storage is browser-local and non-authoritative.
- Confidence: **medium**
- Verification follow-up: Add and run a focused browser-independent test for per-Session draft/history restoration, Enter/modified-Enter behavior, and selection changes; then validate focus headfully.

### Requirement: WEB-COMPOSER-DELIVERY-002

Sending MUST preserve the selected Session, support queue and steer choices, create optimistic sending feedback, reject duplicates, and reconcile explicit steering conflicts.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

Image filenames in Attached uploads open the shared image-preview dialog for the selected Session. Copy-path and detach remain separate actions; non-image filenames remain plain text. Desktop and mobile use the same authenticated preview endpoint, loading/error states, Escape handling, and focus restoration.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

- POST /api/chat/attachment-resources
- GET /api/chat/attachment-resources/:id
- DELETE /api/chat/attachment-resources/:id
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
- K07 typed JSON/media admission, pinned provider validation, scoped durable media routes and private draft/copy/receipt/CAS repositories are implemented. Actual provider-aware Composer mutation/freeze/send, chunks/GC/productive-copy/fork/auth and rich UI/history integration remain open. Module-level real-tab CAS is not integrated Composer acceptance or the completed attachment cutover.

## Reconciled stale claims

- Reject: Speech and transcription necessarily share one provider.
- Reject: Browser media APIs receive provider credentials.
- Reject: File preview accepts arbitrary local paths.
- Reject: Optimistic messages are durable history.
- Reject: Goal slash commands own Goal runtime semantics.

## Verification and traceability

- Private copy source checkpoint: `df94a3a5cff2c944f81db64fd982109c0aba6556`. Final `cutover-k07-copy-focused-06` passed narrow copy/draft/browser-fixture types, 26 pure/module tests and an owned esbuild module fixture bundle. `cutover-k07-copy-browser-05` passed 21 **HeadlessChrome** native-IndexedDB cases via Browser Use/CDP, including a genuine second-tab copy CAS. CDP verified the served bundle SHA-256 and reported no uncaught exceptions. Tracked-diff and the new untracked source-file hash matched both final runs immediately before staging. First two targeted type attempts failed and were fixed; an early Browser Use run failed because its tool executable was unavailable in a second child invocation. Intermediate copy runs are WIP, not unique coverage; their `headful` label was inaccurate because the user agent says HeadlessChrome. Final copy module/browser verification is not a full Chat UI, real login, productive provider, installation or release compiler pass.
- Browser-foundation source checkpoint: `7b64d34b378f713932ab4841e19d5ed240178a09`. `cutover-k07-browser-state-focused-03` passed narrow persistence/fixture types and 25 pure/module tests, then built the owned browser fixture. `cutover-k07-browser-headful-03` passed 15 native-IndexedDB cases through headed Chrome 153, Browser Use interaction and CDP evidence, including a separate-tab CAS race. The served bundle hash matched the fixture build; console/network/exception results, exact harness and screenshot are retained. Tracked-diff and all five untracked source/test hashes matched both final runs immediately before the source commit. Extracted add/update/remove bodies were separately checked unchanged.
- Earlier browser-focused batches passed the same 25-test group and are not added as unique coverage. Headful attempt 01 failed in Browser Use element-index handling before any module case ran; attempt 02 passed ten cases on earlier source. Both remain evidence, not final-source acceptance. No full application compiler, real App login, physical quota exhaustion, product UI, valuable-data migration or installation acceptance follows from these module checks.
- Media-authority source checkpoint: `8cefa246f0f7e7a4bb921e98b4349eddfd330e0b`. `cutover-k07-media-admission-focused-06` passed 164 focused module/provider/storage/draft tests and eleven selected HTTP tests, with no failures/skips. Narrow resource-store/payload/protocol/provider/draft types passed, followed by a 581-file behavioral emit and 22 plugin artifacts. This is not full worker/web-app/root compilation, release packaging, installation or productive Composer acceptance.
- Media attempts 02–04 remain failed evidence: an obsolete model-path assertion, cold-worker HTTP queue deadlines, and two module-fixture startup deadlines. Fixture readiness was made explicit without increasing limits or removing behavioral assertions. A new deterministic test retains default cold-start queue rejection; the no-HTTP startup-dispatch test still makes no HTTP request. Run 05 passed 105 plus eleven tests on prior emitted source; it did not rebuild artifacts.
- Earlier provider-admission source checkpoint: `72d60f5b720034abd2cc0d394d719736fccdc8ab`, following the unchanged JSON-helper extraction `4578810ee33172d3dba9cbcfc454bdf51062cf77`. `cutover-k07-admission-focused-04` passed 98 focused tests and seven selected HTTP tests. Earlier content-binding batches passed 47 plus five; coverage overlaps and is not a unique-test sum. The entire Web suite was not run.
- The narrower compiler checks do not replace the blocked broader graphs. Earlier browser-safe binding checks also passed; a broader backend target import graph exhausted a 384 MiB heap (exit 134), and no broader backend or root typecheck pass is claimed. The fresh 577-file ESM emit was behavioral-test input, not a release compiler pass; 22 plugin artifacts rebuilt successfully.
- Preserved failed attempts exposed an initial media TypeScript inference error, double JSON serialization, typed-error transport loss and an HTTP fixture attempting to mutate a frozen plan. All were corrected before the final bounded pass; failures are not hidden or reclassified as passes.
- Commands, outputs, failures and source/verification boundaries are preserved in the [bounded evidence collection](/reports/artifacts/beta4-phase2/direct-cutover-2026-09-22/evidence.json). Counts from separate batches overlap.
- Remaining source/named-test and Docker/typecheck/package claims belong to the historical `39090b8850758293e69380a52bb7498d7c955bc2` authoring package; they are not rerun claims for the current candidate. Candidate installation acceptance is explicitly user-skipped, not passed.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Historical package verification command (not rerun for this change):

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-composer-send.test.mjs test/chat-ui-pending-message-delivery.test.mjs test/chat-ui-upload-attachments.test.mjs test/chat-ui-download-files.test.mjs test/chat-transcription-web.test.mjs test/chat-speech-web.test.mjs test/loop-session-goal-command.test.mjs`

## Related concepts

- SPC-CMP-004
- SPC-RES-005
- SPC-SEC-002
- SPC-RUN-008
- SPC-WEB-002
