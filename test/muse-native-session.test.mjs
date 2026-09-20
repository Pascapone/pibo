import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { exerciseAgentRuntimeAdapterContract } from "../dist/agent-runtime/testing/contract.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";
import {
	MUSE_NATIVE_ADAPTER_ID,
	MUSE_NATIVE_AGENT_RUNTIME_DRIVER,
	getMuseNativeSession,
} from "../dist/agent-runtimes/muse-native/adapter.js";
import { museAuthConfigPath } from "../dist/agent-runtimes/muse-native/auth.js";
import { parseMuseNativeRuntimeConfig } from "../dist/agent-runtimes/muse-native/config.js";
import { MuseNativeTurnController, splitMuseToolIntent } from "../dist/agent-runtimes/muse-native/turn.js";
import { MuseNativeConnectionPump } from "../dist/agent-runtimes/muse-native/sessions.js";

const fixturePath = fileURLToPath(new URL("./fixtures/muse-serve-fake.mjs", import.meta.url));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = process.platform === "win32" ? 15_000 : 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Muse native session output");
		await delay(5);
	}
}

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-muse-native-"));
	const disposers = [];
	t.after(async () => {
		for (const dispose of disposers.splice(0)) await dispose().catch(() => {});
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	await chmod(fixturePath, 0o755);
	const fakeStateDir = join(root, "fake-state");
	process.env.MUSE_FAKE_STATE_DIR = fakeStateDir;
	return { root, fakeStateDir, workspace: join(root, "workspace"), disposers };
}

function runtimeConfig(root, overrides = {}) {
	const allowlist = process.platform === "win32"
		? ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "MUSE_FAKE_STATE_DIR", "MUSE_FAKE_DENY_CAPABILITIES"]
		: ["PATH", "MUSE_FAKE_STATE_DIR", "MUSE_FAKE_DENY_CAPABILITIES"];
	return parseMuseNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: allowlist,
		diagnosticTimeoutMs: 2_000,
		startupTimeoutMs: process.platform === "win32" ? 15_000 : 5_000,
		requestTimeoutMs: 10_000,
		shutdownTimeoutMs: 500,
		...overrides,
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
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
}

function openInput(instanceId, workspace, binding, historyHandoff, activeModel) {
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
		...(historyHandoff ? { historyHandoff } : {}),
		...(activeModel ? { activeModel } : {}),
		productContext: { piboSessionId: piboSession.id },
	};
}

function createAdapter(root, instanceId, configOverrides = {}) {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Test",
		config: runtimeConfig(root, configOverrides),
	});
	return { registry, adapter, instanceId };
}

async function openFreshSession(t, root, suffix, disposers, configOverrides = {}) {
	const { registry, adapter, instanceId } = createAdapter(root, `muse-native-${suffix}`, configOverrides);
	const binding = unboundBinding(instanceId, `ps_${suffix}`);
	const session = await registry.openSession(instanceId, openInput(instanceId, root, binding));
	const dispose = () => session.dispose();
	if (disposers) disposers.push(dispose);
	else t.after(dispose);
	return { registry, adapter, instanceId, binding, session };
}

async function readFakeState(fakeStateDir) {
	return JSON.parse(await readFile(join(fakeStateDir, "muse-fake-state.json"), "utf8"));
}

async function setHangMethods(fakeStateDir, methods) {
	await mkdir(fakeStateDir, { recursive: true });
	const path = join(fakeStateDir, "hang-methods.json");
	if (methods.length === 0) await rm(path, { force: true });
	else await writeFile(path, JSON.stringify(methods));
}

test("Muse native sessions pass the reusable runtime-adapter contract", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root, "muse-native-contract");
	const binding = unboundBinding(instanceId, "ps_muse_contract");
	const result = await exerciseAgentRuntimeAdapterContract(
		adapter,
		openInput(instanceId, root, binding),
		"contract prompt",
	);
	assert.equal(result.events.filter((event) => event.type === "turn_started").length, 1);
	assert.equal(result.events.filter((event) => event.type === "turn_completed").length, 1);
	assert.equal(result.events.some((event) => event.type === "assistant_delta"), true);
	assert.equal(result.events.some((event) => event.type === "assistant_message"), true);
	assert.equal(result.events.some((event) => event.type === "usage"), true);
});

test("Muse native prompt streams tool events, usage, and context pressure", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "stream", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	const binding = session.getBinding();
	assert.equal(binding.state, "bound");
	assert.ok(binding.nativeSessionId?.startsWith("muse-fake-session-"));
	assert.equal(binding.protocol, "muse-session-protocol");

	await session.prompt({ text: "hello [tool] [context]", source: "interactive" });
	assert.equal(events.filter((event) => event.type === "turn_started").length, 1);
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	const message = events.find((event) => event.type === "assistant_message");
	assert.match(message.text, /fake reply to/);
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal(toolCall.toolName, "bash");
	assert.deepEqual(toolCall.args, { command: "echo fake-tool" });
	const finished = events.find((event) => event.type === "tool_execution_finished");
	assert.equal(finished.isError, false);
	assert.equal(finished.result, "fake-tool\n");
	const usage = events.find((event) => event.type === "usage");
	assert.equal(usage.usage.inputTokens, 10);
	assert.equal(usage.usage.outputTokens, 5);
	assert.equal(usage.usage.totalTokens, 15);

	const status = session.getStatus();
	assert.equal(status.streaming, false);
	assert.ok(status.enabledTools.includes("bash"));
	assert.equal(status.contextUsage.tokens, 1200);
	assert.equal(status.contextUsage.contextWindow, 100_000);
	assert.equal(typeof getMuseNativeSession(session), "object");
});

test("Muse native approval round-trip parks, responds, and completes", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "approval", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	const promptPromise = session.prompt({ text: "run it [tool] [approval]", source: "interactive" });
	await waitFor(() => session.pendingApproval !== undefined);
	const pending = session.pendingApproval;
	assert.equal(pending.requestType, "tool-approval");
	assert.equal(pending.title, "bash");
	assert.deepEqual(pending.decisions.map((decision) => decision.id), ["approve-once", "deny-once"]);
	assert.ok(events.some((event) => event.type === "approval_requested"));

	await assert.rejects(() => session.controls.respondToApproval(pending.requestId, "no-such-choice"), /no offered choice/);
	await session.controls.respondToApproval(pending.requestId, "approve-once");
	await promptPromise;
	assert.equal(session.pendingApproval, undefined);
	assert.ok(events.some((event) => event.type === "approval_resolved" && event.resolution === "responded"));
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	const state = await readFakeState(fakeStateDir);
	assert.deepEqual(state.decideRequests.at(-1), { approvalId: pending.requestId, choiceId: "approve-once" });
});

