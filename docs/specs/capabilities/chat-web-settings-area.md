# Spec: Chat Web Settings Area

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Model Provider Auth and Session Model Selection](./model-provider-auth-and-session-selection.md), [Pibo Pi Packages](./pi-packages.md), [User Skills](./user-skills.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md)

## Why

Chat Web is the primary place where a user changes runtime-affecting preferences after a Pibo session already exists. Those settings combine browser-local display preferences, app context user settings, workspace-scoped model defaults, provider credential actions, Pi Package registration, and user-skill management.

This area needs its own behavior contract because it coordinates several lower-level capabilities. A settings change must be safe, authenticated, scoped to the right persistence boundary, and reflected in the catalog or runtime context without confusing browser-only preferences with product state.

## Goal

Chat Web MUST provide a settings workbench whose panels expose runtime preferences, provider authentication, Pi Packages, and user skills through authenticated, same-origin actions while preserving the distinct storage and security semantics of each setting type.

## Background / Current State

`src/apps/chat-ui/src/App.tsx` defines the top-level `settings` area and the `general`, `pi-packages`, `skills`, and `providers` panels. General settings include browser-local thinking display toggles, app context timezone, and workspace-scoped runtime model defaults. The Providers panel in `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx` calls routed session actions for login, API-key, status, and logout operations.

`src/apps/chat/web-app.ts` exposes authenticated settings endpoints under `/api/chat`, including `model-defaults`, `user-settings`, `pi-packages`, and `user-skills`. `src/core/user-settings.ts` persists app context user settings under the Pibo home. Pi Packages and user skills synchronize back into the capability catalog so Custom Agents and runtimes can select them.

## Scope

### In Scope

- Settings area routing and panel selection for General, Pi Packages, Skills, and Providers.
- Browser-local thinking display preferences.
- Controller-scoped timezone setting and runtime-context propagation.
- Workspace-scoped main-agent and subagent model defaults, thinking defaults, and fast-mode defaults.
- Provider credential status, OAuth/API-key actions, and logout entry points from Chat Web.
- Pi Package list, create, update, enable/disable, and delete behavior as exposed in the settings area.
- User skill list, create, install, edit, enable/disable, and delete behavior as exposed in the settings area.
- Catalog invalidation after settings changes that affect selectable runtime capabilities.

### Out of Scope

- The internal provider login implementations — covered by the model-provider spec.
- Pi Package source inspection and runtime loading semantics — covered by the Pi Packages spec.
- User skill markdown parsing and runtime expansion semantics — covered by the User Skills spec.
- Route canonicalization outside the settings area — covered by the browser shell-state spec.
- Per-setting multi-user ACLs beyond authenticated controller scoping.

## Requirements

### Requirement: Settings panels are URL-addressable and bounded

The Settings area MUST expose only the supported settings panels and MUST route unknown or absent panel selections to the General panel.

#### Current

`ChatAppRoute` accepts `settings` with an optional panel. `SettingsSidebar` lists `general`, `pi-packages`, `skills`, and `providers`; `SettingsContent` renders one of those four panels.

#### Target

Users and agents can deep-link to a settings panel without relying on hidden browser state, and unsupported settings panels cannot render arbitrary content.

#### Acceptance

- `/settings` renders General settings.
- `/settings/pi-packages` renders Pi Packages settings.
- `/settings/skills` renders Skills settings.
- `/settings/providers` renders Providers settings.
- An unsupported settings subpath falls back to a known route or error behavior managed by the router, not to an untyped panel.

#### Scenario: Deep link to Providers

- GIVEN the user is authenticated in Chat Web
- WHEN the browser opens `/settings/providers`
- THEN the Providers panel is selected
- AND the settings sidebar marks Providers active.

### Requirement: Browser display preferences remain browser-local

Thinking display controls MUST be stored in browser local storage and MUST NOT mutate server-side user settings or runtime defaults.

#### Current

General settings toggles `pibo.chat.showThinking` and `pibo.chat.expandThinking` directly in `localStorage`. These values affect terminal rendering, not runtime creation.

#### Target

A user can change how thinking blocks render in one browser without changing future runtime inputs or another browser's settings.

#### Acceptance

