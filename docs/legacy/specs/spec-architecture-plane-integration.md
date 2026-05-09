---
title: Plane External Issue Tracker Integration
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo
tags: [architecture, integration, plane, issue-tracker, agents, automations]
---

# Introduction

This specification defines the architecture for integrating Pibo with Plane as an external issue tracker and project management system.

Plane remains a separately deployed service. Pibo owns agent orchestration, routing, sessions, automation rules, execution state, and reliability. The integration uses Plane HTTP APIs and Plane webhooks. Pibo must not copy Plane source code or import Plane packages into Pibo.

## 1. Purpose & Scope

The purpose of this specification is to define how Pibo should use Plane as an external issue tracker while preserving a clean product boundary:

- Plane is the system of record for work items, projects, states, comments, labels, assignees, and issue-facing user workflows.
- Pibo is the system of record for agent sessions, agent runs, routing, automation rules, execution logs, and Pibo-owned event processing.
- The integration is implemented as a Pibo plugin or connector, not as core Pibo code.
- Plane events are normalized into Pibo product events and durable jobs before they trigger agent behavior.
- Pibo sessions created from Plane work items must be first-class Pibo Sessions with Plane metadata attached.

This specification applies to:

- Plane API client design.
- Plane webhook receiver design.
- Pibo event normalization.
- Pibo session creation and reuse.
- Agent activation rules.
- Status and comment synchronization between Pibo and Plane.
- Reliability and idempotency behavior.
- Security requirements for webhook verification and API token handling.
- Future automation surfaces for event-based and time-based issue workflows.

This specification does not require:

- Changes to Plane source code.
- Copying Plane UI or Plane server code.
- A custom Plane fork.
- A complete automation UI in the first implementation.

## 2. Definitions

- **Plane**: The external open-source project management application hosted from `makeplane/plane`.
- **Plane Work Item**: Plane's current API term for an issue-like task. Older Plane URLs and code may still use "issue".
- **Plane Issue ID**: The UUID of a Plane `Issue` or Work Item.
- **Plane Project ID**: The UUID of a Plane project.
- **Plane Workspace Slug**: The human-readable workspace identifier used in Plane API paths.
- **Plane State**: A workflow state in a Plane project. States belong to state groups such as `backlog`, `unstarted`, `started`, `completed`, `cancelled`, and `triage`.
- **Plane Webhook Delivery**: One HTTP delivery attempt from Plane to Pibo. It includes `X-Plane-Delivery`, but this value must not be treated as a stable business event id across retries.
- **Pibo Plane Integration**: A configured connection from Pibo to one Plane instance, workspace, and optional project set.
- **Plane Connector Plugin**: The Pibo plugin that registers Plane tools, webhook routes, automation workers, profiles, and optional web UI.
- **Plane Event**: A raw incoming webhook payload or a polled Plane change.
- **Normalized Plane Event**: A Pibo-owned event derived from a Plane event with stable fields for routing and automation.
- **Plane Link Record**: Pibo-owned persistent data linking a Plane work item to one or more Pibo Sessions.
- **Plane Issue Session**: A Pibo Session whose `channel` is `plane` and whose `kind` identifies it as a Plane work item session.
- **Automation Rule**: A Pibo-owned rule that maps normalized Plane events or scheduled checks to Pibo actions.
- **Actor Loop**: A feedback loop where Pibo updates Plane, Plane emits a webhook, and Pibo reacts to its own update as if it came from a human.

## 3. Requirements, Constraints & Guidelines

### 3.1 Product Boundary

- **REQ-001**: Plane MUST remain an external service from Pibo's perspective.
- **REQ-002**: Pibo MUST integrate with Plane through HTTP APIs, webhooks, and configuration.
- **REQ-003**: Pibo MUST NOT copy Plane source code into Pibo.
- **REQ-004**: Pibo MUST NOT import Plane packages as runtime dependencies.
- **REQ-005**: Plane-specific behavior MUST be implemented in a Pibo plugin or connector module.
- **REQ-006**: Core Pibo session routing MUST remain Plane-agnostic.
- **REQ-007**: Plane-specific identifiers MUST be stored in Pibo Session metadata or Plane connector tables, not in new generic core columns.
- **CON-001**: Plane is licensed as AGPL-3.0-only. Pibo should avoid source-code reuse and direct package dependencies unless the resulting licensing obligations are explicitly accepted.

