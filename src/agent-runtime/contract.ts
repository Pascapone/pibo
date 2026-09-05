import { AgentRuntimeContractError } from "./errors.js";
import { validateAgentRuntimeCapabilities } from "./capabilities.js";
import type { AgentRuntimeSession } from "./types.js";
import { hasPendingNativeSession, type RuntimeSessionBinding } from "../sessions/runtime-binding.js";

const REQUIRED_SESSION_METHODS = ["getBinding", "subscribe", "prompt", "abort", "dispose", "getStatus"] as const;
const BINDING_STATES = new Set(["unbound", "bound", "missing", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateAgentRuntimeSessionContract(session: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(session)) return ["session must be an object"];

	for (const field of ["adapterId", "runtimeInstanceId", "cwd"] as const) {
		if (typeof session[field] !== "string" || !session[field].trim()) {
			errors.push(`session.${field} must be a non-empty string`);
		}
	}
	for (const method of REQUIRED_SESSION_METHODS) {
		if (typeof session[method] !== "function") errors.push(`session.${method}() is required`);
	}

	let capabilities: AgentRuntimeSession["capabilities"] | undefined;
	if (!isRecord(session.capabilities)) {
		errors.push("session.capabilities must be an object");
	} else {
		const capabilityErrors = validateAgentRuntimeCapabilities(session.capabilities);
		errors.push(...capabilityErrors.map((error) => `session.capabilities.${error}`));
		if (capabilityErrors.length === 0) capabilities = session.capabilities as AgentRuntimeSession["capabilities"];
	}
	const controls = isRecord(session.controls) ? session.controls : undefined;
	if (session.controls !== undefined && !controls) errors.push("session.controls must be an object when provided");
	const requireMethod = (enabled: boolean, path: string, method: keyof NonNullable<AgentRuntimeSession["controls"]>) => {
		if (enabled && typeof controls?.[method] !== "function") {
			errors.push(`${path} requires controls.${String(method)}()`);
		}
	};

	if (capabilities?.input.steering && typeof session.steer !== "function") {
		errors.push("input.steering requires session.steer()");
	}
	if (capabilities) {
		requireMethod(capabilities.lifecycle.listNativeSessions, "lifecycle.listNativeSessions", "listSessions");
		requireMethod(capabilities.lifecycle.fork, "lifecycle.fork", "forkSession");
		requireMethod(capabilities.lifecycle.forkWhileRunning, "lifecycle.forkWhileRunning", "getForkCandidatesWhileRunning");
		requireMethod(capabilities.lifecycle.forkWhileRunning, "lifecycle.forkWhileRunning", "forkSessionWhileRunning");
		requireMethod(capabilities.lifecycle.clone, "lifecycle.clone", "cloneSession");
		requireMethod(capabilities.lifecycle.tree, "lifecycle.tree", "getSessionTree");
		requireMethod(capabilities.lifecycle.tree, "lifecycle.tree", "navigateSessionTree");
		requireMethod(capabilities.models.switchInSession, "models.switchInSession", "setModel");
		requireMethod(capabilities.reasoning.supported, "reasoning.supported", "getReasoning");
		requireMethod(capabilities.reasoning.supported, "reasoning.supported", "setReasoning");
		requireMethod(capabilities.approvals.supported, "approvals.supported", "respondToApproval");
		requireMethod(capabilities.approvals.structuredUserInput, "approvals.structuredUserInput", "respondToUserInput");
		requireMethod(capabilities.maintenance.compaction, "maintenance.compaction", "compact");
	}

	if (typeof session.getBinding === "function") {
		try {
			const binding: unknown = session.getBinding();
			if (!isRecord(binding)) {
				errors.push("session.getBinding() must return an object");
			} else {
				for (const field of ["piboSessionId", "runtimeInstanceId", "adapterId"] as const) {
					if (typeof binding[field] !== "string" || !binding[field].trim()) {
						errors.push(`session.getBinding().${field} must be a non-empty string`);
					}
				}
				if (!BINDING_STATES.has(String(binding.state))) {
					errors.push("session.getBinding().state is invalid");
				}
				if (binding.adapterId !== session.adapterId) {
					errors.push(`binding.adapterId "${String(binding.adapterId)}" does not match session.adapterId "${String(session.adapterId)}"`);
				}
				if (binding.runtimeInstanceId !== session.runtimeInstanceId) {
					errors.push(
						`binding.runtimeInstanceId "${String(binding.runtimeInstanceId)}" does not match session.runtimeInstanceId "${String(session.runtimeInstanceId)}"`,
					);
				}
				if (binding.state === "bound" && !binding.nativeSessionId) {
					errors.push("a bound session requires binding.nativeSessionId");
				}
				if (binding.state === "unbound" && binding.nativeSessionId && !hasPendingNativeSession(binding as RuntimeSessionBinding)) {
					errors.push("an unbound session must not expose binding.nativeSessionId");
				}
			}
		} catch {
			errors.push("session.getBinding() must not throw during contract validation");
		}
	}
	return errors;
}

export function assertAgentRuntimeSessionContract(session: unknown, runtimeInstanceId?: string): asserts session is AgentRuntimeSession {
	const errors = validateAgentRuntimeSessionContract(session);
	if (errors.length > 0) {
		throw new AgentRuntimeContractError(
			runtimeInstanceId ?? (isRecord(session) && typeof session.runtimeInstanceId === "string" ? session.runtimeInstanceId : "unknown"),
			`Agent runtime session contract failed: ${errors.join("; ")}`,
		);
	}
}