test("Muse native abort, steer, and failure terminals behave", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "abort", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	const slow = session.prompt({ text: "slow work [slow]", source: "interactive" });
	await waitFor(() => session.getStatus().streaming);
	await session.abort();
	await slow;
	const cancelled = events.filter((event) => event.type === "turn_completed").at(-1);
	assert.equal(cancelled.status, "cancelled");

	const steered = session.prompt({ text: "slow again [slow]", source: "interactive" });
	await waitFor(() => session.getStatus().streaming);
	await session.steer({ text: "more detail", source: "interactive" });
	await steered;
	assert.equal(events.filter((event) => event.type === "turn_started").length, 2);
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 2);
	assert.ok(events.some((event) => event.type === "assistant_message" && event.text.includes("steered: more detail")));

	await session.prompt({ text: "boom [fail]", source: "interactive" });
	const failed = events.find((event) => event.type === "turn_failed");
	assert.match(failed.message, /scripted fake failure/);
});

test("Muse native resume, binding inspection, profiles, and models behave", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root, "muse-native-resume");
	const binding = unboundBinding(instanceId, "ps_muse_resume");
	const session = await registry.openSession(instanceId, openInput(instanceId, root, binding));
	disposers.push(() => session.dispose());
	await session.prompt({ text: "first turn", source: "interactive" });
	const persisted = session.getBinding();
	await session.dispose();

	const resumed = await registry.openSession(instanceId, openInput(instanceId, root, persisted));
	disposers.push(() => resumed.dispose());
	assert.equal(resumed.getBinding().nativeSessionId, persisted.nativeSessionId);
	await resumed.prompt({ text: "second turn", source: "interactive" });

	const inspected = await adapter.resolveBinding({ binding: persisted, workspace: root });
	assert.equal(inspected.state, "bound");
	const missing = await adapter.resolveBinding({
		binding: { ...persisted, nativeSessionId: "muse-fake-session-absent" },
		workspace: root,
	});
	assert.equal(missing.state, "missing");
	const errored = await adapter.resolveBinding({
		binding: { ...persisted, nativeSessionId: undefined },
		workspace: root,
	});
	assert.equal(errored.state, "error");

	const brokenRegistry = new AgentRuntimeAdapterRegistry();
	brokenRegistry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const broken = brokenRegistry.registerInstance({
		id: "muse-native-broken",
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root, { executable: join(root, "absent-muse-binary") }),
	});
	await assert.rejects(
		() => broken.resolveBinding({ binding: persisted, workspace: root }),
		/Muse host failed to start|not authoritative evidence/,
	);

	const profileDiagnostics = await adapter.validateProfile({ profile: profile(instanceId), workspace: root });
	assert.equal(profileDiagnostics.some((diagnostic) => diagnostic.severity === "error"), false);
	const mismatch = await adapter.validateProfile({
		profile: profile("other-instance"),
		workspace: root,
	});
	assert.ok(mismatch.some((diagnostic) => diagnostic.code === "runtime_instance_mismatch"));
	const badProvider = await adapter.validateProfile({
		profile: profile(instanceId),
		workspace: root,
		activeModel: { id: "fake-model-a", provider: "other-provider" },
	});
	assert.ok(badProvider.some((diagnostic) => diagnostic.code === "muse_native_model_provider_invalid"));
	const unknownModel = await adapter.validateProfile({
		profile: profile(instanceId),
		workspace: root,
		activeModel: { id: "absent-model", provider: "meta-muse" },
	});
	assert.ok(unknownModel.some((diagnostic) => diagnostic.code === "muse_native_model_unavailable"));
	const invalidOptionsProfile = profile(instanceId);
	invalidOptionsProfile.runtimeOptions = { approvalMode: "sometimes" };
	const invalidOptions = await adapter.validateProfile({ profile: invalidOptionsProfile, workspace: root });
	assert.ok(invalidOptions.some((diagnostic) => diagnostic.code === "muse_native_runtime_options_invalid"));

	const catalog = await adapter.listModels();
	assert.deepEqual(catalog.models.map((model) => model.id), ["fake-model-a", "fake-model-b"]);
	assert.ok(catalog.models.every((model) => model.provider === "meta-muse"));
});

test("Muse native session controls manage model, reasoning, compaction, and forks", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "controls", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "prime the session", source: "interactive" });
	assert.equal(session.controls.cycleReasoning().value, "none");

	const switched = await session.controls.setModel({ id: "fake-model-b", provider: "meta-muse" });
	assert.equal(switched.id, "fake-model-b");
	assert.equal(session.getStatus().activeModel.id, "fake-model-b");
	const switchedBinding = session.getBinding();
	assert.equal(switchedBinding.metadata.museNativeModelId, "fake-model-b");
	assert.equal(switchedBinding.metadata.museModelId, "fake-model-b");
	await assert.rejects(() => session.controls.setModel({ id: "absent-model", provider: "meta-muse" }), /not in the runtime model catalog/);

	const reasoning = session.controls.setReasoning("high");
	assert.equal(reasoning.value, "high");
	assert.equal(session.controls.cycleReasoning().value, "xhigh");
	assert.throws(() => session.controls.setReasoning("turbo"), /reasoning effort/);
	assert.equal(session.controls.getFastMode().supported, false);

	await session.controls.compact();
	assert.ok(events.some((event) => event.type === "compaction_start"));
	assert.ok(events.some((event) => event.type === "compaction_end" && event.aborted === false));

	const candidates = session.controls.getForkCandidates();
	assert.ok(candidates.length >= 1);
	const before = session.getBinding().nativeSessionId;
	const forked = await session.controls.forkSession(candidates[0].entryId);
	assert.equal(forked.cancelled, false);
	assert.equal(forked.previous.nativeSessionId, before);
	const after = session.getBinding().nativeSessionId;
	assert.equal(forked.current.nativeSessionId, after);
	assert.notEqual(after, before);
	await session.prompt({ text: "forked turn", source: "interactive" });

	const cloned = await session.controls.cloneSession();
	assert.equal(cloned.cancelled, false);
	assert.notEqual(session.getBinding().nativeSessionId, after);

	const listed = await session.controls.listSessions();
	assert.ok(listed.some((entry) => entry.nativeSessionId === session.getBinding().nativeSessionId));
	await assert.rejects(() => session.controls.respondToUserInput("req-1", {}), /not support/);
});

