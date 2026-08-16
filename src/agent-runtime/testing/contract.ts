import { assertAgentRuntimeSessionContract } from "../contract.js";
import type { AgentRuntimeSemanticEvent } from "../events.js";
import type { AgentRuntimeAdapter, AgentRuntimeSession, OpenAgentRuntimeSessionInput } from "../types.js";

export type AgentRuntimeContractResult = {
	session: AgentRuntimeSession;
	events: AgentRuntimeSemanticEvent[];
};

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Agent runtime contract violation: ${message}`);
}

export async function exerciseAgentRuntimeAdapterContract(
	adapter: AgentRuntimeAdapter,
	input: OpenAgentRuntimeSessionInput,
	prompt = "runtime adapter contract prompt",
): Promise<AgentRuntimeContractResult> {
	invariant(adapter.instanceId.length > 0, "configured instance id is required");
	invariant(adapter.descriptor.id.length > 0, "adapter id is required");
	invariant(adapter.descriptor.displayName.length > 0, "adapter display name is required");
	invariant(adapter.enabled, `instance "${adapter.instanceId}" must be enabled for the contract run`);
	const diagnostics = await adapter.diagnose();
	invariant(
		diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
		"enabled adapter diagnostics returned an error",
	);
	const validation = adapter.validateProfile({ profile: input.profile, workspace: input.workspace });
	invariant(validation.every((diagnostic) => diagnostic.severity !== "error"), "profile validation returned an error");

	const session = await adapter.openSession(input);
	invariant(session.runtimeInstanceId === adapter.instanceId, "session instance id does not match adapter instance");
	invariant(session.adapterId === adapter.descriptor.id, "session adapter id does not match descriptor");
	invariant(session.cwd === input.workspace, "session cwd does not match open input");
	assertAgentRuntimeSessionContract(session);
	const binding = session.getBinding();
	invariant(binding.piboSessionId === input.piboSession.id, "binding Pibo Session id does not match open input");
	invariant(binding.runtimeInstanceId === adapter.instanceId, "binding runtime instance id does not match adapter");
	invariant(binding.adapterId === adapter.descriptor.id, "binding adapter id does not match descriptor");

	const events: AgentRuntimeSemanticEvent[] = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		await session.prompt({ text: prompt, source: "rpc" });
		const status = session.getStatus();
		invariant(status.cwd === input.workspace, "status cwd does not match session cwd");
		invariant(status.streaming === false, "session remained streaming after prompt settled");
		const startedEvents = events.filter((event) => event.type === "turn_started");
		const completedEvents = events.filter((event) => event.type === "turn_completed");
		const failedEvents = events.filter((event) => event.type === "turn_failed");
		invariant(startedEvents.length === 1, "successful prompt must emit exactly one turn_started event");
		invariant(completedEvents.length === 1, "successful prompt must emit exactly one turn_completed event");
		invariant(failedEvents.length === 0, "successful prompt emitted turn_failed");
		invariant(
			events.indexOf(startedEvents[0]!) < events.indexOf(completedEvents[0]!),
			"turn_completed preceded turn_started",
		);
		const settledBinding = session.getBinding();
		invariant(settledBinding.piboSessionId === binding.piboSessionId, "prompt changed the binding Pibo Session id");
		invariant(settledBinding.runtimeInstanceId === binding.runtimeInstanceId, "prompt changed the binding runtime instance");
		invariant(settledBinding.adapterId === binding.adapterId, "prompt changed the binding adapter");
		await session.abort();
		invariant(session.getStatus().streaming === false, "idle abort left the session streaming");
	} finally {
		unsubscribe();
		await session.dispose();
		await session.dispose();
	}
	return { session, events };
}
