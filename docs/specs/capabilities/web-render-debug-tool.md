# Spec: Web Render Debug Tool

**Status:** Draft
**Created:** 2026-05-16
**Controller / Source:** User request in Pibo Session `ps_042af0fc-2e94-4ea4-9fb4-074cf674e9d6`
**Related docs:** [Debug CLI](./debug-cli.md), [Chat Web Bootstrap and Navigation API](./chat-web-bootstrap-and-navigation-api.md), [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Chat Web Cache and Live State](./chat-web-cache-and-live-state.md), [Chat Web Trace Render Diagnostics](./chat-web-trace-render-diagnostics.md), [Browser Use Authenticated Leases](./browser-use-authenticated-leases.md), [Browser Automation Desktop Environment](./browser-automation-desktop-environment.md)

## Why

Agents cannot reliably debug fast frontend state transitions with screenshots alone. Chat Web has optimistic UI updates, route changes, live streams, virtualized lists, and background refetches. These can create short flickers: a DOM node appears, disappears, reappears with another id, changes class, or remounts before a screenshot captures the final state.

The concrete failure case is new-session creation. Chat Web creates an optimistic session, selects it, navigates into the chat surface, replaces the temporary session with the real Pibo Session, may auto-rename it, and refreshes navigation data. When this sequence jumps, an agent sees only the final screenshot and cannot tell whether the sidebar, route, selected state, React render path, or cache refresh caused the jump.

Pibo needs an opt-in debug tool that watches browser render state over time and reports compact diffs. The tool must preserve agent context by default. It must show what changed, when it changed, and which app-state or React-render signal likely caused the visible change.

## Goal

Pibo MUST provide an opt-in Web Render Debug Tool that attaches to a browser target, captures scoped DOM/accessibility/render-state snapshots over time, and emits bounded diffs that let agents diagnose Chat Web render jumps without relying on screenshots.

## Background / Current State

Pibo already has several pieces adjacent to this need:

- `pibo debug` provides read-oriented diagnostics for local Pibo stores and trace state.
- Browser Use tooling can acquire authenticated Chat Web browser leases and inspect a page with screenshots, state, and CDP-backed commands.
- Chat Web has trace render diagnostics for trace-row consistency, but those diagnostics target trace projection and replay, not general DOM, layout, React render, or optimistic navigation behavior.
- `src/apps/chat-ui/src/renderMetrics.ts` counts component renders in development, but it does not produce a correlated DOM timeline.

A local review of Vercel Labs Agent Browser showed useful patterns for agent-facing browser debugging: compact accessibility snapshots, short element refs, line-based snapshot diffs, annotated screenshots, CDP attachment, and React render profiling through a React DevTools hook. It does not provide a complete DOM mutation timeline or Pibo-specific optimistic-state explanation. Pibo should reuse the output patterns, not depend on Agent Browser as the only solution.

## Scope

### In Scope

- A progressively discoverable CLI surface under `pibo debug web` or an equivalent debug command group.
- Browser target discovery and attachment through CDP, including existing authenticated Chat Web browser targets and Docker compute-worker browsers.
- Scoped point-in-time snapshots of DOM, accessibility, selected computed state, focus, route, and visible layout boxes.
- Diff-first output between snapshots.
- Watch mode that records DOM mutations and relevant layout/style/focus changes over a bounded time window.
- Chat Web debug anchors for stable element identity on important surfaces such as session lists, selected sessions, composer, route shell, and message/trace containers.
- Optional React render tracing that records component renders, render counts, mount/remount events, basic render reasons, and DOM-mutation correlation.
- Optional Pibo app-state markers for session selection, navigation, TanStack Query/cache updates, mutation lifecycle, bootstrap refreshes, and auto-rename events.
- Scenario workflows for high-value Chat Web bugs, starting with new-session creation.
- Text output optimized for agents and JSON/JSONL artifacts for deeper offline analysis.
- Redaction, size limits, time limits, and local-only artifacts.

### Out of Scope

- Product analytics or always-on telemetry — this tool is for explicit debugging only.
- Automatic upload of DOM snapshots, screenshots, or timeline artifacts to Pibo services.
- Replacing Browser Use, Chrome DevTools, Playwright, or screenshots for normal browser automation.
- Full pixel-perfect visual regression testing.
- Complete React DevTools replacement.
- Explaining every browser paint, layout, and style recalculation in Chrome trace format.
- Persisting debug data in normal Pibo Session, room, or trace stores.
- Production user-facing UI changes beyond inert debug attributes and opt-in debug hooks.

## Concepts

### Render Debug Session

A short-lived local debug run against one browser target. It has a target tab, optional app name, scope selector, start time, duration, output budget, and artifact directory.

