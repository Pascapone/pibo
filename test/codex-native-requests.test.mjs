import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
	getCodexNativeClient,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));
const testDisposers = new WeakMap();

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 3_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
		await delay(5);
	}
}

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-requests-"));
	const disposers = [];
	testDisposers.set(t, disposers);
	t.after(async () => {
		for (const dispose of disposers.reverse()) await dispose();
		await rm(root, { recursive: true, force: true });
	});
	await chmod(fixturePath, 0o755);
	return root;
}

function registerTestDisposer(t, dispose) {
	const disposers = testDisposers.get(t);
	if (!disposers) throw new Error("Codex native request test root is not initialized");
	disposers.push(dispose);
}

function runtimeConfig(root, experimentalUserInput = false) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		experimentalUserInput,
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

function profile(instanceId, profileName = `profile-${instanceId}`) {
	return new InitialSessionContextBuilder(profileName)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
}

function unboundBinding(instanceId, piboSessionId) {
	return {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
}

function openInput(instanceId, workspace, binding, activeMessageId = "pibo-request-message") {
	const selectedProfile = profile(instanceId);
	const piboSession = createPiboSession({
		id: binding.piboSessionId,
		channel: "test",
		kind: "chat",
		profile: selectedProfile.profileName,
		workspace,
		runtimeBinding: binding,
	});
	return {
		piboSession,
		profile: selectedProfile,
		binding,
		workspace,
		productContext: {
			piboSessionId: piboSession.id,
			getActiveMessage: () => ({ id: activeMessageId, source: "user" }),
		},
	};
}

function createAdapter(root, instanceId, experimentalUserInput = false) {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex Native Request Test",
		config: runtimeConfig(root, experimentalUserInput),
	});
	return { registry, adapter, instanceId };
}

async function openFreshSession(t, root, suffix, experimentalUserInput = false) {
	const fixture = createAdapter(root, `codex-native-${suffix}`, experimentalUserInput);
	const binding = unboundBinding(fixture.instanceId, `ps_${suffix}`);
	const session = await fixture.registry.openSession(
		fixture.instanceId,
		openInput(fixture.instanceId, root, binding),
	);
	registerTestDisposer(t, () => session.dispose());
	return { ...fixture, binding, session };
}

function eventsOf(events, type) {
	return events.filter((event) => event.type === type);
}

test("Codex native advertises stable approvals and only advertises experimental structured input when configured", async (t) => {
	const root = await testRoot(t);
	assert.equal(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities.approvals.supported, true);
	assert.equal(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities.approvals.structuredUserInput, false);

	const stable = await openFreshSession(t, root, "stable-capabilities");
	assert.equal(stable.adapter.descriptor.capabilities.approvals.supported, true);
	assert.equal(stable.adapter.descriptor.capabilities.approvals.structuredUserInput, false);
	assert.equal(stable.session.capabilities.approvals.structuredUserInput, false);
	assert.equal(typeof stable.session.controls.respondToApproval, "function");
	assert.equal(typeof stable.session.controls.respondToUserInput, "function");

	const experimental = await openFreshSession(t, root, "experimental-capabilities", true);
	assert.equal(experimental.adapter.descriptor.capabilities.approvals.supported, true);
	assert.equal(experimental.adapter.descriptor.capabilities.approvals.structuredUserInput, true);
	assert.equal(experimental.session.capabilities.approvals.structuredUserInput, true);
});