test("Muse native diagnose, auth, timeouts, and import rejection behave", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root, "muse-native-diag");
	const diagnostics = await adapter.diagnose();
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "muse_native_version_ok"));
	const leakedGenerationDirs = [];
	async function collectGenerationDirs(path) {
		let entries;
		try {
			entries = await readdir(path, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(path, entry.name);
			if (!entry.isDirectory()) continue;
			if (entry.name === "sessions") {
				for (const session of await readdir(full)) {
					const sessionPath = join(full, session);
					for (const child of await readdir(sessionPath)) {
						if (child !== "xdg-data") leakedGenerationDirs.push(join(sessionPath, child));
					}
				}
				continue;
			}
			await collectGenerationDirs(full);
		}
	}
	await collectGenerationDirs(join(root, "runtime-state"));
	assert.deepEqual(leakedGenerationDirs, []);

	const broken = new AgentRuntimeAdapterRegistry();
	broken.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const missing = broken.registerInstance({
		id: "muse-native-missing",
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root, { executable: join(root, "absent-muse-binary") }),
	});
	const missingDiagnostics = await missing.diagnose();
	assert.ok(missingDiagnostics.some((diagnostic) => diagnostic.code === "muse_native_executable_missing"));

	const loggedOut = await adapter.getAuthStatus();
	assert.equal(loggedOut[0].state, "disconnected");
	assert.equal(loggedOut[0].configured, false);
	const authDir = museAuthConfigPath(runtimeConfig(root), instanceId);
	await mkdir(authDir, { recursive: true });
	await writeFile(join(authDir, "auth.json"), JSON.stringify({ schema_version: 1, providers: { other: { token: "keep-me" } } }));
	const started = await adapter.startAuth({ providerId: "meta", method: "api_key", apiKey: "test-key" });
	assert.equal(started.state, "connected");
	const stored = await adapter.getAuthStatus();
	assert.equal(stored[0].state, "connected");
	assert.equal(stored[0].configured, true);
	const merged = JSON.parse(await readFile(join(authDir, "auth.json"), "utf8"));
	assert.equal(merged.providers.other.token, "keep-me");
	assert.equal(merged.providers.meta.api_key, "test-key");
	await assert.rejects(() => adapter.startAuth({ providerId: "meta", method: "device_code" }), /not supported/);
	assert.equal(adapter.completeAuth, undefined);
	assert.equal(adapter.cancelAuth, undefined);
	const loggedOutAgain = await adapter.logoutAuth({ providerId: "meta" });
	assert.equal(loggedOutAgain.state, "disconnected");
	const afterLogout = JSON.parse(await readFile(join(authDir, "auth.json"), "utf8"));
	assert.equal(afterLogout.providers.other.token, "keep-me");
	assert.equal("api_key" in (afterLogout.providers.meta ?? {}), false);
	const statusAfterLogout = await adapter.getAuthStatus();
	assert.equal(statusAfterLogout[0].state, "disconnected");
	assert.equal(statusAfterLogout[0].configured, false);
	await writeFile(join(authDir, "auth.json"), "{not-json");
	await assert.rejects(() => adapter.logoutAuth({ providerId: "meta" }), /not valid JSON/);
	assert.equal(await readFile(join(authDir, "auth.json"), "utf8"), "{not-json");

	const { registry } = createAdapter(root, "muse-native-timeout");
	await assert.rejects(
		() => registry.openSession("muse-native-timeout", openInput("muse-native-timeout", root, unboundBinding("muse-native-timeout", "ps_muse_import"), { mode: "import", history: [] })),
		/portable history import is not supported/,
	);

	const impatient = new AgentRuntimeAdapterRegistry();
	impatient.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	impatient.registerInstance({
		id: "muse-native-impatient",
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root, { requestTimeoutMs: 100 }),
	});
	const impatientSession = await impatient.openSession("muse-native-impatient", openInput("muse-native-impatient", root, unboundBinding("muse-native-impatient", "ps_muse_timeout")));
	disposers.push(() => impatientSession.dispose());
	await assert.rejects(
		() => impatientSession.prompt({ text: "slow work [hang]", source: "interactive" }),
		/timed out after 300ms/,
	);
});

test("Muse native resume reports the native model as active", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-resumemodel");
	const binding = unboundBinding(instanceId, "ps_muse_resumemodel");
	const session = await registry.openSession(instanceId, openInput(instanceId, root, binding));
	disposers.push(() => session.dispose());
	await session.prompt({ text: "first turn", source: "interactive" });
	const persisted = session.getBinding();
	assert.equal(persisted.metadata.museNativeModelId, "fake-model-a");
	await session.dispose();

	const resumed = await registry.openSession(
		instanceId,
		openInput(instanceId, root, persisted, undefined, { id: "fake-model-b", provider: "meta-muse" }),
	);
	disposers.push(() => resumed.dispose());
	assert.equal(resumed.getBinding().nativeSessionId, persisted.nativeSessionId);
	assert.equal(resumed.getStatus().activeModel.id, "fake-model-a");
	const resumedBinding = resumed.getBinding();
	assert.equal(resumedBinding.metadata.museNativeModelId, "fake-model-a");
	assert.equal(resumedBinding.metadata.museModelId, "fake-model-a");
});

test("Muse native timeout errors redact prompt text", async (t) => {
	const { root, disposers } = await testRoot(t);
	const impatient = new AgentRuntimeAdapterRegistry();
	impatient.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	impatient.registerInstance({
		id: "muse-native-redact",
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root, { requestTimeoutMs: 100 }),
	});
	const session = await impatient.openSession("muse-native-redact", openInput("muse-native-redact", root, unboundBinding("muse-native-redact", "ps_muse_redact")));
	disposers.push(() => session.dispose());
	let failure;
	try {
		await session.prompt({ text: "slow work [hang] password=hunter2-secret", source: "interactive" });
	} catch (error) {
		failure = error;
	}
	assert.ok(failure);
	assert.match(failure.message, /timed out after 300ms/);
	assert.equal(failure.message.includes("hunter2"), false);
});

