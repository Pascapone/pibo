# Design: Web Annotations Plugin

## Context

The target workflow is Chat Web driven. The user works in a Pibo session, starts annotation for a URL or existing browser target, marks UI in that target, and sends the annotation back to Pibo. The target page should not need source-code changes for basic annotation.

The design intentionally separates source finding from annotation transport:

- Runtime DOM selection works through CDP-injected overlay code.
- Source hints are captured if present.
- LocatorJS-compatible metadata and future Pibo dev instrumentation can improve source confidence without becoming mandatory for every page.

## Goals / Non-Goals

### Goals

- Implement Web Annotations as a plugin with selectable agent tools.
- Bind browser targets to Pibo Sessions and Rooms.
- Collect annotations from live browser pages without changing target app source.
- Preserve enough target metadata for agents to find the affected code.
- Keep the first version narrow enough to build and test in Pibo's Docker worker workflow.

### Non-Goals

- Building a Chrome Extension in the first version.
- Replacing `pibo debug web snapshot`, `diff`, or `watch`.
- Guaranteeing perfect source locations for uninstrumented production builds.
- Requiring every component to have a manually maintained `data-pibo-id`.

## Decisions

### Decision: Plugin-owned capability

- **Choice:** Implement Web Annotations as `pibo.web-annotations` or equivalent plugin that registers tools, APIs, and UI hooks.
- **Rationale:** The user wants an activatable capability package that can be given to selected agents. This matches Pibo's plugin and capability catalog model.
- **Alternatives considered:** Add annotation commands directly to core debug web. This is simpler, but makes the feature harder to enable per profile and harder to evolve as a bundled workflow.

### Decision: Chat Web launches or attaches the browser target

- **Choice:** The first user flow starts in Chat Web: annotate URL or attach existing CDP target.
- **Rationale:** Chat Web already knows the current Pibo Session and Room. Starting there avoids a pairing step and guarantees annotation events land in the correct session.
- **Alternatives considered:** Browser extension pairing. More flexible, but adds installation, permissions, and pairing complexity before the core workflow is proven.

### Decision: CDP injection before Chrome Extension

- **Choice:** Use CDP to inject the annotation overlay into selected browser targets.
- **Rationale:** Pibo already has Browser Use/CDP target discovery and debug commands. CDP works for local development and Docker workers without modifying the target app.
- **Alternatives considered:** TypeScript library import in every target app. This gives better framework access, but violates the requirement to annotate pages without source changes.

### Decision: Source hints are layered and best-effort

- **Choice:** Capture source hints from multiple sources in priority order:
  1. explicit app/debug attributes, such as `data-pibo-id`, `data-testid`, `data-test-id`, `data-locatorjs-id`, or similar configured names;
  2. LocatorJS-compatible metadata when present;
  3. React development metadata or Fiber-derived component path when available;
  4. DOM selector, DOM path, text, and bounding box fallback.
- **Rationale:** Automatic source mapping is valuable but cannot be guaranteed on every page. The system should degrade without losing the user's annotation.
- **Alternatives considered:** Require LocatorJS for all annotated projects. This would be narrower and more reliable for React, but would block basic annotation for plain pages or uninstrumented apps.

### Decision: Prefer structured annotation references over prompt-only text

- **Choice:** Persist annotations as records and attach references or normalized copies to messages. Render a concise model-visible block only when an annotation is attached to a user message or requested by an agent tool.
- **Rationale:** Persistent records support status, review, replay, and agent tools. Prompt-only Markdown cannot support lifecycle management.
- **Alternatives considered:** Copy annotation Markdown to clipboard. Simple, but loses status and session binding.

### Decision: Use status lifecycle compatible with agent work

- **Choice:** Use statuses such as `open`, `attached`, `acknowledged`, `applying`, `needs_review`, `resolved`, `dismissed`, and `failed`.
- **Rationale:** The lifecycle distinguishes user-created work, agent acknowledgment, active implementation, review, and completion.
- **Alternatives considered:** Agentation-style `pending/acknowledged/resolved/dismissed` only. Simpler, but less expressive for Chat Web attachments and review.

## User Experience

### Chat Web entry points

A first UI can add one compact action near existing web/debug controls:

```text
Annotate URL
Attach Browser Target
```

`Annotate URL` asks for a URL and opens or attaches a target. `Attach Browser Target` lists reachable CDP targets with title and URL.

### Annotation state in Chat Web

The active session shows a small annotations panel or composer-adjacent chip strip:

```text
Web annotations
- ann_123 · open · button "Send" · localhost:3000/chat
- ann_124 · needs_review · region 340x120 · localhost:3000/settings
```

The user can attach one or more annotations to the next message. A message attachment preview should show label, URL, target kind, and note.

### Overlay behavior

The overlay should be small and reversible:

- toggle active/inactive annotation mode;
- hover outline for selectable element;
- click element to open note input;
- optional drag region for visual target;
- submit note;
- cancel and stop annotation mode.

The overlay should avoid blocking normal page use when annotation mode is inactive.

## Data Model

Names are illustrative and can be refined during implementation.

