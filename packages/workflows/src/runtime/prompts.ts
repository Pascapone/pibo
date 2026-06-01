import type {
  AgentNodeDefinition,
  JsonObject,
  JsonValue,
  NodeAttempt,
  NodeLocalStateReader,
  PromptBuilderRef,
  PromptBuilderResult,
  RecordedAgentPrompt,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowGlobalStateReader,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowValue,
} from "../types/index.js";
import { resolveWorkflowPromptBuilder } from "../registry/index.js";
import { createCurrentNodeStateView, createNodeScopedWorkflowRun } from "./state.js";
import { createEdgePayloadReader } from "./edge-payloads.js";

export type AgentNodePromptBuildResult =
  | { ok: true; prompt: string; recordedPrompt: RecordedAgentPrompt }
  | { ok: false; diagnostics: WorkflowDiagnostic[]; error: WorkflowErrorSummary };

export type AgentNodePromptBuildOptions = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  edgePayloads?: Record<string, WorkflowValue>;
};

export async function buildAgentNodePrompt(
  node: AgentNodeDefinition,
  input: WorkflowValue,
  options: AgentNodePromptBuildOptions,
): Promise<AgentNodePromptBuildResult> {
  if (node.promptBuilder !== undefined) {
    return buildAgentNodePromptWithRegisteredBuilder(node, input, options);
  }

  if (!node.promptTemplate) {
    const prompt = formatPromptTemplateValue(input);
    return { ok: true, prompt, recordedPrompt: createRecordedAgentPrompt(prompt, "input") };
  }

  const prompt = renderPromptTemplate(node.promptTemplate, {
    input,
    state: options.run.state,
    nodeId: options.nodeId,
  });
  return {
    ok: true,
    prompt,
    recordedPrompt: createRecordedAgentPrompt(prompt, "promptTemplate"),
  };
}