- Toggling `Show thinking blocks` writes only `pibo.chat.showThinking` in browser storage.
- Toggling `Expand thinking blocks` writes only `pibo.chat.expandThinking` in browser storage.
- The expand toggle is disabled when thinking blocks are hidden.
- No `/api/chat/user-settings` or `/api/chat/model-defaults` request is required for these toggles.

#### Scenario: Local thinking display change

- GIVEN a session has thinking output
- WHEN the user enables `Show thinking blocks`
- THEN thinking blocks become visible in that browser
- AND no runtime model or user setting is changed on the server.

### Requirement: User timezone is app-context and validated

The timezone setting MUST be saved for the app context, MUST reject invalid timezone values, and MUST be available to later runtime context assembly.

#### Current

`GET /api/chat/user-settings` loads app context settings. `PATCH /api/chat/user-settings` validates `timezone` with `sanitizeTimezone` and persists it through `updatePiboUserSettings` under the app context compatibility key. `UserTimezoneSettings` autosaves select changes and displays save errors.

#### Target

Changing timezone affects the user's future runtime context without changing other controllers or browser-only preferences.

#### Acceptance

- Loading General settings returns the app context timezone or `UTC` by default.
- Saving a valid IANA timezone persists it for the app context.
- Saving an invalid timezone returns a 4xx error and does not overwrite the previous timezone.
- Later runtime creation injects the selected timezone into `pibo://runtime/session-context.md`.

#### Scenario: Invalid timezone rejected

- GIVEN the authenticated user's timezone is `Europe/Berlin`
- WHEN the browser sends `PATCH /api/chat/user-settings` with `timezone: "Mars/Base"`
- THEN the server returns a client error
- AND subsequent reads still report `Europe/Berlin`.

### Requirement: Runtime model defaults are workspace-scoped and catalog-aware

The General panel MUST save model, thinking, and fast defaults through the model-defaults API and MUST present only configured providers for runtime defaults.

#### Current

`ModelDefaultsSettings` calls `PATCH /api/chat/model-defaults` for main-agent and subagent defaults. `ModelSelector` can filter to `authConfigured` providers and shows stale provider/model labels when a saved default is no longer in the configured catalog.

#### Target

Runtime defaults are persisted as product state for the current workspace and cannot silently select an unauthenticated provider from the settings UI.

#### Acceptance

- Main-agent and subagent defaults can each save model, thinking level, and fast-mode state.
- The selector supports an unset state that delegates to provider fallback.
- Configured-only model selectors omit unauthenticated providers from normal choices.
- A saved but now-unavailable provider or model is visibly stale rather than silently replaced.
- Successful saves invalidate or update catalog-backed UI state.

#### Scenario: Provider loses authentication

- GIVEN the main-agent default references a provider that was previously configured
- WHEN that provider becomes unconfigured
- THEN the model selector no longer offers it as a normal choice
- AND the saved value is shown as stale or not configured until the user changes it.

### Requirement: Provider credential actions require a selected Pibo Session

The Providers panel MUST use routed session actions for provider login and logout and MUST show a blocked state when no Pibo Session is selected.

#### Current

`ProviderSettingsView` returns `Select a chat session to manage provider authentication` when `piboSessionId` is missing. With a session, it calls `postAction` for `login.status`, `login.start`, `login.complete`, `login.apikey`, and `logout`.

#### Target

Provider credential actions are correlated with a Pibo Session and gateway action context instead of being anonymous browser mutations.

#### Acceptance

- With no selected session, the Providers panel displays an instructional disabled state.
- Loading the panel with a selected session requests provider status through `login.status`.
- OAuth start shows the returned URL, state, user code, instructions, or flow details without marking the provider configured.
- OAuth completion marks only the completed provider configured and clears the entered code.
- API-key save does not display the key after a successful save.
- Logout marks the provider unconfigured after the action succeeds.

#### Scenario: Save API key

- GIVEN a selected Pibo Session exists
- WHEN the user enters an OpenAI API key and saves it
- THEN Chat Web sends a `login.apikey` action for the selected session
- AND the provider row reports configured after the action succeeds
- AND the input is cleared.

### Requirement: Runtime capability settings synchronize catalog state

Pi Package and User Skill changes made from Settings MUST update the underlying store and refresh catalog-dependent UI after successful mutations.