### Snapshot

A compact representation of a page region at one point in time. It may contain DOM nodes, accessibility nodes, selected classes/attributes, text previews, focus state, route state, visible bounding boxes, and app-state markers.

### Timeline Event

A timestamped event produced during watch mode. Events include DOM node additions/removals, attribute changes, class changes, text changes, focus changes, route changes, layout-box changes, React render commits, and Pibo app-state markers.

### Diff

A compact comparison between two snapshots or between adjacent timeline windows. The default output prints only additions, removals, changes, suspected flickers, and summary counts.

### Debug Anchor

A stable `data-*` attribute or comparable identity marker that lets the tool identify important Chat Web elements without fragile CSS paths. Debug anchors must not affect layout or behavior.

## MVP Boundary and Requirement Levels

This spec defines the durable capability, but implementation MUST be staged. Requirements use the following levels:

- **MVP Required:** required for the first usable version. These requirements appear in Phase 1 and the MVP success criteria.
- **Capability Required:** required before the capability is considered complete, but not required for the DOM-watch MVP.
- **Optional / Adapter:** useful integrations that must not block the core Pibo workflow.

MVP Required behavior is limited to target discovery/attachment, scoped DOM snapshots, point-in-time diffs, bounded watch mode, stable Chat Web debug anchors, local artifacts, redaction, and compute-worker/browser-lease compatibility.

App-state markers and `scenario new-session` are Capability Required for this spec, but may ship after the MVP. React tracing, visual correlation, and Agent Browser interop are Optional / Adapter features.

## Default Budgets and Heuristics

The implementation may tune these values, but the first version SHOULD use concrete defaults so behavior is testable:

| Area | Default | Hard limit / rule |
|---|---:|---|
| Watch duration | 5 seconds | 30 seconds unless an explicit unsafe/deep flag exists |
| Printed stdout budget | 12,000 characters | Always summarize truncation |
| Snapshot node count | 250 nodes | Prefer changed/debug-anchored/interactive nodes before truncating |
| Snapshot depth | 8 levels | Depth limit is reported when reached |
| Timeline event count | 500 grouped events | Raw events are coalesced before this limit |
| Text preview | 80 characters per node | Values and message bodies are redacted by default |
| Artifact size | 10 MB per run | Larger runs require an explicit output/deep option |

Default snapshots treat these as important nodes:

- nodes with Pibo debug anchors
- interactive controls
- focused or selected nodes
- route/session/chat shell nodes
- visible text-bearing nodes inside the requested scope
- nodes that changed during diff or watch mode

Default captured attributes SHOULD be an allowlist, not all attributes. The allowlist SHOULD include `id`, `role`, `aria-*`, `data-pibo-*`, `data-testid`, `href` origin/path for links, `disabled`, `checked`, `selected`, `hidden`, `tabindex`, and a compact class summary.

A **suspected flicker** is a remove/add, hide/show, selected/unselected, text rollback, or class rollback involving the same logical element or visible label inside a 500 ms window. When stable identity is unavailable, the output MUST say that the flicker match is inferred.

A **remount-like change** is a remove/add pair where the logical identity, visible title, or Pibo id appears equivalent but the DOM identity changed.

## Required Chat Web Debug Anchors

The exact attribute names may evolve during design, but the following logical anchors are required for the Chat Web capability:

| Surface | Required identity | Required state markers |
|---|---|---|
| App shell / route shell | current area and route path | mobile/desktop mode when known |
| Room/sidebar shell | selected room id when available | sidebar open/closed on mobile |
| Session list root | room id or personal scope | loading/archived-visible state when available |
| Session row | Pibo Session ID or optimistic temp ID | selected, running/error/unread, archived when available |
| Main chat shell | selected Pibo Session ID or optimistic temp ID | loading/empty/error state when available |
| Composer | selected Pibo Session ID | empty/non-empty, disabled/focused state; value redacted |
| Message/trace/terminal container | selected Pibo Session ID and view id | loading/streaming state when available |
| Menus/dialogs/portals | owning action or surface | open/closed and selected item when available |

Debug anchors must not include tokens, cookies, full message text, model output, or provider credentials.

## Required Capability Surface and Illustrative Commands

The capability contract is behavioral, not tied to exact command names. The CLI MUST expose these actions somehow:

- list browser targets
- attach to a selected target or the best Chat Web target
- capture a scoped snapshot
- diff against a previous snapshot or artifact
- watch a scoped region for a bounded duration
- run the `new-session` Chat Web scenario
- export or locate local artifacts

The following commands are illustrative names for that surface:

