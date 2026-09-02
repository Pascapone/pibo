---
type: "Historical Record"
title: "Interactive Collaboration Analysis"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/interactive-collaboration-analysis-2026-05-02.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "000706e8ee99729d5354f4be44f4a35eda00ef4c"
  source_bytes: 12039
  source_sha256: "c943b0d341cfa8f008e2361b326c8e8584c2f73204cd67257ff261a5ffea18b2"
  source_body_sha256: "c943b0d341cfa8f008e2361b326c8e8584c2f73204cd67257ff261a5ffea18b2"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Interactive Collaboration Analysis

Date: 2026-05-02

## Goal

Preserve the current analysis for an interactive collaboration mode in the Chat Web App so the product can later support:

- agent to user guidance inside the web app
- user to agent references to sessions, context files, settings, and future modules
- a plugin-owned extension path for adding new interactive modules later

This document is analysis only. No implementation changes are implied.

## Problem Statement

The desired interaction model has three product states:

- `normal`: the current web app behavior
- `agent_showing`: the agent wants to point the user at something in the app
- `user_collaboration`: the user wants to point the agent at something in the app

The interaction must stay extensible. When future modules are added, those modules should be able to participate in the same interaction protocol without reworking the core app each time.

## Current Relevant Architecture

### Chat Web App

- The main React shell lives in `src/apps/chat-ui/src/App.tsx`.
- Top-level areas are currently hardcoded as `sessions | agents | context | settings`.
- Chat routes are already deep-linkable under `/apps/chat/*`.
- Session view rendering already uses a small registry via `src/apps/chat-ui/src/session-views/registry.tsx`.
- Session, room, trace, composer, slash commands, and various local UI states are still heavily coordinated from `App.tsx`.

### Backend and Routing

- Web actions already go through `/api/chat/action`.
- Backend execution actions are routed through `PiboExecutionEvent` and `PiboGatewayAction`.
- Gateway actions are plugin-registered and discovered by the frontend dynamically.
- The routed session executes those actions through `src/core/routed-session.ts`.

### Product Events

- Pibo already has product-scoped events through `emitProductEvent(...)` and `subscribeProductEvents(...)`.
- These are already used by the context-files plugin for cross-UI synchronization.
- Product events are currently event-based, not state-based. They are good for notification, but not enough on their own for a consumable multi-browser interaction lifecycle.

### Existing Cross-Linking Capabilities

- Sessions already support `parentId`, `originId`, derived sessions, child session links, and trace navigation.
- Trace nodes can already open child sessions.
- Context files already have a separate event stream and API model.

## Main Conclusion

The feature is feasible, but the hard part is not raw UI navigation. The hard part is defining a clean product protocol that:

- lets the agent request a UI interaction
- lets the user add structured app references back to the agent
- works across multiple browser instances
- remains plugin-extensible
- avoids hardcoding more special cases into `App.tsx`

The correct boundary is a dedicated plugin-owned capability, not ad hoc chat-specific logic.

## Recommended Product Shape

Create a new internal plugin capability:

- `pibo.interactive`

That plugin should own:

- interaction protocol types
- interaction persistence
- interaction lifecycle events
- agent-facing interactive tools
- frontend capability discovery
- future plugin registration for interactive modules

This should not be treated as a pure Chat UI feature. It is a product capability surfaced through the Chat Web App.

## Recommended State Model

### Browser UI State

The browser should expose an interaction state machine:

- `normal`
- `agent_showing`
- `user_collaboration`

Suggested shapes:

```ts
type InteractionUiState =
  | { mode: "normal" }
  | { mode: "agent_showing"; interactionId: string }
  | { mode: "user_collaboration"; sourcePiboSessionId: string; refs: InteractionContextRef[] };
```

### Product Interaction State

The interaction itself should not live only in React state. It needs a backend store so all browser instances see the same pending or consumed interaction.

Suggested lifecycle:

- `pending`
- `consumed`
- `cancelled`
- `expired`

This solves the multi-browser requirement:

- all browsers receive the same pending interaction
- any browser may consume it
- once consumed, it disappears everywhere

## Why Events Alone Are Not Enough

The current product event model is suitable for:

- notifying browsers that something changed
- updating read models
- lightweight synchronization

It is not sufficient by itself for:

- exactly one pending interaction shared across browser instances
- marking an interaction as consumed everywhere
- handling reconnects or late subscribers reliably

That means the feature needs both:

- durable interaction state
- product events derived from state transitions

## Recommended Protocol

### Interaction Target

```ts
type InteractionTarget =
  | { kind: "session"; id: string; subTarget?: string; label?: string }
  | { kind: "context_file"; id: string; subTarget?: string; label?: string }
  | { kind: "agent_profile"; id: string; subTarget?: string; label?: string }
  | { kind: "setting"; id: string; subTarget?: string; label?: string }
  | { kind: string; id: string; subTarget?: string; label?: string };
```

### Interaction Request

```ts
type InteractionIntent = "open" | "highlight" | "inspect" | "add_to_context";

type InteractionMode = "agent_showing" | "user_collaboration";

type InteractionRecord = {
  id: string;
  sourcePiboSessionId: string;
  mode: InteractionMode;
  intent: InteractionIntent;
  target: InteractionTarget;
  reason?: string;
  status: "pending" | "consumed" | "cancelled" | "expired";
  createdAt: string;
  consumedAt?: string;
  consumedBy?: string;
};
```

### Context References Returned To The Agent

```ts
type InteractionContextRef = {
  kind: string;
  id: string;
  label?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};
```

