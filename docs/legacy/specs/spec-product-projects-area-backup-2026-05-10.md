---
type: "Historical Record"
title: "Pibo Projects Area"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/spec-product-projects-area.backup-2026-05-10.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "aaff8574ea140792a1d31ad06d5b685090f0babd"
  source_bytes: 36567
  source_sha256: "47bd114fb675057c5e3c8e1f2cd87daa3adf1c3e0c3adc3ca24144f291d1316a"
  source_body_sha256: "b2856536e6014a468f47929a7dc84c9201ce945dca7bbad900eefab37fa9f08f"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---

# Introduction

This specification captures the proposed **Projects** area for the Pibo Chat Web App.

Projects are a coding-project-focused sibling module to the existing `Sessions` area. The current `Sessions` area remains unchanged. The new `Projects` area must start as a separate session-like module: it uses the same room/session interaction model, terminal/transcript surface, composer, sub-session tree, traces, and CRUD behavior, but it stores and routes its data separately from `Sessions`. Workflow state is the extra concept that Projects adds on top of the normal chat/session experience.

A Project Session is still a chat session. The simplest workflow is a one-node workflow, currently described as `simple-chat`, that does nothing beyond exposing the normal Session surface. When every Project Session uses this workflow, the Projects tab behaves like a 1:1 copy of the Sessions tab with separate routes and separate data. More complex workflows, such as `standard-project`, can then add states, graph edges, decisions, review steps, and cleanup behavior without replacing the selected-session chat surface.

## 1. Purpose & Scope

The purpose of the Projects area is to make agent-driven project work easier to manage. V1 focuses on standard coding sessions that move from feature/change idea to spec, plan, implementation, agent testing, human review, and cleanup.

In scope for the initial Projects concept:

- A new top-level `Projects` tab in the Chat Web App header/top bar.
- A Projects experience that is a 1:1 copy of the existing Sessions tab layout, behavior, sidebar hierarchy, session tree, selected-session pane, composer, terminal/session views, and CRUD controls, with Workflow and Project metadata added.
- Project containers that replace the user-facing label `Rooms` with `Projects` in the Projects module.
- The Projects sidebar shows its own green Personal Chat entry at the top, styled like the Sessions sidebar Personal Chat entry, but backed by separate Projects data and the `~/.pibo/projects/workspace` working directory.
- Separate Projects routes, selection state, and storage partitioning so Rooms/Sessions and Projects/Project Sessions do not mix.
- Every Project must be linked to a concrete local project folder/workspace path at creation time. Draft/unconfigured Projects are not part of V1.
- Each Project can contain many Project Sessions.
- Project Sessions are normal Pibo runtime/chat sessions with additional Project and Workflow metadata.
- Project Sessions have explicit workflow definitions. In V1, `simple-chat` is the only implemented workflow, but it must still use the workflow definition interface so later workflows can be added cleanly.
- V1 must support the one-node workflow so Projects can ship as a separate Sessions clone before complex workflow behavior is complete.
- `standard-project` is the first complex coding workflow target after V1. It can add specs, planning, implementation, agent testing, human review, and cleanup states.
- Sub-Sessions are created by subagent calls from a Main Project Session and remain visible/selectable in the Project Session tree.
- Main Project Sessions have an extensible workflow state machine when their workflow is more complex than `simple-chat`.
- Complex workflow state machines must be selected by workflow id so future workflows can define their own states and logic.
- Human review actions such as approve, send back with reason, or discard.
- Cleanup-oriented actions that help decide what to keep, push, merge, or discard after agent work.

Out of scope for V1:

- Removing or changing the existing `Sessions` area.
- Reusing the exact same Room and Session records in both the Sessions and Projects tabs without an explicit module discriminator.
- Implementing non-standard complex Project workflows such as Research Sessions.
- Full Git hosting integration design.
- Full CI/CD pipeline orchestration.
- Multi-user/team permissions beyond the existing owner-scope model.
- Complete knowledge/document management design, except as a future extension direction.