```bash
pibo debug web --help
pibo debug web targets
pibo debug web attach-chat
pibo debug web snapshot --scope '[data-pibo-debug="session-list"]'
pibo debug web diff --scope '[data-pibo-debug="session-list"]'
pibo debug web watch --scope '[data-pibo-debug="chat-shell"]' --duration 5000
pibo debug web scenario new-session --duration 5000
pibo debug web react start
pibo debug web react stop
```

The root help MUST show only immediate subcommands and next steps. Detailed schemas and examples MUST live behind deeper help, schema, or guide commands.

## Output Model

### Default Text Output

Default output MUST be short, line-oriented, and optimized for an agent reading the current conversation. It MUST not dump full HTML.

Example new-session timeline:

```text
# Web Render Watch: chat-web new-session, 5.0s
# target: t3 /apps/chat/rooms/room_123/sessions/ps_old
# scope: [data-pibo-debug="chat-shell"]

0000ms action click role=button name="New Session"
0018ms state selectedPiboSessionId null -> optimistic-session-a7f
0021ms dom + @s4 session-item id=optimistic-session-a7f title="New Session" selected=true
0027ms dom ~ @main data-pibo-session-id: ps_old -> optimistic-session-a7f
0143ms api session.create success id=ps_123 tempId=optimistic-session-a7f
0151ms state selectedPiboSessionId optimistic-session-a7f -> ps_123
0154ms dom - @s4 session-item id=optimistic-session-a7f
0156ms dom + @s5 session-item id=ps_123 title="Untitled Session" selected=true
0162ms dom ~ @main data-pibo-session-id: optimistic-session-a7f -> ps_123
0918ms dom ~ @s5 title "Untitled Session" -> "New Chat"

Suspected flicker:
- session item remounted instead of preserving visual row identity
- main chat shell changed session id twice in 144ms
- bootstrap refresh landed after optimistic replacement

Summary: 3 adds, 1 removal, 5 updates, 2 state changes, 1 suspected flicker
Artifact: /.../web-render/2026-05-16T120102Z/new-session.jsonl
```

### JSON / JSONL Output

Machine-readable output MUST be available for offline analysis. JSONL is preferred for watch mode because it streams bounded events.

Each event SHOULD include:

- debug session id
- timestamp offset in milliseconds
- target id and URL
- scope selector
- event kind
- stable element id or fallback path
- short before/after values
- source category: `dom`, `ax`, `layout`, `focus`, `route`, `react`, `pibo-state`, `network`, or `action`
- redaction metadata when text or values are omitted

## Requirements

### Requirement: CLI discovery is progressive

The Web Render Debug Tool MUST follow Pibo's progressive CLI discovery rule.

#### Current

No dedicated `pibo debug web` surface exists. Agents currently combine Browser Use commands, screenshots, ad hoc CDP calls, and manual JavaScript snippets.

#### Target

An agent can discover the tool one level at a time, attach to a browser target, run a scoped snapshot, and then learn watch/scenario commands without receiving the full spec in help output.

#### Acceptance

- `pibo debug web --help` lists immediate actions only.
- `pibo debug web snapshot --help` lists snapshot options and a next command such as `diff` or `watch`.
- Unknown subcommands fail with a message that points to the nearest relevant help command.
- Help output does not print full schemas, long implementation notes, or unrelated Pibo context.

#### Scenario: Agent discovers watch mode

- GIVEN an agent knows only `pibo debug`
- WHEN it runs `pibo debug web --help`
- THEN it sees `targets`, `attach-chat`, `snapshot`, `diff`, `watch`, and `scenario`
- AND it sees a next-step command for detailed watch help.

### Requirement: Browser attachment is safe and explicit

The tool MUST attach to an existing browser target or a Pibo-managed debug browser without disturbing host production gateways or unrelated browser tabs.

#### Current

Browser debugging guidance prefers existing authenticated Chat Web tabs, Browser Use authenticated leases, and direct CDP fallback. Agents must manually find a usable target and avoid fake host auth infrastructure.

#### Target

The tool can list targets, identify likely Chat Web tabs, attach to a selected target, and report why no target is usable. It must work with Docker compute-worker web/CDP ports and with authenticated Browser Use leases.

#### Acceptance

- `targets` lists CDP targets with id, title, URL, app guess, and attachment status.
- `attach-chat` selects an authenticated Chat Web target only when it can detect a usable Chat Web shell or composer.
- If no authenticated target exists, the output points to the Browser Use lease/auth-template workflow instead of starting fake host auth.
- The tool never restarts host gateways or launches host dev-auth infrastructure.
- A disconnected target produces a bounded error and leaves artifacts readable.

#### Scenario: No usable Chat Web tab