test("Muse native turn timeout is idle-based and survives steady activity", async (t) => {
	const { root, disposers } = await testRoot(t);
	const active = new AgentRuntimeAdapterRegistry();
	active.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	active.registerInstance({
		id: "muse-native-drip",
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		config: runtimeConfig(root, { requestTimeoutMs: 100 }),
	});
	const session = await active.openSession("muse-native-drip", openInput("muse-native-drip", root, unboundBinding("muse-native-drip", "ps_muse_drip")));
	disposers.push(() => session.dispose());
	// ~200ms of steady items with a 100ms budget: only an idle timeout survives this.
	await session.prompt({ text: "steady work [drip]", source: "interactive" });
	await assert.rejects(
		() => session.prompt({ text: "slow work [hang]", source: "interactive" }),
		/timed out after 300ms without activity/,
	);
});

test("Muse native turn survives backoff-like silence on a responsive host", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "backoff", disposers, { requestTimeoutMs: 150 });
	// 300ms of silence exceeds one 150ms window: only liveness-probed extension lets this turn complete.
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "slow work [slow]", source: "interactive" });
	assert.ok(events.some((event) => event.type === "assistant_message" && event.text.includes("fake reply to: slow work")));
});

test("Muse native turn fails fast when the host stops answering", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "hostdead", disposers, { requestTimeoutMs: 100 });
	// session/read is the primary silence signal now; the legacy liveness probe
	// only runs when the authoritative read itself is unanswered.
	await setHangMethods(fakeStateDir, ["approval/listPending", "session/read"]);
	const startedAt = Date.now();
	await assert.rejects(
		() => session.prompt({ text: "slow work [hang]", source: "interactive" }),
		/timed out after 100ms without activity .*\(host unresponsive\)/,
	);
	assert.ok(Date.now() - startedAt < 5_000, "unresponsive host must fail at the first window");
	await setHangMethods(fakeStateDir, []);
});

test("Muse native compaction times out on a hanging host", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "compacthang", disposers, { requestTimeoutMs: 500 });
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "prime", source: "interactive" });
	await setHangMethods(fakeStateDir, ["session/compact"]);
	await assert.rejects(() => session.controls.compact(), /compaction timed out after 500ms/);
	await setHangMethods(fakeStateDir, []);
	assert.ok(events.some((event) => event.type === "compaction_end" && event.aborted === true));
	await session.controls.compact();
	assert.ok(events.some((event) => event.type === "compaction_end" && event.aborted === false));
});

test("Muse native model switch times out on a hanging host", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "sethang", disposers, { requestTimeoutMs: 500 });
	await setHangMethods(fakeStateDir, ["session/setModel"]);
	await assert.rejects(
		() => session.controls.setModel({ id: "fake-model-b", provider: "meta-muse" }),
		/model switch timed out after 500ms/,
	);
	await setHangMethods(fakeStateDir, []);
	const switched = await session.controls.setModel({ id: "fake-model-b", provider: "meta-muse" });
	assert.equal(switched.id, "fake-model-b");
});

test("Muse native binding inspection times out on a hanging host", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root, "muse-native-readhang", { requestTimeoutMs: 500 });
	const binding = unboundBinding(instanceId, "ps_muse_readhang");
	const session = await registry.openSession(instanceId, openInput(instanceId, root, binding));
	disposers.push(() => session.dispose());
	await session.prompt({ text: "first turn", source: "interactive" });
	const persisted = session.getBinding();
	await setHangMethods(fakeStateDir, ["session/read"]);
	await assert.rejects(() => adapter.resolveBinding({ binding: persisted, workspace: root }), /binding inspection failed/);
	await setHangMethods(fakeStateDir, []);
	const inspected = await adapter.resolveBinding({ binding: persisted, workspace: root });
	assert.equal(inspected.state, "bound");
});

test("Muse native model catalog times out on a hanging host", async (t) => {
	const { root, fakeStateDir } = await testRoot(t);
	const { adapter } = createAdapter(root, "muse-native-listhang", { requestTimeoutMs: 500 });
	await setHangMethods(fakeStateDir, ["model/list"]);
	await assert.rejects(() => adapter.listModels(), /model catalog timed out after 500ms/);
	await setHangMethods(fakeStateDir, []);
	const catalog = await adapter.listModels();
	assert.deepEqual(catalog.models.map((model) => model.id), ["fake-model-a", "fake-model-b"]);
});

test("Muse native steer times out on a hanging host", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "steerhang", disposers, { requestTimeoutMs: 3_000 });
	const slow = session.prompt({ text: "slow work [slow]", source: "interactive" });
	await waitFor(() => session.getStatus().streaming);
	await setHangMethods(fakeStateDir, ["turn/steer"]);
	await assert.rejects(() => session.steer({ text: "more detail", source: "interactive" }), /steer timed out after 3000ms/);
	await setHangMethods(fakeStateDir, []);
	await session.abort();
	await slow;
});

test("Muse native steer requires a running turn", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "steeridle", disposers);
	await assert.rejects(() => session.steer({ text: "too early", source: "interactive" }), /requires a running turn/);
});

test("Muse native fork rejects unknown boundaries", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "forkbad", disposers);
	await session.prompt({ text: "prime the session", source: "interactive" });
	await assert.rejects(() => session.controls.forkSession("no-such-turn"), /not a valid fork boundary/);
});

test("Muse native approval arguments redact secrets", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "secretapproval", disposers);
	const promptPromise = session.prompt({ text: "run it [tool] [approval] [secretargs]", source: "interactive" });
	await waitFor(() => session.pendingApproval !== undefined);
	const pending = session.pendingApproval;
	assert.deepEqual(pending.arguments, { command: "echo fake-tool", description: "fake tool call", api_key: "[redacted]" });
	await session.controls.respondToApproval(pending.requestId, "approve-once");
	await promptPromise;
});