## 2. Definitions

- **Sessions Area**: The existing top-level Chat Web App area for general chat rooms and sessions.
- **Projects Area**: The top-level Chat Web App area reached through the `Projects` tab. It is a separate session-like module, not a filtered view of Sessions.
- **Pibo Project**: A user-facing work container that groups Project Sessions and is always linked to one local project folder in V1.
- **Project Folder**: The local workspace/root path associated with a Pibo Project. It is the source project folder from which isolated session worktrees are created.
- **Project Session**: A normal Pibo runtime/chat session associated with a Pibo Project. It keeps the standard Session transcript, terminal/session view, composer, status, trace view, tree behavior, archive/delete behavior, and Sub-Session hierarchy, and adds Project/Workflow metadata.
- **Workflow Definition**: The process graph selected for a Project Session. It defines nodes, edges, allowed transitions, waiting states, and actions.
- **`simple-chat` Workflow**: The one-node workflow. It represents the normal chat/session behavior with no extra process gates. If all Project Sessions use `simple-chat`, Projects behaves like an isolated clone of Sessions.
- **`standard-project` Workflow**: The first complex coding workflow target. It represents one feature, change, bugfix, or similar coding work item and follows the specs/plan/implementation/test/review/cleanup flow.
- **Project Session Type**: A product label for the workflow family of a Project Session, such as `simple-chat`, `standard-project`, or a future `research` type.
- **Research Session**: A future Project Session type focused on gathering information, analysis, comparison, investigation, and recommendations. It may have its own states and logic and is not implemented in V1.
- **Main Project Session**: A top-level Project Session inside a Project. For complex workflows, it owns the workflow run state.
- **Sub-Session**: A child Pibo Session created when the agent in a Main Project Session calls a subagent. A Sub-Session follows the delegated task, appears in the Project Session tree, and remains selectable as a normal session surface.
- **Project Session Workspace**: The isolated worktree and Docker compute worker assigned to one Project Session when the chosen workflow needs execution isolation. `simple-chat` does not create a worktree or Docker worker in V1.
- **Projects Personal Chat**: The Projects module's own Personal Chat entry. It is separate from the Sessions module Personal Chat and uses `~/.pibo/projects/workspace` as its default working directory.
- **Workflow State**: The current node/phase of a Project Session's workflow run.
- **Session State Class**: A code-level state implementation that owns the behavior, available actions, validation, prompts, and side effects for one state.
- **Project State Machine**: The orchestration layer that owns allowed transitions between Workflow States for Main Project Sessions but does not embed state-specific behavior.
- **Spec Phase**: The standard-project phase where the desired feature/change is converted into durable specs.
- **Plan Phase**: The standard-project phase where an executable implementation plan is derived from the accepted specs.
- **Implementation Phase**: The standard-project phase where agents perform the coding work in the isolated Docker worker/worktree of the Main Session and may create Sub-Sessions for delegated work.
- **Agent Test Phase**: The standard-project automated/self-test phase run by the agent before work is handed to the user.
- **Human Review Phase**: The standard-project phase where the agent has already tested its own work and the human user reviews, tests, accepts, rejects, or asks for changes.
- **Cleanup Phase**: The standard-project phase where Pibo helps the user decide what to keep, discard, push, merge, or otherwise finalize.

## 3. Product Model

### 3.1 Projects vs Sessions

The existing `Sessions` area remains the general conversation/session surface.

The new `Projects` area is optimized for coding and project work, but its first product shape is deliberately the same as Sessions:

- The top-level tab is `Projects`, not `Sessions`.
- The left-side grouping concept is called `Projects`, not `Rooms`.
- The session list is called `Project Sessions`, not `Sessions`, where the distinction matters.
- The selected Project Session opens the same kind of main surface as a selected Session: terminal/transcript, trace controls, model/profile/status header, slash commands, and composer.
- A Project must have a project folder at creation time in V1.
- A Project can contain multiple Project Sessions over time.
- Each Main Project Session represents one topic or work order, such as a feature, bugfix, research report, documentation update, investigation, or cleanup task.
- Each Main Project Session has a selected workflow.
- V1 implements only `simple-chat` as the one-node baseline workflow, but the workflow registry/interface must exist from the start.
- `standard-project` is the first complex workflow target after V1 for feature/change/bugfix work.
- Future Main Session workflows may have different graphs. For example, a Research workflow may focus on information gathering and analysis instead of code implementation.
- Sub-Sessions appear below the Main Project Session when subagents are called.
- A Project may later collect knowledge, documentation, project files, acceptance notes, and operational history.

### 3.2 Relationship to Pibo Rooms and Routes

Projects should use their own Projects storage from the start. The product concept, route space, and persistence must remain separate from Rooms/Sessions. V1 lists all Projects in that storage, regardless of owner scope; owner-scoped filtering can be added later.

- A Pibo Room is a general Chat Web container in the Sessions module.
- A Pibo Project is a coding-focused product container in the Projects module.
- V1 should create a separate Projects database, for example `.pibo/web-projects.sqlite`, with first-class Projects tables rather than mixing Project containers into Room tables.
- Rooms from the Sessions tab must not appear as Projects.
- Projects from the Projects tab must not appear as Rooms.
- Session records created in the Sessions tab must not appear as Project Sessions.
- Project Sessions created in the Projects tab must not appear in the Sessions tab unless a future feature explicitly exports or links them.
- Projects routes must be their own route family, for example `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId`.
- Project actions must not redirect to `/rooms/:roomId` or `/sessions/:piboSessionId`.
- If any temporary bridge to existing room/session code is needed, it must remain an implementation detail and must not leak product language or routes.
- UI labels in the Projects area must consistently say `Project`/`Projects`, not `Room`/`Rooms`.

### 3.3 Project Folder Requirement

Every Project must be linked to one local project folder at creation time.

The folder link should provide:

- Display name/path in the Project header.
- Source workspace context for new Project Sessions.
- A stable basis for later workflow-specific workspace setup and cleanup checks such as Git status, worktree state, branch, changed files, and test commands.

V1 Project folder rules:

- The user may point a Project at any existing local folder; it does not have to be under a Pibo-managed directory.
- The existing folder may contain arbitrary files and does not need to be empty.
- V1 does not need to verify that the folder is a Git repository.
- Project creation requires `name` and `projectFolder`; `description` is optional.
- Project names must be unique.
- Project folders must be unique; two Projects must not point to the same folder.
- When creating a new folder, the user selects or enters a parent path and a Project name; Pibo creates the folder on disk and sets the Project folder to that new path.
- V1 may use direct path entry for folder selection. A richer file explorer can be added later.

### 3.4 Project Session Workflows

Project Sessions must select a workflow to keep the system extensible.

V1 must support the `simple-chat` workflow as the only implemented workflow:

- It is the default and only selectable workflow while Projects is first introduced.
- It has one effective node and no extra process gates.
- It preserves normal chat/session behavior.
- It lets Projects ship as a separate clone of Sessions while the Workflow foundation is hardened.

The first complex workflow target after V1 is `standard-project`:

- It represents coding work such as a feature, change, bugfix, refactor, cleanup, or similar implementation task.
- It uses the standard specs/plan/implementation/agent-test/human-review/cleanup flow.
- It may be optional or experimental until the Workflow runner, state persistence, worker isolation, and UI actions are ready.

Future workflows should be possible without changing the core Project model:

- A `research` workflow could gather information, inspect code, compare options, analyze logs, summarize tradeoffs, or produce recommendations.
- A research workflow might use states such as `question`, `research`, `analysis`, `summary`, and `completed`.
- Other future workflows may support documentation, design, incident analysis, release preparation, migration planning, or dependency upgrade workflows.

Each workflow should be able to define:

- Its own node/state names.
- Its own state classes and behavior.
- Its own allowed transitions.
- Its own default prompts and acceptance criteria.
- Its own UI actions.
- Its own completion and failure semantics.