### 3.2 Integration Configuration

- **REQ-008**: Pibo MUST support one or more configured Plane integrations.
- **REQ-009**: Each integration MUST have a stable `integrationId`.
- **REQ-010**: Each integration MUST store the Plane base URL.
- **REQ-011**: Each integration MUST store the Plane API token securely.
- **REQ-012**: Each integration MUST store a Plane webhook secret or secret lookup reference.
- **REQ-013**: Each integration MUST support workspace slug configuration.
- **REQ-014**: Each integration SHOULD support per-project mapping to Pibo workspace directories and agent profiles.
- **REQ-015**: Each integration SHOULD support default behavior for unmapped projects.
- **REQ-016**: Each integration SHOULD expose a health check that validates API connectivity, token validity, and project/state access.

### 3.3 Plane API Client

- **REQ-017**: The Plane API client MUST send API authentication using the `X-Api-Key` header.
- **REQ-018**: The Plane API client MUST support listing, retrieving, creating, updating, and searching work items.
- **REQ-019**: The Plane API client MUST support retrieving project states.
- **REQ-020**: The Plane API client MUST support adding comments to work items.
- **REQ-021**: The Plane API client MUST support setting a work item's state.
- **REQ-022**: The Plane API client SHOULD support label and assignee lookup in a later implementation stage.
- **REQ-023**: The Plane API client SHOULD support work item lookup by `external_id` and `external_source`.
- **REQ-024**: The Plane API client MUST preserve Plane response IDs exactly as strings.
- **REQ-025**: The Plane API client MUST surface rate limit and authentication errors in a structured way.

### 3.4 Webhook Receiver

- **SEC-001**: The webhook receiver MUST read the raw request body before parsing JSON.
- **SEC-002**: The webhook receiver MUST verify `X-Plane-Signature` using HMAC-SHA256 and the configured webhook secret.
- **SEC-003**: The webhook receiver MUST reject missing signatures unless the integration is explicitly configured for insecure local development.
- **SEC-004**: The webhook receiver MUST reject unknown integration ids.
- **SEC-005**: The webhook receiver MUST reject malformed payloads.
- **SEC-006**: The webhook receiver MUST not expose the Plane API token or webhook secret in logs, events, tool outputs, or UI payloads.
- **REQ-026**: The webhook receiver MUST return a 2xx response after durable acceptance, not after agent execution completes.
- **REQ-027**: The webhook receiver MUST persist the raw delivery before processing automation.
- **REQ-028**: The webhook receiver MUST append a normalized event after successful validation.
- **REQ-029**: The webhook receiver MUST enqueue automation jobs for asynchronous processing.
- **REQ-030**: The webhook receiver MUST support duplicate delivery handling.
- **REQ-031**: The webhook receiver MUST support a route under a Pibo web app API prefix, such as `/api/plane/webhooks/:integrationId`.
- **GUD-001**: In local development, Plane may reject `localhost` webhook URLs. Use a reachable host, tunnel, or Plane `WEBHOOK_ALLOWED_IPS` configuration.

### 3.5 Event Normalization

- **EVT-001**: Pibo MUST normalize Plane webhook payloads into a stable Pibo event schema.
- **EVT-002**: Normalized events MUST include `integrationId`.
- **EVT-003**: Normalized events MUST include `planeEvent`.
- **EVT-004**: Normalized events MUST include `planeAction`.
- **EVT-005**: Normalized events MUST include `planeWebhookId`.
- **EVT-006**: Normalized events MUST include `planeWorkspaceId` when provided by Plane.
- **EVT-007**: Normalized issue events MUST include `planeIssueId` when available.
- **EVT-008**: Normalized issue events SHOULD include `planeProjectId`, `planeProjectIdentifier`, `sequenceId`, and a display key when available.
- **EVT-009**: Normalized update events MUST include `activityField`, `oldValue`, and `newValue` when Plane provides them.
- **EVT-010**: Normalized events MUST include actor details when Plane provides them.
- **EVT-011**: Normalized events MUST include a Pibo-generated `normalizedEventId`.
- **EVT-012**: Normalized events MUST include an `idempotencyKey`.
- **EVT-013**: Normalized events MUST retain a reference to the raw event stream id or raw delivery id.
- **EVT-014**: Pibo MUST treat `X-Plane-Delivery` as a delivery-attempt identifier, not as the only idempotency key.