#### Current

The web app handlers for `/api/chat/pi-packages` and `/api/chat/user-skills` call store or manager methods, synchronize enabled user skills into the plugin registry, and invalidate the bootstrap catalog cache. The React settings views call mutation handlers that update local lists after successful responses.

#### Target

Agents and custom-agent forms see newly added, enabled, disabled, or removed capabilities without requiring a manual gateway restart.

#### Acceptance

- Adding, updating, enabling, disabling, or deleting a Pi Package invalidates the bootstrap catalog cache.
- Creating, installing, updating, enabling, disabling, or deleting a user skill synchronizes the user-skill catalog and invalidates the bootstrap catalog cache.
- Deleting a Pi Package selected by a custom agent fails with conflict and names affected agents.
- Enabling a user skill whose name conflicts with another registered skill fails before the catalog is polluted.
- The Settings UI updates its package or skill list only after a successful server response.

#### Scenario: Delete selected Pi Package is blocked

- GIVEN a custom agent selects Pi Package `pkg-a`
- WHEN the user tries to delete `pkg-a` from Settings
- THEN the API returns a conflict naming the affected custom agent
- AND the package remains registered.

## Edge Cases

- Browser storage may be unavailable; browser-local preferences should degrade without blocking authenticated settings APIs.
- A provider action may fail after a row has entered a loading state; the row must return to an actionable state and show the error.
- A saved model default may reference a provider or model that has been removed from the catalog.
- User skill installation may create a temporary skill that must be removed if catalog-name validation fails.
- Settings panels that depend on bootstrap catalog data must handle missing or still-loading catalog data.

## Constraints

- **Compatibility:** Settings routes must preserve existing `/settings`, `/settings/pi-packages`, `/settings/skills`, and `/settings/providers` links.
- **Security / Privacy:** Server mutations must require authenticated sessions and same-origin JSON checks where applicable. API-key values must not be echoed back into persistent browser UI after save.
- **Persistence:** Browser display preferences stay in browser local storage; user timezone is app-context state in Pibo home; model defaults are workspace-scoped; packages and skills use their existing product stores.
- **Dependencies:** Provider actions require a selected routed Pibo Session and the gateway action registry.

## Success Criteria

- [ ] SC-001: Each settings panel can be opened directly by URL and shows the correct active sidebar item.
- [ ] SC-002: Thinking display toggles change only browser-local state.
- [ ] SC-003: Invalid timezone saves fail without overwriting the previous app context timezone.
- [ ] SC-004: Runtime model default selectors omit unauthenticated providers from normal choices and preserve visible stale values.
- [ ] SC-005: Provider login, API-key, status, and logout actions are unavailable without a selected Pibo Session and routed through gateway actions with one.
- [ ] SC-006: Package and skill mutations refresh catalog-dependent UI and enforce conflict checks.

## Assumptions and Open Questions

### Assumptions

- The current React Router route definitions map the settings subpaths described by `navigateToRoute`.
- The selected Pibo Session is the intended correlation context for provider login actions in Chat Web.
- Existing lower-level specs remain authoritative for the internal semantics of provider auth, Pi Packages, and user skills.

### Open Questions

- Should provider credential management have a app context API that does not require selecting a chat session, or is session-action routing a deliberate product constraint?
- Should browser-local thinking display preferences eventually migrate to app context settings for multi-device consistency?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001: Settings panels are URL-addressable and bounded | Deep link to Providers | Source coverage | Pending |
| REQ-002: Browser display preferences remain browser-local | Local thinking display change | Source coverage | Pending |
| REQ-003: User timezone is app-context and validated | Invalid timezone rejected | Source coverage | Pending |
| REQ-004: Runtime model defaults are workspace-scoped and catalog-aware | Provider loses authentication | Source coverage | Pending |
| REQ-005: Provider credential actions require a selected Pibo Session | Save API key | Source coverage | Pending |
| REQ-006: Runtime capability settings synchronize catalog state | Delete selected Pi Package is blocked | Source coverage | Pending |

## Verification Basis

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx`
- `src/apps/chat/web-app.ts`
- `src/core/user-settings.ts`
- `src/core/model-defaults.ts`
- `src/pi-packages/store.ts`
- `src/user-skills/manager.ts`