### 3.5 Project Session Isolation

Project Sessions should create and use isolated execution workspaces only when the selected workflow requires execution isolation. `simple-chat` Project Sessions do not create Docker compute workers or worktrees in V1.

For workflows that require execution isolation:

- A new worktree is created for the session.
- A Docker compute worker is spawned for the session.
- The agent for that session works only inside that session's worktree and Docker worker.
- Browser checks, builds, tests, gateway restarts, and implementation commands run inside the worker context.
- The host checkout must not be used as the experimental workspace.
- The Project Session should persist the worker id, worktree path, branch name, web port, CDP port, and lifecycle status when available.

This keeps each standard feature attempt, future research/investigation task, and delegated subagent task reviewable, disposable, and safe to clean up.

### 3.6 Main Sessions and Sub-Sessions

Projects must clearly distinguish Main Sessions from Sub-Sessions:

- Main Sessions are top-level Project Sessions inside a Project.
- Main Sessions select or own the workflow run.
- For `simple-chat`, the workflow run adds no extra visible process beyond normal chat.
- For complex workflows, Main Sessions own the workflow state and follow the workflow graph.
- Sub-Sessions are created by the Main Session's agent when it invokes subagents.
- Sub-Sessions are children of the Main Session through normal Pibo Session hierarchy.
- Sub-Sessions are not independently driven through the Main Session's project workflow states unless a future workflow explicitly models that behavior.
- A Sub-Session's scope is the task delegated by the Main Session's agent.
- The Main Session remains responsible for integrating subagent results into its workflow state.

### 3.7 Projects Tab Parity Rule

The Projects tab must start as a visual and behavioral clone of the Sessions tab, not as a settings-style page and not as a workflow-only dashboard.

Required layout:

```text
Top nav: Sessions | Projects | Agents | Context | Settings

Projects sidebar:
  Personal Chat        // Projects-owned green personal chat row, styled like Sessions
  Projects             // same position where Sessions shows Rooms
    Project A
    Project B
    Archived Projects
  Project Sessions     // same position where Sessions shows Sessions
    Main Project Session
      Sub-Session
```

The Projects tab may add workflow status chips, workflow run panels, workflow selection menus, review actions, and project-folder metadata. These controls are additive. They must not replace the copied Sessions structure, session tree, selected Session view, terminal/transcript, trace controls, or chat composer.

The green Personal Chat row in Projects is a Projects-owned Personal Chat, not a link to the Sessions module Personal Chat. It uses `~/.pibo/projects/workspace` as its working directory and uses `simple-chat` by default.

Parity means the Projects area keeps the same user capabilities as Sessions unless this spec explicitly says otherwise:

- Project rows have the same row density, hover state, active state, inline edit behavior, archive/restore affordance, delete flow, empty states, and mobile behavior as Room rows.
- Project Sessions have the same creation, selection, rename, archive/restore, delete, active/archived grouping, Sub-Session tree, unread/status badges, and mobile behavior as Sessions.
- Selecting a Project Session opens the same main Session surface used by Sessions: terminal/transcript view, session-view selector, trace/raw-events controls, model/profile/status header, slash commands, and composer.
- Workflow UI sits around or above the selected Session surface.

### 3.8 Project Session Interaction Model

A Project Session is still a Pibo Session. The Project association adds workflow state, project folder context, workspace metadata, and Project-scoped navigation; it does not remove chat behavior.

Required selected-session surface:

```text
Project header / workflow controls / workflow status
Selected Project Session header
Session terminal or transcript view
Runtime trace and raw-events controls
Chat composer with the same commands and behavior as Sessions
```

The user must be able to talk to the selected Project Session, watch its runtime output, inspect traces, and switch to Sub-Sessions in the same way they can in the Sessions tab.

Project Session creation should mirror normal Session creation, with the Projects-specific addition that a workflow is selected at creation time. In V1, the only available workflow is `simple-chat`, so the UI may preselect it while still persisting it through the workflow model.