### 3.6 Routing And Session Creation

- **RTE-001**: A Plane work item that should activate an agent MUST resolve to exactly one primary Pibo Plane Issue Session unless a rule explicitly requests multiple sessions.
- **RTE-002**: Pibo MUST look up an existing Plane Link Record before creating a new session.
- **RTE-003**: Pibo MUST create a new Pibo Session when a rule requires agent activation and no existing session is linked.
- **RTE-004**: Pibo MUST reuse the existing linked Pibo Session for subsequent events by default.
- **RTE-005**: Pibo MUST create sessions with `channel: "plane"`.
- **RTE-006**: Pibo MUST create primary work item sessions with `kind: "plane.issue"`.
- **RTE-007**: Pibo MUST store Plane identity fields in session metadata.
- **RTE-008**: Pibo MUST set `profile` from rule mapping, project mapping, label mapping, or integration default.
- **RTE-009**: Pibo MUST set `workspace` from project mapping or integration default.
- **RTE-010**: Pibo SHOULD set the session title from the Plane display key and work item name.
- **RTE-011**: Pibo SHOULD create or attach to a Pibo Room representing the Plane project or work item when Chat Web visibility is required.
- **RTE-012**: Pibo MUST not infer Plane meaning from the Pibo Session ID.

### 3.7 Agent Activation Rules

- **AUT-001**: Pibo MUST support event-based activation.
- **AUT-002**: Pibo SHOULD support time-based activation after the basic event-based implementation.
- **AUT-003**: Pibo MUST support a rule condition for Plane event type.
- **AUT-004**: Pibo MUST support a rule condition for Plane action.
- **AUT-005**: Pibo MUST support a rule condition for `activity.field`.
- **AUT-006**: Pibo SHOULD support rule conditions for project, state group, label, assignee, priority, issue type, and title/body text.
- **AUT-007**: Pibo SHOULD support explicit trigger comments such as `/pibo start`, `/pibo sync`, or `@pibo`.
- **AUT-008**: Pibo MUST support a rule action to create or reuse a Pibo Session.
- **AUT-009**: Pibo MUST support a rule action to enqueue a message into a Pibo Session.
- **AUT-010**: Pibo SHOULD support a rule action to update Plane state.
- **AUT-011**: Pibo SHOULD support a rule action to comment on a Plane work item.
- **AUT-012**: Pibo SHOULD support a rule action to abort or dispose a Pibo Session for cancellation workflows.
- **AUT-013**: Rule execution MUST be idempotent for a normalized event.

### 3.8 Status And Comment Synchronization

- **SYNC-001**: When Pibo starts agent work for an issue, Pibo SHOULD update the Plane work item to the configured started state.
- **SYNC-002**: When Pibo finishes agent work successfully, Pibo SHOULD add a summary comment to the Plane work item.
- **SYNC-003**: When Pibo finishes agent work successfully, Pibo MAY update the Plane work item to the configured completed or review state.
- **SYNC-004**: When Pibo needs human input, Pibo SHOULD add a Plane comment with the question and keep the work item in an active state.
- **SYNC-005**: When Pibo fails irrecoverably, Pibo SHOULD add a failure comment and leave the work item in a configured attention state or active state.
- **SYNC-006**: Pibo MUST avoid reacting to its own Plane comments and status updates unless a rule explicitly allows it.
- **SYNC-007**: Pibo MUST preserve enough metadata to distinguish Pibo-originated Plane changes from human-originated Plane changes.

### 3.9 Reliability And Operations

- **OPS-001**: Raw Plane deliveries MUST be stored in the Pibo Reliability Store or an equivalent durable store.
- **OPS-002**: Normalized Plane events MUST be stored in the Pibo Reliability Store or an equivalent durable store.
- **OPS-003**: Automation processing MUST use durable jobs.
- **OPS-004**: Automation jobs MUST have retry behavior.
- **OPS-005**: Failed automation jobs MUST be inspectable.
- **OPS-006**: The integration MUST provide debug CLI visibility for integrations, linked sessions, events, jobs, and dead jobs.
- **OPS-007**: Pibo SHOULD implement a reconciliation job that periodically compares Plane state with Pibo link records and sessions.
- **OPS-008**: Reconciliation MUST be able to repair missed webhook deliveries.
- **OPS-009**: Reconciliation MUST be able to detect deleted or inaccessible Plane work items.