- GIVEN CDP is reachable but no target contains an authenticated Chat Web shell
- WHEN an agent runs `pibo debug web attach-chat`
- THEN the command fails with a clear explanation
- AND it prints the next safe command to acquire or prepare a Browser Use authenticated lease.

### Requirement: Snapshots are scoped and compact

The tool MUST capture only the requested page scope by default and MUST summarize nodes in a compact agent-readable form.

#### Current

Screenshots show final pixels. Raw HTML dumps are too large and often omit visible timing. Browser Use state is useful but not specialized for short-lived DOM diff analysis.

#### Target

A snapshot of a scope shows stable element ids, roles/names when available, relevant attributes, selected classes, short text previews, focus state, and bounding boxes when requested. The tool omits irrelevant subtrees and truncates output to a visible budget.

#### Acceptance

- A snapshot requires an explicit scope unless a known app preset supplies one.
- Default output includes only important nodes: interactive elements, debug anchors, selected route/session containers, visible text-bearing nodes, and changed nodes in diff mode.
- Output includes a summary when nodes are omitted by depth, count, text, or character budget.
- `--json` or `--artifact` can store the full bounded snapshot without printing it all to stdout.
- Snapshot failures identify the missing selector or unavailable browser target.

#### Scenario: Scoped session list snapshot

- GIVEN Chat Web is open and the session list has debug anchors
- WHEN an agent runs `pibo debug web snapshot --scope '[data-pibo-debug="session-list"]'`
- THEN stdout lists session rows with ids, titles, selected state, unread/running state when present, and relevant classes
- AND it does not print message bodies or unrelated main-panel DOM.

### Requirement: Element identity is stable across diffs

The tool MUST assign stable short refs that survive common rerenders and reveal remounts when identity changes.

#### Current

Browser element indices and raw DOM paths can change after navigation, virtualization, or React reconciliation. This makes before/after comparisons noisy.

#### Target

The tool prefers explicit debug anchors, Pibo Session IDs, room IDs, test IDs, ARIA roles/names, and stable key-like attributes before falling back to DOM paths. It reports when an element appears to be visually equivalent but has a new DOM identity.

#### Acceptance

- Chat Web session rows can be identified by Pibo Session ID or optimistic temp ID.
- The selected chat shell can be identified by selected Pibo Session ID when available.
- Reordered nodes are reported as moves, not remove/add pairs, when stable identity is known.
- Recreated nodes with the same visible label but different identity are reported as remount-like changes.
- Fallback DOM-path identities are marked as unstable.

#### Scenario: Optimistic session replacement

- GIVEN a session row first appears as `optimistic-session-a7f`
- WHEN it is replaced by `ps_123`
- THEN the diff reports the replacement as a temp-to-real session transition when app-state markers confirm it
- AND reports remove/add remount behavior if the DOM row was destroyed and recreated.

### Requirement: Diffs are first-class output

The tool MUST default to diffs when comparing states and MUST avoid printing unchanged page content.

#### Current

Agents take repeated screenshots or snapshots and manually infer changes. That wastes context and misses short-lived transitions.

#### Target

Diff output shows added, removed, updated, moved, remounted, focused, hidden, shown, and layout-shifted nodes. It includes concise before/after values and a summary.

#### Acceptance

- `diff` compares the current snapshot against the previous snapshot for the same target and scope by default.
- `diff --from <artifact> --to current` compares a stored artifact to the live page.
- Unchanged nodes are omitted unless `--context` requests nearby lines.
- Diff output is ordered by timestamp for watch mode and by tree order for point-in-time snapshots.
- The tool reports when the baseline scope, URL, viewport, or app route differs from the current state.

#### Scenario: Class flicker is visible

- GIVEN a session row gains and loses `opacity-50` inside a watch window
- WHEN watch output is summarized
- THEN the timeline contains class-change entries for the row
- AND the final summary calls out a transient class change.

### Requirement: Watch mode records a bounded render timeline

The tool MUST provide watch mode for short time windows and MUST coalesce high-frequency browser events into readable timeline entries.

#### Current

A screenshot after an action cannot show that a DOM node vanished for 80 ms or that a class toggled twice before settling.

#### Target

Watch mode injects a scoped observer, records changes during a configured duration or until an explicit stop condition, and emits a compact timeline. It should use browser APIs such as `MutationObserver`, focus events, route/history hooks, selected layout reads, and optional animation-frame sampling.

#### Acceptance

- Watch mode requires a maximum duration with a safe default and an upper bound.
- The tool records node additions/removals, relevant attribute/class changes, text changes, focus changes, route changes, and selected layout-box changes.
- Events are grouped by animation frame or short time bucket to avoid one line per raw mutation.
- A quiet page produces a short "no changes" summary.
- High-volume pages produce truncation summaries rather than unbounded output.
- The injected watcher is removed when the run ends or the target navigates.