test("Codex native scopes, redacts, resolves, and validates command and file approval requests", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "approvals");
	const events = [];
	session.subscribe((event) => events.push(event));

	const commandPrompt = session.prompt({ text: "[approval-command] approve a command", source: "rpc" });
	await waitFor(() => eventsOf(events, "approval_requested").length === 1, "command approval request");
	const commandRequest = eventsOf(events, "approval_requested")[0].request;
	assert.equal(commandRequest.requestType, "command_execution");
	assert.equal(commandRequest.title, "Run Codex command");
	assert.doesNotMatch(commandRequest.requestId, /^server-request-/);
	assert.deepEqual(commandRequest.decisions.map((decision) => decision.id), ["accept", "acceptForSession", "decline", "cancel"]);
	assert.equal(session.pendingApprovals.length, 1);
	assert.equal(session.pendingApproval.requestId, commandRequest.requestId);
	assert.doesNotMatch(
		JSON.stringify(commandRequest),
		/fixture-command-secret|fixture-approval-secret|fixture-network-secret|fixture-policy-secret|fixture-policy-network-secret|private-environment-id/,
	);
	assert.match(commandRequest.arguments.command, /token=\[redacted\]/);
	assert.equal(commandRequest.arguments.networkApprovalContext.apiKey, "[redacted]");
	assert.equal(commandRequest.arguments.proposedExecpolicyAmendment[1], "token=[redacted]");
	assert.equal(commandRequest.arguments.proposedNetworkPolicyAmendments[0].secret, "[redacted]");
	await assert.rejects(
		session.controls.respondToApproval(commandRequest.requestId, "always"),
		/Unsupported runtime approval decision/,
	);
	assert.equal(session.pendingApprovals.length, 1);
	await session.controls.respondToApproval(commandRequest.requestId, "acceptForSession");
	await commandPrompt;
	assert.equal(session.pendingApprovals.length, 0);
	assert.deepEqual(eventsOf(events, "approval_resolved").map((event) => event.resolution), ["responded"]);
	assert.deepEqual(eventsOf(events, "assistant_message").map((event) => event.text), ["Command approved."]);
	await assert.rejects(
		session.controls.respondToApproval(commandRequest.requestId, "accept"),
		/no longer pending/,
	);

	const filePrompt = session.prompt({ text: "[approval-file] review the change", source: "rpc" });
	await waitFor(() => eventsOf(events, "approval_requested").length === 2, "file approval request");
	const fileRequest = eventsOf(events, "approval_requested")[1].request;
	assert.equal(fileRequest.requestType, "file_change");
	assert.equal(fileRequest.title, "Apply Codex file changes");
	assert.equal(fileRequest.arguments.grantRoot, "/private/approval-workspace");
	await session.controls.respondToApproval(fileRequest.requestId, "decline");
	await filePrompt;
	assert.deepEqual(eventsOf(events, "assistant_message").map((event) => event.text), ["Command approved.", "File change declined."]);
	assert.ok(eventsOf(events, "tool_execution_finished").some((event) => event.toolName === "codex_file_change" && event.isError));

	const cancelPrompt = session.prompt({ text: "[approval-command] cancel this turn", source: "rpc" });
	await waitFor(() => eventsOf(events, "approval_requested").length === 3, "cancellable command approval request");
	await session.controls.respondToApproval(eventsOf(events, "approval_requested")[2].request.requestId, "cancel");
	await cancelPrompt;
	assert.ok(eventsOf(events, "turn_completed").some((event) => event.status === "interrupted"));
	assert.equal(eventsOf(events, "approval_resolved").length, 3);

	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.deepEqual(state.serverResponseSummaries.map((entry) => entry.decision), ["acceptForSession", "decline", "cancel"]);
	assert.equal(state.pendingServerRequestCount, 0);
	assert.equal(state.serverResponseSummaries.some((entry) => entry.unexpected), false);
	assert.doesNotMatch(
		JSON.stringify(events),
		/fixture-command-secret|fixture-approval-secret|fixture-network-secret|fixture-policy-secret|fixture-policy-network-secret|private-environment-id/,
	);
});