## 4. Standard Project Workflow

### 4.1 Required Flow

The first complex workflow target is `standard-project`. A standard Main Project Session should normally start in the specs/planning part of the workflow and then move through the complete feature/change/bugfix lifecycle:

```text
specs -> plan -> implementation -> agent_test
                            ^              |
                            |              v
                    needs_changes <- agent_test_failed
                                           |
                                           v
                                     human_review
                                           |
            +------------------------------+------------------------------+
            v                              v                              v
        cleanup                    implementation                    discarded
            |
            v
        completed
```

The important product rules are:

- A standard Main Session usually represents one feature, change, bugfix, refactor, cleanup, or similar coding work item.
- The Main Session is the unit that moves through workflow states.
- The desired change should first become a spec update.
- The implementation plan is derived from the specs.
- Execution follows the plan.
- The agent tests its own work before handing it to the user.
- The user reviews only after the agent believes the work is ready.
- Sub-Sessions can be created during implementation or other phases, but they do not own the Main Session state.

### 4.2 States

Required `standard-project` Main Session states:

- `specs`: The desired feature/change/bugfix is converted into durable specs. Standard Main Sessions normally start here.
- `plan`: The agent derives an execution plan from the specs.
- `implementation`: The agent executes the plan in the session worktree/Docker worker and may delegate work to Sub-Sessions.
- `agent_test`: The agent runs its own tests and checks.
- `needs_changes`: The work needs another implementation iteration after failed tests or explicit feedback.
- `human_review`: The work is ready for the user to test and accept or reject.
- `cleanup`: The user approved the direction and Pibo helps finalize the working tree.
- `completed`: The Main Session's feature/change/bugfix is finalized.
- `failed`: The agent reached the retry limit or determines it cannot complete the work.
- `discarded`: The Main Session's feature/change/bugfix is intentionally abandoned.

Optional future or UI-only pre-state:

- `discussion`: The user and agent clarify a desired change before a formal Project Session is started. If represented as a state, it must transition into `specs` before implementation can begin.

### 4.3 Retry Loop

The implementation/test loop must support bounded retries on the standard Main Session:

```text
implementation -> agent_test -> needs_changes -> implementation
```

- The Main Session should track `retryCount` and `maxRetries`.
- `agent_test` may transition to `human_review` when checks pass.
- `agent_test` may transition to `needs_changes` when checks fail and retries remain.
- `agent_test` may transition to `failed` when retries are exhausted.
- The agent may also mark the Main Session as `failed` when it determines the requested work cannot be completed safely or correctly.
- Each failed test iteration should produce a durable reason and summary.

### 4.4 Human Review Actions

In the `human_review` state, the user must have clear decision actions:

- **Approve / Release**: Move the Main Session to `cleanup`.
- **Send back**: Move the Main Session back to `needs_changes` or `implementation` with a required reason.
- **Discard**: Move the Main Session to `discarded`, preferably with an optional reason.

The send-back reason must become durable context so the next agent iteration can see what was rejected or missing.

### 4.5 Cleanup Actions

In the `cleanup` state, Pibo should help answer:

- What changed in the Main Session worktree and relevant Sub-Session worktrees?
- Which files should be kept?
- Which files should be reverted or deleted?
- Are tests still passing?
- Should this be committed, pushed, merged to `main`, or left as a branch/worktree?
- Should session Docker workers be released?

Initial UI actions may be lightweight wrappers around inspectable operations:

- Show Git status.
- Show changed files.
- Show diffs.
- Run configured test command.
- Mark files/changes as keep or discard.
- Create a cleanup summary.
- Release Docker compute workers after confirmation.
- Mark cleanup as completed.

Potential later actions:

- Create commit.
- Push branch.
- Open pull request.
- Merge to main.
- Delete or archive worktrees.

## 5. State Machine Architecture

The state system should be extensible across workflows. The state machine defines flow; state classes define behavior.