#### Scenario: Node disappears briefly

- GIVEN a selected session row is removed and re-added within 100 ms
- WHEN watch mode runs over that interval
- THEN the timeline reports a transient removal/re-addition
- AND the summary flags a suspected flicker.

### Requirement: Chat Web exposes stable debug anchors

Chat Web MUST expose inert debug anchors for key render surfaces when the debug build or runtime configuration enables them.

#### Current

The UI has semantic structure and class names, but agents often need stable selectors for session list rows, selected shells, composer, and panels.

#### Target

Important Chat Web regions expose stable `data-pibo-debug` and resource-specific attributes without changing layout, styling, or accessibility behavior.

#### Acceptance

- The session list root exposes a stable debug selector.
- Session rows expose their Pibo Session ID or optimistic temp ID.
- The selected session row and selected main chat shell expose selected-state markers.
- The composer, message/trace view, route shell, room/sidebar shell, and mobile sidebar expose stable debug selectors.
- Debug anchors do not contain secrets, tokens, or message bodies.
- Production builds may include inert anchors if they are safe, but active watchers remain opt-in.

#### Scenario: Session list can be scoped without brittle classes

- GIVEN Chat Web is loaded
- WHEN an agent asks for the session-list snapshot
- THEN the tool can select a stable debug anchor
- AND it does not rely on Tailwind class ordering or generated DOM paths.

### Requirement: Pibo app-state markers explain optimistic update flows

Chat Web SHOULD emit opt-in debug markers that describe relevant app-state transitions during a render debug session.

#### Current

The new-session flow updates React state, TanStack Query cache, router state, bootstrap data, and selected session state. CDP can observe the DOM but cannot reliably infer which app-level transition caused each change.

#### Target

When render debugging is enabled, Chat Web emits bounded markers for mutation start/success/error, optimistic temp IDs, selected Pibo Session ID changes, navigation requests/completions, bootstrap/navigation refreshes, auto-rename lifecycle, and cache updates that affect session navigation.

#### Acceptance

- Markers are disabled by default.
- Markers are stored in page memory or streamed only to the attached debug tool.
- Markers include timestamps compatible with DOM timeline events.
- Markers include stable Pibo IDs and client transaction IDs when safe.
- Marker payloads omit message text and secret values by default.
- Missing markers do not break DOM-only debugging; output states that correlation is unavailable.

#### Scenario: Create-session marker correlation

- GIVEN render debugging is enabled
- WHEN a new session is created
- THEN the timeline includes optimistic-create, server-success, selected-session-change, and navigation markers when those transitions occur
- AND DOM changes near those markers are grouped under the same phase.

### Requirement: React render tracing is optional and correlated

The tool SHOULD support optional React render tracing for Chat Web and other React apps.

#### Current

Agent Browser demonstrates useful React render profiling through a React DevTools hook. Pibo currently has lightweight development render counters but no correlated DOM timeline.

#### Target

A debug run can record component render counts, mounts, remounts, commit windows, approximate render reasons, and whether a render coincided with DOM mutations in the watched scope. It must degrade gracefully when React instrumentation is unavailable.

#### Acceptance

- `react start` begins a bounded render recording for the active target.
- `react stop` prints a compact table of top components by render count or render time when available.
- Watch output can include render commits that overlap DOM changes in the selected scope.
- If React DevTools hooks are unavailable, the tool reports that React tracing is unavailable and continues DOM watch mode.
- Render reports are truncated by component count and payload size.

#### Scenario: Sidebar rerenders without DOM change

- GIVEN `SessionSidebar` rerenders repeatedly but the session-list DOM does not change
- WHEN React tracing and DOM watch mode run together
- THEN the report distinguishes render churn from visible DOM mutation.

### Requirement: Scenario workflows reproduce known Chat Web bugs

The tool MUST support scenario workflows for repeated high-value debugging tasks. The first required scenario is `new-session`.

#### Current

Agents must manually click UI controls, take screenshots, inspect state, and reason from incomplete evidence.

#### Target

A scenario command sets up a scoped watch, performs or waits for a named user action, captures the timeline, and prints a diagnosis-oriented summary.

#### Acceptance

- `scenario new-session` watches the session list and chat shell before, during, and after session creation.
- The scenario can either click a discovered New Session control or wait for a manual click when `--manual` is set.
- The output reports optimistic temp ID, real Pibo Session ID, route changes, selected-state changes, row add/remove/update behavior, and auto-rename changes when detectable.
- The scenario saves a JSONL artifact and prints its path.
- Scenario failure leaves a partial artifact and an explicit failure phase.

