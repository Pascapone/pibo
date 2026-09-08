import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";

export const PI_CODEX_PREFIX_CODEC = "pi-0.85.0/openai-codex-responses/v1";

type PiPrefixSnapshot = {
	format: 1;
	systemPrompt: string;
	tools: NonNullable<Context["tools"]>;
	providerStatic: Record<string, unknown>;
};

const PROVIDER_FIELDS = new Set([
	"model", "store", "stream", "instructions", "text", "include", "prompt_cache_key",
	"tool_choice", "parallel_tool_calls", "temperature", "service_tier", "tools", "reasoning",
]);

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode(payload: string): PiPrefixSnapshot {
	let value: unknown;
	try { value = JSON.parse(payload); } catch { throw new PrefixRecoveryRequiredError("invalid Pi prefix payload"); }
	if (!object(value) || value.format !== 1 || typeof value.systemPrompt !== "string"
		|| !Array.isArray(value.tools) || !object(value.providerStatic)
		|| value.tools.some(tool => !object(tool) || typeof tool.name !== "string" || typeof tool.description !== "string" || !object(tool.parameters))) {
		throw new PrefixRecoveryRequiredError("unsupported Pi prefix payload");
	}
	for (const key of Object.keys(value.providerStatic)) {
		if (!PROVIDER_FIELDS.has(key)) throw new PrefixRecoveryRequiredError("unsupported Pi provider prefix field");
	}
	return value as PiPrefixSnapshot;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function captureTools(tools: Context["tools"]): NonNullable<Context["tools"]> {
	// Executable closures and current credentials never enter the artifact.
	return (tools ?? []).map(tool => ({
		name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters),
		...(tool.constrainedSampling === undefined ? {} : { constrainedSampling: structuredClone(tool.constrainedSampling) }),
	}));
}

/**
 * Narrow codec at the SDK's final onPayload seam, after provider extensions.
 * This is an adapter-input proof, not a claim that mutable native history or
 * resource paths have already met the complete session-resume contract.
 * Unsupported APIs/configuration transitions fail instead of rewriting them.
 */
export async function installPiCodexPrefixCodec(
	session: AgentSession,
	controller: SessionPrefixController,
): Promise<void> {
	const restored = await controller.restore(PI_CODEX_PREFIX_CODEC);
	let snapshot = restored === undefined ? undefined : deepFreeze(decode(restored));
	const historical = session.sessionManager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant");
	if (!snapshot && historical) throw new PrefixRecoveryRequiredError("Pi history has no captured original prefix");
	if (snapshot) {
		const available = new Map(session.agent.state.tools.map(tool => [tool.name, tool]));
		for (const tool of snapshot.tools) {
			const current = available.get(tool.name);
			if (!current || JSON.stringify(current.parameters) !== JSON.stringify(tool.parameters)
				|| JSON.stringify(current.constrainedSampling) !== JSON.stringify(tool.constrainedSampling)) {
				throw new PrefixRecoveryRequiredError(`frozen Pi tool ${tool.name} is unavailable or incompatible`);
			}
		}
	}
	const stream = session.agent.streamFunction;
	session.agent.streamFunction = async (model, context, options) => {
		// Compaction uses a separate summarization prompt and must retain native semantics.
		if (session.isCompacting) return stream(model, context, options);
		if (model.api !== "openai-codex-responses") throw new PrefixRecoveryRequiredError("Pi prefix codec does not support this provider API");
		if (snapshot && snapshot.providerStatic.model !== model.id) throw new PrefixRecoveryRequiredError("model change requires an explicit prefix epoch transition");
		const frozenContext: Context = snapshot
			? { ...context, systemPrompt: snapshot.systemPrompt, tools: snapshot.tools }
			: context;
		const previousPayload = options?.onPayload;
		return stream(model, frozenContext, {
			...options,
			onPayload: async (raw, requestModel) => {
				const transformed = await previousPayload?.(raw, requestModel) ?? raw;
				if (!object(transformed) || !Array.isArray(transformed.input)) throw new PrefixRecoveryRequiredError("unexpected Pi provider payload");
				for (const key of Object.keys(transformed)) {
					if (key !== "input" && !PROVIDER_FIELDS.has(key)) throw new PrefixRecoveryRequiredError("new provider field requires a compatible prefix codec");
				}
				if (!snapshot) {
					const providerStatic: Record<string, unknown> = {};
					for (const key of Object.keys(transformed)) if (key !== "input") providerStatic[key] = structuredClone(transformed[key]);
					const captured: PiPrefixSnapshot = {
						format: 1, systemPrompt: frozenContext.systemPrompt ?? "", tools: captureTools(frozenContext.tools), providerStatic,
					};
					await controller.seal({
						codec: PI_CODEX_PREFIX_CODEC, payload: JSON.stringify(captured), nativeSessionId: session.sessionId,
						evidence: "adapter-inputs", hasHistoricalModelInput: historical,
					});
					snapshot = deepFreeze(captured);
				}
				// Configuration changes are not silently undone. They need a visible epoch transition.
				for (const key of ["model", "reasoning", "text", "service_tier", "temperature", "prompt_cache_key"]) {
					if (JSON.stringify(transformed[key]) !== JSON.stringify(snapshot.providerStatic[key])) {
						throw new PrefixRecoveryRequiredError("provider configuration or cache affinity changed; explicit transition required");
					}
				}
				// Only a shallow envelope allocation; no per-turn history or tools serialization.
				return { ...snapshot.providerStatic, input: transformed.input };
			},
		});
	};
}
