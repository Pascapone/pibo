import type {
  DurationSpec,
  EdgeId,
  EdgeKind,
  EdgeStateMapping,
  NodeId,
  RetryPolicy,
  StateAccessPolicy,
  StatePath,
  WorkflowDefinition,
  WorkflowEdgeDefinition,
  WorkflowId,
  WorkflowMetadata,
  WorkflowNodeDefinition,
  WorkflowNodeUiMetadata,
  WorkflowSnapshotKind,
  WorkflowStateFieldDefinition,
  WorkflowUiMetadata,
  WorkflowVersion,
  XStateMachineProjection,
  XStateProjectionAction,
  XStateProjectionActor,
  XStateProjectionContextShape,
  XStateProjectionDelay,
  XStateProjectionGuard,
  XStateProjectionKind,
  XStateProjectionMachineConfig,
  XStateProjectionSchemaVersion,
  XStateProjectionState,
  XStateProjectionStateMeta,
  XStateProjectionTerminalKind,
  XStateProjectionTransition,
  XStateProjectionTransitionConfig,
  XStateProjectionTransitionMeta,
  WorkflowMachineSnapshot,
  WorkflowRunStatus,
  WorkflowXStateUiActor,
  WorkflowXStateUiCurrent,
  WorkflowXStateUiEdge,
  WorkflowXStateUiModel,
  WorkflowXStateUiModelKind,
  WorkflowXStateUiModelSchemaVersion,
  WorkflowXStateUiNode,
  WorkflowXStateUiNodeStatus,
} from "../types/index.js";

export const WORKFLOW_XSTATE_PROJECTION_KIND: XStateProjectionKind = "pibo.workflow.xstateProjection";
export const WORKFLOW_XSTATE_PROJECTION_VERSION: XStateProjectionSchemaVersion = 1;
export const WORKFLOW_XSTATE_UI_MODEL_KIND: WorkflowXStateUiModelKind = "pibo.workflow.xstateUiModel";
export const WORKFLOW_XSTATE_UI_MODEL_VERSION: WorkflowXStateUiModelSchemaVersion = 1;

export const WORKFLOW_XSTATE_SNAPSHOT_KINDS = ["kernel", "xstate", "ui"] as const satisfies readonly WorkflowSnapshotKind[];

export const WORKFLOW_XSTATE_TERMINAL_STATE_IDS: Record<XStateProjectionTerminalKind, string> = {
  completed: "workflow.completed",
  failed: "workflow.failed",
  cancelled: "workflow.cancelled",
};

export const WORKFLOW_XSTATE_NODE_DONE_EVENT = "WORKFLOW.NODE.DONE";
export const WORKFLOW_XSTATE_RESUME_EVENT = "WORKFLOW.RESUME";
export const WORKFLOW_XSTATE_CANCEL_EVENT = "WORKFLOW.CANCEL";
export const WORKFLOW_XSTATE_FAIL_EVENT = "WORKFLOW.FAIL";

export const WORKFLOW_XSTATE_ACTOR_SOURCES: Record<WorkflowNodeDefinition["kind"], string> = {
  adapter: "pibo.workflow.actor.adapter",
  agent: "pibo.workflow.actor.agent",
  code: "pibo.workflow.actor.code",
  human: "pibo.workflow.actor.human",
  workflow: "pibo.workflow.actor.workflow",
};

export type CreateXStateProjectionContextShapeOptions = {
  global?: Record<StatePath, WorkflowStateFieldDefinition>;
  local?: Record<NodeId, StateAccessPolicy | undefined>;
  edge?: Record<EdgeId, EdgeStateMapping | undefined>;
};

export function createXStateProjectionContextShape(
  options: CreateXStateProjectionContextShapeOptions = {},
): XStateProjectionContextShape {
  return {
    durableTruth: "kernel",
    global: options.global ?? {},
    local: options.local ?? {},
    edge: options.edge ?? {},
    exposesPrivatePayloads: false,
  };
}