test("Muse native turn controller rejects unknown reasoning effort", async () => {
	const controller = new MuseNativeTurnController({}, {}, "session-1", 1_000, () => {});
	await assert.rejects(() => controller.start("hello", { reasoningEffort: "turbo" }), /reasoning effort/);
	await assert.rejects(() => controller.steer("hello", { reasoningEffort: "turbo" }), /requires a running turn/);
	controller.dispose();
});

test("Muse native session open applies the profile thinking level", async (t) => {
	const { root } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-thinking");
	const openWithThinking = async (suffix, thinkingLevel) => {
		const profiled = new InitialSessionContextBuilder(`profile-thinking-${suffix}`)
			.withAgentRuntime(instanceId)
			.withBuiltinTools("disabled")
			.withAutoContextFiles(false)
			.withToolPackages({ goalControl: false })
			.withMainThinkingLevel(thinkingLevel)
			.createSession();
		const input = {
			...openInput(instanceId, root, unboundBinding(instanceId, `ps_muse_thinking_${suffix}`)),
			profile: profiled,
		};
		const session = await registry.openSession(instanceId, input);
		t.after(() => session.dispose());
		return session;
	};
	const high = await openWithThinking("high", "high");
	assert.equal(high.getStatus().reasoning.value, "high");
	const off = await openWithThinking("off", "off");
	assert.equal(off.getStatus().reasoning.value, "none");
	const ultra = await openWithThinking("ultra", "ultra");
	assert.equal(ultra.getStatus().reasoning.value, "ultra");
});