### 5.1 Design Principle

- The **Project State Machine** owns allowed transitions and transition history for Main Sessions that run complex workflows.
- Workflow/state-machine definitions are scoped by workflow id.
- `simple-chat` must be valid as the one-node/no-extra-gates workflow.
- Each **Session State Class** owns the functionality of one complex workflow state.
- Adding a new workflow should not require rewriting the standard-project workflow.
- Adding a new state to one workflow should not require rewriting one large state-machine function.
- UI actions should be derived from the active state class where possible.
- State-specific prompts, validation, side effects, and completion criteria should live with the state class.
- Sub-Sessions do not execute the Main Session state machine directly. They receive their behavior from the delegated subagent task and report results back through the normal session/subagent trace.

### 5.2 Draft Interfaces

```ts
export type PiboProjectWorkflowId = "simple-chat" | "standard-project" | string;

export type PiboStandardProjectSessionStateName =
  | "specs"
  | "plan"
  | "implementation"
  | "agent_test"
  | "needs_changes"
  | "human_review"
  | "cleanup"
  | "completed"
  | "failed"
  | "discarded";

export type PiboProjectSessionKind = "main" | "sub";

export type PiboProjectTransition = {
  piboSessionId: string;
  workflowId: PiboProjectWorkflowId;
  from: string;
  to: string;
  action: string;
  reason?: string;
};

export type PiboProjectAction = {
  id: string;
  label: string;
  kind: "user" | "agent" | "system";
  requiresReason?: boolean;
  destructive?: boolean;
};

export interface PiboProjectSessionStateHandler {
  readonly workflowId: PiboProjectWorkflowId;
  readonly name: string;

  getAvailableActions(context: PiboProjectSessionStateContext): PiboProjectAction[];

  canEnter?(context: PiboProjectSessionStateContext): Promise<boolean> | boolean;
  onEnter?(context: PiboProjectSessionStateContext): Promise<void> | void;
  onExit?(context: PiboProjectSessionStateContext): Promise<void> | void;

  handleAction(
    actionId: string,
    context: PiboProjectSessionStateContext,
    input?: Record<string, unknown>,
  ): Promise<PiboProjectTransition | void> | PiboProjectTransition | void;
}

export interface PiboProjectStateMachineDefinition {
  readonly workflowId: PiboProjectWorkflowId;
  readonly initialState: string;
  canTransition(from: string, to: string): boolean;
  transition(transition: PiboProjectTransition): Promise<void>;
}

export interface PiboProjectWorkflowDefinition {
  readonly id: PiboProjectWorkflowId;
  readonly label: string;
  readonly stateMachine: PiboProjectStateMachineDefinition;
  getStateHandler(stateName: string): PiboProjectSessionStateHandler | undefined;
}
```

The exact interface can change during implementation, but the separation should remain: workflow definitions select the state machine and handlers; state handlers own behavior; the state machine owns flow and transition persistence for Main Sessions.

## 6. UI Requirements

