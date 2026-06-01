# Spec: User Skills

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/runtime-prompt-and-compaction.md`

## Why

Users need reusable instruction packages that can be created, edited, installed, selected by Custom Agents, and loaded into runtimes without changing plugin source code. These skills must remain distinct from plugin-shipped skills so user-owned behavior can evolve locally while preserving capability catalog integrity.

## Goal

Pibo MUST manage user skills as durable local `SKILL.md` resources, expose them through CLI and Chat Web APIs, synchronize enabled skills into the runtime capability catalog, and expand selected skill content only when a profile chooses it.

## Background / Current State

Current code stores user skill metadata in `.pibo/user-skills.json` and each skill body in `.pibo/user-skills/<name>/SKILL.md` under the configured user-skill root. The `pibo skills` CLI and Chat Web create `UserSkillManager` with `os.homedir()`, so current user skills are user-home resources rather than workspace-local resources. `UserSkillManager` wraps store operations and remote installation. `pibo skills` provides CLI management. Chat Web exposes `/api/chat/user-skills*` endpoints and a Settings skills panel. Enabled user skills are synchronized into the channel capability registry as `kind: "user"` entries and then become selectable by Custom Agents.

Skill descriptions live in `SKILL.md` frontmatter. The JSON store keeps identity, path, enabled state, source, source URL, and timestamps. Runtime inline expansion can append referenced skill content for `$skill-name` tokens from the runtime resource loader.

## Scope

### In Scope

- Local user skill storage, metadata, and `SKILL.md` frontmatter behavior.
- CLI commands under `pibo skills`.
- Chat Web user-skill CRUD and install APIs.
- Synchronization of enabled user skills into the capability catalog.
- Custom Agent selection of user skills by name.
- Runtime availability and inline expansion of selected skill content.

### Out of Scope

- Plugin-shipped skills — specified by the Plugin Registry and Capability Catalog spec.
- Managed Context Files — specified separately because they are not skill packages.
- Remote marketplace trust, signature verification, or sandboxing — current code downloads from supported sources without a trust policy.
- Skill authoring quality rules — this spec covers storage and selection behavior, not prose quality.

## Requirements

### Requirement: User skills are durable local resources

The system MUST store user skill metadata in the local Pibo store and store skill content in a `SKILL.md` file owned by that skill.

#### Current

`src/user-skills/store.ts` uses `.pibo/user-skills.json` and `.pibo/user-skills/<name>/SKILL.md` under the configured cwd. A missing store loads as an empty versioned store.

#### Acceptance

- Creating a skill creates the skill directory and `SKILL.md` file.
- The JSON store persists id, name, path, enabled state, source, source URL when present, and timestamps.
- Loading a missing store returns an empty `version: 1` store.
- Loading malformed or unsupported store data fails with an explicit error.

#### Scenario: Fresh workspace

- GIVEN a workspace with no `.pibo/user-skills.json`
- WHEN user skills are listed
- THEN the result is an empty list, not an error

### Requirement: Skill names are stable kebab-case capability keys

The system MUST validate user skill names before creating or renaming skills and MUST reject duplicate names.

#### Current

`validateSkillName` trims names, requires lowercase kebab-case beginning with a letter, caps length at 64 characters, and checks for existing store entries.

#### Acceptance

- Empty names, overlong names, non-kebab names, and duplicate names are rejected.
- Name lookup accepts either skill id or skill name.
- Renaming updates the stored path and moves existing skill files to the new skill directory.

#### Scenario: Duplicate local skill

- GIVEN a user skill named `review-helper`
- WHEN another skill is created with the same name
- THEN creation fails and the original skill remains unchanged

### Requirement: Frontmatter owns user-visible description

The system MUST treat `SKILL.md` frontmatter as the source of truth for name and description content while keeping persisted JSON metadata compact.

#### Current

`createUserSkill` and `updateUserSkill` parse simple frontmatter. Descriptions are stripped before JSON persistence and read back from `SKILL.md` when listing or finding skills.

#### Acceptance

- A description supplied in API/CLI input is written to `SKILL.md` frontmatter.
- If no explicit description is supplied, imported markdown frontmatter can provide it.
- List and show operations report descriptions from `SKILL.md`.
- JSON store entries do not need a duplicated description field.

#### Scenario: Imported markdown has frontmatter

- GIVEN markdown with `description: Frontend review helper.` in frontmatter
- WHEN the skill is created with no separate description
- THEN the listed skill has description `Frontend review helper.`
- AND the generated `SKILL.md` contains exactly one frontmatter block

### Requirement: CLI manages user skills directly

The `pibo skills` CLI MUST provide direct local operations for listing, showing, adding, removing, enabling, disabling, and installing user skills.

#### Current

`src/skills/cli.ts` implements `list`, `show`, `add --file`, `remove`, `enable`, `disable`, and `install` using `UserSkillManager` rooted at the operator home directory.

#### Acceptance

- `pibo skills list` prints an empty-state message when no skills exist.
- `show`, `remove`, `enable`, and `disable` return a non-zero exit code when the skill is unknown.
- `add --file` reads markdown from disk and returns created skill metadata as JSON.
- `install` returns installed skill id, name, and source as JSON.

#### Scenario: Unknown skill show

- GIVEN no skill named `missing-helper`
- WHEN an operator runs `pibo skills show missing-helper`
- THEN the CLI prints a not-found error and sets a failure exit code

### Requirement: Remote installation accepts only supported skill sources

The system MUST install remote skills only from supported URL and shorthand forms and MUST fail without leaving partial skill directories when download fails.

#### Current

`parseSkillUrl` accepts `https://skills.sh/...`, GitHub repository or tree URLs, and non-HTTP owner/repo shorthand. The installer searches common skill directories, downloads the selected GitHub directory, and cleans up the target directory on failure.