export type CreateXStateMachineProjectionOptions = {
  id: WorkflowId;
  version: WorkflowVersion;
  initial: string;
  states?: Record<string, XStateProjectionState>;
  transitions?: XStateProjectionTransition[];
  actors?: Record<string, XStateProjectionActor>;
  guards?: Record<string, XStateProjectionGuard>;
  actions?: Record<string, XStateProjectionAction>;
  delays?: Record<string, XStateProjectionDelay>;
  contextShape?: XStateProjectionContextShape;
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

export type WorkflowNodeXStateProjection = {
  initial: string;
  states: Record<string, XStateProjectionState>;
  actors: Record<string, XStateProjectionActor>;
  actions: Record<string, XStateProjectionAction>;
  delays: Record<string, XStateProjectionDelay>;
  contextShape: XStateProjectionContextShape;
};

export type WorkflowEdgeXStateProjection = {
  transitions: XStateProjectionTransition[];
  guards: Record<string, XStateProjectionGuard>;
  actions: Record<string, XStateProjectionAction>;
};

export function projectWorkflowNodesToXState(definition: WorkflowDefinition): WorkflowNodeXStateProjection {
  const states: Record<string, XStateProjectionState> = {};
  const actors: Record<string, XStateProjectionActor> = {};
  const actions: Record<string, XStateProjectionAction> = {};
  const delays: Record<string, XStateProjectionDelay> = {};

  for (const [nodeId, node] of Object.entries(definition.nodes).sort(([left], [right]) => left.localeCompare(right))) {
    const actor = createXStateProjectionActorForNode(nodeId, node);
    const retryPolicy = node.retry ?? definition.retry;
    const state = createXStateProjectionStateForNode(nodeId, node, actor, retryPolicy);
    const failureAction = createXStateRecordFailureAction(nodeId);

    actors[actor.id] = actor;
    actions[failureAction.id] = failureAction;
    states[state.id] = state;

    if (node.kind === "human") {
      const enterWaitAction = createXStateEnterWaitAction(nodeId);
      const resumeWaitAction = createXStateResumeWaitAction(nodeId);
      actions[enterWaitAction.id] = enterWaitAction;
      actions[resumeWaitAction.id] = resumeWaitAction;

      if (node.timeout !== undefined) {
        const timeoutDelay = createXStateHumanTimeoutDelay(nodeId, node.timeout);
        delays[timeoutDelay.id] = timeoutDelay;
      }
    }

    if (retryPolicy !== undefined) {
      const retryDelay = createXStateRetryDelay(nodeId, retryPolicy);
      const scheduleRetryAction = createXStateScheduleRetryAction(nodeId);
      delays[retryDelay.id] = retryDelay;
      actions[scheduleRetryAction.id] = scheduleRetryAction;
      states[xstateRetryDelayStateIdForNode(nodeId)] = createXStateRetryDelayStateForNode(
        nodeId,
        retryPolicy,
        retryDelay.id,
      );
    }
  }

  return {
    initial: xstateInitialStateIdForWorkflow(definition),
    states,
    actors,
    actions,
    delays,
    contextShape: createXStateProjectionContextShape({
      global: definition.state?.global,
      local: Object.fromEntries(
        Object.entries(definition.nodes)
          .filter(([, node]) => node.state !== undefined)
          .map(([nodeId, node]) => [nodeId, node.state]),
      ),
      edge: Object.fromEntries(
        Object.entries(definition.edges)
          .filter(([, edge]) => edge.state !== undefined)
          .map(([edgeId, edge]) => [edgeId, edge.state]),
      ),
    }),
  };
}

export function projectWorkflowEdgesToXState(definition: WorkflowDefinition): WorkflowEdgeXStateProjection {
  const transitions: XStateProjectionTransition[] = [];
  const guards: Record<string, XStateProjectionGuard> = {};
  const actions: Record<string, XStateProjectionAction> = {};

  const loopGuardsByEdgeId = new Map(
    (definition.loops ?? [])
      .filter((loop) => loop.guard?.handler !== undefined)
      .map((loop) => [loop.edgeId, loop.guard]),
  );

  for (const [edgeId, edge] of Object.entries(definition.edges).sort(compareWorkflowEdgeEntriesForXState)) {
    const actionId = xstateTransferEdgeActionId(edgeId);
    const guard = edge.guard ?? loopGuardsByEdgeId.get(edgeId);
    actions[actionId] = {
      id: actionId,
      kind: "transferEdge",
      edgeId,
      durableEffect: true,
    };

    const transition: XStateProjectionTransition = {
      id: xstateTransitionIdForEdge(edgeId),
      event: xstateEventForEdge(edge),
      source: xstateStateIdForNode(edge.from.nodeId),
      target: xstateStateIdForNode(edge.to.nodeId),
      edgeId,
      actions: [actionId],
      meta: createXStateTransitionMetaForEdge(edgeId, edge, guard),
    };
    if (guard?.handler !== undefined) {
      transition.guard = guard.handler;
      guards[guard.handler] ??= {
        id: guard.handler,
        ref: guard.handler,
        edgeId,
      };
    }

    transitions.push(transition);
  }

  return { transitions, guards, actions };
}

export function projectWorkflowToXStateProjection(definition: WorkflowDefinition): XStateMachineProjection {
  const nodeProjection = projectWorkflowNodesToXState(definition);
  const edgeProjection = projectWorkflowEdgesToXState(definition);
  const finalProjection = projectWorkflowFinalStatesToXState(definition);

  return createXStateMachineProjection({
    id: definition.id,
    version: definition.version,
    initial: nodeProjection.initial,
    states: nodeProjection.states,
    transitions: [...edgeProjection.transitions, ...finalProjection.transitions],
    actors: nodeProjection.actors,
    guards: edgeProjection.guards,
    actions: { ...nodeProjection.actions, ...edgeProjection.actions, ...finalProjection.actions },
    delays: nodeProjection.delays,
    contextShape: nodeProjection.contextShape,
    metadata: definition.metadata,
    ui: definition.ui,
  });
}

export function createXStateMachineProjection(options: CreateXStateMachineProjectionOptions): XStateMachineProjection {
  const contextShape = options.contextShape ?? createXStateProjectionContextShape();
  const states = options.states ?? {};
  const transitions = options.transitions ?? [];
  const actors = options.actors ?? {};
  const guards = options.guards ?? {};
  const actions = options.actions ?? {};
  const delays = options.delays ?? {};

  const config = createXStateMachineConfig({
    id: options.id,
    version: options.version,
    initial: options.initial,
    states,
    transitions,
    actors,
    guards,
    actions,
    delays,
    contextShape,
    metadata: options.metadata,
    ui: options.ui,
  });

  return {
    kind: WORKFLOW_XSTATE_PROJECTION_KIND,
    schemaVersion: WORKFLOW_XSTATE_PROJECTION_VERSION,
    id: options.id,
    version: options.version,
    initial: options.initial,
    config,
    states,
    transitions,
    actors,
    guards,
    actions,
    delays,
    contextShape,
    finalStates: WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
    metadata: options.metadata,
    ui: options.ui,
  };
}

export type CreateWorkflowXStateUiModelOptions = {
  snapshot?: WorkflowMachineSnapshot;
  activeStateIds?: string[];
};

export function createWorkflowXStateUiModel(
  projection: XStateMachineProjection,
  options: CreateWorkflowXStateUiModelOptions = {},
): WorkflowXStateUiModel {
  const current = createWorkflowXStateUiCurrent(projection, options);
  const activeStateIds = new Set(current?.stateIds ?? []);
  return {
    kind: WORKFLOW_XSTATE_UI_MODEL_KIND,
    schemaVersion: WORKFLOW_XSTATE_UI_MODEL_VERSION,
    projection: {
      kind: projection.kind,
      schemaVersion: projection.schemaVersion,
      workflowId: projection.id,
      workflowVersion: projection.version,
      initialStateId: projection.initial,
      durableTruth: projection.contextShape.durableTruth,
      exposesPrivatePayloads: projection.contextShape.exposesPrivatePayloads,
      snapshotKinds: [...WORKFLOW_XSTATE_SNAPSHOT_KINDS],
    },
    ...(current ? { current } : {}),
    nodes: createWorkflowXStateUiNodes(projection, activeStateIds, current?.status),
    edges: createWorkflowXStateUiEdges(projection),
    actors: createWorkflowXStateUiActors(projection),
    guards: Object.values(projection.guards).sort((left, right) => left.id.localeCompare(right.id)),
    actions: Object.values(projection.actions).sort((left, right) => left.id.localeCompare(right.id)),
    delays: Object.values(projection.delays).sort((left, right) => left.id.localeCompare(right.id)),
    finalStates: projection.finalStates,
    ui: projection.ui,
  };
}

function createWorkflowXStateUiCurrent(
  projection: XStateMachineProjection,
  options: CreateWorkflowXStateUiModelOptions,
): WorkflowXStateUiCurrent | undefined {
  const snapshot = options.snapshot;
  const stateIds = options.activeStateIds ?? (snapshot ? activeStateIdsFromWorkflowSnapshot(projection, snapshot) : []);
  if (!snapshot && stateIds.length === 0) {
    return undefined;
  }

  return {
    ...(snapshot ? { snapshotKind: snapshot.kind, runId: snapshot.runId, status: snapshot.status } : {}),
    stateIds,
    ...(snapshot?.current.nodeId ? { nodeId: snapshot.current.nodeId } : {}),
    ...(snapshot?.current.edgeId ? { edgeId: snapshot.current.edgeId } : {}),
  };
}

function activeStateIdsFromWorkflowSnapshot(
  projection: XStateMachineProjection,
  snapshot: WorkflowMachineSnapshot,
): string[] {
  const terminalStateId = terminalStateIdForWorkflowStatus(projection, snapshot.status);
  if (terminalStateId !== undefined) {
    return [terminalStateId];
  }
  if (snapshot.current.nodeId !== undefined) {
    return [xstateStateIdForNode(snapshot.current.nodeId)];
  }
  return [projection.initial];
}

function terminalStateIdForWorkflowStatus(
  projection: XStateMachineProjection,
  status: WorkflowRunStatus,
): string | undefined {
  if (status === "completed") {
    return projection.finalStates.completed;
  }
  if (status === "failed") {
    return projection.finalStates.failed;
  }
  if (status === "cancelled") {
    return projection.finalStates.cancelled;
  }
  return undefined;
}

function createWorkflowXStateUiNodes(
  projection: XStateMachineProjection,
  activeStateIds: ReadonlySet<string>,
  workflowStatus: WorkflowRunStatus | undefined,
): WorkflowXStateUiNode[] {
  const projectedStates = Object.values(projection.states).sort((left, right) => left.id.localeCompare(right.id));
  const terminalStates: XStateProjectionState[] = (Object.entries(projection.finalStates) as Array<[
    XStateProjectionTerminalKind,
    string,
  ]>).map(([terminalKind, stateId]) => ({
    id: stateId,
    kind: "terminal",
    type: "final",
    tags: [terminalKind],
    meta: {
      pibo: {
        kind: "terminal",
        terminal: { status: terminalKind },
      },
    },
  }));

  return [...projectedStates, ...terminalStates]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((state) => {
      const pibo = state.meta?.pibo;
      const status = workflowXStateUiNodeStatus(state, activeStateIds, workflowStatus);
      return {
        id: state.id,
        label: workflowXStateUiNodeLabel(state),
        kind: state.kind,
        type: state.type,
        nodeId: state.nodeId,
        nodeKind: pibo?.nodeKind,
        actorId: state.actorId ?? pibo?.actorId,
        status,
        tags: [...(state.tags ?? pibo?.tags ?? [])],
        description: pibo?.description,
        position: pibo?.ui?.position,
        collapsed: pibo?.ui?.collapsed,
        color: pibo?.ui?.color,
        icon: pibo?.ui?.icon,
        wait: pibo?.wait,
        retry: pibo?.retry,
        terminal: pibo?.terminal,
      };
    });
}

function workflowXStateUiNodeLabel(state: Pick<XStateProjectionState, "id" | "kind" | "nodeId" | "meta">): string {
  if (state.kind === "terminal") {
    return state.meta?.pibo.terminal?.status ?? state.id;
  }
  if (state.kind === "retryDelay") {
    return state.nodeId ? `${state.nodeId} retry delay` : state.id;
  }
  return state.nodeId ?? state.id;
}

function workflowXStateUiNodeStatus(
  state: Pick<XStateProjectionState, "id" | "kind">,
  activeStateIds: ReadonlySet<string>,
  workflowStatus: WorkflowRunStatus | undefined,
): WorkflowXStateUiNodeStatus {
  if (!activeStateIds.has(state.id)) {
    return "idle";
  }
  if (state.kind === "terminal") {
    if (workflowStatus === "completed" || workflowStatus === "failed" || workflowStatus === "cancelled") {
      return workflowStatus;
    }
    return "active";
  }
  if (state.kind === "wait" || workflowStatus === "waiting") {
    return "waiting";
  }
  if (state.kind === "retryDelay") {
    return "retry_scheduled";
  }
  if (workflowStatus === "failed" || workflowStatus === "cancelled") {
    return workflowStatus;
  }
  return "active";
}

function createWorkflowXStateUiEdges(projection: XStateMachineProjection): WorkflowXStateUiEdge[] {
  return projection.transitions.map((transition, index) => {
    const edgeUi = transition.meta?.pibo.ui;
    return {
      id: transition.id ?? `workflow.transition.${index}`,
      source: transition.source,
      target: transition.target,
      event: transition.event,
      edgeId: transition.edgeId,
      edgeKind: transition.meta?.pibo.edgeKind,
      guardRef: transition.guard,
      adapterRef: transition.meta?.pibo.adapterRef,
      actions: [...(transition.actions ?? [])],
      label: edgeUi?.label,
      color: edgeUi?.color,
      priority: transition.meta?.pibo.priority,
    };
  });
}

function createWorkflowXStateUiActors(projection: XStateMachineProjection): WorkflowXStateUiActor[] {
  return Object.values(projection.actors)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((actor) => ({
      id: actor.id,
      nodeId: actor.nodeId,
      kind: actor.kind,
      src: actor.src,
      childWorkflowId: actor.childWorkflowId,
      childWorkflowVersion: actor.childWorkflowVersion,
    }));
}

type CreateXStateMachineConfigOptions = {
  id: WorkflowId;
  version: WorkflowVersion;
  initial: string;
  states: Record<string, XStateProjectionState>;
  transitions: XStateProjectionTransition[];
  actors: Record<string, XStateProjectionActor>;
  guards: Record<string, XStateProjectionGuard>;
  actions: Record<string, XStateProjectionAction>;
  delays: Record<string, XStateProjectionDelay>;
  contextShape: XStateProjectionContextShape;
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

function createXStateMachineConfig(options: CreateXStateMachineConfigOptions): XStateProjectionMachineConfig {
  const configStates: XStateProjectionMachineConfig["states"] = {};

  for (const state of Object.values(options.states).sort((a, b) => a.id.localeCompare(b.id))) {
    configStates[state.id] = {
      id: state.id,
      type: state.type,
      tags: state.tags,
      entry: state.entry,
      exit: state.exit,
      invoke: state.invoke,
      after: state.after,
      meta: state.meta,
    };
  }

  for (const [terminalKind, terminalStateId] of Object.entries(WORKFLOW_XSTATE_TERMINAL_STATE_IDS) as Array<[
    XStateProjectionTerminalKind,
    string,
  ]>) {
    configStates[terminalStateId] ??= {
      id: terminalStateId,
      type: "final",
      meta: createTerminalStateMeta(terminalKind),
    };
  }

  for (const transition of options.transitions) {
    const sourceState = configStates[transition.source];
    if (!sourceState) {
      continue;
    }

    sourceState.on ??= {};
    const projectedTransition: XStateProjectionTransitionConfig = {
      target: transition.target,
    };
    if (transition.guard !== undefined) {
      projectedTransition.guard = transition.guard;
    }
    if (transition.actions !== undefined) {
      projectedTransition.actions = transition.actions;
    }
    if (transition.meta !== undefined) {
      projectedTransition.meta = transition.meta;
    }
    const existingTransition = sourceState.on[transition.event];
    if (existingTransition === undefined) {
      sourceState.on[transition.event] = projectedTransition;
    } else if (Array.isArray(existingTransition)) {
      existingTransition.push(projectedTransition);
    } else {
      sourceState.on[transition.event] = [existingTransition, projectedTransition];
    }
  }

  return {
    id: options.id,
    initial: options.initial,
    states: configStates,
    meta: {
      pibo: {
        schemaVersion: WORKFLOW_XSTATE_PROJECTION_VERSION,
        workflowId: options.id,
        workflowVersion: options.version,
        snapshotKinds: [...WORKFLOW_XSTATE_SNAPSHOT_KINDS],
        contextShape: options.contextShape,
        actors: options.actors,
        guards: options.guards,
        actions: options.actions,
        delays: options.delays,
        finalStates: WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
        metadata: options.metadata,
        ui: options.ui,
      },
    },
  };
}

function createTerminalStateMeta(kind: XStateProjectionTerminalKind): XStateProjectionStateMeta {
  return {
    pibo: {
      kind: "terminal",
      terminal: {
        status: kind,
      },
    },
  };
}

export function createXStateProjectionActorForNode(
  nodeId: NodeId,
  node: WorkflowNodeDefinition,
): XStateProjectionActor {
  return {
    id: xstateActorIdForNode(nodeId),
    src: xstateActorSourceForNodeKind(node.kind),
    nodeId,
    kind: node.kind,
    input: { kind: "nodeInput", nodeId },
    childWorkflowId: node.kind === "workflow" ? node.workflowId : undefined,
    childWorkflowVersion: node.kind === "workflow" ? node.workflowVersion : undefined,
    metadata: node.metadata,
  };
}

export function createXStateProjectionStateForNode(
  nodeId: NodeId,
  node: WorkflowNodeDefinition,
  actor: XStateProjectionActor = createXStateProjectionActorForNode(nodeId, node),
  retryPolicy: RetryPolicy | undefined = node.retry,
): XStateProjectionState {
  const tags = [node.kind, ...(node.kind === "human" ? ["wait"] : []), ...(node.metadata?.tags ?? [])];
  const stateKind = node.kind === "human" ? "wait" : "node";
  const state: XStateProjectionState = {
    id: xstateStateIdForNode(nodeId),
    kind: stateKind,
    nodeId,
    type: "atomic",
    actorId: actor.id,
    invoke: {
      id: actor.id,
      src: actor.src,
      input: actor.input,
      onError: {
        target: xstateFailureTargetForNode(nodeId, retryPolicy),
        actions: xstateFailureActionsForNode(nodeId, retryPolicy),
      },
    },
    tags,
    meta: {
      pibo: {
        kind: stateKind,
        nodeId,
        nodeKind: node.kind,
        actorId: actor.id,
        description: node.description,
        tags,
        ui: node.ui,
      },
    },
  };

  if (node.kind === "human") {
    state.entry = [xstateEnterWaitActionId(nodeId)];
    state.exit = [xstateResumeWaitActionId(nodeId)];
    state.meta = {
      pibo: {
        kind: stateKind,
        nodeId,
        nodeKind: node.kind,
        actorId: actor.id,
        description: node.description,
        tags,
        ui: node.ui,
        wait: {
          durable: true,
          resumeEvent: WORKFLOW_XSTATE_RESUME_EVENT,
          actions: node.actions,
          timeout: node.timeout,
        },
      },
    };

    if (node.timeout !== undefined) {
      state.after = {
        [xstateHumanTimeoutDelayId(nodeId)]: {
          target: WORKFLOW_XSTATE_TERMINAL_STATE_IDS.failed,
          actions: [xstateRecordFailureActionId(nodeId)],
        },
      };
    }
  }

  return state;
}

export function xstateTransitionIdForEdge(edgeId: EdgeId): string {
  return `workflow.edge.${edgeId}.transition`;
}

export function xstateTransferEdgeActionId(edgeId: EdgeId): string {
  return `workflow.edge.${edgeId}.transfer`;
}

export function xstateRecordFailureActionId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.recordFailure`;
}

export function xstateEnterWaitActionId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.enterWait`;
}

export function xstateResumeWaitActionId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.resumeWait`;
}

export function xstateScheduleRetryActionId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.scheduleRetry`;
}