- **REQ-001**: The Chat Web App top bar MUST include a new `Projects` tab next to the existing `Sessions` tab.
- **REQ-002**: The existing `Sessions` tab and behavior MUST remain unchanged for the initial Projects work.
- **REQ-003**: The Projects tab MUST be a 1:1 copy of the Sessions tab structure and behavior before Workflow extras are added.
- **REQ-004**: The Projects sidebar MUST show a Projects-owned green Personal Chat entry at the top, styled like the Sessions sidebar Personal Chat entry.
- **REQ-005**: Below the Personal Chat entry, the Projects sidebar MUST show `Projects` where the Sessions sidebar shows `Rooms`.
- **REQ-006**: The Projects sidebar MUST show `Project Sessions` in the same sidebar position and style where the Sessions tab shows `Sessions`.
- **REQ-007**: The Projects tab MUST NOT use the Context Files/settings-style layout as its primary layout.
- **REQ-008**: Projects MUST use their own route family, for example `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId`.
- **REQ-009**: Creating, selecting, editing, archiving, restoring, or deleting a Project MUST keep the user in the Projects tab.
- **REQ-010**: Project flows MUST NOT redirect to `/rooms/:roomId`, `/sessions/:piboSessionId`, or the Sessions tab.
- **REQ-011**: Sessions-tab Rooms/Sessions and Projects-tab Projects/Project Sessions MUST be separated by Projects-owned storage, preferably `.pibo/web-projects.sqlite` in V1.
- **REQ-012**: Creating a Project MUST require selecting or entering a project folder. Draft/unconfigured Projects are not part of V1.
- **REQ-012a**: V1 MAY use direct path entry for folder selection; a graphical file explorer is not required for V1.
- **REQ-012b**: Project creation MUST require a unique Project name and unique folder path; description is optional.
- **REQ-012c**: Project deletion MUST follow the Room-style confirmation flow, including typing the Project name for destructive deletion.
- **REQ-012d**: Permanent Project deletion MUST ask whether to delete the underlying project files; archiving MUST NOT delete files.
- **REQ-013**: Project Sessions MUST be listed under the selected Project.
- **REQ-014**: Project Sessions MUST show their selected workflow where it is useful for understanding behavior.
- **REQ-015**: V1 MUST support creating Project Sessions with the `simple-chat` one-node workflow as the only implemented workflow.
- **REQ-016**: `simple-chat` Project Sessions MUST behave like normal chat sessions: same terminal/transcript, traces, composer, slash commands, profile/model controls, and Sub-Session tree.
- **REQ-017**: The first complex workflow target after V1 SHOULD be `standard-project`.
- **REQ-018**: The UI MUST visually distinguish Main Project Sessions from Sub-Sessions.
- **REQ-019**: A selected Main Project Session with a complex workflow MUST show its workflow state prominently.
- **REQ-020**: A selected Sub-Session MUST show its delegated task context and parent Main Session, but MUST NOT expose independent project state transitions unless a future workflow explicitly models them.
- **REQ-021**: Project rows MUST support the same edit, archive, restore, and delete affordances as Room rows, using Project labels and Projects routes.
- **REQ-022**: Project Sessions MUST support the same select, rename, archive, restore, and delete affordances as Sessions in the Sessions tab.
- **REQ-023**: The Project Sessions sidebar MUST render Main Sessions and Sub-Sessions with the same tree behavior, indentation, status indicators, unread indicators, active state, and mobile behavior as the Sessions sidebar.
- **REQ-024**: Selecting a Project Session MUST show the normal Session main pane: terminal/transcript, session-view selector, runtime trace controls, raw-events controls, and composer.
- **REQ-025**: The Project Session composer MUST send messages to the selected Project Session and support the same slash commands, draft behavior, history behavior, disabled states, and submit behavior as the Sessions composer.
- **REQ-026**: Workflow selection menus, status panels, and review actions MUST be additive controls around the normal selected-Session surface.
- **REQ-027**: Projects MUST NOT replace the selected Project Session main pane with a Workflow-only dashboard or static status card.
- **REQ-028**: New execution-capable Project Sessions SHOULD automatically create a worktree and Docker compute worker only when their workflow requires agent coding work. `simple-chat` MUST NOT create a worktree or Docker worker in V1.
- **REQ-029**: New Main Project Sessions SHOULD inherit the Project's folder/workspace context but MUST execute only in the session worktree when isolated execution is active.
- **REQ-030**: Sub-Sessions SHOULD also execute only in their own session workspace when their workflow requires execution isolation, unless a later design explicitly chooses shared workspaces.
- **REQ-031**: The UI SHOULD show the active worktree path, worker status, and relevant worker ports when available.
- **REQ-032**: The Specs phase MUST make spec changes visible and durable for `standard-project` sessions.
- **REQ-033**: The Plan phase MUST show the plan derived from the specs before execution for `standard-project` sessions.
- **REQ-034**: The Agent Test phase MUST show test attempts, failures, retry count, and max retries for `standard-project` Main Sessions.
- **REQ-035**: The Human Review phase MUST expose approve, send-back-with-reason, and discard actions for `standard-project` Main Sessions.
- **REQ-036**: The Cleanup phase SHOULD expose project-folder/worktree inspection and cleanup helper actions.
- **REQ-037**: Main Session state transitions MUST be visible in the Project timeline or activity history.

