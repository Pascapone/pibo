import type {
  CodeNodeResult,
  NodeAttempt,
  NodeAttemptId,
  TypeScriptCodeNodeDefinition,
  WorkflowCommand,
  WorkflowCommandEmitter,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import type { WorkflowRunStore } from "../store/index.js";
import { resolveWorkflowHandler } from "../registry/index.js";
import { validateNodeOutput, validateWorkflowPortValue } from "../validation/index.js";
import {
  codeNodeDispatchFailure,
  failCodeNodeDispatch,
} from "./dispatch-failures.js";
import { createEdgePayloadReader } from "./edge-payloads.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import {
  applyCodeNodePatches,
  createStateReader,
  localStateSnapshotForNode,
  validateCodeNodePatches,
  WorkflowStateAccessViolation,
} from "./state.js";
import { createTimestampFactory } from "./time.js";

export type WorkflowCodeNodeDispatchOptions = {
  registry: Pick<WorkflowRegistry, "handlers">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  commandEmitter?: WorkflowCommandEmitter;
  edgePayloads?: Record<string, WorkflowValue>;
};

export type WorkflowCodeNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  result: CodeNodeResult;
  commands: WorkflowCommand[];
};

export type WorkflowCodeNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowCodeNodeDispatchResult = WorkflowCodeNodeDispatchSuccess | WorkflowCodeNodeDispatchFailure;

export async function dispatchWorkflowCodeNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowCodeNodeDispatchOptions,
): Promise<WorkflowCodeNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return codeNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as a code node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Code node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "code") {
    return codeNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.codeNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but code node dispatch requires a TypeScript code node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.codeNodeRequired",
        message: "Code node dispatch failed because the selected node is not a code node.",
      },
    });
  }

  const codeNode = node as TypeScriptCodeNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "code",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
    metadata: { handlerId: codeNode.handler },
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "node.started",
    runId: run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  await persistWorkflowRun(options.store, run);

  const handler = resolveWorkflowHandler(options.registry, codeNode.handler);
  const diagnostics: WorkflowDiagnostic[] = [];

  if (!handler) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownHandlerRef",
      message: `Workflow code node '${nodeId}' references handler '${codeNode.handler}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.handler`,
      hint: "Register the handler before dispatching the code node.",
    });
  }

  if (codeNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(codeNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failCodeNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.codeNodeDispatchFailed",
        message: "Code node dispatch failed before handler execution.",
      },
    });
  }

  try {
    const emittedCommands: WorkflowCommand[] = [];
    const handlerResult = await handler!.value({
      input,
      global: createStateReader("global", run.state.global, codeNode, nodeId),
      local: createStateReader("local", run.state.local?.[nodeId] ?? {}, codeNode, nodeId),
      edge: createEdgePayloadReader(options.edgePayloads ?? {}),
      emit: (event) => emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, event),
      command: async (command) => {
        emittedCommands.push(command);
        await options.commandEmitter?.(command);
      },
    });

    const commands = [...emittedCommands, ...toWorkflowCommandArray(handlerResult.command)];
    const patchDiagnostics = validateCodeNodePatches(definition, codeNode, nodeId, handlerResult);
    if (patchDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return failCodeNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: patchDiagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidCodeNodePatch",
          message: "Code node state patch failed validation before completion.",
        },
      });
    }

    const nodeOutputResult = validateNodeOutput(definition, nodeId, handlerResult.output);
    if (!nodeOutputResult.ok) {
      return failCodeNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Code node output failed validation before downstream use.",
        },
      });
    }

    applyCodeNodePatches(run, nodeId, handlerResult.globalPatch, handlerResult.localPatch);

    for (const command of commands) {
      if (!emittedCommands.includes(command)) {
        await options.commandEmitter?.(command);
      }
      if (command.kind === "emitEvent") {
        await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, command.event);
      }
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = handlerResult.output;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    nodeAttempt.completedAt = completedAt;
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: handlerResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: handlerResult.output,
      result: handlerResult,
      commands,
    };
  } catch (caught) {
    const diagnostics = caught instanceof WorkflowStateAccessViolation ? [caught.diagnostic] : [];
    return failCodeNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: codeNodeErrorSummaryFromCaught(caught),
    });
  }
}

function toWorkflowCommandArray(command: WorkflowCommand | WorkflowCommand[] | undefined): WorkflowCommand[] {
  if (!command) {
    return [];
  }

  return Array.isArray(command) ? command : [command];
}

function codeNodeErrorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof WorkflowStateAccessViolation) {
    return {
      code: caught.diagnostic.code,
      message: caught.message,
    };
  }

  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.codeHandlerFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.codeHandlerFailed",
    message: "Code node handler failed with a non-Error value.",
  };
}