test("Codex native gates structured user input, validates answers, and never projects secret answers", async (t) => {
	const root = await testRoot(t);
	const disabled = await openFreshSession(t, root, "user-input-disabled");
	const disabledEvents = [];
	disabled.session.subscribe((event) => disabledEvents.push(event));
	await disabled.session.prompt({ text: "[user-input] ask while disabled", source: "rpc" });
	assert.equal(eventsOf(disabledEvents, "user_input_requested").length, 0);
	assert.equal(eventsOf(disabledEvents, "turn_failed").length, 1);
	assert.equal(disabled.session.pendingUserInputs.length, 0);
	const disabledState = await getCodexNativeClient(disabled.session).request("test/getState", {});
	assert.equal(disabledState.serverResponseSummaries.at(-1).error, true);

	const { session } = await openFreshSession(t, root, "user-input-enabled", true);
	const events = [];
	session.subscribe((event) => events.push(event));
	const listedPrompt = session.prompt({ text: "[user-input-listed] choose an option", source: "rpc" });
	await waitFor(() => eventsOf(events, "user_input_requested").length === 1, "listed structured input request");
	const listed = eventsOf(events, "user_input_requested")[0].request;
	assert.equal(listed.blocking, true);
	assert.equal(listed.questions.length, 1);
	assert.equal(listed.questions[0].allowFreeform, false);
	assert.deepEqual(listed.questions[0].options.map((option) => option.label), ["Safe (Recommended)", "Fast"]);
	await assert.rejects(
		session.controls.respondToUserInput(listed.requestId, { unknown: "Safe (Recommended)" }),
		/Unknown answer id/,
	);
	await assert.rejects(
		session.controls.respondToUserInput(listed.requestId, { approach: "Unsafe" }),
		/requires a listed option/,
	);
	assert.equal(session.pendingUserInputs.length, 1);
	await session.controls.respondToUserInput(listed.requestId, { approach: "Safe (Recommended)" });
	await listedPrompt;

	const secretAnswer = "confidential-response-token-should-not-project";
	const secretPrompt = session.prompt({ text: "[user-input-secret] ask privately", source: "rpc" });
	await waitFor(() => eventsOf(events, "user_input_requested").length === 2, "secret structured input request");
	const secret = eventsOf(events, "user_input_requested")[1].request;
	assert.equal(secret.questions[0].secret, true);
	assert.equal(secret.questions[0].allowFreeform, true);
	assert.equal(session.pendingUserInput.requestId, secret.requestId);
	await session.controls.respondToUserInput(secret.requestId, { approach: secretAnswer });
	await secretPrompt;
	assert.equal(session.pendingUserInputs.length, 0);
	assert.deepEqual(eventsOf(events, "user_input_resolved").map((event) => event.resolution), ["responded", "responded"]);
	assert.doesNotMatch(JSON.stringify(events), new RegExp(secretAnswer));

	const state = await getCodexNativeClient(session).request("test/getState", {});
	const summaries = state.serverResponseSummaries.filter((entry) => entry.method === "item/tool/requestUserInput");
	assert.deepEqual(summaries.map((entry) => entry.answerIds), [["approach"], ["approach"]]);
	assert.deepEqual(summaries.map((entry) => entry.answerCount), [1, 1]);
	assert.doesNotMatch(JSON.stringify(state), new RegExp(secretAnswer));
});

test("Codex native rejects foreign and malformed server requests without creating product requests", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "invalid-requests", true);
	const events = [];
	session.subscribe((event) => events.push(event));

	await session.prompt({ text: "[approval-command approval-foreign] foreign scope", source: "rpc" });
	await session.prompt({ text: "[approval-command approval-invalid-timestamp] invalid timestamp payload", source: "rpc" });
	assert.equal(eventsOf(events, "approval_requested").length, 0);
	assert.equal(eventsOf(events, "user_input_requested").length, 0);
	assert.equal(eventsOf(events, "turn_failed").length, 2);
	assert.deepEqual(session.pendingApprovals, []);
	assert.deepEqual(session.pendingUserInputs, []);
	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.deepEqual(state.serverResponseSummaries.map((entry) => entry.error), [true, true]);
	assert.equal(state.pendingServerRequestCount, 0);
});