The returned reference should be structured, not just plain text. Plain text may still be the transport into the agent session for V1, but the product should keep the reference structured first.

## Plugin Extensibility Model

### Backend Plugin Interface

`pibo.interactive` should allow registration of interactive modules:

```ts
type PiboInteractionModule = {
  kind: string;
  label: string;
  supportedIntents: readonly string[];
  canBeShownByAgent: boolean;
  canAddToContext: boolean;
  resolveTarget(input: { id: string; subTarget?: string }): Promise<ResolvedInteractionTarget | null>;
};
```

This keeps module-specific target resolution out of the generic chat code.

### Frontend Module Interface

The Chat UI should maintain a frontend registry parallel to the backend module registry:

```ts
type InteractionTargetAdapter = {
  kind: string;
  canOpen(target: InteractionTarget): boolean;
  open(target: InteractionTarget, api: InteractionUiApi): Promise<void> | void;
  canRenderAddToContext(target: InteractionTarget): boolean;
  toContextRef(target: InteractionTarget): Promise<InteractionContextRef> | InteractionContextRef;
};
```

This is the key to keeping future modules pluggable without turning `App.tsx` into another large conditional switch.

## Agent-Facing Tooling

V1 likely needs a small tool surface, not a broad toolset.

Suggested first tool:

- `pibo_interactive_show`

Example shape:

```ts
type PiboInteractiveShowInput = {
  target: InteractionTarget;
  intent?: "open" | "highlight" | "inspect";
  reason?: string;
};
```

Behavior:

- create a pending interaction record
- emit `interaction.requested`
- return a compact structured acknowledgement

Important: the tool should not attempt to manipulate a specific browser directly. It should create product state and let subscribed browsers react.

## User-To-Agent Flow

The user collaboration mode should preserve the originating session:

- the user starts collaboration from session `A`
- the browser records `sourcePiboSessionId = A`
- the user can then navigate elsewhere in the app
- modules expose an `Add to context` action
- added references are attached back to session `A`

This origin session must remain fixed during collaboration mode. Otherwise the user can accidentally add context to the wrong session while browsing.

## Multi-Browser Semantics

Required behavior from the latest discussion:

- all browser instances react to the same state
- once the interaction is consumed, it disappears everywhere

Recommended semantics:

1. agent requests interaction
2. store writes record as `pending`
3. product event `interaction.requested` is emitted
4. all browsers render the pending interaction
5. one browser executes the interaction
6. browser calls consume API
7. store atomically marks interaction `consumed`
8. product event `interaction.consumed` is emitted
9. all browsers clear the UI prompt

This is the right model for shared awareness without building browser-instance addressing first.

## API and Event Surface

Suggested additions under a plugin-owned API prefix:

- `GET /api/interactive/bootstrap`
- `GET /api/interactive/events`
- `POST /api/interactive/interactions`
- `POST /api/interactive/interactions/:id/consume`
- `POST /api/interactive/interactions/:id/cancel`

Suggested product event types:

- `interaction.requested`
- `interaction.updated`
- `interaction.consumed`
- `interaction.cancelled`
- `interaction.expired`

These should be product events, not normal routed chat output events.

## Frontend Refactor Recommendation

`src/apps/chat-ui/src/App.tsx` currently carries too much coordination logic for this feature to land cleanly if added directly.

Recommended decomposition:

- `ChatShell`
- `useChatNavigation`
- `useInteractionMachine`
- `interactionModules.ts`
- `SessionsArea`
- `ContextArea`
- `AgentsArea`
- `SettingsArea`

The goal is not a speculative rewrite. The goal is to pull out the minimum stable seams before interactive collaboration logic is added.

## Specific Current Gaps

### Deep Links

Sessions already have usable deep links.

Context currently does not have a strong URL-level target model for selecting a specific file inside the Chat UI. That should be added if context files are first-class interaction targets.

### Area Registry

Areas are currently hardcoded. Future module growth suggests introducing a small area or target registry instead of expanding the existing switch logic indefinitely.

### Store Ownership

There is not yet a dedicated persistence layer for consumable interactions. That needs to be introduced explicitly.

### Tool Package Model

The codebase already has the idea of capability packages such as `pibo-run-control`. Interactive collaboration should follow the same pattern and become a small explicit package, for example:

- `pibo-interactive`

## Recommended MVP Scope

Keep the first version narrow:

- backend plugin `pibo.interactive`
- interaction store plus product events
- one agent tool: `pibo_interactive_show`
- one browser state machine
- two target kinds:
  - `session`
  - `context_file`
- collaboration mode with `Add to context`

Defer for later:

- settings
- agent profile references
- runtime-loaded frontend plugin bundles
- browser-instance targeting
- richer arbitration between multiple pending interactions

## Main Risks

- adding this directly into `App.tsx` will create brittle UI state coupling
- using only SSE events without durable state will fail the shared multi-browser consume requirement
- encoding target behavior as raw URLs will make permissions, validation, and later module extensibility much worse
- letting `pibo.interactive` know too much about Chat-specific details will reduce reuse and make the plugin boundary weak

## Recommendation

Proceed with a plugin-owned design:

- `pibo.interactive` as a first-class internal plugin
- durable interaction state plus product events
- explicit interaction protocol
- frontend interaction adapter registry
- small `App.tsx` modularization before or alongside implementation

This gives a path that is technically coherent, multi-browser safe, and extensible enough for future modules without overbuilding a marketplace or full dynamic frontend plugin runtime now.
