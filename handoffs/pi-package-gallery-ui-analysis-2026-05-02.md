# Pi Package Gallery UI Analysis

Date: 2026-05-02

## Goal

Plan the missing Pi Package management surfaces:

- Chat Web Agent Designer add/remove flow.
- Rich metadata display for registered packages.
- Package registration state separate from per-agent selection.
- Historical note: iframe/gallery discovery was considered and rejected for now.

## Current State

Implemented and pushed on `main` in `d5680f4 Add Pi package integration layer` and `62eb95d Harden Pi package integration`:

- `pibo pi-packages list/add/inspect/remove/doctor`.
- Pibo package store at `.pibo/pi-packages.json`.
- Backend package APIs:
  - `GET /api/chat/pi-packages`
  - `POST /api/chat/pi-packages`
  - `GET /api/chat/pi-packages/:id`
  - `PATCH /api/chat/pi-packages/:id` for metadata/source refresh
  - `DELETE /api/chat/pi-packages/:id`
- Capability catalog includes `piPackages`.
- Agent Designer can toggle already registered packages.
- Custom agents persist `piPackages`.
- Runtime loads only selected registered packages.
- Registered packages use `installStatus` and `installPath`.
- npm package installs are scoped under `.pibo/pi-packages/npm/...`.
- Deleting a package selected by a custom agent is blocked with affected-agent diagnostics.

Not implemented:

- Agent Designer UI to add packages by URL.
- Agent Designer UI to remove package registrations.
- Agent Designer UI to disable a registered package without removing it.
- Rich metadata panel for package description, source links, resources, install spec, diagnostics, and discovered tool names.

Explicit product decision:

- No website discovery in the UI.
- No iframe embedding.
- User pastes a `https://pi.dev/packages/...` package detail URL.
- Pibo loads metadata from that URL/package source and displays it in the Agent Designer.

## iframe Feasibility

Header check on 2026-05-02:

```text
curl -I -L https://pi.dev/packages
curl -I -L https://pi.dev/packages/pi-web-access
```

Both responses include:

```text
x-frame-options: SAMEORIGIN
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
```

Conclusion:

- Direct iframe embedding of `https://pi.dev/packages` inside Pibo Chat Web will be blocked by the browser today.
- Even if the page became iframe-embeddable later, Pibo still could not read the iframe URL or DOM because it is cross-origin.
- A Pibo-side `Install this package` button outside the iframe cannot reliably know which package page the iframe is on unless `pi.dev` cooperates through `postMessage` or an embed API.

## Security Analysis

### Direct iframe

If `pi.dev` removes `X-Frame-Options` or adds Pibo to `frame-ancestors`, a direct iframe is the safest rendering option because browser same-origin policy isolates the external site.

Risks and constraints:

- Pibo cannot inspect iframe DOM or current URL.
- Pibo cannot inject install buttons into the iframe.
- Use a restrictive iframe sandbox if possible, for example start with `sandbox="allow-scripts allow-forms allow-popups"` and avoid `allow-same-origin` unless required.
- Any communication must be explicit `postMessage`, validated by origin `https://pi.dev`, and schema-validated.

### Pibo proxy iframe

Do not proxy `pi.dev/packages` HTML through Pibo just to bypass frame headers.

Risks:

- Cross-site scripting becomes same-origin with Pibo if proxied under `/api` or `/apps`.
- Relative scripts/assets/forms can execute with Pibo origin unless aggressively rewritten.
- CSP, cookies, redirects, service workers, and form targets become hard to reason about.
- It blurs trust boundaries and creates ongoing maintenance risk.

### Backend install endpoint

Current backend `POST /api/chat/pi-packages` accepts the same source parser as the CLI, including local paths. Before exposing add controls in the browser UI, local paths should be blocked or gated behind an explicit local-admin mode.

Reason:

- A web user should not be able to register arbitrary server-local paths by typing a path into the browser.
- UI add flow should initially accept only `https://pi.dev/packages/...` URLs.
- Keep local path registration CLI-only for V1.

### Package execution trust

Pi Package extensions execute code in the Pi runtime. UI must show this clearly near install/add actions.

Recommended UI copy:

```text
Extensions execute code in the Pi runtime. Review package source before adding it.
```

## Recommended Product Direction

### Recommended V1

Build a native Pibo package management surface. Do not build gallery discovery and do not use an iframe.

Reason:

- The iframe is blocked today by `X-Frame-Options: SAMEORIGIN`.
- Native UI can reuse existing `POST /api/chat/pi-packages`.
- Native UI can mark registered packages, offer add/remove buttons, and preserve Pibo's auth and validation boundaries.
- The desired workflow is explicit and simple: paste a trusted package detail URL, inspect metadata, then choose whether individual agents use it.

V1 UI:

- Add a `Pi Packages` management panel in Agent Designer.
- Add an input for `https://pi.dev/packages/...`.
- Add button registers the package and loads metadata.
- Show registered packages with rich metadata:
  - name
  - description
  - version
  - source URL
  - install spec
  - repository/source-code URL when available
  - resource types
  - extension paths
  - skill names
  - prompt names
  - theme names
  - discovered tool names when available
  - install status
  - diagnostics