### 3.10 Agent Tools

- **TOOL-001**: The plugin MUST register a tool to retrieve Plane work item details.
- **TOOL-002**: The plugin MUST register a tool to add a Plane work item comment.
- **TOOL-003**: The plugin MUST register a tool to update Plane work item fields.
- **TOOL-004**: The plugin MUST register a tool to set a Plane work item state by logical state mapping.
- **TOOL-005**: The plugin SHOULD register a tool to search/list Plane work items.
- **TOOL-006**: Agent-visible tools MUST expose product-level capabilities, not raw unbounded HTTP request power.
- **TOOL-007**: Tools MUST enforce integration, workspace, and project policy before calling Plane.
- **TOOL-008**: Tools MUST redact Plane secrets from errors and results.

## 4. Interfaces & Data Contracts

### 4.1 Plane Connector Plugin

The plugin should be named `pibo.plane`.

It should register:

| Capability | Required | Purpose |
| --- | --- | --- |
| Web app API route | Yes | Receive Plane webhooks and expose integration management endpoints. |
| Native tools | Yes | Let agents read/update Plane work items through curated tools. |
| Gateway actions | Recommended | Let operators start/sync/link issues from Pibo. |
| Profile | Recommended | Provide a default `plane-issue-agent` profile. |
| Context file | Recommended | Provide Plane-specific agent operating rules. |
| Product event listeners | Optional | Emit higher-level product events for UI and debug surfaces. |

### 4.2 Plane Integration Configuration

```ts
export type PlaneIntegrationConfig = {
  integrationId: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiTokenRef: string;
  webhookSecretRef: string;
  workspaceSlug: string;
  ownerScope?: string;
  defaultProfile: string;
  defaultWorkspace?: string;
  defaultRoomMode?: "none" | "project" | "issue";
  projectMappings: PlaneProjectMapping[];
  stateMappings: PlaneStateMapping[];
  automationRules: PlaneAutomationRule[];
  createdAt: string;
  updatedAt: string;
};
```

```ts
export type PlaneProjectMapping = {
  planeProjectId: string;
  planeProjectIdentifier?: string;
  enabled: boolean;
  piboWorkspace?: string;
  defaultProfile?: string;
  roomMode?: "none" | "project" | "issue";
  metadata?: Record<string, unknown>;
};
```

```ts
export type PlaneStateMapping = {
  planeProjectId?: string;
  logicalState:
    | "backlog"
    | "todo"
    | "started"
    | "review"
    | "blocked"
    | "completed"
    | "cancelled";
  planeStateId: string;
  planeStateName?: string;
  planeStateGroup?: "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "triage";
};
```

### 4.3 Plane Webhook Headers

Observed Plane webhook headers:

| Header | Meaning | Required Handling |
| --- | --- | --- |
| `Content-Type` | JSON payload type. | Must be `application/json` or compatible. |
| `User-Agent` | Plane currently sends `Autopilot`. | Do not rely on it for security. |
| `X-Plane-Delivery` | Delivery attempt UUID. | Store for diagnostics; do not treat as stable business event id. |
| `X-Plane-Event` | Plane event type, such as `issue`. | Validate against payload `event` when possible. |
| `X-Plane-Signature` | HMAC-SHA256 signature. | Verify before accepting. |

### 4.4 Plane Webhook Payload

Observed Plane payload shape:

```ts
export type PlaneWebhookPayload = {
  event: "project" | "issue" | "module" | "cycle" | "issue_comment" | string;
  action: "created" | "updated" | "deleted" | string;
  webhook_id: string;
  workspace_id: string;
  data: Record<string, unknown> | null;
  activity: {
    field: string | null;
    old_value: unknown;
    new_value: unknown;
    actor: Record<string, unknown> | null;
    old_identifier: string | null;
    new_identifier: string | null;
  } | null;
};
```

Issue update examples:

