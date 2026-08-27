import { AgentRuntimeContractError } from "./errors.js";
import type { AgentRuntimeSession } from "./types.js";
import { hasPendingNativeSession } from "../sessions/runtime-binding.js";

export function validateAgentRuntimeSessionContract(session: AgentRuntimeSession): string[] {
	const errors: string[] = [];
	const capabilities = session.capabilities;
	const controls = session.controls;
	const requireMethod = (enabled: boolean, path: string, method: keyof NonNullable<AgentRuntimeSession["controls"]>) => {
		if (enabled && typeof controls?.[method] !== "function") {
			errors.push(`${path} requires controls.${String(method)}()`);
		}
	};

	if (capabilities.input.steering && typeof session.steer !== "function") {
		errors.push("input.steering requires session.steer()");
	}
	requireMethod(capabilities.lifecycle.listNativeSessions, "lifecycle.listNativeSessions", "listSessions");
	requireMethod(capabilities.lifecycle.fork, "lifecycle.fork", "forkSession");
	requireMethod(capabilities.lifecycle.clone, "lifecycle.clone", "cloneSession");
	requireMethod(capabilities.lifecycle.tree, "lifecycle.tree", "getSessionTree");
	requireMethod(capabilities.lifecycle.tree, "lifecycle.tree", "navigateSessionTree");
	requireMethod(capabilities.models.switchInSession, "models.switchInSession", "setModel");
	requireMethod(capabilities.reasoning.supported, "reasoning.supported", "getReasoning");
	requireMethod(capabilities.reasoning.supported, "reasoning.supported", "setReasoning");
	requireMethod(capabilities.approvals.supported, "approvals.supported", "respondToApproval");
	requireMethod(capabilities.approvals.structuredUserInput, "approvals.structuredUserInput", "respondToUserInput");
	requireMethod(capabilities.maintenance.compaction, "maintenance.compaction", "compact");

	const binding = session.getBinding();
	if (binding.adapterId !== session.adapterId) {
		errors.push(`binding.adapterId "${binding.adapterId}" does not match session.adapterId "${session.adapterId}"`);
	}
	if (binding.runtimeInstanceId !== session.runtimeInstanceId) {
		errors.push(
			`binding.runtimeInstanceId "${binding.runtimeInstanceId}" does not match session.runtimeInstanceId "${session.runtimeInstanceId}"`,
		);
	}
	if (binding.state === "bound" && !binding.nativeSessionId) {
		errors.push("a bound session requires binding.nativeSessionId");
	}
	if (binding.state === "unbound" && binding.nativeSessionId && !hasPendingNativeSession(binding)) {
		errors.push("an unbound session must not expose binding.nativeSessionId");
	}
	return errors;
}

export function assertAgentRuntimeSessionContract(session: AgentRuntimeSession): void {
	const errors = validateAgentRuntimeSessionContract(session);
	if (errors.length > 0) {
		throw new AgentRuntimeContractError(
			session.runtimeInstanceId,
			`Agent runtime session contract failed: ${errors.join("; ")}`,
		);
	}
}
