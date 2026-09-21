import assert from "node:assert/strict";
import test from "node:test";
import {
	assertAgentRuntimeSessionContract,
	validateAgentRuntimeSessionContract,
} from "../dist/agent-runtime/contract.js";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { AgentRuntimeContractError } from "../dist/agent-runtime/errors.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";
import { PENDING_NATIVE_SESSION_METADATA_KEY } from "../dist/sessions/runtime-binding.js";

function validSession(overrides = {}) {
	return {
		adapterId: "fake",
		runtimeInstanceId: "fake-b1-k01",
		cwd: "/tmp/b1-k01",
		capabilities: createMinimalAgentRuntimeCapabilities(),
		getBinding: () => ({
			piboSessionId: "ps_b1_k01",
			runtimeInstanceId: "fake-b1-k01",
			adapterId: "fake",
			state: "bound",
			nativeSessionId: "native-b1-k01",
		}),
		subscribe: () => () => {},
		prompt: async () => {},
		abort: async () => {},
		dispose: async () => {},
		getStatus: () => ({ streaming: false, enabledTools: [], cwd: "/tmp/b1-k01" }),
		...overrides,
	};
}

function openInput(piboSessionId) {
	const profile = new InitialSessionContextBuilder("b1-k01").withAgentRuntime("fake-b1-k01").createSession();
	const piboSession = createPiboSession({
		id: piboSessionId,
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace: process.cwd(),
	});
	return {
		piboSession,
		profile,
		workspace: piboSession.workspace,
		productContext: { piboSessionId: piboSession.id },
	};
}

function openFakeSession(piboSessionId, options = {}) {
	const driver = createFakeAgentRuntimeDriver({ adapterId: "fake", ...options });
	const adapter = driver.create({ instanceId: "fake-b1-k01", enabled: true, config: {} });
	return adapter.openSession(openInput(piboSessionId));
}

test("b1-k01 session contract accepts a contract-conformant session", async () => {
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession()), []);
	const session = await openFakeSession("ps_b1_k01_valid");
	try {
		assert.deepEqual(validateAgentRuntimeSessionContract(session), []);
		assertAgentRuntimeSessionContract(session);
	} finally {
		await session.dispose();
	}
});

test("b1-k01 session contract rejects structural violations", () => {
	assert.deepEqual(validateAgentRuntimeSessionContract(undefined), ["session must be an object"]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ adapterId: "  " })), [
		"session.adapterId must be a non-empty string",
		"binding.adapterId \"fake\" does not match session.adapterId \"  \"",
	]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ runtimeInstanceId: "" })), [
		"session.runtimeInstanceId must be a non-empty string",
		"binding.runtimeInstanceId \"fake-b1-k01\" does not match session.runtimeInstanceId \"\"",
	]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ cwd: "" })), [
		"session.cwd must be a non-empty string",
	]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ prompt: undefined })), [
		"session.prompt() is required",
	]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: [] })), [
		"session.capabilities must be an object",
	]);
	const badCapabilities = createMinimalAgentRuntimeCapabilities();
	badCapabilities.lifecycle.persistent = "yes";
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: badCapabilities })), [
		"session.capabilities.lifecycle.persistent must be boolean",
	]);
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ controls: [] })), [
		"session.controls must be an object when provided",
	]);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({ getBinding: () => [] })),
		["session.getBinding() must return an object"],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => ({ runtimeInstanceId: "fake-b1-k01", adapterId: "fake", state: "bound", nativeSessionId: "n" }),
		})),
		["session.getBinding().piboSessionId must be a non-empty string"],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => ({
				piboSessionId: "ps_b1_k01",
				runtimeInstanceId: "fake-b1-k01",
				adapterId: "fake",
				state: "stale",
			}),
		})),
		["session.getBinding().state is invalid"],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => ({
				piboSessionId: "ps_b1_k01",
				runtimeInstanceId: "other-instance",
				adapterId: "fake",
				state: "unbound",
			}),
		})),
		['binding.runtimeInstanceId "other-instance" does not match session.runtimeInstanceId "fake-b1-k01"'],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => ({
				piboSessionId: "ps_b1_k01",
				runtimeInstanceId: "fake-b1-k01",
				adapterId: "fake",
				state: "bound",
			}),
		})),
		["a bound session requires binding.nativeSessionId"],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => ({
				piboSessionId: "ps_b1_k01",
				runtimeInstanceId: "fake-b1-k01",
				adapterId: "fake",
				state: "unbound",
				nativeSessionId: "native-b1-k01",
			}),
		})),
		["an unbound session must not expose binding.nativeSessionId"],
	);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			getBinding: () => {
				throw new Error("boom");
			},
		})),
		["session.getBinding() must not throw during contract validation"],
	);
});

