import type { AgentRuntimeModelCatalog, AgentRuntimeModelInfo } from "../../agent-runtime/types.js";
import { OmpRpcClient } from "./client.js";

/** OMP thinking levels (from ai/types.ts ThinkingLevel). */
export const OMP_REASONING_VALUES = ["none", "low", "medium", "high"] as const;
export const OMP_MODEL_PROVIDER_ID = "omp";
export const OMP_MODEL_OPTIONS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		provider: { type: "string" },
		modelId: { type: "string" },
		thinkingLevel: { type: "string", enum: [...OMP_REASONING_VALUES] },
	},
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type OmpModelDescriptor = {
	provider?: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	thinking?: boolean;
	contextWindow?: number;
};

export function toAgentRuntimeModelCatalog(
	runtimeInstanceId: string,
	models: OmpModelDescriptor[],
): AgentRuntimeModelCatalog {
	return {
		runtimeInstanceId,
		models: models.map(toAgentRuntimeModelInfo),
	};
}

export function toAgentRuntimeModelInfo(model: OmpModelDescriptor): AgentRuntimeModelInfo {
	return {
		id: model.id,
		provider: model.provider ?? OMP_MODEL_PROVIDER_ID,
		displayName: model.name ?? model.id,
		reasoningOptions: model.reasoning || model.thinking ? [...OMP_REASONING_VALUES] : undefined,
		options: {
			provider: model.provider ?? OMP_MODEL_PROVIDER_ID,
			modelId: model.id,
		},
	};
}

export async function readOmpModelCatalog(client: OmpRpcClient, runtimeInstanceId: string): Promise<AgentRuntimeModelCatalog> {
	try {
		const result = await client.request({ type: "get_available_models" }, "get_available_models");
		const data = result["data" as keyof typeof result];
		if (data && typeof data === "object" && !Array.isArray(data) && "models" in data) {
			const models = (data as { models: unknown }).models;
			if (Array.isArray(models)) {
				const descriptors: OmpModelDescriptor[] = [];
				for (const item of models) {
					if (!isRecord(item)) continue;
					if (typeof item.id !== "string" || item.id.length === 0) continue;
					descriptors.push({
						provider: typeof item.provider === "string" ? item.provider : undefined,
						id: item.id,
						name: typeof item.name === "string" ? item.name : undefined,
						reasoning: item.reasoning === true,
						thinking: item.thinking === true,
						contextWindow: typeof item.contextWindow === "number" ? item.contextWindow : undefined,
					});
				}
				return toAgentRuntimeModelCatalog(runtimeInstanceId, descriptors);
			}
		}
	} catch {
		// Model discovery is best-effort in fixtures; empty catalog is acceptable.
	}
	return { runtimeInstanceId, models: [] };
}

export async function setOmpModel(
	client: OmpRpcClient,
	provider: string,
	modelId: string,
): Promise<AgentRuntimeModelInfo> {
	const result = await client.request({ type: "set_model", provider, modelId }, "set_model");
	const data = result["data" as keyof typeof result];
	if (isRecord(data) && typeof data.id === "string") {
		return toAgentRuntimeModelInfo({
			provider: typeof data.provider === "string" ? data.provider : provider,
			id: data.id,
			name: typeof data.name === "string" ? data.name : undefined,
		});
	}
	return { id: modelId, provider };
}

export type OmpReasoningInfo = {
	value?: string;
	availableValues: string[];
	supported: boolean;
};

export async function setOmpThinkingLevel(client: OmpRpcClient, level: string): Promise<void> {
	await client.request({ type: "set_thinking_level", level }, "set_thinking_level");
}

export function parseOmpReasoning(level: unknown): OmpReasoningInfo {
	if (typeof level === "string" && level.length > 0) {
		const normalized = OMP_REASONING_VALUES.includes(level as (typeof OMP_REASONING_VALUES)[number]) ? level : "medium";
		return { value: normalized, availableValues: [...OMP_REASONING_VALUES], supported: true };
	}
	return { availableValues: [...OMP_REASONING_VALUES], supported: true };
}