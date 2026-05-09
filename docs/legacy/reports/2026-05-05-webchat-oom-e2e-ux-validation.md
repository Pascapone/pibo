# Webchat OOM / Delta Compaction E2E + UX Validation

Date: 2026-05-05

## Scope

Validated the OOM delta-compaction changes in isolated Docker Compute workers. The host `pibo-web` gateway was not stopped, restarted, or used as an experimental target.

Workers used:

- Agent A: `oom-e2e-agent-a` — persistence/store-guard focus + browser smoke
- Agent B: `oom-e2e-agent-b` — trace/bounds focus + browser navigation/reload smoke
- Self check: `oom-e2e-self` — full type/build smoke + API/browser UX validation

Each worker used its own container and Browser Use session.

## Agent Prompts

### Agent A

> Lies GLOSSARY.md, docs/delta-compaction-hardening-plan.md und plans/2026-05-05-final-webchat-oom-delta-compaction-plan.md. Nutze nur diesen Docker Worker, nicht den Host-Gateway. Teste die OOM/Delta-Compaction aus Sicht Persistenz + Browser. Nutze browser-use. Prüfe: Typecheck, fokussierte Tests, Dev-Auth Login im Browser, Chat UI erreichbar, keine durable Delta Rows nach Startup/Trace-Dry-Run. Schreibe /tmp/agent-a-report.md mit Checks, Ergebnissen, Risiken.

### Agent B

> Lies GLOSSARY.md, docs/delta-compaction-hardening-plan.md und plans/2026-05-05-final-webchat-oom-delta-compaction-plan.md. Nutze nur diesen Docker Worker, nicht den Host-Gateway. Teste die OOM/Delta-Compaction aus Sicht Trace API, SSE/Reconnect und Browser UX. Nutze browser-use. Prüfe: Build/Test subset, trace raw events bounded, SSE cursor tests, Browser Login, Reload, Navigation zu Sessions/Agents/Settings. Schreibe /tmp/agent-b-report.md mit Checks, Ergebnissen, Risiken.

## Results Summary

| Area | Result |
| --- | --- |
| Host gateway isolation | Pass — no host gateway operations performed |
| Docker image build | Pass |
| Typecheck in Docker | Pass |
| Dist-level compactor assertions | Pass |
| Store guards reject live-only deltas | Pass |
| Long-stream compaction scenario | Pass — 1500 assistant deltas persisted as one final assistant message |
| Thinking long-stream compaction scenario | Pass — 1000 thinking deltas persisted as one final `thinking_finished` |
| Debug compact-deltas dry-run | Pass — new worker stores report 0 live-only rows |
| Dev-auth browser login | Pass |
| Browser Chat UI authenticated state | Pass |
| Browser composer visibility | Pass |
| Browser Agents page | Pass |
| Browser Settings page | Pass |
| Trace API on fresh session | Pass — bounded empty trace, rawEvents 0 |

## Detailed Findings

### Agent A

- Ran `npm run typecheck` inside `oom-e2e-agent-a`.
- Ran dist-level assertions against:
  - `OutputCompactor`
  - `isLiveOnlyOutputEvent`
  - `ChatEventLog`
  - `ChatWebReadModel`
- Confirmed `assistant_delta`, `thinking_delta`, and `tool_execution_updated` are ignored by durable stores.
- Confirmed assistant deltas compact to final text: `hello world`.
- Ran:
  - `pibo debug events compact-deltas --dry-run --store chat`
  - `pibo debug events compact-deltas --dry-run --store reliability`
- Browser Use verified dev-auth login and Chat UI rendering with composer.

### Agent B

- Ran `npm run build` inside `oom-e2e-agent-b`.
- Ran long trace/read-model scenario:
  - 1500 live assistant deltas
  - one final assistant message
  - durable read model contains one `assistant_message`, zero `assistant_delta`
  - trace raw events remain bounded
- Ran `pibo debug events --help` and `pibo debug events compact-deltas --dry-run`.
- Browser Use verified:
  - authenticated Chat page
  - Agents page
  - Settings page
  - return/reload to Chat page
  - composer present

### Self Worker

- Ran `npm run typecheck` and `npm run build` inside `oom-e2e-self`.
- Ran a dist-level thinking compaction scenario:
  - 1000 `thinking_delta` inputs
  - one final `thinking_finished`
  - zero durable live-only delta rows in `ChatEventLog` and `ChatWebReadModel`
- Verified dev-auth API flow:
  - `/api/auth/sign-in/social`
  - `/api/auth/session`
  - `/api/chat/session`
  - `/api/chat/trace?includeRawEvents=true&rawEventsLimit=5`
- Browser Use verified authenticated Chat/Agents/Settings UX.

## UX User Stories

### 1. First-time authenticated user opens Chat

**As a user**, I can open the Docker worker Chat app, sign in through dev auth, and land in an authenticated Chat UI.

Observed:

- Email shown: `dev@pibo.local`
- Personal Chat created automatically
- Session selected automatically
- Composer textarea present

Status: Pass.

### 2. User can understand the empty session state

**As a user**, I can see that a fresh session has no visible trace rows and can identify where to type a message.

Observed:

- Empty trace: `No visible trace rows yet.`
- Profile selector visible
- Composer placeholder: `Message selected session, type / for commands or $ for skills`

Status: Pass.

### 3. User can navigate main product areas

**As a user**, I can move between Sessions, Agents, Context, and Settings without losing authentication.

Observed:

- Agents page shows read-only profiles and Agent Designer.
- Settings page shows General settings, runtime model defaults, provider notice.
- Returning to Chat restores selected session and composer.

Status: Pass.

### 4. Long streaming output does not bloat durable storage

**As a user**, long streamed assistant/thinking output should render live, but reload/trace should rely on compact canonical events.

Validated by dist scenarios:

- 1500 assistant deltas compacted to one `assistant_message`.
- 1000 thinking deltas compacted to one `thinking_finished`.
- Durable store guards reject live-only delta rows.

Status: Pass for storage/trace behavior. Full real-provider live streaming was not exercised because worker has no configured provider credentials.

### 5. Operator can inspect migration/delta risk safely

**As an operator**, I can run a dry-run delta compaction command without mutating data.

Observed:

- `pibo debug events compact-deltas --dry-run` reports chat and reliability stores.
- Fresh worker stores report `liveOnlyRows=0`.

Status: Pass.

## Risks / Follow-ups

- Browser Use `wait text "New Chat"` was not a reliable selector in the current UI copy, but Browser state and JS evaluation confirmed the authenticated UI and composer.
- Real provider-backed streaming was not tested in Docker because no provider credentials are configured. The live/durable split was validated through dist-level compactor/read-model scenarios and existing unit/integration tests.
- The implemented `compact-deltas --apply` remains a conservative cleanup path for live-only rows, not the full legacy synthesis/rewrite migration described in the long-term plan. Production migration still needs backup, dry-run on copy, review, and explicit approval.

## Verdict

The Docker E2E/test phase confirms the core OOM fix goals for new runs:

- new durable stores do not accept live-only deltas,
- trace paths are bounded for the tested scenarios,
- browser-authenticated Chat UX loads correctly in isolated workers,
- operator dry-run reports zero live-only rows in fresh worker stores.

Ready for a staged migration dry-run on copied legacy DBs before any production operation.