test("Muse native session open fails clearly when the host withholds sessionMcp", async (t) => {
	const { root } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-capdeny");
	const mcpConfigPath = join(root, "mcp-servers.json");
	await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: { external: { url: "http://127.0.0.1:49191/mcp" } } })}\n`);
	const input = (overrides = {}) => ({
		...openInput(instanceId, root, unboundBinding(instanceId, "ps_muse_capdeny")),
		services: {
			resources: {
				sessionGeneration: "gen-capdeny-1",
				getAdapterEnvironment: () => ({}),
				getMcpConfigPath: () => mcpConfigPath,
				getInspection: () => ({ skills: [], diagnostics: [] }),
				getContextContributions: () => [],
			},
		},
		...overrides,
	});
	process.env.MUSE_FAKE_DENY_CAPABILITIES = "sessionMcp";
	t.after(() => {
		delete process.env.MUSE_FAKE_DENY_CAPABILITIES;
	});
	await assert.rejects(() => registry.openSession(instanceId, input()), /sessionMcp capability/);
	delete process.env.MUSE_FAKE_DENY_CAPABILITIES;
	const session = await registry.openSession(instanceId, input());
	t.after(() => session.dispose());
	const delivered = JSON.parse(await readFile(join(root, "fake-state", "muse-fake-state.json"), "utf8"));
	assert.equal(delivered.startRequests.at(-1).config.mcpServers.external.transport, "streamableHttp");
});

test("Muse native tool calls expose the model description as intent", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "intent", disposers);
	assert.deepEqual(session.capabilities.tools.intentTracing, { supported: true, configurable: false, enabledByDefault: true });
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [tool]", source: "interactive" });
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal(toolCall.intent, "fake tool call");
	assert.deepEqual(toolCall.args, { command: "echo fake-tool" });
	const started = events.find((event) => event.type === "tool_execution_started");
	assert.equal(started.intent, "fake tool call");
	const updated = events.find((event) => event.type === "tool_execution_updated");
	assert.equal("intent" in updated, false);
	const finished = events.find((event) => event.type === "tool_execution_finished");
	assert.equal("intent" in finished, false);
});

test("Muse native tool intent extraction trims, bounds, and redacts", () => {
	assert.deepEqual(splitMuseToolIntent({ command: "echo", description: "  fake tool call  " }), {
		args: { command: "echo" },
		intent: "fake tool call",
	});
	assert.deepEqual(splitMuseToolIntent({ command: "echo fake-tool" }), {
		args: { command: "echo fake-tool" },
		intent: undefined,
	});
	assert.deepEqual(splitMuseToolIntent({ description: "   " }), {
		args: { description: "   " },
		intent: undefined,
	});
	assert.deepEqual(splitMuseToolIntent({ description: 42 }), { args: { description: 42 }, intent: undefined });
	assert.deepEqual(splitMuseToolIntent("nope"), { args: "nope", intent: undefined });
	assert.deepEqual(splitMuseToolIntent(null), { args: null, intent: undefined });
	assert.deepEqual(splitMuseToolIntent([{ description: "listed" }]), { args: [{ description: "listed" }], intent: undefined });
	const long = `call with password=hunter2 ${"x".repeat(600)}`;
	const split = splitMuseToolIntent({ description: long, other: 1 });
	assert.equal(split.intent.length <= 512, true);
	assert.equal(split.intent.includes("hunter2"), false);
	assert.ok(split.intent.startsWith("call with password=[redacted]"));
	assert.deepEqual(split.args, { other: 1 });
});

test("Muse native tool calls without description emit no intent", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "intent-missing", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [tool] [nodesc]", source: "interactive" });
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal("intent" in toolCall, false);
	const started = events.find((event) => event.type === "tool_execution_started");
	assert.equal("intent" in started, false);
});

test("Muse native reclaimed turns fail instead of completing", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "reclaim", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [reclaim]", source: "interactive" });
	const failed = events.find((event) => event.type === "turn_failed");
	assert.ok(failed);
	assert.match(failed.message, /reclaimed before launch/);
	assert.equal(events.some((event) => event.type === "turn_completed"), false);
});

test("Muse native patch summaries emit one diff update per change", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "patch", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [tool] [patch]", source: "interactive" });
	const diffs = events.filter((event) => event.type === "diff_updated");
	assert.equal(diffs.length, 1);
	assert.deepEqual(diffs[0].diff, { filesChanged: 2, insertions: 10, deletions: 3 });
	assert.ok(events.some((event) => event.type === "tool_execution_finished"));
	assert.ok(events.some((event) => event.type === "turn_completed"));
});

test("Muse native rebind drops stale diagnostic metadata", async (t) => {
	const { root } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-rebind");
	const binding = {
		...unboundBinding(instanceId, "ps_muse_rebind"),
		metadata: { diagnosticCode: "stale", diagnosticMessage: "stale", keepMe: "kept" },
	};
	const session = await registry.openSession(instanceId, openInput(instanceId, root, binding));
	t.after(() => session.dispose());
	const metadata = session.getBinding().metadata ?? {};
	assert.equal("diagnosticCode" in metadata, false);
	assert.equal("diagnosticMessage" in metadata, false);
	assert.equal(metadata.keepMe, "kept");
});

test("Muse native reasoning streams deltas between start and finish", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "reasoning", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [reasoning]", source: "interactive" });
	const kinds = events.map((event) => event.type);
	assert.ok(kinds.includes("reasoning_started"));
	assert.ok(kinds.includes("reasoning_finished"));
	const delta = events.find((event) => event.type === "reasoning_delta");
	assert.equal(delta.text, "considering options");
	assert.ok(kinds.indexOf("reasoning_started") < kinds.indexOf("reasoning_delta"));
	assert.ok(kinds.indexOf("reasoning_delta") < kinds.indexOf("reasoning_finished"));
});

test("Muse native dispose interrupts a running turn", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "dispose-busy", disposers);
	const promptPromise = session.prompt({ text: "slow work [slow]", source: "interactive" });
	promptPromise.catch(() => {});
	await waitFor(() => session.getStatus().streaming === true);
	const startedAt = Date.now();
	await session.dispose();
	assert.ok(Date.now() - startedAt < 10_000);
	await promptPromise;
	assert.equal(session.getStatus().streaming, false);
});

test("Muse native large tool args parse to a bounded object", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "bigargs", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [tool] [bigargs]", source: "interactive" });
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal(toolCall.argsComplete, true);
	assert.equal(typeof toolCall.args, "object");
	assert.equal(toolCall.args.command, "echo big");
	assert.ok(toolCall.args.blob.endsWith("…[truncated]"));
	assert.ok(toolCall.args.blob.length < 20_000);
});

test("Muse native fallback tool names stay out of the observed inventory", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "noname", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "hello [tool] [noname]", source: "interactive" });
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal(toolCall.toolName, "muse-tool");
	assert.equal(session.getStatus().enabledTools.includes("muse-tool"), false);
});

test("Muse native connection pump drops per-session ledgers on unregister", () => {
	let handler;
	const pump = new MuseNativeConnectionPump({ onNotification: (fn) => { handler = fn; } });
	pump.register("session-1", { apply: () => {} });
	handler({ method: "turn/completed", params: { sessionId: "session-1", turnId: "turn-1", terminal: "completed" } });
	assert.deepEqual(pump.completedTurns.get("session-1"), ["turn-1"]);
	pump.unregister("session-1");
	assert.equal(pump.completedTurns.has("session-1"), false);
});

test("Muse native connection pump tracks the last live view cursor", () => {
	let handler;
	const pump = new MuseNativeConnectionPump({ onNotification: (fn) => { handler = fn; } });
	pump.register("session-1", { apply: () => {} });
	assert.equal(pump.lastViewCursor("session-1"), undefined);
	handler({ method: "item/started", params: { sessionId: "session-1", viewCursor: "7" } });
	assert.equal(pump.lastViewCursor("session-1"), "7");
	handler({ method: "item/delta", params: { sessionId: "session-1" } });
	assert.equal(pump.lastViewCursor("session-1"), "7");
	handler({ method: "item/completed", params: { sessionId: "session-1", viewCursor: "9" } });
	assert.equal(pump.lastViewCursor("session-1"), "9");
	pump.unregister("session-1");
	assert.equal(pump.lastViewCursor("session-1"), undefined);
});

test("Muse native unknown terminals fail instead of completing", async () => {
	const events = [];
	const stubTurn = {
		turnId: "turn-stub-unknown",
		observedStart: true,
		completed: Promise.resolve({ kind: "terminalUnknown" }),
		async *items() {},
		async *deltas() {},
	};
	const stubSession = { sendUserTurn: async () => stubTurn };
	const stubConnection = { command: async () => ({}) };
	const controller = new MuseNativeTurnController(stubConnection, stubSession, "session-1", 1_000, (event) => events.push(event));
	await controller.start("hello");
	assert.ok(events.some((event) => event.type === "turn_failed" && /host died/.test(event.message)));
	assert.equal(events.some((event) => event.type === "turn_completed"), false);
});

const WEDGED_INTAKE_MESSAGE = "turn/start runtime submit failed: event log failed: event id 834d77f4-b59d-5c71-811b-d3ed7133dbc3 conflicts with an existing event";

async function scriptTurnStartFailures(fakeStateDir, spec) {
	await mkdir(fakeStateDir, { recursive: true });
	await writeFile(join(fakeStateDir, "fail-turn-start.json"), JSON.stringify(spec));
}

test("Muse native prompt resyncs and retries a wedged turn intake once", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "intakeretry", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	const nativeSessionId = session.getBinding().nativeSessionId;
	await session.prompt({ text: "prime the session", source: "interactive" });
	await scriptTurnStartFailures(fakeStateDir, { times: 1, kind: "commandRejected", message: WEDGED_INTAKE_MESSAGE });

	await session.prompt({ text: "continue after compaction", source: "interactive" });

	const state = await readFakeState(fakeStateDir);
	assert.equal(state.turnStartRequests.length, 3);
	assert.equal(state.turnStartRequests[1].rejected, true);
	assert.equal(state.turnStartRequests[2].rejected, false);
	assert.ok(events.some((event) => event.type === "warning" && /re-sync/.test(event.message)));
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 2);
	assert.ok(events.some((event) => event.type === "assistant_message" && /fake reply to/.test(event.text)));
	assert.equal(session.getBinding().nativeSessionId, nativeSessionId);
	assert.ok(session.controls.getForkCandidates().length >= 1);

	await session.prompt({ text: "steady state", source: "interactive" });
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 3);
});

test("Muse native prompt does not retry turn rejections without the wedge signature", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "intakeno", disposers);
	await scriptTurnStartFailures(fakeStateDir, { times: 5, kind: "commandRejected", message: "turn/start rejected: intake busy" });
	await assert.rejects(() => session.prompt({ text: "hello", source: "interactive" }), /intake busy/);
	const state = await readFakeState(fakeStateDir);
	assert.equal(state.turnStartRequests.length, 1);
});

test("Muse native prompt surfaces a persistent wedged intake after one retry", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "intakestuck", disposers);
	await scriptTurnStartFailures(fakeStateDir, { times: 5, kind: "commandRejected", message: WEDGED_INTAKE_MESSAGE });
	await assert.rejects(() => session.prompt({ text: "hello", source: "interactive" }), /conflicts with an existing event/);
	const state = await readFakeState(fakeStateDir);
	assert.equal(state.turnStartRequests.length, 2);
});

test("Muse native compaction surfaces a noop admission instead of blanket success", async (t) => {
	const { root, fakeStateDir, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "compactnoop", disposers);
	const events = [];
	session.subscribe((event) => events.push(event));
	const accepted = await session.controls.compact();
	assert.equal(accepted.status, "accepted");
	assert.ok(events.some((event) => event.type === "compaction_end" && event.aborted === false));

	await mkdir(fakeStateDir, { recursive: true });
	await writeFile(join(fakeStateDir, "compact-noop.json"), JSON.stringify({ reason: "no_compactable_history" }));
	const noop = await session.controls.compact("keep it short");
	assert.equal(noop.native, true);
	assert.equal(noop.status, "noop");
	assert.equal(noop.reason, "no_compactable_history");
	assert.equal(noop.customInstructionsApplied, false);
});

async function readFakeHostArgs(fakeStateDir) {
	const files = (await readdir(fakeStateDir)).filter((name) => name.endsWith(".args.json")).sort();
	const result = [];
	for (const file of files) result.push(JSON.parse(await readFile(join(fakeStateDir, file), "utf8")));
	return result;
}

test("Muse native sandbox toggle restarts the host and preserves the session", async (t) => {
	const { root, fakeStateDir } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-sandbox-toggle", { sandbox: "enabled" });
	const mcpConfigPath = join(root, "mcp-servers.json");
	await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: { external: { url: "http://127.0.0.1:49191/mcp" } } })}\n`);
	const input = {
		...openInput(instanceId, root, unboundBinding(instanceId, "ps_muse_sandbox_toggle")),
		services: {
			resources: {
				sessionGeneration: "gen-sandbox-toggle-1",
				getAdapterEnvironment: () => ({}),
				getMcpConfigPath: () => mcpConfigPath,
				getInspection: () => ({ skills: [], diagnostics: [] }),
				getContextContributions: () => [],
			},
		},
	};
	const session = await registry.openSession(instanceId, input);
	t.after(() => session.dispose());
	assert.deepEqual(session.controls.getSandbox(), { supported: true, enabled: true, mode: "enabled" });
	assert.deepEqual(session.getStatus().sandbox, { supported: true, enabled: true, mode: "enabled" });
	const nativeSessionId = session.getBinding().nativeSessionId;
	await session.prompt({ text: "before toggle", source: "interactive" });

	const off = await session.controls.setSandbox(false);
	assert.equal(off.supported, true);
	assert.equal(off.enabled, false);
	assert.equal(off.mode, "disabled");
	assert.equal(off.changed, true);
	assert.equal(off.restarted, true);
	assert.deepEqual(session.controls.getSandbox(), { supported: true, enabled: false, mode: "disabled" });
	assert.equal(session.getBinding().nativeSessionId, nativeSessionId);
	assert.equal(session.getBinding().metadata.museNativeSandboxMode, "disabled");
	const toggledArgs = await readFakeHostArgs(fakeStateDir);
	assert.equal(toggledArgs.length, 2);
	assert.ok(toggledArgs.some((entry) => entry.join(" ") === "serve"));
	assert.ok(toggledArgs.some((entry) => entry.join(" ") === "serve --disable-sandbox"));
	const resumedState = await readFakeState(fakeStateDir);
	assert.equal(resumedState.resumeRequests.at(-1).config.mcpServers.external.transport, "streamableHttp");

	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "after toggle", source: "interactive" });
	assert.ok(events.some((event) => event.type === "turn_completed"));

	const unchanged = await session.controls.setSandbox(false);
	assert.equal(unchanged.changed, false);
	assert.equal(unchanged.restarted, false);
	assert.equal((await readFakeHostArgs(fakeStateDir)).length, 2);

	const on = await session.controls.setSandbox(true);
	assert.equal(on.enabled, true);
	assert.equal(on.mode, "enabled");
	assert.equal(on.restarted, true);
	assert.equal(session.getBinding().nativeSessionId, nativeSessionId);
	assert.equal(session.getBinding().metadata.museNativeSandboxMode, "enabled");
	assert.equal((await readFakeHostArgs(fakeStateDir)).length, 3);
});