#### Acceptance

- Unsupported URL formats are rejected before download.
- Installed skills require a `SKILL.md` file.
- Existing target directories or duplicate installed skill names are rejected.
- A failed download removes the partially created target directory when possible.

#### Scenario: Download has no skill file

- GIVEN a supported repository URL whose resolved directory lacks `SKILL.md`
- WHEN installation completes the download step
- THEN installation fails
- AND no registered user skill remains in the store

### Requirement: Chat Web user-skill APIs are authenticated same-origin JSON endpoints

Chat Web MUST expose user skill management only to authenticated web sessions and MUST require same-origin JSON requests for mutations.

#### Current

`src/apps/chat/web-app.ts` requires `requireSession` for user-skill reads and mutations, and calls `requireSameOriginJsonRequest` for create, install, patch, and delete.

#### Acceptance

- `GET /api/chat/user-skills` returns the current user skill list for an authenticated session.
- `GET /api/chat/user-skills/:id` returns skill metadata and markdown or 404.
- `POST`, `PATCH`, `DELETE`, and install requests reject unauthenticated or non-same-origin JSON requests.
- Invalid names, markdown, enabled values, and install URLs return 400-level errors.

#### Scenario: Cross-site mutation

- GIVEN an authenticated browser session
- WHEN a cross-site request attempts `POST /api/chat/user-skills`
- THEN the server rejects the mutation before creating a skill

### Requirement: Enabled user skills synchronize into the capability catalog

The system MUST register enabled user skills as user-owned skill capabilities and unregister disabled or removed user skills.

#### Current

`syncUserSkills` reads the user skill list, registers enabled skills through `channelContext.registerSkill({ kind: "user" })`, unregisters previously synced names that are no longer enabled, and avoids duplicate registration for already synced names.

#### Acceptance

- Enabled user skills appear in the capability catalog as `kind: "user"` without plugin attribution.
- Disabled or removed user skills no longer appear as selectable user skills after synchronization.
- Repeated synchronization is idempotent and does not trip duplicate registry guards.
- Enabling, creating, installing, or renaming a user skill to a name that conflicts with an existing catalog skill is rejected or rolled back.

#### Scenario: Disable selected skill

- GIVEN an enabled user skill `review-helper` appears in the capability catalog
- WHEN the skill is disabled through Chat Web
- THEN synchronization unregisters `review-helper`
- AND the next agent catalog response does not list it as an enabled selectable skill

### Requirement: Custom Agents select user skills by capability name

Custom Agents MUST select user skills by the same name shown in the capability catalog and MUST skip missing skills without breaking profile creation.

#### Current

Custom Agent profile construction uses selected skill names against the profile build context. Existing custom-agent behavior skips unknown skills with warnings and serializes broken context-file references separately.

#### Acceptance

- A Custom Agent can save a user skill name from the catalog in its `skills` selection.
- A runtime created from that Custom Agent includes the selected enabled user skill.
- If a selected user skill is later disabled or deleted, profile construction does not fail the entire agent runtime.
- The catalog is invalidated after user skill create, install, update, or delete so the UI can refresh choices.

#### Scenario: Deleted selected skill

- GIVEN a Custom Agent selects `review-helper`
- AND `review-helper` is deleted
- WHEN the Custom Agent profile is created
- THEN runtime creation continues with remaining valid capabilities
- AND `review-helper` is not loaded

### Requirement: Runtime inline expansion loads selected skill bodies safely

When runtime text references selected skills with `$skill-name`, the system MUST append the matching skill body from the runtime resource loader and MUST not expand unknown or escaped references.

#### Current

`expandInlineSkills` scans unescaped `$name` tokens, finds matching runtime skills, reads each skill file once, strips frontmatter, and appends content. Read failures append an explicit load-error marker.

#### Acceptance

- Each referenced selected skill is expanded at most once per input text.
- Escaped references such as `\$review-helper` are left untouched.
- Unknown references are left untouched and do not fail runtime processing.
- A missing skill file produces an explicit expansion error block rather than throwing.

