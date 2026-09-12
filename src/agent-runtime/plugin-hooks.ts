import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import type { PluginHookDescriptor, PluginHookResult } from "../plugins/contributions.js";
import type { PluginJsonValue } from "../plugins/manifest.js";
import type { PiboToolDefinition, PiboToolResult } from "../tools/contract.js";
import { redactSensitiveText } from "../core/sensitive-data-redaction.js";

export type PluginHookEvidence = {
	id: string; hookId: string; phase: PluginHookDescriptor["phase"]; order: number;
	status: "continued" | "transformed" | "rejected" | "failed";
	generation: string; piboSessionId: string; executed?: boolean; diagnostic?: string;
	provenance?: Extract<PluginHookResult, { action: "transform" }>["provenance"];
};
export type RuntimePluginHook = {
	descriptor: PluginHookDescriptor;
	run(value: PluginJsonValue, context: { piboSessionId: string; generation: string; toolName?: string; toolCallId?: string; signal: AbortSignal }): Promise<PluginHookResult> | PluginHookResult;
};
export type PluginHookScope = {
	piboSessionId: string; generation: string; toolName?: string; toolCallId?: string;
	signal?: AbortSignal; record: (evidence: PluginHookEvidence) => void;
};

async function invokeHook(hook: RuntimePluginHook, value: PluginJsonValue, scope: PluginHookScope): Promise<PluginHookResult> {
	const controller = new AbortController();
	const abort = () => controller.abort(scope.signal?.reason ?? new Error("Plugin hook cancelled"));
	if (scope.signal?.aborted) abort();
	scope.signal?.addEventListener("abort", abort, { once: true });
	let timer: ReturnType<typeof setTimeout> | undefined;
	let rejectAbort: (() => void) | undefined;
	try {
		if (!Number.isFinite(hook.descriptor.timeoutMs) || hook.descriptor.timeoutMs <= 0 || hook.descriptor.timeoutMs > 300_000) throw new Error("Invalid plugin hook timeout");
		const cancelled = new Promise<never>((_, reject) => {
			rejectAbort = () => reject(new Error("Plugin hook cancelled or timed out"));
			controller.signal.addEventListener("abort", rejectAbort, { once: true });
			if (controller.signal.aborted) rejectAbort();
			timer = setTimeout(() => controller.abort(new Error("Plugin hook timed out")), hook.descriptor.timeoutMs);
		});
		return await Promise.race([cancelled, Promise.resolve().then(() => {
			if (controller.signal.aborted) throw new Error("Plugin hook cancelled");
			return hook.run(structuredClone(value), { piboSessionId: scope.piboSessionId, generation: scope.generation, toolName: scope.toolName, toolCallId: scope.toolCallId, signal: controller.signal });
		})]);
	} finally {
		if (timer) clearTimeout(timer);
		scope.signal?.removeEventListener("abort", abort);
		if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
	}
}

/** Only this controlled pipeline may claim interception. Native harness tools are not wrapped. */
export async function runPluginHooks(hooks: readonly RuntimePluginHook[], phase: PluginHookDescriptor["phase"], initial: PluginJsonValue, scope: PluginHookScope, validate: (value: unknown) => boolean): Promise<PluginJsonValue> {
	let value = initial;
	const record = (evidence: PluginHookEvidence) => {
		try { scope.record(evidence); } catch (error) {
			if (phase !== "post-tool") throw error;
			console.warn("Plugin post-tool evidence persistence failed after tool execution; external result is retained.");
		}
	};
	if (!validate(value)) throw new Error(`Invalid ${phase} input`);
	const ordered = hooks.filter((hook) => hook.descriptor.phase === phase).sort((a, b) => a.descriptor.order - b.descriptor.order || a.descriptor.id.localeCompare(b.descriptor.id));
	for (const hook of ordered) {
		const evidence: PluginHookEvidence = { id: randomUUID(), hookId: hook.descriptor.id, phase, order: hook.descriptor.order, status: "continued", generation: scope.generation, piboSessionId: scope.piboSessionId, ...(phase === "post-tool" ? { executed: true } : {}) };
		try {
			if (scope.signal?.aborted) throw new Error("Plugin hook cancelled");
			const result = await invokeHook(hook, value, scope);
			if (!result || !["continue", "transform", "reject"].includes(result.action)) throw new Error("Invalid plugin hook result");
			if (result.action === "reject") {
				evidence.status = "rejected";
				throw new Error("Plugin hook rejected controlled execution");
			}
			if (result.action === "transform") {
				if (!result.provenance || typeof result.provenance.description !== "string" || !Array.isArray(result.provenance.inputRefs) || !result.provenance.inputRefs.every((ref) => typeof ref === "string") || !validate(result.value)) throw new Error("Invalid plugin hook transformation or provenance");
				value = structuredClone(result.value);
				evidence.status = "transformed";
				evidence.provenance = { description: redactSensitiveText(result.provenance.description), inputRefs: result.provenance.inputRefs.map(redactSensitiveText), ...(result.provenance.outputRef ? { outputRef: redactSensitiveText(result.provenance.outputRef) } : {}) };
			}
			record(evidence);
		} catch (error) {
			if (evidence.status !== "rejected") evidence.status = "failed";
			// Do not persist arbitrary thrown plugin values; those may contain credentials.
			evidence.diagnostic = "Plugin hook failed, rejected, timed out or was cancelled";
			record(evidence);
			// Post-tool failure cannot turn an already completed external write into a non-execution.
			if (phase !== "post-tool" && (hook.descriptor.required || evidence.status === "rejected" || scope.signal?.aborted)) throw new Error(`Plugin hook ${hook.descriptor.id} blocked ${phase}`, { cause: error });
		}
	}
	if (scope.signal?.aborted && phase !== "post-tool") throw new Error("Plugin execution cancelled");
	return value;
}

export function wrapPluginToolHooks(tool: PiboToolDefinition, hooks: readonly RuntimePluginHook[], scope: Omit<PluginHookScope, "toolName" | "toolCallId" | "signal">): PiboToolDefinition {
	return { ...tool, async execute(toolCallId, input, signal, onUpdate, context) {
		const executionScope = { ...scope, toolName: tool.name, toolCallId, signal };
		const transformed = await runPluginHooks(hooks, "pre-tool", input as PluginJsonValue, executionScope, (value) => Value.Check(tool.inputSchema, value));
		const result = await tool.execute(toolCallId, transformed, signal, onUpdate, context);
		return await runPluginHooks(hooks, "post-tool", result as unknown as PluginJsonValue, executionScope, (value) => {
			if (!value || typeof value !== "object" || !Array.isArray((value as PiboToolResult).content)) return false;
			return !tool.outputSchema || Value.Check(tool.outputSchema, (value as PiboToolResult).structuredContent);
		}) as unknown as PiboToolResult;
	} };
}