#### Scenario: New session micro-jump

- GIVEN Chat Web is open in a usable target
- WHEN an agent runs `pibo debug web scenario new-session --duration 5000`
- THEN the tool captures the new-session flow from pre-click to post-bootstrap refresh
- AND the summary identifies any transient removal, remount, selected-state mismatch, route mismatch, or title rollback.

### Requirement: Artifacts are local, bounded, and reusable

The tool MUST write detailed artifacts only to a local debug artifact directory and MUST print the path in stdout.

#### Current

Ad hoc screenshots and copied DOM dumps are scattered and hard to compare later.

#### Target

Each render debug run stores optional artifacts with metadata, snapshots, timeline events, and summaries. Artifacts can be used as baselines for later diffs.

#### Acceptance

- The default artifact path is under a Pibo debug artifact directory, with `--output-dir` override.
- Artifact names include timestamp, app guess, scenario or command name, and a short run id.
- The tool enforces per-run size limits and prints truncation metadata.
- `diff --from <artifact>` can load a previous snapshot or timeline summary.
- Artifacts are not committed, uploaded, or added to normal Pibo stores by the tool.

#### Scenario: Compare before and after fix

- GIVEN an artifact captured before a code change
- WHEN an agent runs a new scenario after the fix
- THEN it can compare the new artifact with the old one and see whether suspected flicker entries disappeared.

### Requirement: Redaction protects user and secret data

The tool MUST avoid exposing sensitive data by default.

#### Current

Raw DOM, screenshots, console logs, and local-storage dumps can contain prompts, credentials, auth metadata, file names, tokens, and model output.

#### Target

Default output includes only short labels and debug identifiers needed to diagnose render behavior. Operators can opt into more text when necessary, but known secret patterns remain masked.

#### Acceptance

- Composer input values are redacted by default.
- Message bodies and model output are omitted or shortened by default.
- Auth tokens, cookies, authorization headers, and known secret-looking strings are never printed in plaintext.
- `--include-text` and `--include-values` expand text/value capture only within the selected scope.
- Redacted fields are marked as redacted, not silently omitted.

#### Scenario: Composer contains secret text

- GIVEN the composer contains text that looks like an API key
- WHEN an agent captures a chat-shell snapshot
- THEN stdout and artifacts mask the value
- AND the node still indicates that the composer is non-empty when that fact matters.

### Requirement: The tool preserves render timing as much as possible

The tool MUST minimize observer overhead and MUST report when instrumentation may affect timing.

#### Current

Adding heavy observers, layout reads, screenshots, or frequent computed-style reads can change the flicker being debugged.

#### Target

Default watch mode observes mutations and focus with low overhead. Expensive features such as layout-box sampling, computed-style diffs, React profiling, screenshots, or Chrome tracing are opt-in.

#### Acceptance

- Default watch mode avoids full-DOM serialization on every mutation.
- Layout reads are scoped and rate-limited.
- Computed-style capture is limited to changed or explicitly selected nodes.
- The tool reports enabled expensive features in the run header.
- If event volume exceeds limits, the tool samples or truncates and reports that fact.

#### Scenario: High-frequency animation

- GIVEN a spinner animates inside the watched scope
- WHEN default watch mode runs
- THEN it does not emit one event per animation frame for unchanged DOM
- AND it reports only relevant DOM/class/layout changes.

### Requirement: Headful, headless, and compute-worker modes are explicit

The tool MUST work in the Pibo development workflow and MUST state mode-specific limitations.

#### Current

Some issues require a real headful browser and authenticated profile. Other checks can run against a compute-worker browser through CDP.

#### Target

The tool can attach to a Docker compute worker's browser/CDP port, a Browser Use lease, or an existing authenticated tab. It reports whether it is headful/headless and whether screenshots, focus behavior, viewport, or OS-level input fidelity may differ.

#### Acceptance

- Target metadata includes viewport, URL, headful/headless when detectable, and CDP source.
- The tool accepts an explicit CDP WebSocket URL or port.
- In compute-worker mode, the tool uses worker web/CDP ports and does not touch the host production gateway.
- The output warns when a scenario depends on visual focus/hover/scroll behavior that may differ in headless mode.

#### Scenario: Docker compute worker target

- GIVEN a compute worker exposes web and CDP ports
- WHEN an agent passes the worker CDP target
- THEN the tool attaches to that target and uses the worker app URL for Chat Web checks.

### Requirement: Agent Browser interop is optional

The tool MAY use Agent Browser or similar browser tooling for snapshots, accessibility trees, annotated screenshots, or React profiling, but the Pibo capability MUST not depend on an unconfigured external CLI for its core DOM watch behavior.