test("b1-k01 session contract requires controls for declared capabilities", () => {
	const steeringCaps = createMinimalAgentRuntimeCapabilities();
	steeringCaps.input.steering = true;
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: steeringCaps })), [
		"input.steering requires session.steer()",
	]);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({ capabilities: steeringCaps, steer: async () => {} })),
		[],
	);

	const modelCaps = createMinimalAgentRuntimeCapabilities();
	modelCaps.models.switchInSession = true;
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: modelCaps })), [
		"models.switchInSession requires controls.setModel()",
	]);

	const forkCaps = createMinimalAgentRuntimeCapabilities();
	forkCaps.lifecycle.fork = true;
	forkCaps.lifecycle.forkWhileRunning = true;
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: forkCaps })), [
		"lifecycle.fork requires controls.forkSession()",
		"lifecycle.forkWhileRunning requires controls.getForkCandidatesWhileRunning()",
		"lifecycle.forkWhileRunning requires controls.forkSessionWhileRunning()",
	]);

	const approvalCaps = createMinimalAgentRuntimeCapabilities();
	approvalCaps.approvals.supported = true;
	approvalCaps.maintenance.compaction = true;
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ capabilities: approvalCaps })), [
		"approvals.supported requires controls.respondToApproval()",
		"maintenance.compaction requires controls.compact()",
	]);
	assert.deepEqual(
		validateAgentRuntimeSessionContract(validSession({
			capabilities: approvalCaps,
			controls: { respondToApproval: async () => {}, compact: async () => {} },
		})),
		[],
	);

	const pendingBinding = {
		piboSessionId: "ps_b1_k01",
		runtimeInstanceId: "fake-b1-k01",
		adapterId: "fake",
		state: "unbound",
		nativeSessionId: "native-b1-k01",
		metadata: { [PENDING_NATIVE_SESSION_METADATA_KEY]: true },
	};
	assert.deepEqual(validateAgentRuntimeSessionContract(validSession({ getBinding: () => pendingBinding })), []);
});

test("b1-k01 assert helper throws contract errors with instance identity", () => {
	assert.throws(
		() => assertAgentRuntimeSessionContract(validSession({ prompt: undefined })),
		(error) => error instanceof AgentRuntimeContractError
			&& error.runtimeInstanceId === "fake-b1-k01"
			&& /session\.prompt\(\) is required/.test(error.message),
	);
	assert.throws(
		() => assertAgentRuntimeSessionContract(undefined),
		(error) => error instanceof AgentRuntimeContractError && error.runtimeInstanceId === "unknown",
	);
	assert.throws(
		() => assertAgentRuntimeSessionContract(validSession({ prompt: undefined }), "explicit-instance"),
		(error) => error instanceof AgentRuntimeContractError && error.runtimeInstanceId === "explicit-instance",
	);
});

test("b1-k01 Fake: failed turns reject the prompt and emit exactly one terminal failure", async () => {
	// Fake-specific rejection: the Fake adapter rejects scripted failures. Pi resolves
	// every turn outcome; Codex/Muse resolve native terminals and reject only on
	// diagnostic/process/protocol/dispose failures. Consumers must read the events.
	const session = await openFakeSession("ps_b1_k01_failed", { script: { failWith: "synthetic failure" } });
	const events = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		await assert.rejects(session.prompt({ text: "fail please", source: "rpc" }), /synthetic failure/);
		assert.deepEqual(events.map((event) => event.type), ["turn_started", "turn_failed"]);
		assert.equal(events[1].message, "synthetic failure");
		assert.equal(session.getStatus().streaming, false);
	} finally {
		unsubscribe();
		await session.dispose();
	}
});

test("b1-k01 Fake: abort emits its terminal synchronously, before the prompt settles", async () => {
	// Fake-specific order: the terminal comes from abort() itself. Pi emits no
	// terminal for a cancelled turn; Codex delivers its legitimate terminal
	// asynchronously AFTER abort() returns (see b1-real-adapter-contract).
	const session = await openFakeSession("ps_b1_k01_abort", { script: { waitForAbort: true } });
	const events = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		const promptPromise = session.prompt({ text: "long turn", source: "rpc" });
		await new Promise((resolve) => setImmediate(resolve));
		await session.abort();
		const atAbortReturn = events.map((event) => event.type);
		assert.deepEqual(atAbortReturn, ["turn_started", "turn_completed"]);
		await promptPromise;
		const terminal = events.filter((event) => event.type === "turn_completed" || event.type === "turn_failed");
		assert.equal(terminal.length, 1);
		assert.equal(terminal[0].type, "turn_completed");
		assert.equal(terminal[0].status, "aborted");
		assert.equal(session.getStatus().streaming, false);
	} finally {
		unsubscribe();
		await session.dispose();
	}
});

test("b1-k01 Fake: abort after dispose is a documented no-op (differs from real adapters)", async () => {
	// Fake-specific: abort() never checks disposed. Codex/Muse/OMP throw after
	// dispose; Pi resolves without effect (see b1-real-adapter-contract).
	const session = await openFakeSession("ps_b1_k01_abort_disposed");
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.dispose();
	await session.abort();
	await session.abort();
	assert.deepEqual(events, []);
	assert.equal(session.getStatus().streaming, false);
});

test("b1-k01 Fake: dispose during a turn settles the prompt and ends delivery", async () => {
	// Fake-specific event picture: dispose aborts the waiting turn (one
	// aborted terminal) and clears listeners, so nothing arrives afterwards.
	// Real adapters differ per turn (see b1-real-adapter-contract).
	const session = await openFakeSession("ps_b1_k01_dispose_turn", { script: { waitForAbort: true } });
	const events = [];
	session.subscribe((event) => events.push(event));
	const promptPromise = session.prompt({ text: "long turn", source: "rpc" });
	await new Promise((resolve) => setImmediate(resolve));
	await session.dispose();
	await promptPromise;
	assert.deepEqual(events.map((event) => event.type), ["turn_started", "turn_completed"]);
	assert.equal(events[1].status, "aborted");
	await session.dispose();
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(events.length, 2);
	assert.equal(session.getStatus().streaming, false);
});

test("b1-k01 Fake: idle dispose is idempotent and ends event delivery", async () => {
	const session = await openFakeSession("ps_b1_k01_dispose");
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.dispose();
	await session.dispose();
	await assert.rejects(session.prompt({ text: "too late", source: "rpc" }), /disposed/);
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.deepEqual(events, []);
	assert.equal(session.getStatus().streaming, false);
});