test("Muse native session open resolves profile sandbox options above instance config", async (t) => {
	const { root, fakeStateDir } = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root, "muse-native-sandbox-profile", { sandbox: "enabled" });
	const input = openInput(instanceId, root, unboundBinding(instanceId, "ps_muse_sandbox_profile"));
	input.profile.runtimeOptions = { sandbox: "disabled" };
	const session = await registry.openSession(instanceId, input);
	t.after(() => session.dispose());
	assert.deepEqual(session.controls.getSandbox(), { supported: true, enabled: false, mode: "disabled" });
	const args = await readFakeHostArgs(fakeStateDir);
	assert.equal(args.length, 1);
	assert.ok(args[0].includes("--disable-sandbox"));

	const invalid = profile(instanceId);
	invalid.runtimeOptions = { sandbox: "sometimes" };
	const diagnostics = await adapter.validateProfile({ profile: invalid, workspace: root });
	assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "muse_native_runtime_options_invalid"));
});

test("Muse native view-death turn recovers via page walk and settles", async (t) => {
	const { root, disposers } = await testRoot(t);
	const { session } = await openFreshSession(t, root, "viewdeath", disposers, { requestTimeoutMs: 200 });
	const events = [];
	session.subscribe((event) => events.push(event));
	// Without recovery this prompt rejects after 600ms of silence; the dead
	// view must be reconciled instead, repeatedly across poll windows.
	await session.prompt({ text: "hello [tool] [viewdeath]", source: "interactive" });
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	// Opening content arrived live; the tool round-trip was backfilled from view/page.
	assert.ok(events.some((event) => event.type === "assistant_message"));
	const toolCall = events.find((event) => event.type === "tool_call");
	assert.equal(toolCall.toolName, "bash");
	assert.ok(events.some((event) => event.type === "tool_execution_finished"));
	// Honest one-liners: reconciling first, recovered once the terminal replays.
	assert.ok(events.some((event) => event.type === "reasoning_finished" && /reconciling missed events/.test(event.text ?? "")));
	assert.ok(events.some((event) => event.type === "reasoning_finished" && /recovered.*replayed \d+ missed events/.test(event.text ?? "")));
	assert.ok(events.some((event) => event.type === "native_event" && event.event?.kind === "muse-view-recovery"));
	assert.equal(session.getStatus().streaming, false);
});