- Registered packages can be globally enabled/disabled without removal.
- Remove/unregister button deletes the package registration after confirmation.
- Per-agent toggles remain separate: an enabled registered package can be selected for one custom agent and not selected for another.
- A globally disabled package must not load for any agent, even if an older custom agent still has it selected.

### Deferred Discovery

Do not implement these in the next iteration:

- `pibo pi-packages search <query>`
- `pibo pi-packages gallery`
- iframe gallery
- HTML scraping of `pi.dev/packages`

### Future iframe Option

Only revisit iframe if `pi.dev` supports one of these:

- Removes/changes frame policy to allow Pibo origins.
- Provides an official embeddable gallery route.
- Provides a `postMessage` contract such as:

```ts
type PiPackageGalleryMessage =
  | { type: "pi-package:selected"; source: string; name?: string }
  | { type: "pi-package:add-requested"; source: string; name?: string };
```

Then Pibo can:

- Embed the official gallery.
- Listen only to messages from `https://pi.dev`.
- Validate `source` starts with `https://pi.dev/packages/`.
- Call `POST /api/chat/pi-packages`.
- Refresh `GET /api/chat/agent-catalog`.

## Suggested Implementation Plan

### Phase 1: Data Model Hardening

Files:

- `src/pi-packages/types.ts`
- `src/pi-packages/store.ts`
- `src/pi-packages/runtime.ts`
- `src/apps/chat/web-app.ts`

Backend changes:

- Add a package registration state, for example:

```ts
enabled: boolean;
```

- Default `enabled` to `true` for existing and newly added packages.
- Extend existing API support to update package registration state:

```text
PATCH /api/chat/pi-packages/:id
```

Current `PATCH` refreshes package metadata/source; it does not yet persist `enabled`.

- Runtime rule:
  - registered and enabled + selected by profile => load
  - registered but disabled + selected by profile => do not load, emit warning diagnostic
  - not registered + selected by profile => current error behavior

Verify:

- Disabled registered package does not load for any runtime.
- Disabled selected package appears in profile/runtime diagnostics.
- Existing `.pibo/pi-packages.json` files without `enabled` migrate/read as enabled.

### Phase 2: UI Add/Remove/Disable Without Search

Files:

- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat/web-app.ts`

Backend:

- Keep existing `POST /api/chat/pi-packages`.
- Add a UI-specific validation path or option that rejects local paths for browser-origin adds.
- Keep `DELETE /api/chat/pi-packages/:id`.
- Add `PATCH /api/chat/pi-packages/:id` for enable/disable and metadata refresh if needed.

Frontend:

- Add API helpers:
  - `postPiPackage(source: string)`
  - `patchPiPackage(id: string, input: { enabled?: boolean })`
  - `deletePiPackage(id: string)`
- Add Agent Designer controls:
  - text input for `https://pi.dev/packages/...` package URL
  - add button
  - enable/disable action per registered package
  - remove/unregister action per registered package
  - expand/details action per package
  - status/error display
- After add/remove:
  - refresh catalog/bootstrap cache
  - keep draft selection consistent
- If a selected package is globally disabled, show that state in the per-agent package toggle row.
- If a package is removed, remove it from the current draft selection.

Verify:

- Add wrong web URL returns clear error.
- Add `https://pi.dev/packages/pi-web-access` registers package.
- Registered package appears in catalog and Agent Designer with metadata.
- Disable package makes it unavailable for runtime loading but keeps the registration visible.
- Re-enable package makes it selectable/loadable again.
- Remove package removes it from catalog and draft selection.
- Saving a custom agent with selected package persists.

### Phase 3: Rich Metadata Presentation

Frontend metadata display should make package trust and behavior inspectable:

- Primary row:
  - package name
  - version
  - enabled/disabled
  - selected for current agent
  - resource summary, for example `extension + skill`
- Detail area:
  - description
  - `source`
  - `installSpec`
  - repository/source URL as external link
  - lists for skills/prompts/themes/extensions
  - discovered tools if present
  - diagnostics grouped by info/warning/error
  - warning text that extensions execute code in the Pi runtime

### Phase 4: iframe Revisit

Only if upstream supports embedding/postMessage.

Do not implement a Pibo HTML proxy unless there is an explicit security review and a strong reason to accept the same-origin script risk.

## Acceptance Criteria

- User can add a package from Agent Designer with a `https://pi.dev/packages/...` URL.
- User can remove a registered package from Agent Designer.
- User can disable a registered package without removing it.
- Disabled packages remain visible but do not load into runtimes.
- Already registered packages are visibly marked.
- Package metadata is rich enough to inspect what the package does before selecting it for an agent.
- Package toggles remain per-agent and persist through save/reload.
- Browser-origin add flow rejects local paths.
- Wrong web URLs still produce the existing clear validation error.
- No iframe proxy of untrusted third-party HTML is introduced.
- No website discovery/search is introduced in this iteration.

## Open Questions

- Should remove be global registration removal, or should UI call it "Unregister" to avoid implying package files are deleted?
- Should adding from Agent Designer auto-select the package for the current draft agent, or only register it?
- Should disable be called `Disable`, `Deactivate`, or `Hide from agents` in the UI?
- Should metadata refresh be a separate button, or should add/update always refresh metadata?