```json
{
  "event": "issue",
  "action": "updated",
  "webhook_id": "plane-webhook-id",
  "workspace_id": "plane-workspace-id",
  "data": {
    "id": "plane-issue-id",
    "name": "Fix failing login flow",
    "project": "plane-project-id",
    "sequence_id": 123,
    "priority": "high"
  },
  "activity": {
    "field": "state_id",
    "old_value": "old-state-id",
    "new_value": "new-state-id",
    "actor": { "id": "plane-user-id", "email": "user@example.com" },
    "old_identifier": null,
    "new_identifier": null
  }
}
```

### 4.5 Raw Delivery Record

```ts
export type PlaneRawDeliveryRecord = {
  deliveryRecordId: string;
  integrationId: string;
  receivedAt: string;
  method: "POST";
  headers: {
    contentType?: string;
    planeDelivery?: string;
    planeEvent?: string;
    planeSignaturePresent: boolean;
  };
  signatureStatus: "valid" | "invalid" | "missing" | "skipped-dev";
  bodySha256: string;
  rawBody: string;
  remoteAddress?: string;
};
```

### 4.6 Normalized Plane Event

```ts
export type NormalizedPlaneEvent = {
  normalizedEventId: string;
  integrationId: string;
  rawDeliveryRecordId: string;
  idempotencyKey: string;
  receivedAt: string;
  source: "webhook" | "poll";
  planeDelivery?: string;
  planeEvent: string;
  planeAction: string;
  planeWebhookId?: string;
  planeWorkspaceId?: string;
  workspaceSlug: string;
  planeProjectId?: string;
  planeIssueId?: string;
  planeIssueDisplayKey?: string;
  planeIssueSequenceId?: number;
  activityField?: string;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: {
    id?: string;
    email?: string;
    displayName?: string;
    isPiboActor?: boolean;
  };
  data: Record<string, unknown> | null;
};
```

Recommended event topics:

| Topic | Payload | Purpose |
| --- | --- | --- |
| `plane.raw_delivery` | `PlaneRawDeliveryRecord` | Audit and troubleshooting. |
| `plane.normalized` | `NormalizedPlaneEvent` | Automation source event. |
| `plane.action` | Pibo action result | Audit of actions taken because of Plane. |

Recommended job queues:

| Queue | Purpose |
| --- | --- |
| `plane.automation` | Process normalized events through rules. |
| `plane.sync` | Push Pibo state/comments to Plane. |
| `plane.reconcile` | Poll Plane and repair missed events or links. |

### 4.7 Plane Link Record

```ts
export type PlaneIssueSessionLink = {
  linkId: string;
  integrationId: string;
  planeWorkspaceSlug: string;
  planeWorkspaceId?: string;
  planeProjectId: string;
  planeProjectIdentifier?: string;
  planeIssueId: string;
  planeIssueSequenceId?: number;
  planeIssueDisplayKey?: string;
  piboSessionId: string;
  piboRoomId?: string;
  linkRole: "primary" | "derived" | "subagent" | "manual";
  status: "active" | "archived" | "deleted" | "inaccessible";
  lastPlaneEventAt?: string;
  lastPiboEventAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};
```

Uniqueness requirements:

- `(integrationId, planeIssueId, linkRole = "primary")` MUST be unique for active primary links.
- `piboSessionId` SHOULD be unique in the link table unless a future feature explicitly supports multi-issue sessions.

### 4.8 Pibo Session Metadata

Plane-created sessions should use this metadata shape:

```ts
export type PlaneSessionMetadata = {
  plane: {
    integrationId: string;
    workspaceSlug: string;
    workspaceId?: string;
    projectId: string;
    projectIdentifier?: string;
    issueId: string;
    issueSequenceId?: number;
    issueDisplayKey?: string;
    issueUrl?: string;
    linkId?: string;
    sourceEventId?: string;
  };
  chatRoomId?: string;
};
```

Recommended Pibo Session create input:

```ts
{
  channel: "plane",
  kind: "plane.issue",
  profile: "plane-issue-agent",
  ownerScope: "user:<owner-id>",
  workspace: "/path/to/repo",
  title: "PROJ-123 Fix failing login flow",
  metadata: {
    plane: {
      integrationId: "plane-main",
      workspaceSlug: "acme",
      projectId: "project-uuid",
      projectIdentifier: "PROJ",
      issueId: "issue-uuid",
      issueSequenceId: 123,
      issueDisplayKey: "PROJ-123",
      issueUrl: "https://plane.example.com/acme/projects/..."
    },
    chatRoomId: "room_uuid"
  }
}
```