#### Current

Agent Browser provides compact accessibility snapshots, diffs, annotated screenshots, and React render profiling. It does not cover all Pibo-specific watch/correlation needs.

#### Target

Pibo can adopt Agent Browser-compatible output ideas and may provide an adapter when the CLI is installed. The core Pibo workflow remains available through Pibo-managed CDP/browser tooling.

#### Acceptance

- Missing Agent Browser does not prevent `targets`, `snapshot`, or `watch` from running when CDP is available.
- If Agent Browser is used, the output identifies that adapter and preserves Pibo redaction and budget rules.
- Pibo-specific app-state markers and scenario summaries do not require Agent Browser.

#### Scenario: Agent Browser absent

- GIVEN the machine has no `agent-browser` executable
- WHEN an agent runs `pibo debug web watch`
- THEN the command still works through the Pibo CDP path or fails only because no browser target is available.

## Edge Cases

- **Optimistic IDs:** Temporary optimistic IDs may be replaced by real `ps_*` IDs. The tool must show both IDs and the transition.
- **Virtualized lists:** Session, trace, or message rows may unmount because of virtualization. The tool must distinguish viewport virtualization from unexpected flicker when possible.
- **Route changes:** Navigation can destroy the watched scope. The tool must record the route change and either reattach to the same logical scope or end with a clear reason.
- **Mobile sidebar:** Mobile layout may hide or remount the session list. Scenario output must include viewport and sidebar state.
- **CSS-only changes:** Some flickers are class/style changes without DOM node changes. The tool must capture class changes by default and computed-style/layout changes when requested.
- **Focus loss:** Composer focus may change without large DOM mutations. Watch mode must capture focus transitions in the scope.
- **Shadow DOM and portals:** Dialogs, menus, and overlays may live outside the requested scope. Known Chat Web portals should have debug anchors or be included through explicit extra scopes.
- **Iframes:** Generic site support should report iframe boundaries. Chat Web does not require cross-origin iframe introspection for the first version.
- **Large DOM:** The tool must honor node, depth, event, and byte budgets and report truncation.
- **Browser disconnect:** If the tab closes or reloads, the tool must save partial data and stop cleanly.
- **React unavailable:** Production/minified builds or missing hooks may prevent render reasons. DOM watch mode remains valid.
- **Sensitive labels:** Accessible names or text previews may contain user content. Redaction rules apply before stdout or artifact writes.

## Constraints

- **Development workflow:** Pibo code changes for this capability must be developed in a Docker compute worker. Documentation-only changes do not require a worker.
- **Security / Privacy:** The tool is opt-in, local by default, redacts sensitive values, and does not upload artifacts automatically.
- **Performance:** Default watch mode must be low overhead. Expensive layout/style/React/screenshot/profiler modes must be explicit.
- **Compatibility:** The tool must work with Chrome DevTools Protocol targets. It should not require one specific browser automation library for core behavior.
- **Product Boundary:** Public correlation keys are Pibo Session IDs, room IDs, client transaction IDs, route paths, and Chat Web debug markers. Pi Session IDs should appear only when already visible in existing diagnostics and needed for correlation.
- **CLI Design:** Help output must remain progressive and line-oriented.
- **Auth:** Dev-auth is allowed only inside Docker workers. Host Chat Web attachment must use existing authenticated browser sessions or Better Auth flows.

## Success Criteria

### MVP Required

- [ ] SC-001: An agent can discover the web render debug command surface progressively from CLI help.
- [ ] SC-002: The tool can list CDP targets and attach to an authenticated Chat Web target without restarting host gateways.
- [ ] SC-003: A scoped session-list snapshot prints compact rows with stable IDs and omits unrelated DOM.
- [ ] SC-004: A point-in-time diff prints only changed nodes and a summary count.
- [ ] SC-005: Watch mode captures transient add/remove/class/text/focus/route changes within the default 5 second duration.
- [ ] SC-006: Chat Web exposes stable debug anchors for session list, session rows, selected chat shell, composer, and main render containers.
- [ ] SC-007: Artifacts are local, bounded, reusable for later diffs, and never uploaded automatically.
- [ ] SC-008: Default stdout and artifacts redact composer values, message bodies, tokens, cookies, and secret-looking strings.
- [ ] SC-009: The tool works in Docker compute-worker CDP mode and with Browser Use authenticated leases.

### Capability Completion

- [ ] SC-010: The `new-session` scenario reports optimistic temp ID, real Pibo Session ID, selected-state changes, route changes, title changes, and suspected flickers.
- [ ] SC-011: App-state markers correlate DOM changes with create-session, navigation, bootstrap refresh, and auto-rename phases.

