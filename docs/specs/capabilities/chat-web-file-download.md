# Spec: Chat Web File Download

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/chat-web-browser-shell-state.md`, `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`

## Why

Agents often produce files that the user must inspect outside the terminal view: logs, reports, screenshots, PDFs, generated data, or build artifacts. Chat Web needs a small, predictable way to download those files from the session context without adding attachment storage or duplicating file contents into the chat database.

The current implementation exposes this as a browser-local `/download` slash command backed by an authenticated same-origin download endpoint.

## Goal

Chat Web MUST let an authenticated user download an existing regular file by absolute path or by path relative to the selected session's effective workspace, while keeping the command explicit, session-aware, and non-persistent.

## Background / Current State

The browser command surface adds `/download` in `src/apps/chat-ui/src/App.tsx`. Running it calls `downloadChatFile()` in `src/apps/chat-ui/src/api.ts`, which sends a GET request to `/api/chat/download` with `path`, optional `piboSessionId`, and optional `roomId`.

The server route in `src/apps/chat/web-app.ts` requires an authenticated web session, resolves the requested Pibo Session, derives a base path from room workspace metadata, the selected session workspace, or the default Pibo workspace, resolves the requested path, verifies that it exists and is a regular file, and streams it with download headers.

## Scope

### In Scope

- The `/download <path>` Chat Web slash command.
- The `/api/chat/download` same-origin GET endpoint.
- Path resolution for absolute paths and paths relative to the effective selected workspace.
- Server validation that the resolved path exists and is a file.
- Response headers for content type, length, download filename, and no-store caching.
- Browser handling that turns the response body into a downloaded file.

### Out of Scope

- Uploads, drag-and-drop attachments, and persistent file records.
- File previews in the transcript or terminal.
- Directory archives or recursive download.
- Cross-user file-sharing links.
- Sandboxing file access beyond the current authenticated-session and selected-workspace behavior.

## Requirements

### Requirement: The command is explicit and local to the browser composer

The Chat Web composer MUST expose `/download` as a slash command and MUST execute it as a browser action instead of sending it to the agent runtime.

#### Current

`slashCommands` appends `/download` with action `download`. `runCommand()` handles that action before calling gateway actions or message submission.

#### Target

A download request is user-initiated, visible in the composer, and does not become a runtime message or persisted chat message.

#### Acceptance

- `/download` appears in slash-command suggestions.
- Submitting `/download <path>` calls the browser download helper.
- Submitting `/download` without a path shows `Usage: /download <path>`.
- The command does not call `postMessage()` and does not create a chat event.

#### Scenario: Download command is intercepted

- GIVEN a selected session is open
- WHEN the user submits `/download output/report.md`
- THEN Chat Web calls the download API for `output/report.md`
- AND the text is not sent to the Pibo runtime.

### Requirement: Downloads are authenticated and session-aware

The server MUST require a valid Chat Web session and MUST resolve the requested Pibo Session before serving a file.

#### Current

The `/api/chat/download` route calls `requireSession()`, then `resolveRequestedSession()` with `piboSessionId` and `roomId` query parameters.

#### Target

Downloads are tied to the authenticated user's reachable Chat Web session context.

#### Acceptance

- Unauthenticated download requests fail before file access.
- A missing or invalid requested session fails through normal selected-session resolution.
- The same endpoint works for Sessions-area downloads and Project-area downloads when the caller supplies the selected Pibo Session.

#### Scenario: Unauthenticated request is denied

- GIVEN no valid web session cookie is present
- WHEN a client requests `/api/chat/download?path=report.md`
- THEN the server rejects the request without reading the file.

### Requirement: Relative paths resolve against the effective workspace

The server MUST resolve relative download paths against the effective workspace for the selected session.

#### Current

The base path is `roomWorkspaceFromMetadata(room.metadata)`, then `selectedSession.workspace`, then `getDefaultPiboWorkspace()`. `resolveDownloadPath()` resolves non-absolute paths against that base path.

#### Target

A user can download files that an agent created relative to the room or session workspace without knowing the absolute filesystem path.

#### Acceptance

- If the room has workspace metadata, relative paths resolve under that room workspace.
- Otherwise, if the selected session has `workspace`, relative paths resolve under the session workspace.
- Otherwise, relative paths resolve under the default Pibo workspace.
- The server returns the resolved file content when it exists and is a regular file.

#### Scenario: Relative artifact download

- GIVEN the selected session workspace is `/work/demo`
- AND `/work/demo/artifacts/result.json` exists as a file
- WHEN the user runs `/download artifacts/result.json`
- THEN the server streams `/work/demo/artifacts/result.json`.

### Requirement: Absolute paths are accepted as explicit paths

The server MUST accept absolute paths and resolve them as explicit filesystem targets.

#### Current

`resolveDownloadPath()` returns `resolve(path)` when `path` is absolute.

#### Target

When an agent reports an absolute artifact path, the user can download it directly.

#### Acceptance

- An absolute path is not rebased under the selected workspace.
- Existing regular files at absolute paths are streamed.
- Missing absolute paths return a file-not-found error.

#### Scenario: Absolute artifact path

- GIVEN `/tmp/pibo-output/report.pdf` exists as a file
- WHEN the user runs `/download /tmp/pibo-output/report.pdf`
- THEN Chat Web downloads that file with filename `report.pdf`.

### Requirement: Only regular existing files are served

The server MUST reject missing paths and non-file paths.

#### Current

The route calls `statSync()`, maps missing paths to `404`, and rejects values where `stat.isFile()` is false with `400`.

#### Target

The endpoint does not serve directories, sockets, devices, or implicit listings.

#### Acceptance

- Missing paths return HTTP 404 with a useful error message.
- Directories return HTTP 400 with a useful error message.
- Existing regular files are streamed.

#### Scenario: Directory request is rejected

- GIVEN `/work/demo/artifacts` is a directory
- WHEN the user requests `/api/chat/download?path=artifacts` for a session rooted at `/work/demo`
- THEN the server returns a 400 error instead of a directory listing.

### Requirement: Download responses carry safe browser headers

The server MUST send response headers that make the browser save the file and avoid caching the response.

#### Current

The route sets `content-type` from the file extension, `content-length` from `stat.size`, `content-disposition` to an attachment filename derived from `basename(absolutePath)`, and `cache-control: no-store`.

#### Target

The browser saves the downloaded content under a stable filename and does not reuse stale file contents.

#### Acceptance

- `.html`, `.json`, `.md`, `.txt`, `.log`, `.pdf`, `.png`, `.jpg`, `.jpeg`, and `.webp` receive the current mapped content types.
- Unknown extensions use `application/octet-stream`.
- `content-disposition` contains an encoded basename, not the full server path.
- `cache-control` is `no-store`.

#### Scenario: Filename does not expose parent directories

- GIVEN the requested path resolves to `/work/demo/private/build.log`
- WHEN the response is created
- THEN the attachment filename is `build.log`
- AND the header does not include `/work/demo/private`.

## Edge Cases

- Paths with leading or trailing whitespace are trimmed by the command/API caller before server resolution.
- Browser filename parsing falls back to `download` when `content-disposition` has no supported filename value.
- Absolute path support means access is broader than the selected workspace; callers should treat `/download` as an authenticated local-operator feature, not a shareable web file server.
- The current route streams from the live filesystem and does not snapshot content; a file changed during streaming may produce filesystem-dependent results.

## Constraints

- **Compatibility:** The command must coexist with registered gateway slash commands and must not reserve any gateway action name.
- **Security / Privacy:** Requests must pass Chat Web authentication. The current implementation does not enforce a workspace-only path sandbox for absolute paths.
- **Performance:** Files stream from disk instead of being loaded fully into memory on the server.
- **Dependencies:** Download behavior depends on Chat Web session resolution, room workspace metadata, Pibo Session workspace, and browser Blob download support.

## Success Criteria

- [ ] SC-001: `/download <relative-path>` downloads an existing regular file relative to the selected session's effective workspace.
- [ ] SC-002: `/download <absolute-path>` downloads an existing regular file at that path.
- [ ] SC-003: `/download` without a path shows usage feedback and does not contact the server.
- [ ] SC-004: Missing paths return 404 and directories return 400.
- [ ] SC-005: Successful responses include attachment filename, content length, content type, and `cache-control: no-store`.

## Assumptions and Open Questions

### Assumptions

- Chat Web runs as a local/operator-facing app where authenticated users are trusted to request files they can name.
- Relative-path downloads should keep following room workspace metadata before session workspace because this matches current source behavior.

### Open Questions

- Should absolute path downloads remain allowed, or should they require an explicit admin setting or workspace allowlist?
- Should large downloads have a maximum size or timeout?
- Should Project-area downloads use the Project folder directly when it differs from the linked Pibo Session workspace?

## Traceability

| Requirement | Scenario / Story | Source basis | Status |
|---|---|---|---|
| Command is explicit | Download command is intercepted | `src/apps/chat-ui/src/App.tsx` | Implemented |
| Authenticated and session-aware | Unauthenticated request is denied | `src/apps/chat/web-app.ts` download route | Implemented |
| Relative workspace resolution | Relative artifact download | `roomWorkspaceFromMetadata`, `selectedSession.workspace`, `getDefaultPiboWorkspace` | Implemented |
| Absolute paths accepted | Absolute artifact path | `resolveDownloadPath` | Implemented |
| Existing regular files only | Directory request is rejected | `statSync`, `stat.isFile()` checks | Implemented |
| Safe response headers | Filename does not expose parent directories | `contentTypeForDownload`, `basename`, response headers | Implemented |

## Verification Basis

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/types/rooms.ts`
- `src/core/workspace.ts`