### 4.9 Automation Rule

```ts
export type PlaneAutomationRule = {
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  trigger: PlaneAutomationTrigger;
  conditions: PlaneAutomationCondition[];
  actions: PlaneAutomationAction[];
  cooldownMs?: number;
  maxRunsPerIssuePerDay?: number;
};
```

```ts
export type PlaneAutomationTrigger =
  | { type: "plane_event"; events?: string[]; actions?: string[] }
  | { type: "schedule"; cron: string; selector: PlaneIssueSelector }
  | { type: "manual" };
```

```ts
export type PlaneAutomationCondition =
  | { field: "planeProjectId"; op: "equals" | "in"; value: string | string[] }
  | { field: "activityField"; op: "equals" | "in"; value: string | string[] }
  | { field: "stateGroup"; op: "equals" | "in"; value: string | string[] }
  | { field: "label"; op: "contains" | "not_contains"; value: string }
  | { field: "priority"; op: "equals" | "in"; value: string | string[] }
  | { field: "commentText"; op: "contains" | "regex"; value: string }
  | { field: "actor"; op: "is_pibo" | "is_not_pibo"; value?: boolean };
```

```ts
export type PlaneAutomationAction =
  | { type: "ensure_session"; profile?: string; workspace?: string; roomMode?: "none" | "project" | "issue" }
  | { type: "send_session_message"; template: string; source?: "service" | "actor" }
  | { type: "set_plane_state"; logicalState: string }
  | { type: "add_plane_comment"; template: string }
  | { type: "abort_session" }
  | { type: "clear_session_queue" }
  | { type: "emit_product_event"; eventType: string };
```

### 4.10 Agent Tool Contracts

Recommended native tools:

| Tool | Purpose |
| --- | --- |
| `plane_get_work_item` | Retrieve current Plane work item data by integration and issue id. |
| `plane_comment_work_item` | Add a comment to a Plane work item. |
| `plane_update_work_item` | Patch allowed work item fields. |
| `plane_set_work_item_state` | Set state by configured logical state. |
| `plane_search_work_items` | Search/list work items for a configured project. |

Example tool input:

```ts
export type PlaneGetWorkItemInput = {
  integrationId: string;
  planeIssueId: string;
  expand?: Array<"labels" | "assignees">;
};
```

Example tool output:

```ts
export type PlaneWorkItemSummary = {
  id: string;
  displayKey?: string;
  name: string;
  descriptionHtml?: string;
  priority?: string;
  state?: {
    id: string;
    name?: string;
    group?: string;
  };
  labels?: Array<{ id: string; name: string }>;
  assignees?: Array<{ id: string; displayName?: string; email?: string }>;
  url?: string;
  updatedAt?: string;
};
```

## 5. Acceptance Criteria

- **AC-001**: Given a valid Plane webhook request, When Pibo receives it, Then Pibo verifies the signature, stores the raw delivery, appends a normalized event, enqueues an automation job, and returns 2xx without waiting for agent execution.
- **AC-002**: Given a webhook request with an invalid signature, When Pibo receives it, Then Pibo rejects it and does not enqueue automation.
- **AC-003**: Given two delivery attempts for the same effective Plane update, When Pibo normalizes them, Then the automation action is executed at most once for the same idempotency key.
- **AC-004**: Given a Plane issue created event that matches an activation rule, When the automation job runs, Then Pibo creates one primary Pibo Session and stores one active primary Plane Link Record.
- **AC-005**: Given a subsequent Plane issue update for a linked issue, When the automation job runs, Then Pibo reuses the linked Pibo Session instead of creating another primary session.
- **AC-006**: Given a Plane state change to the configured started state, When the matching rule runs, Then Pibo sends a service message to the linked or newly created session.
- **AC-007**: Given a Plane state change to the configured cancelled state, When the matching rule runs, Then Pibo aborts or clears the linked session according to configuration.
- **AC-008**: Given an agent completes work successfully, When Pibo syncs the result, Then Plane receives a comment with the summary and optionally a configured state change.
- **AC-009**: Given a Plane comment authored by the configured Pibo actor, When Plane emits a webhook for that comment, Then Pibo ignores it unless a rule explicitly permits self-triggered events.
- **AC-010**: Given Plane webhooks are missed, When reconciliation runs, Then Pibo detects changed or unlinked Plane work items and enqueues appropriate sync or automation jobs.
- **AC-011**: Given the Plane API token is invalid, When the integration health check runs, Then Pibo reports a structured authentication failure.
- **AC-012**: Given a configured project mapping has a Pibo workspace path, When a session is created for that project, Then the Pibo Session uses that workspace path.