test("Muse native abort settles a stuck turn within the abort bound", async () => {
	const events = [];
	const stubTurn = {
		turnId: "turn-stub-stuck",
		observedStart: true,
		completed: new Promise(() => {}),
		async *items() {},
		async *deltas() {},
	};
	const stubSession = { sendUserTurn: async () => stubTurn };
	const stubConnection = { command: async () => ({}), request: async () => ({}) };
	const controller = new MuseNativeTurnController(stubConnection, stubSession, "session-1", 60_000, (event) => events.push(event), { abortTimeoutMs: 50 });
	const startedAt = Date.now();
	const run = controller.start("hello");
	run.catch(() => {});
	await delay(20);
	await controller.interrupt();
	await run;
	assert.ok(Date.now() - startedAt < 5_000);
	const completed = events.filter((event) => event.type === "turn_completed").at(-1);
	assert.equal(completed.status, "cancelled");
	assert.ok(events.some((event) => event.type === "warning" && /settled locally as cancelled/.test(event.message)));
	assert.equal(controller.streaming, false);
	controller.dispose();
});

test("Muse native turn fails fast when the native turn is over but unrecoverable", async () => {
	const events = [];
	const stubTurn = {
		turnId: "turn-stub-gone",
		observedStart: true,
		completed: new Promise(() => {}),
		async *items() {},
		async *deltas() {},
	};
	const stubSession = {
		sendUserTurn: async () => stubTurn,
		apply: () => ({ fold: { kind: "item" }, io: Promise.resolve([]), retirements: [] }),
	};
	const stubConnection = {
		command: async () => ({}),
		request: async (method) => {
			if (method === "session/read") return { session: { activeTurnId: null } };
			if (method === "view/page") return { events: [], nextCursor: null };
			throw new Error(`unexpected ${method}`);
		},
	};
	const controller = new MuseNativeTurnController(stubConnection, stubSession, "session-1", 60_000, (event) => events.push(event), { pollMs: 30 });
	const startedAt = Date.now();
	await assert.rejects(() => controller.start("hello"), /could not be reconciled/);
	assert.ok(Date.now() - startedAt < 5_000);
	assert.ok(events.some((event) => event.type === "turn_failed"));
	assert.ok(events.some((event) => event.type === "reasoning_finished" && /reconciling missed events/.test(event.text ?? "")));
	assert.equal(events.some((event) => event.type === "reasoning_finished" && /recovered/.test(event.text ?? "")), false);
	controller.dispose();
});

test("Muse native recovery ignores a terminal for a natively running turn", async () => {
	const events = [];
	let resolveCompleted;
	const stubTurn = {
		turnId: "turn-stub-phantom",
		observedStart: true,
		completed: new Promise((resolve) => {
			resolveCompleted = resolve;
		}),
		async *items() {},
		async *deltas() {},
	};
	const applied = [];
	const stubSession = {
		sendUserTurn: async () => stubTurn,
		apply: (frame) => {
			applied.push(frame);
			return { fold: { kind: "item" }, io: Promise.resolve([]), retirements: [] };
		},
	};
	const stubConnection = {
		command: async () => ({}),
		request: async (method) => {
			// Authoritative read: the native turn is still running.
			if (method === "session/read") return { session: { activeTurnId: "turn-stub-phantom" } };
			// Dead view projection serves a stale terminal for the running turn.
			if (method === "view/page") {
				return {
					events: [
						{
							method: "turn/completed",
							params: { turnId: "turn-stub-phantom", terminal: "failed", reason: "incomplete", viewCursor: "v:phantom" },
						},
					],
					nextCursor: null,
				};
			}
			throw new Error(`unexpected ${method}`);
		},
	};
	const controller = new MuseNativeTurnController(stubConnection, stubSession, "session-1", 60_000, (event) => events.push(event), { pollMs: 30 });
	const run = controller.start("hello");
	// Let several silence windows elapse: the phantom terminal must never settle the running turn.
	await delay(150);
	assert.ok(applied.every((frame) => frame.method !== "turn/completed"));
	assert.equal(events.some((event) => event.type === "turn_failed"), false);
	assert.ok(events.some((event) => event.type === "reasoning_finished" && /reconciling missed events/.test(event.text ?? "")));
	assert.ok(events.some((event) => event.type === "reasoning_finished" && /still running natively/.test(event.text ?? "")));
	const recovery = events.find((event) => event.type === "native_event" && event.event?.kind === "muse-view-recovery");
	assert.equal(recovery?.event?.terminalContradicted, true);
	// The turn still settles normally once its real terminal arrives.
	resolveCompleted({ kind: "completed", observedStart: true, params: { terminal: "completed" } });
	await run;
	const completed = events.filter((event) => event.type === "turn_completed").at(-1);
	assert.equal(completed.status, "completed");
	assert.equal(controller.streaming, false);
	controller.dispose();
});

test("Muse native sandbox toggle override wins on reopen", async (t) => {
	const { root } = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "muse-native-sandbox-reopen", { sandbox: "enabled" });
	const session = await registry.openSession(instanceId, openInput(instanceId, root, unboundBinding(instanceId, "ps_muse_sandbox_reopen")));
	await session.controls.setSandbox(false);
	await session.controls.setSandbox(true);
	await session.controls.setSandbox(false);
	const persisted = session.getBinding();
	assert.equal(persisted.metadata.museNativeSandboxMode, "disabled");
	await session.dispose();

	const reopened = await registry.openSession(instanceId, openInput(instanceId, root, persisted));
	t.after(() => reopened.dispose());
	assert.equal(reopened.getBinding().nativeSessionId, persisted.nativeSessionId);
	assert.deepEqual(reopened.controls.getSandbox(), { supported: true, enabled: false, mode: "disabled" });
	await reopened.prompt({ text: "reopened turn", source: "interactive" });
});