### Optional / Adapter

- [ ] SC-012: React tracing distinguishes render churn from visible DOM mutation when React instrumentation is available.
- [ ] SC-013: Agent Browser or annotated-screenshot integration works when explicitly configured, without becoming a dependency for DOM watch mode.

## Assumptions and Open Questions

### Assumptions

- The first implementation should target Chromium/CDP because Pibo's browser debugging and Browser Use workflows already rely on CDP.
- Chat Web can add safe debug anchors without changing visual behavior.
- The most valuable first scenario is new-session creation because it combines optimistic update, selection, navigation, bootstrap refresh, and auto-rename behavior.
- Agent-facing text output is more useful than complete raw JSON during normal debugging, but JSONL artifacts are necessary for deeper analysis.
- React render tracing is valuable but should not block the DOM watch MVP.

### Open Questions

#### Blocking Before Implementation

- What is the activation mechanism for active app-state markers: local storage, URL query flag, browser-injected script, or debug API handshake?
- What is the default artifact directory: Pibo home, active project/worktree, or a mode-dependent choice?
- For `scenario new-session`, is automatic clicking the default, or must the operator pass `--act` while default mode waits for a manual click?

#### Decide During Design

- Should debug anchors ship in production builds by default, or only when a debug flag is enabled?
- Which exact CLI command names should satisfy the required capability surface?
- Which CDP client implementation should own target attachment and injected-script lifecycle?

#### Deferred / Optional

- Should Pibo vendor any Agent Browser code, depend on the CLI optionally, or only copy its output concepts?
- Should optional pixel-diff screenshots ship in Phase 3, or remain delegated to Browser Use and Agent Browser?

## Implementation Phases

These phases are not an implementation plan. They define the expected capability increments for traceability.

### Phase 1: DOM watch MVP

- Add CLI discovery and target attachment.
- Implement scoped DOM snapshots, stable identity rules, point-in-time diff, and bounded watch mode.
- Add local JSONL artifacts and redaction.
- Add minimal Chat Web debug anchors for session list, session rows, selected shell, and composer.

### Phase 2: Chat Web scenario support

- Add `scenario new-session`.
- Add app-state markers for create-session, selection, route, bootstrap/navigation refresh, and auto-rename.
- Correlate DOM timeline entries with app-state phases.

### Phase 3: React and visual correlation

- Add optional React render tracing.
- Add layout/style sampling controls.
- Add optional annotated screenshot or Agent Browser adapter when available.
- Add artifact-to-artifact comparison for before/after fixes.

## Traceability

| Requirement | Scenario / Story | Phase | Status |
|---|---|---:|---|
| REQ-001 CLI discovery is progressive | Agent discovers watch mode | 1 | Pending |
| REQ-002 Browser attachment is safe and explicit | No usable Chat Web tab | 1 | Pending |
| REQ-003 Snapshots are scoped and compact | Scoped session list snapshot | 1 | Pending |
| REQ-004 Element identity is stable across diffs | Optimistic session replacement | 1 | Pending |
| REQ-005 Diffs are first-class output | Class flicker is visible | 1 | Pending |
| REQ-006 Watch mode records a bounded render timeline | Node disappears briefly | 1 | Pending |
| REQ-007 Chat Web exposes stable debug anchors | Session list can be scoped without brittle classes | 1 | Pending |
| REQ-008 Pibo app-state markers explain optimistic update flows | Create-session marker correlation | 2 | Pending |
| REQ-009 React render tracing is optional and correlated | Sidebar rerenders without DOM change | 3 | Pending |
| REQ-010 Scenario workflows reproduce known Chat Web bugs | New session micro-jump | 2 | Pending |
| REQ-011 Artifacts are local, bounded, and reusable | Compare before and after fix | 1 | Pending |
| REQ-012 Redaction protects user and secret data | Composer contains secret text | 1 | Pending |
| REQ-013 The tool preserves render timing as much as possible | High-frequency animation | 1 | Pending |
| REQ-014 Headful, headless, and compute-worker modes are explicit | Docker compute worker target | 1 | Pending |
| REQ-015 Agent Browser interop is optional | Agent Browser absent | 3 | Pending |

## Verification Basis

The spec is based on the user-reported Chat Web debugging problem, existing Pibo specs for Debug CLI, Chat Web browser/cache/navigation behavior, Browser Use authenticated leases, and a local review of the Agent Browser repository cloned to `/tmp/agent-browser` on 2026-05-16. The Agent Browser review informed the snapshot, ref, diff, annotated screenshot, CDP, and React-render concepts. The Pibo-specific requirements come from Chat Web's optimistic session and navigation behavior.