## 6. Test Automation Strategy

- **Test Levels**: Unit, integration, and local end-to-end tests.
- **Unit Tests**:
  - Signature verification.
  - Webhook payload validation.
  - Normalized event creation.
  - Idempotency key generation.
  - Rule condition evaluation.
  - Plane Link Record lookup and uniqueness behavior.
- **Integration Tests**:
  - Webhook route stores raw and normalized events.
  - Automation job creates/reuses Pibo Sessions through `PiboChannelContext`.
  - Plane tools call a mocked Plane API server and redact secrets.
  - Status/comment sync handles Plane API failures and retries.
- **End-to-End Tests**:
  - Start Pibo web gateway.
  - Send signed Plane-style webhook.
  - Verify Pibo Session creation.
  - Verify session receives initial service message.
  - Verify mocked Plane receives comment/state updates.
- **Test Data Management**:
  - Use temporary SQLite stores.
  - Use a deterministic test integration id.
  - Use fixed Plane issue/project/state ids.
- **Failure Testing**:
  - Invalid signature.
  - Missing issue id.
  - Duplicate events.
  - Plane API 401.
  - Plane API 404 for deleted issues.
  - Retryable Plane API 5xx.
- **Regression Commands**:
  - Use existing Pibo test runner commands once implementation files exist.
  - Add focused tests for the Plane plugin before enabling broad automation.

## 7. Rationale & Context

Plane already provides the issue tracker capabilities Pibo needs: work items, comments, status workflow, labels, assignees, projects, API tokens, and webhooks. Pibo should not recreate Plane's issue tracker in the first implementation. Pibo should connect to Plane and focus on what Pibo uniquely owns: agent routing, session control, automation, tool governance, and traceable execution.

The strongest architecture keeps these responsibilities separate:

- Plane owns issue workflow state and human-facing issue views.
- Pibo owns agent lifecycle and Pibo Session state.
- Link records connect Plane entities to Pibo Sessions.
- Durable Pibo events and jobs provide replay, retry, debugging, and future automation support.

This design also minimizes AGPL risk by avoiding Plane source-code reuse. HTTP API integration is the intended boundary.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Plane server - Provides work item APIs, state APIs, comments, API tokens, and webhooks.
- **EXT-002**: Pibo web gateway - Hosts the Plane webhook receiver and optional integration UI.
- **EXT-003**: Pibo Session Router - Creates and routes Pibo Sessions for Plane-triggered agent work.

### Infrastructure Dependencies

- **INF-001**: Reachable webhook endpoint - Plane must be able to call Pibo's webhook URL.
- **INF-002**: Durable SQLite stores - Required for events, jobs, sessions, rooms, and Plane link records.
- **INF-003**: Secret storage - Required for Plane API tokens and webhook secrets.

### Data Dependencies

- **DAT-001**: Plane API token - Required to read and update Plane work items.
- **DAT-002**: Plane webhook secret - Required to verify webhook authenticity.
- **DAT-003**: Plane project ids and state ids - Required for project mapping and status sync.

### Compliance Dependencies

- **COM-001**: Plane AGPL-3.0-only license - Pibo must avoid copying or directly embedding Plane code unless AGPL obligations are intentionally accepted.

## 9. Examples & Edge Cases

### 9.1 Basic Event-Based Rule