```ts
export type WebAnnotationStatus =
  | "open"
  | "attached"
  | "acknowledged"
  | "applying"
  | "needs_review"
  | "resolved"
  | "dismissed"
  | "failed";

export type WebAnnotationTargetKind =
  | "element"
  | "text"
  | "region"
  | "visual"
  | "pin";

export type WebAnnotation = {
  id: string;
  ownerScope: string;
  piboSessionId: string;
  piboRoomId?: string;
  status: WebAnnotationStatus;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedBy?: "human" | "agent";
  note: string;
  url: string;
  title?: string;
  targetId?: string;
  targetKind: WebAnnotationTargetKind;
  viewport: { width: number; height: number; devicePixelRatio?: number };
  target?: WebAnnotationTarget;
  screenshotRef?: string;
  thread?: WebAnnotationThreadMessage[];
};

export type WebAnnotationTarget = {
  label?: string;
  selector?: string;
  domPath?: string;
  fullDomPath?: string;
  tagName?: string;
  classSummary?: string;
  text?: string;
  selectedText?: string;
  htmlHint?: string;
  accessibility?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  sourceHints?: WebAnnotationSourceHint[];
};

export type WebAnnotationSourceHint = {
  kind:
    | "pibo-id"
    | "test-id"
    | "locatorjs"
    | "react-fiber"
    | "jsx-source"
    | "dom-fallback";
  confidence: "high" | "medium" | "low";
  id?: string;
  file?: string;
  line?: number;
  column?: number;
  component?: string;
  componentPath?: string[];
  raw?: Record<string, unknown>;
};

export type WebAnnotationThreadMessage = {
  id: string;
  role: "human" | "agent";
  content: string;
  createdAt: string;
};
```

## API Shape

The plugin should expose authenticated same-origin endpoints. Exact paths can change, but they should support these operations:

```text
POST /api/web-annotations/bindings
GET  /api/web-annotations/bindings?sessionId=...
POST /api/web-annotations/bindings/:id/inject
DELETE /api/web-annotations/bindings/:id

POST /api/web-annotations
GET  /api/web-annotations?sessionId=...&status=...
GET  /api/web-annotations/:id
PATCH /api/web-annotations/:id
POST /api/web-annotations/:id/thread
```

Overlay submissions use `POST /api/web-annotations`. The server derives owner scope from the authenticated binding or token, not from client-supplied owner fields.

## Agent Tools

Tool names should be concise and namespaced:

```text
web_annotations_list
web_annotations_get
web_annotations_watch
web_annotations_acknowledge
web_annotations_resolve
web_annotations_dismiss
```

Optional later tools:

```text
web_annotations_reply
web_annotations_attach
web_annotations_open_target
```

`web_annotations_watch` can be yieldable if it blocks for new annotations. It should integrate with Pibo's yielded-run control rather than inventing a second run lifecycle.

## Model-Visible Attachment Format

When a user attaches annotations to a message, Pibo can append a structured block:

```xml
<attached-web-annotations>
1. ann_123
targetKind: element
url: http://localhost:3000/settings
label: button "Save"
selector: [data-testid="save-button"]
sourceHint: src/components/SettingsForm.tsx:88:12 (high, locatorjs)
position: x1120 y742 140x44
text: Save changes
htmlHint: <button data-testid="save-button" class="...">
comment: Make this wider and align it with the form footer.
</attached-web-annotations>
```

The block must stay concise. Large HTML, full page text, and screenshots remain references or tool-readable details.

## Source Finding Strategy

### Basic target identity

The overlay should always collect:

- best CSS selector;
- DOM path;
- tag and class summary;
- text or selected text;
- HTML opening tag hint;
- bounding box;
- accessibility hints.

### LocatorJS / source-aware identity

If LocatorJS-compatible data exists, the overlay stores it as a high-confidence source hint. If no explicit metadata exists, the overlay may attempt React dev/Fiber lookup and store medium-confidence component/source hints.

The plugin should not depend on a specific LocatorJS package API until implementation verifies the exact metadata shape. The spec requires compatibility with available metadata, not a pinned package choice.

### Pibo future instrumentation

Future Pibo React projects may opt into dev-only instrumentation that emits stable `data-pibo-*` or LocatorJS-compatible attributes. That instrumentation should be a separate follow-up task unless implementation finds a trivial path.

## Persistence

The store must be durable across gateway restarts. It can use the existing Pibo data store or a plugin-owned SQLite table. Records must include owner scope, session id, room id, status, and timestamps.

Screenshot artifacts should store file references, not inline base64 payloads, in the annotation record and model-visible block.

## Security / Privacy

- Injection requires explicit user action from Chat Web or an authenticated API.
- The server derives owner scope and session access from Pibo auth/session state.
- Overlay submissions must be tied to a server-created binding or token.
- Payload size limits apply to text, HTML hints, and screenshot metadata.
- The overlay must not send full page HTML by default.
- The model-visible attachment must redact common secret-like values.
- Cross-origin iframe content is out of reach unless the browser/host grants access; the overlay should represent it as unavailable instead of failing.

## Risks / Trade-offs

- **CDP dependency:** The first version works best in Pibo-managed browser sessions. Extension support may be needed later.
- **Source confidence:** React and LocatorJS hints may be missing in production builds. DOM fallback must remain useful.
- **Overlay interference:** Injected scripts can conflict with app event handling. Annotation mode should be explicit and easy to stop.
- **Data sensitivity:** UI text and screenshots can contain private data. Keep prompt context small and explicit.

## Migration / Rollback

- No existing data migration is required for the first version.
- If the plugin is disabled, existing annotation records remain in the store but no tools or UI entry points are exposed.
- Overlay injection is runtime-only; reload or stop annotation mode should remove it from the page.

## Open Questions

- Should the initial Chat Web UI live in the composer, debug panel, or a new Web Annotations panel?
- Should `web_annotations_watch` be yieldable in V1 or start as a short-polling synchronous tool?
- Should annotations auto-attach to the next message by default?
- Should Pibo provide a recommended LocatorJS setup for Pibo itself in the same change or a follow-up?