test("Codex native clears pending requests on interrupt and process failure without sending stale responses", async (t) => {
	const root = await testRoot(t);
	const interrupted = await openFreshSession(t, root, "approval-interrupt");
	const interruptedEvents = [];
	interrupted.session.subscribe((event) => interruptedEvents.push(event));
	const interruptedPrompt = interrupted.session.prompt({ text: "[approval-command] wait for interruption", source: "rpc" });
	await waitFor(() => eventsOf(interruptedEvents, "approval_requested").length === 1, "interruptible approval request");
	await interrupted.session.abort();
	await interruptedPrompt;
	assert.equal(interrupted.session.pendingApprovals.length, 0);
	assert.deepEqual(eventsOf(interruptedEvents, "approval_resolved").map((event) => event.resolution), ["cleared"]);
	const interruptedState = await getCodexNativeClient(interrupted.session).request("test/getState", {});
	assert.equal(interruptedState.pendingServerRequestCount, 0);
	assert.deepEqual(interruptedState.serverResponseSummaries, []);

	const crashed = await openFreshSession(t, root, "approval-crash");
	const crashedEvents = [];
	crashed.session.subscribe((event) => crashedEvents.push(event));
	const crashedPrompt = crashed.session.prompt({
		text: "[approval-command approval-crash] crash with a pending request",
		source: "rpc",
	});
	await waitFor(() => eventsOf(crashedEvents, "approval_requested").length === 1, "approval before process crash");
	await assert.rejects(crashedPrompt, /exited|closed/i);
	await waitFor(() => eventsOf(crashedEvents, "approval_resolved").length === 1, "crash request cleanup");
	assert.equal(crashed.session.pendingApprovals.length, 0);
	assert.deepEqual(eventsOf(crashedEvents, "approval_resolved").map((event) => event.resolution), ["aborted"]);
	assert.equal(eventsOf(crashedEvents, "turn_failed").length, 1);
});

test("Codex approval and structured-input requests flow through generic routed status and gateway actions", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-router-requests";
	const profileName = "codex-native-router-requests-profile";
	const piboSessionId = "ps_codex_router_requests";
	const config = runtimeConfig(root, true);
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-router-requests",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config });
				api.registerProfile({
					name: profileName,
					create() {
						return profile(instanceId, profileName);
					},
				});
			},
		})],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profileName,
		workspace: root,
		runtimeBinding: { runtimeInstanceId: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, state: "unbound" },
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	registerTestDisposer(t, () => router.disposeAll());
	const events = [];
	router.subscribe((event) => events.push(event));

	await router.emit({
		type: "message",
		piboSessionId,
		id: "approval-message",
		text: "[approval-command] routed approval",
		source: "user",
	});
	await waitFor(() => eventsOf(events, "approval_requested").length === 1, "routed approval request");
	const approval = eventsOf(events, "approval_requested")[0];
	assert.equal(approval.eventId, "approval-message");
	assert.deepEqual(router.getSessionRuntimeStatus(piboSessionId).pendingApprovals.map((request) => request.requestId), [approval.request.requestId]);
	const approvalResult = await router.emit({
		type: "execution",
		piboSessionId,
		id: "approval-response",
		action: "runtime.approval.respond",
		params: { requestId: approval.request.requestId, decision: "accept" },
	});
	assert.equal(approvalResult.type, "execution_result");
	assert.deepEqual(approvalResult.result, { requestId: approval.request.requestId, responded: true });
	await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === "approval-message"), "routed approval completion");
	assert.deepEqual(router.getSessionRuntimeStatus(piboSessionId).pendingApprovals ?? [], []);

	await router.emit({
		type: "message",
		piboSessionId,
		id: "input-message",
		text: "[user-input-listed] routed user input",
		source: "user",
	});
	await waitFor(() => eventsOf(events, "user_input_requested").length === 1, "routed user-input request");
	const input = eventsOf(events, "user_input_requested")[0];
	assert.equal(input.eventId, "input-message");
	assert.deepEqual(router.getSessionRuntimeStatus(piboSessionId).pendingUserInputs.map((request) => request.requestId), [input.request.requestId]);
	const inputResult = await router.emit({
		type: "execution",
		piboSessionId,
		id: "input-response",
		action: "runtime.user_input.respond",
		params: { requestId: input.request.requestId, answers: { approach: "Safe (Recommended)" } },
	});
	assert.equal(inputResult.type, "execution_result");
	assert.deepEqual(inputResult.result, { requestId: input.request.requestId, responded: true });
	await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === "input-message"), "routed user-input completion");
	assert.deepEqual(router.getSessionRuntimeStatus(piboSessionId).pendingUserInputs ?? [], []);
	assert.equal(eventsOf(events, "approval_resolved")[0].eventId, "approval-message");
	assert.equal(eventsOf(events, "user_input_resolved")[0].eventId, "input-message");
	assert.doesNotMatch(
		JSON.stringify(events),
		/fixture-command-secret|fixture-approval-secret|fixture-network-secret|fixture-policy-secret|fixture-policy-network-secret|private-environment-id/,
	);
});