export function xstateCompleteNodeActionId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.complete`;
}

export function xstateRetryDelayId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.retryDelay`;
}

export function xstateHumanTimeoutDelayId(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.humanTimeout`;
}

export function xstateEventForEdge(edge: WorkflowEdgeDefinition): string {
  if (edge.event !== undefined) {
    return edge.event;
  }

  const kind = xstateEdgeKind(edge);
  if (kind === "error") {
    return WORKFLOW_XSTATE_FAIL_EVENT;
  }
  if (kind === "resume") {
    return WORKFLOW_XSTATE_RESUME_EVENT;
  }

  return WORKFLOW_XSTATE_NODE_DONE_EVENT;
}

export function createXStateTransitionMetaForEdge(
  edgeId: EdgeId,
  edge: WorkflowEdgeDefinition,
  guard = edge.guard,
): XStateProjectionTransitionMeta {
  const pibo: XStateProjectionTransitionMeta["pibo"] = {
    edgeId,
    edgeKind: xstateEdgeKind(edge),
  };

  if (guard?.handler !== undefined) {
    pibo.guardRef = guard.handler;
  }
  if (edge.adapter?.transform.id !== undefined) {
    pibo.adapterRef = edge.adapter.transform.id;
  }
  if (edge.join !== undefined) {
    pibo.join = edge.join;
  }
  const priority = edge.priority ?? edge.guard?.priority;
  if (priority !== undefined) {
    pibo.priority = priority;
  }
  if (edge.ui !== undefined) {
    pibo.ui = edge.ui;
  }

  return { pibo };
}

function compareWorkflowEdgeEntriesForXState(
  [leftId, left]: [EdgeId, WorkflowEdgeDefinition],
  [rightId, right]: [EdgeId, WorkflowEdgeDefinition],
): number {
  const sourceComparison = left.from.nodeId.localeCompare(right.from.nodeId);
  if (sourceComparison !== 0) {
    return sourceComparison;
  }

  const eventComparison = xstateEventForEdge(left).localeCompare(xstateEventForEdge(right));
  if (eventComparison !== 0) {
    return eventComparison;
  }

  const priorityComparison = xstateEdgePriority(left) - xstateEdgePriority(right);
  if (priorityComparison !== 0) {
    return priorityComparison;
  }

  return leftId.localeCompare(rightId);
}

function xstateEdgeKind(edge: WorkflowEdgeDefinition): EdgeKind {
  return edge.kind ?? "data";
}

function xstateEdgePriority(edge: WorkflowEdgeDefinition): number {
  return edge.priority ?? edge.guard?.priority ?? Number.MAX_SAFE_INTEGER;
}

export function xstateActorIdForNode(nodeId: NodeId): string {
  return `workflow.node.${nodeId}`;
}

export function xstateActorSourceForNodeKind(kind: WorkflowNodeDefinition["kind"]): string {
  return WORKFLOW_XSTATE_ACTOR_SOURCES[kind];
}

export function xstateInitialStateIdForWorkflow(definition: WorkflowDefinition): string {
  const initialNodeId = Array.isArray(definition.initial) ? definition.initial[0] : definition.initial;
  return xstateStateIdForNode(initialNodeId);
}

export function xstateStateIdForNode(nodeId: NodeId): string {
  return `node.${nodeId}`;
}

export function xstateRetryDelayStateIdForNode(nodeId: NodeId): string {
  return `node.${nodeId}.retryDelay`;
}

type WorkflowFinalXStateProjection = {
  transitions: XStateProjectionTransition[];
  actions: Record<string, XStateProjectionAction>;
};

function projectWorkflowFinalStatesToXState(definition: WorkflowDefinition): WorkflowFinalXStateProjection {
  const transitions: XStateProjectionTransition[] = [];
  const actions: Record<string, XStateProjectionAction> = {};
  const finalNodeIds = Array.isArray(definition.final)
    ? definition.final
    : definition.final === undefined
      ? []
      : [definition.final];

  for (const nodeId of [...finalNodeIds].sort((left, right) => left.localeCompare(right))) {
    if (definition.nodes[nodeId] === undefined) {
      continue;
    }

    const action = createXStateCompleteNodeAction(nodeId);
    actions[action.id] = action;
    transitions.push({
      id: xstateFinalTransitionIdForNode(nodeId),
      event: WORKFLOW_XSTATE_NODE_DONE_EVENT,
      source: xstateStateIdForNode(nodeId),
      target: WORKFLOW_XSTATE_TERMINAL_STATE_IDS.completed,
      actions: [action.id],
    });
  }

  return { transitions, actions };
}

function createXStateRecordFailureAction(nodeId: NodeId): XStateProjectionAction {
  return {
    id: xstateRecordFailureActionId(nodeId),
    kind: "recordFailure",
    nodeId,
    durableEffect: true,
  };
}

function createXStateEnterWaitAction(nodeId: NodeId): XStateProjectionAction {
  return {
    id: xstateEnterWaitActionId(nodeId),
    kind: "enterWait",
    nodeId,
    durableEffect: true,
  };
}

function createXStateResumeWaitAction(nodeId: NodeId): XStateProjectionAction {
  return {
    id: xstateResumeWaitActionId(nodeId),
    kind: "resumeWait",
    nodeId,
    durableEffect: true,
  };
}

function createXStateScheduleRetryAction(nodeId: NodeId): XStateProjectionAction {
  return {
    id: xstateScheduleRetryActionId(nodeId),
    kind: "scheduleRetry",
    nodeId,
    durableEffect: true,
  };
}

function createXStateCompleteNodeAction(nodeId: NodeId): XStateProjectionAction {
  return {
    id: xstateCompleteNodeActionId(nodeId),
    kind: "completeNode",
    nodeId,
    durableEffect: true,
  };
}

function createXStateRetryDelay(nodeId: NodeId, policy: RetryPolicy): XStateProjectionDelay {
  return {
    id: xstateRetryDelayId(nodeId),
    kind: "retry",
    nodeId,
    duration: retryBackoffDuration(policy.backoff),
    durableWakeup: true,
  };
}

function createXStateHumanTimeoutDelay(nodeId: NodeId, duration: DurationSpec): XStateProjectionDelay {
  return {
    id: xstateHumanTimeoutDelayId(nodeId),
    kind: "humanTimeout",
    nodeId,
    duration,
    durableWakeup: true,
  };
}

function createXStateRetryDelayStateForNode(
  nodeId: NodeId,
  policy: RetryPolicy,
  delayId: string,
): XStateProjectionState {
  return {
    id: xstateRetryDelayStateIdForNode(nodeId),
    kind: "retryDelay",
    nodeId,
    type: "atomic",
    tags: ["retryDelay"],
    after: {
      [delayId]: {
        target: xstateStateIdForNode(nodeId),
      },
    },
    meta: {
      pibo: {
        kind: "retryDelay",
        nodeId,
        retry: {
          durable: true,
          delayId,
          policy,
        },
      },
    },
  };
}

function xstateFailureTargetForNode(nodeId: NodeId, retryPolicy: RetryPolicy | undefined): string {
  return retryPolicy === undefined
    ? WORKFLOW_XSTATE_TERMINAL_STATE_IDS.failed
    : xstateRetryDelayStateIdForNode(nodeId);
}

function xstateFailureActionsForNode(nodeId: NodeId, retryPolicy: RetryPolicy | undefined): string[] {
  return retryPolicy === undefined
    ? [xstateRecordFailureActionId(nodeId)]
    : [xstateRecordFailureActionId(nodeId), xstateScheduleRetryActionId(nodeId)];
}

function retryBackoffDuration(policy: RetryPolicy["backoff"]): XStateProjectionDelay["duration"] {
  if (policy === undefined || policy.kind === "none") {
    return undefined;
  }

  if (policy.kind === "fixed") {
    return { kind: "milliseconds", value: policy.delayMs };
  }

  if (policy.kind === "linear") {
    return { kind: "milliseconds", value: policy.initialMs };
  }

  return { kind: "milliseconds", value: policy.initialMs };
}

function xstateFinalTransitionIdForNode(nodeId: NodeId): string {
  return `workflow.node.${nodeId}.complete.transition`;
}