#### Scenario: Escaped and unknown references

- GIVEN selected skill `review-helper`
- WHEN input contains `$review-helper`, `\$review-helper`, and `$unknown-helper`
- THEN only `review-helper` content is appended
- AND escaped or unknown references do not add extra skill bodies

## Edge Cases

- A skill file may be missing while store metadata remains; `getSkillMarkdown` returns an empty string and list descriptions fall back to empty description.
- A disabled skill can remain in the local store but must not be registered as a runtime capability.
- A remote install can download a directory whose `SKILL.md` frontmatter name differs from the directory name; the stored skill name follows parsed frontmatter when present.
- A renamed skill may leave filesystem copy artifacts if the move process is interrupted; the store path is still the product metadata source.
- A user skill name can conflict with a plugin skill or another dynamically registered skill; Chat Web must reject enabling or creating that conflict.

## Constraints

- **Compatibility:** The user skill store version is currently `1`; unsupported versions fail explicitly.
- **Security / Privacy:** Chat Web mutations require authenticated same-origin JSON requests. Remote installs fetch unaudited public content and must not imply trust.
- **Performance:** Listing skills reads each `SKILL.md` description; skill files should stay small enough for runtime context use.
- **Context Economy:** User skills are loaded into runtimes only when selected by a profile or referenced for inline expansion.
- **Dependencies:** Remote install depends on GitHub content APIs for GitHub-backed sources.

## Success Criteria

- [ ] SC-001: Creating, listing, finding, updating, disabling, enabling, and deleting local user skills preserve store and `SKILL.md` invariants.
- [ ] SC-002: `pibo skills` commands expose the local user skill lifecycle and report missing skills as failures.
- [ ] SC-003: Chat Web user-skill mutations require authenticated same-origin JSON requests and invalidate the agent catalog.
- [ ] SC-004: Enabled user skills appear in the capability catalog as `kind: "user"`; disabled or removed skills do not.
- [ ] SC-005: Custom Agent runtimes load selected enabled user skills and tolerate missing selected skills.
- [ ] SC-006: Inline `$skill-name` expansion appends selected skill bodies once, ignores unknown or escaped tokens, and reports file read failures inline.

## Assumptions and Open Questions

### Assumptions

- User skills are local user-home product resources, not app-spaced database records or workspace-local records, in the current CLI and Chat Web implementation.
- The current simple YAML parser only needs key/value frontmatter for `name` and `description`.
- Remote source trust will be specified separately if Pibo adds signatures, review, or allowlists.

### Open Questions

- Should user skills become app-spaced or workspace-scoped records instead of `os.homedir()` resources?
- Should deleting or disabling a skill warn when Custom Agents currently select it?
- Should remote installation support branches other than the default branch through GitHub API URLs?
- Should skill markdown size be bounded at API and CLI input boundaries?

## Traceability

| Requirement | Scenario / Story | Code / Test Basis | Status |
|---|---|---|---|
| REQ-001 User skills are durable local resources | Fresh workspace | `src/user-skills/store.ts`, `test/user-skills.test.mjs` | Specified |
| REQ-002 Skill names are stable kebab-case capability keys | Duplicate local skill | `src/user-skills/store.ts`, `src/apps/chat/web-app.ts` | Specified |
| REQ-003 Frontmatter owns user-visible description | Imported markdown has frontmatter | `src/user-skills/store.ts`, `test/user-skills.test.mjs` | Specified |
| REQ-004 CLI manages user skills directly | Unknown skill show | `src/skills/cli.ts`, `src/user-skills/manager.ts` | Specified |
| REQ-005 Remote installation accepts only supported skill sources | Download has no skill file | `src/user-skills/installer.ts` | Specified |
| REQ-006 Chat Web user-skill APIs are authenticated same-origin JSON endpoints | Cross-site mutation | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/api.ts` | Source-backed |
| REQ-007 Enabled user skills synchronize into the capability catalog | Disable selected skill | `src/apps/chat/web-app.ts`, `src/plugins/registry.ts` | Source-backed |
| REQ-008 Custom Agents select user skills by capability name | Deleted selected skill | `src/apps/chat/agent-profiles.ts`, `src/apps/chat/web-app.ts` | Specified |
| REQ-009 Runtime inline expansion loads selected skill bodies safely | Escaped and unknown references | `src/core/skill-expansion.ts`, `src/core/routed-session.ts` | Specified |

## Verification Basis

- `npm test -- --test-name-pattern="user skill"` for store/frontmatter behavior when the project test runner supports filtering.
- `npm run typecheck` for API and profile integration type safety.
- `test/skills-cli.test.mjs` for CLI help, JSON list output, and frontmatter description parsing.
- Manual CLI checks with `pibo skills list`, `add`, `show`, `enable`, `disable`, and `remove` in a temporary user home.
- Manual Chat Web checks against `/api/chat/user-skills` with authenticated same-origin requests.