```json
{
  "ruleId": "start-agent-on-started-state",
  "name": "Start Pibo when Plane issue moves to Started",
  "enabled": true,
  "priority": 100,
  "trigger": {
    "type": "plane_event",
    "events": ["issue"],
    "actions": ["updated"]
  },
  "conditions": [
    { "field": "activityField", "op": "equals", "value": "state_id" },
    { "field": "stateGroup", "op": "equals", "value": "started" },
    { "field": "actor", "op": "is_not_pibo" }
  ],
  "actions": [
    { "type": "ensure_session", "profile": "plane-issue-agent", "roomMode": "issue" },
    {
      "type": "send_session_message",
      "source": "service",
      "template": "Plane issue {{planeIssueDisplayKey}} moved to Started. Inspect the work item, propose a plan, and begin implementation if sufficient context is available."
    },
    { "type": "add_plane_comment", "template": "Pibo agent session started: {{piboSessionUrl}}" }
  ]
}
```

### 9.2 Comment Trigger Rule

```json
{
  "ruleId": "manual-pibo-start-comment",
  "name": "Start Pibo from comment command",
  "enabled": true,
  "priority": 200,
  "trigger": {
    "type": "plane_event",
    "events": ["issue_comment"],
    "actions": ["created"]
  },
  "conditions": [
    { "field": "commentText", "op": "contains", "value": "/pibo start" },
    { "field": "actor", "op": "is_not_pibo" }
  ],
  "actions": [
    { "type": "ensure_session", "profile": "plane-issue-agent", "roomMode": "issue" },
    {
      "type": "send_session_message",
      "source": "service",
      "template": "A human requested agent work from Plane comment. Read the issue and respond with next action."
    }
  ]
}
```

### 9.3 Duplicate Delivery Edge Case

Plane currently provides `X-Plane-Delivery`, but it may represent a delivery attempt rather than a stable business event. Pibo must therefore generate an idempotency key from normalized business data.

Recommended issue update fingerprint fields:

```text
integrationId
planeEvent
planeAction
planeIssueId
activityField
stableJson(oldValue)
stableJson(newValue)
actor.id
data.updated_at when available
```

If `data.updated_at` is not reliable, Pibo may store multiple normalized events but must still make rule actions idempotent by checking link records and action history.

### 9.4 Actor Loop Edge Case

If Pibo changes a Plane state to `started`, Plane may emit a state update webhook. Pibo must identify the actor or action as Pibo-originated and avoid starting another duplicate session.

Required safeguards:

- Track the Plane API token actor where possible.
- Add Pibo-specific markers in comments, such as a hidden or structured marker if Plane supports it safely.
- Store recent outbound action fingerprints.
- Add rule condition `actor is_not_pibo` by default.

### 9.5 Missing Delete Webhook Edge Case

Some Plane delete paths may not dispatch model webhooks consistently. Pibo must not rely only on delete webhooks.

Required behavior:

- Reconciliation periodically checks linked Plane issues.
- 404 or permission failure marks a link as `deleted` or `inaccessible`.
- Pibo does not delete local sessions automatically unless configured.

## 10. Validation Criteria

An implementation complies with this specification when:

- A Plane webhook can create a Pibo Session through the connector without changes to Pibo core routing.
- The same Plane work item does not create duplicate primary sessions under duplicate deliveries.
- A linked Plane work item routes later events into the existing Pibo Session.
- Agent tools can retrieve, comment, and update Plane work items using `X-Api-Key`.
- Plane webhook signatures are verified before durable acceptance.
- Pibo-originated Plane updates do not trigger an actor loop by default.
- The integration can be disabled without removing existing Pibo Sessions.
- Debug commands or equivalent diagnostics can inspect integrations, link records, raw events, normalized events, jobs, and failures.
- No Plane source code or Plane packages are copied into Pibo.

## 11. Related Specifications / Further Reading

- [spec-architecture-pibo-session-model.md](./spec-architecture-pibo-session-model.md)
- [spec-schema-events-and-gateway.md](./spec-schema-events-and-gateway.md)
- [spec-architecture-runtime-boundary.md](./spec-architecture-runtime-boundary.md)
- [spec-process-tool-review-feedback-loop.md](./spec-process-tool-review-feedback-loop.md)
- Plane local clone: `<HOME>/code/plane`
- Plane work item API reference in source: `<HOME>/code/plane/apps/api/plane/api/urls/work_item.py`
- Plane webhook sender in source: `<HOME>/code/plane/apps/api/plane/bgtasks/webhook_task.py`
- Plane API token auth in source: `<HOME>/code/plane/apps/api/plane/api/middleware/api_authentication.py`