async function buildAgentNodePromptWithRegisteredBuilder(
  node: AgentNodeDefinition,
  input: WorkflowValue,
  options: AgentNodePromptBuildOptions,
): Promise<AgentNodePromptBuildResult> {
  const builderId = getPromptBuilderRefId(node.promptBuilder!);
  const builder = builderId && options.registry
    ? resolveWorkflowPromptBuilder(options.registry, node.promptBuilder!)
    : undefined;

  if (!builderId || !builder) {
    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.unknownPromptBuilderRef",
      message: `Workflow agent node '${options.nodeId}' references prompt builder '${builderId ?? "<invalid>"}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Pass a Workflow Registry with the prompt builder registered before dispatching an agent node with promptBuilder.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder resolution failed.",
      },
    };
  }

  try {
    const result = await builder.value({
      input,
      state: createCurrentNodeStateView(options.run.state, options.nodeId),
      global: createPromptBuilderStateReader(options.run.state.global),
      local: createPromptBuilderStateReader(options.run.state.local?.[options.nodeId] ?? {}),
      edge: createEdgePayloadReader(options.edgePayloads ?? {}),
      node,
      nodeId: options.nodeId,
      run: createNodeScopedWorkflowRun(options.run, options.nodeId),
      workflow: options.workflow,
    });
    const normalized = normalizePromptBuilderResult(result);
    if (normalized !== undefined) {
      return {
        ok: true,
        prompt: normalized.prompt,
        recordedPrompt: createRecordedAgentPrompt(normalized.prompt, "promptBuilder", {
          promptBuilderId: builderId,
          builderMetadata: normalized.metadata,
        }),
      };
    }

    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.invalidPromptBuilderResult",
      message: `Workflow prompt builder '${builderId}' for agent node '${options.nodeId}' returned an invalid prompt result.`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Return a prompt string or an object with a string prompt property from the registered prompt builder.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder output was invalid.",
      },
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Prompt builder failed with a non-Error value.";
    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.promptBuilderFailed",
      message: `Workflow prompt builder '${builderId}' for agent node '${options.nodeId}' failed: ${message}`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Fix the registered prompt builder implementation or replace the promptBuilder ref.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder execution failed.",
      },
    };
  }
}

function normalizePromptBuilderResult(
  result: PromptBuilderResult | unknown,
): { prompt: string; metadata?: Record<string, JsonValue> } | undefined {
  if (typeof result === "string") {
    return { prompt: result };
  }

  if (isPromptTemplateObject(result) && typeof result.prompt === "string") {
    const metadata = isJsonObject(result.metadata) ? result.metadata : undefined;
    return {
      prompt: result.prompt,
      ...(metadata ? { metadata } : {}),
    };
  }

  return undefined;
}

function createRecordedAgentPrompt(
  text: string,
  source: RecordedAgentPrompt["source"],
  options: Pick<RecordedAgentPrompt, "promptBuilderId" | "builderMetadata"> = {},
): RecordedAgentPrompt {
  return {
    text,
    source,
    tracePrivacy: {
      kind: "workflowRun",
      storage: "workflow-node-attempt",
      redacted: false,
    },
    ...(options.promptBuilderId ? { promptBuilderId: options.promptBuilderId } : {}),
    ...(options.builderMetadata ? { builderMetadata: options.builderMetadata } : {}),
  };
}

export function recordFinalAgentPrompt(nodeAttempt: NodeAttempt, prompt: RecordedAgentPrompt): void {
  nodeAttempt.metadata = {
    ...nodeAttempt.metadata,
    finalPrompt: prompt,
  };
}

function createPromptBuilderStateReader(values: Record<string, JsonValue>): WorkflowGlobalStateReader | NodeLocalStateReader {
  return {
    get(path) {
      return values[path];
    },
  };
}

function getPromptBuilderRefId(ref: PromptBuilderRef): string | undefined {
  if (typeof ref === "string") {
    return ref.length > 0 ? ref : undefined;
  }

  return ref.kind === "promptBuilder" && ref.language === "typescript" && ref.id.length > 0 ? ref.id : undefined;
}

function getPromptBuilderRefPath(ref: PromptBuilderRef, nodeId: string): string {
  return typeof ref === "string" ? `$.nodes.${nodeId}.promptBuilder` : `$.nodes.${nodeId}.promptBuilder.id`;
}

type PromptTemplateRenderContext = {
  input: WorkflowValue;
  state: WorkflowRun["state"];
  nodeId: string;
};

function renderPromptTemplate(template: string, context: PromptTemplateRenderContext): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (placeholder, expression: string) => {
    const resolved = resolvePromptTemplateExpression(expression.trim(), context);
    return resolved === undefined ? placeholder : formatPromptTemplateValue(resolved);
  });
}

function resolvePromptTemplateExpression(
  expression: string,
  context: PromptTemplateRenderContext,
): WorkflowValue | JsonValue | undefined {
  const path = expression.split(".").map((part) => part.trim()).filter(Boolean);
  const [root, ...rest] = path;

  if (!root) {
    return undefined;
  }

  if (root === "input") {
    return resolvePromptTemplatePath(context.input, rest);
  }

  if (root === "global") {
    return resolvePromptTemplatePath(context.state.global, rest);
  }

  if (root === "local") {
    return resolvePromptTemplatePath(context.state.local?.[context.nodeId] ?? {}, rest);
  }

  if (root === "state") {
    if (rest.length === 0) {
      return createCurrentNodeStateView(context.state, context.nodeId) as JsonValue;
    }

    const [scope, ...statePath] = rest;
    if (scope === "global") {
      return resolvePromptTemplatePath(context.state.global, statePath);
    }

    if (scope === "local") {
      return resolvePromptTemplatePath(context.state.local?.[context.nodeId] ?? {}, statePath);
    }

    return resolvePromptTemplatePath(context.state.global, rest);
  }

  return undefined;
}

function resolvePromptTemplatePath(value: unknown, path: string[]): WorkflowValue | JsonValue | undefined {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isPromptTemplateObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return isPromptTemplateValue(current) ? current : undefined;
}

function formatPromptTemplateValue(value: WorkflowValue | JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isPromptTemplateObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return isPromptTemplateObject(value) && Object.values(value).every(isPromptTemplateValue);
}

function isPromptTemplateValue(value: unknown): value is WorkflowValue | JsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      if (Array.isArray(value)) {
        return value.every(isPromptTemplateValue);
      }
      return Object.values(value).every(isPromptTemplateValue);
    default:
      return false;
  }
}