## 7. Data Contract Draft

```ts
export type PiboProjectWorkflowId = "simple-chat" | "standard-project" | string;

export type PiboStandardProjectSessionStateName =
  | "specs"
  | "plan"
  | "implementation"
  | "agent_test"
  | "needs_changes"
  | "human_review"
  | "cleanup"
  | "completed"
  | "failed"
  | "discarded";

export type PiboProject = {
  id: string;
  ownerScope: string;
  name: string;
  description?: string;
  projectFolder: string;
  configurationStatus: "configured";
  currentMainSessionId?: string;
  archivedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectSession = {
  projectId: string;
  piboSessionId: string;
  kind: "main" | "sub";
  workflowId: PiboProjectWorkflowId;
  workflowRunId?: string;
  parentMainSessionId?: string;
  title?: string;
  state?: string;
  retryCount?: number;
  maxRetries?: number;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectSessionWorkspace = {
  projectId: string;
  piboSessionId: string;
  sourceProjectFolder: string;
  worktreePath: string;
  branchName?: string;
  dockerWorkerId?: string;
  webPort?: number;
  cdpPort?: number;
  status: "creating" | "ready" | "running" | "released" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectEvent = {
  id: string;
  projectId: string;
  piboSessionId?: string;
  actorId?: string;
  type:
    | "project.created"
    | "project.updated"
    | "project.session_created"
    | "project.session_state_changed"
    | "project.spec_updated"
    | "project.plan_created"
    | "project.agent_test_started"
    | "project.agent_test_failed"
    | "project.agent_test_passed"
    | "project.review_sent_back"
    | "project.review_approved"
    | "project.session_failed"
    | "project.session_discarded"
    | "project.cleanup_summary_created"
    | "project.workspace_created"
    | "project.workspace_released";
  payload: Record<string, unknown>;
  createdAt: string;
};
```

Project Sessions may initially be associated through `PiboSession.metadata.projectId`, `PiboSession.metadata.projectSessionKind`, `PiboSession.metadata.projectWorkflowId`, `PiboSession.metadata.projectWorkflowRunId`, and normal `parentId` hierarchy. Project container and workflow metadata should live in the Projects-owned database, separate from Room storage. Long-term implementations may introduce additional first-class relation tables if needed.

## 8. Future Extensions

Projects are intended to become more than session groups. Future versions may add:

- Research Sessions for information gathering, codebase analysis, tradeoff analysis, and recommendations.
- Project knowledge and documentation.
- Project-scoped context files.
- Acceptance criteria tracking.
- Agent-generated implementation plans.
- Test plans and manual test checklists.
- Git branch/worktree lifecycle management.
- Docker worker lifecycle tracking.
- Project-level summaries across many sessions.
- Reusable cleanup playbooks.
- GitHub/GitLab pull request integration.
- CI result integration.

## 9. Open Questions

- Should a standard Main Session always start in `specs`, or can some sessions import existing specs and start in `plan`?
- What should the first post-V1 Project workflow be after `standard-project`: `research`, documentation, incident analysis, or something else?
- Should Sub-Sessions inherit the Main Session workflow, use their own workflow, or remain untyped delegated work?
- Should Sub-Sessions always receive separate worktrees/workers for execution workflows, or should some delegated tasks share the Main Session workspace?
- Can project folders later represent remote repositories, or are Projects always local-folder-backed?
- Which cleanup operations should be UI-only confirmations vs direct executable actions?
- How much Git automation is safe before explicit user confirmation is required?
- What should the default `maxRetries` be for the agent implementation/test loop?
