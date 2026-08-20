import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	InitialSessionContextBuilder,
	PiboPluginRegistry,
	PiboSessionRouter,
	createMinimalAgentRuntimeCapabilities,
	definePiboPlugin,
	piboCorePlugin,
	profileWithRuntimeInstance,
} from "../dist/index.js";
import {
	PORTABLE_HISTORY_HANDOFF_METADATA_KEY,
	PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY,
	PiboDataPortableHistoryProvider,
} from "../dist/agent-runtime/portable-history.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { importPortableHistoryIntoPi } from "../dist/agent-runtimes/pi/portable-history.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function sessionRecord(id = "ps_portable_history") {
	const now = "2026-08-20T00:00:00.000Z";
	return {
		id,
		piSessionId: "",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "source-profile",
		workspace: "/tmp/portable-workspace",
		createdAt: now,
		updatedAt: now,
		metadata: { chatRoomId: "room_portable_history" },
		activeModel: { provider: "source-provider", id: "source-model" },
		runtimeBinding: {
			piboSessionId: id,
			runtimeInstanceId: "source-runtime",
			adapterId: "source-adapter",
			nativeSessionId: "source-native-1",
			state: "bound",
			metadata: {},
			revision: 1,
			createdAt: now,
			updatedAt: now,
		},
	};
}

function ingestConversation(store, session) {
	const ingest = new ChatDataIngestService(store);
	ingest.ingestUserMessageAccepted({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "user:test",
		text: "Remember alpha. api_key=sk-portable-secret-12345678",
		clientTxnId: "portable-user-1",
		legacyEvent: { createdAt: "2026-08-20T00:00:01.000Z" },
	});
	ingest.ingestOutputEvent({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "agent:test",
		createdAt: "2026-08-20T00:00:01.500Z",
		event: {
			type: "message_queued",
			piboSessionId: session.id,
			eventId: "portable-user-1",
			queuedMessages: 1,
			text: "Remember alpha. api_key=sk-portable-secret-12345678",
			source: "user",
		},
	});
	ingest.ingestOutputEvent({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "agent:test",
		createdAt: "2026-08-20T00:00:02.000Z",
		event: {
			type: "tool_call",
			piboSessionId: session.id,
			eventId: "portable-turn-1",
			toolCallId: "sk-tool-call-secret-12345678",
			toolName: "lookup",
			args: { query: "alpha", apiKey: "sk-tool-secret-12345678" },
			argsComplete: true,
		},
	});
	ingest.ingestOutputEvent({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "agent:test",
		createdAt: "2026-08-20T00:00:03.000Z",
		event: {
			type: "tool_execution_finished",
			piboSessionId: session.id,
			eventId: "portable-turn-1",
			toolCallId: "sk-tool-call-secret-12345678",
			toolName: "lookup",
			result: { answer: "alpha", Authorization: "Bearer portable-result-secret" },
			isError: false,
		},
	});
	ingest.ingestOutputEvent({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "agent:test",
		createdAt: "2026-08-20T00:00:04.000Z",
		event: {
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "portable-turn-1",
			assistantIndex: 0,
			text: "Alpha is remembered.",
		},
	});
	store.eventLog.appendEvent({
		sessionId: session.id,
		sessionSequence: 6,
		roomId: session.metadata.chatRoomId,
		topic: "pibo.output",
		type: "thinking_finished",
		source: "actor",
		actorType: "assistant",
		retentionClass: "trace_event",
		previewText: "private reasoning omitted",
		attributes: {},
		createdAt: "2026-08-20T00:00:05.000Z",
		indexedAt: "2026-08-20T00:00:05.000Z",
	});
	return ingest;
}

test("cross-runtime profile projection drops source-runtime model, options, and native feature overrides", () => {
	const source = new InitialSessionContextBuilder("portable-profile-projection")
		.withAgentRuntime("source-runtime", { sourceOnly: true })
		.withModel({ provider: "source-provider", id: "source-model" })
		.withNativeSubagents(false)
		.withAutoContextFiles(false)
		.createSession();
	assert.equal(profileWithRuntimeInstance(source, "source-runtime"), source, "same-runtime context inspection must preserve model and adapter options");
	const target = profileWithRuntimeInstance(source, "target-runtime");
	assert.equal(target.runtimeInstanceId, "target-runtime");
	assert.deepEqual(target.runtimeOptions, {});
	assert.equal(target.model, undefined);
	assert.equal(target.mainModel, undefined);
	assert.equal(target.subagentModel, undefined);
	assert.equal(target.nativeSubagents, undefined);
	assert.equal(target.autoContextFiles, false, "portable profile settings remain available to the frozen target runtime");
});

function buildRegistry() {
	const sourceCapabilities = createMinimalAgentRuntimeCapabilities();
	sourceCapabilities.nativeSubagents = { supported: true, configurable: true, enabledByDefault: true };
	const targetCapabilities = createMinimalAgentRuntimeCapabilities();
	targetCapabilities.nativeSubagents = { supported: true, configurable: true, enabledByDefault: true };
	targetCapabilities.historyImport = true;
	const unsupportedCapabilities = createMinimalAgentRuntimeCapabilities();
	const unavailableCapabilities = createMinimalAgentRuntimeCapabilities();
	unavailableCapabilities.historyImport = true;
	const sourceDriver = createFakeAgentRuntimeDriver({ adapterId: "source-adapter", capabilities: sourceCapabilities });
	const targetDriver = createFakeAgentRuntimeDriver({ adapterId: "target-adapter", capabilities: targetCapabilities });
	const unsupportedDriver = createFakeAgentRuntimeDriver({ adapterId: "unsupported-adapter", capabilities: unsupportedCapabilities });
	const unavailableDriver = createFakeAgentRuntimeDriver({
		adapterId: "unavailable-adapter",
		capabilities: unavailableCapabilities,
		diagnostics: [{ severity: "error", code: "runtime_unavailable", message: "The target runtime executable is unavailable." }],
	});
	const registry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.runtime-portability",
			register(api) {
				api.registerAgentRuntimeDriver(sourceDriver);
				api.registerAgentRuntimeDriver(targetDriver);
				api.registerAgentRuntimeDriver(unsupportedDriver);
				api.registerAgentRuntimeDriver(unavailableDriver);
				api.registerAgentRuntimeInstance({ id: "source-runtime", adapterId: "source-adapter" });
				api.registerAgentRuntimeInstance({ id: "target-runtime", adapterId: "target-adapter" });
				api.registerAgentRuntimeInstance({ id: "unsupported-runtime", adapterId: "unsupported-adapter" });
				api.registerAgentRuntimeInstance({ id: "unavailable-runtime", adapterId: "unavailable-adapter" });
				api.registerProfile({
					name: "source-profile",
					create() {
						return new InitialSessionContextBuilder("source-profile")
							.withAgentRuntime("source-runtime")
							.withNativeSubagents(false)
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession();
					},
				});
			},
		})],
	});
	return {
		registry,
		target: registry.requireAgentRuntimeAdapter("target-runtime"),
		unsupported: registry.requireAgentRuntimeAdapter("unsupported-runtime"),
		unavailable: registry.requireAgentRuntimeAdapter("unavailable-runtime"),
	};
}

test("portable history is bounded, checkpointed, role-aware, and secret-redacted", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-portable-history-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new PiboDataStore(":memory:", { payloadRootDir: join(root, "payloads") });
	t.after(() => store.close());
	const session = sessionRecord();
	const ingest = ingestConversation(store, session);
	const provider = new PiboDataPortableHistoryProvider(store);
	const checkpoint = provider.createCheckpoint(session.id);
	ingest.ingestUserMessageAccepted({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "user:test",
		text: "This message happened after the handoff checkpoint.",
		clientTxnId: "portable-user-after-checkpoint",
		legacyEvent: { createdAt: "2026-08-20T00:01:00.000Z" },
	});
	const history = provider.read({ piboSession: session, sourceBinding: session.runtimeBinding, checkpoint });
	const serialized = JSON.stringify(history);
	assert.equal(history.version, 1);
	assert.equal(history.checkpoint.maxSessionSequence, 6);
	assert.match(serialized, /Remember alpha/);
	assert.match(serialized, /Alpha is remembered/);
	assert.doesNotMatch(serialized, /after the handoff checkpoint/);
	assert.doesNotMatch(serialized, /sk-portable-secret|sk-tool-secret|sk-tool-call-secret|portable-result-secret/);
	assert.match(serialized, /\[redacted\]/);
	assert.ok(history.entries.some((entry) => entry.type === "message" && entry.role === "assistant" && Array.isArray(entry.content) && entry.content.some((part) => part.type === "tool_call")));
	const portableCall = history.entries.find((entry) => entry.type === "message" && entry.role === "assistant" && entry.toolCallId);
	const portableResult = history.entries.find((entry) => entry.type === "message" && entry.role === "tool" && entry.toolCallId);
	assert.match(portableCall?.toolCallId ?? "", /^\[redacted\]-[a-f0-9]{12}$/);
	assert.equal(portableResult?.toolCallId, portableCall?.toolCallId, "redacted tool-call identifiers must remain uniquely pairable");
	assert.ok(history.entries.some((entry) => entry.type === "message" && typeof entry.content === "string" && entry.content.includes("runtime-specific history")));

	ingest.ingestUserMessageAccepted({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "user:test",
		text: "Accepted but never routed to a runtime.",
		clientTxnId: "portable-unrouted",
		legacyEvent: { createdAt: "2026-08-20T00:01:30.000Z" },
	});
	ingest.ingestUserMessageAccepted({
		session,
		roomId: session.metadata.chatRoomId,
		actorId: "user:test",
		text: "Accepted without a transaction id but never routed.",
		legacyEvent: { createdAt: "2026-08-20T00:01:31.000Z" },
	});
	const unroutedCheckpoint = provider.createCheckpoint(session.id);
	const withoutUnrouted = provider.read({ piboSession: session, sourceBinding: session.runtimeBinding, checkpoint: unroutedCheckpoint });
	assert.doesNotMatch(JSON.stringify(withoutUnrouted), /Accepted but never routed|Accepted without a transaction id/, "accepted-but-rejected web messages must not leak into a target runtime handoff");

	new ChatDataIngestService(store).ingestOutputEvent({
		session,
		roomId: session.metadata.chatRoomId,
		createdAt: "2026-08-20T00:02:00.000Z",
		event: {
			type: "tool_execution_finished",
			piboSessionId: session.id,
			eventId: "orphan-turn",
			toolCallId: "orphan-tool",
			toolName: "orphan",
			result: { value: "orphan result" },
			isError: false,
		},
	});
	const orphanCheckpoint = provider.createCheckpoint(session.id);
	const withOrphan = provider.read({ piboSession: session, sourceBinding: session.runtimeBinding, checkpoint: orphanCheckpoint });
	const orphan = withOrphan.entries.find((entry) => entry.id.includes("tool-result") && typeof entry.content === "string" && entry.content.includes("orphan result"));
	assert.equal(orphan?.type, "message");
	assert.equal(orphan?.role, "user", "orphan tool results must not produce invalid native tool history");
	assert.equal(orphan?.toolCallId, undefined);
});

test("portable history enforces its aggregate serialized handoff bound", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-portable-history-bound-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new PiboDataStore(":memory:", { payloadRootDir: join(root, "payloads") });
	t.after(() => store.close());
	const session = sessionRecord("ps_portable_history_bound");
	const ingest = new ChatDataIngestService(store);
	for (let index = 0; index < 520; index += 1) {
		const eventId = `portable-bound-${index}`;
		const text = `${index}:${"x".repeat(2_500)}`;
		ingest.ingestUserMessageAccepted({
			session,
			roomId: session.metadata.chatRoomId,
			actorId: "user:test",
			text,
			clientTxnId: eventId,
			legacyEvent: { createdAt: "2026-08-20T00:00:01.000Z" },
		});
		ingest.ingestOutputEvent({
			session,
			roomId: session.metadata.chatRoomId,
			actorId: "agent:test",
			createdAt: "2026-08-20T00:00:01.500Z",
			event: {
				type: "message_queued",
				piboSessionId: session.id,
				eventId,
				queuedMessages: 1,
				text,
				source: "user",
			},
		});
	}
	const provider = new PiboDataPortableHistoryProvider(store);
	const checkpoint = provider.createCheckpoint(session.id);
	const history = provider.read({ piboSession: session, sourceBinding: session.runtimeBinding, checkpoint });
	assert.equal(history.truncated, true);
	assert.ok(history.omittedEntries > 0);
	assert.ok(history.entries.length <= 1_000);
	assert.ok(Buffer.byteLength(JSON.stringify(history), "utf8") <= 1024 * 1024);
});

test("portable history remains aggregate-bounded after unmatched tool-call normalization", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-portable-history-tool-bound-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new PiboDataStore(":memory:", { payloadRootDir: join(root, "payloads") });
	t.after(() => store.close());
	const session = sessionRecord("ps_portable_history_tool_bound");
	const ingest = new ChatDataIngestService(store);
	for (let index = 0; index < 600; index += 1) {
		ingest.ingestOutputEvent({
			session,
			roomId: session.metadata.chatRoomId,
			actorId: "agent:test",
			createdAt: "2026-08-20T00:00:01.000Z",
			event: {
				type: "tool_call",
				piboSessionId: session.id,
				eventId: `portable-tool-bound-${index}`,
				toolCallId: `portable-call-${index}`,
				toolName: "bounded-tool",
				args: { index, value: "x".repeat(2_200) },
				argsComplete: true,
			},
		});
	}
	const provider = new PiboDataPortableHistoryProvider(store);
	const checkpoint = provider.createCheckpoint(session.id);
	const history = provider.read({ piboSession: session, sourceBinding: session.runtimeBinding, checkpoint });
	assert.equal(history.truncated, true);
	assert.ok(history.omittedEntries > 0);
	assert.ok(history.entries.some((entry) => entry.type === "message" && entry.role === "assistant" && Array.isArray(entry.content)
		&& entry.content.some((part) => part.type === "text" && part.text.includes("had no retained result"))));
	assert.ok(Buffer.byteLength(JSON.stringify(history), "utf8") <= 1024 * 1024);
});

test("Pi portable-history import appends role-aware native messages without fabricating a turn", () => {
	const appended = [];
	importPortableHistoryIntoPi({ appendMessage(message) { appended.push(message); return `entry-${appended.length}`; } }, {
		version: 1,
		piboSessionId: "ps_pi_import",
		sourceRuntimeInstanceId: "codex-native",
		sourceAdapterId: "codex-native",
		checkpoint: { maxSessionSequence: 4, createdAt: "2026-08-20T00:00:00.000Z" },
		entries: [
			{ id: "s1", type: "message", source: "product", createdAt: "2026-08-20T00:00:00.000Z", role: "system", content: "Portable system context", status: "complete" },
			{ id: "u1", type: "message", source: "product", createdAt: "2026-08-20T00:00:01.000Z", role: "user", content: "Portable question", status: "complete" },
			{ id: "a1", type: "message", source: "product", createdAt: "2026-08-20T00:00:02.000Z", role: "assistant", content: [{ type: "tool_call", toolCallId: "call-1", toolName: "lookup", input: { query: "portable" } }], status: "complete" },
			{ id: "t1", type: "message", source: "product", createdAt: "2026-08-20T00:00:03.000Z", role: "tool", content: "portable result", toolCallId: "call-1", toolName: "lookup", result: { answer: "portable" }, status: "complete" },
		],
		truncated: false,
		omittedEntries: 0,
	});
	assert.deepEqual(appended.map((message) => message.role), ["user", "user", "assistant", "toolResult"]);
	assert.match(appended[0].content, /\[Pibo portable system context\]/);
	assert.equal(appended[2].content[0].type, "toolCall");
	assert.equal(appended[2].content[0].id, "call-1");
	assert.equal(appended[3].toolCallId, "call-1");
});

test("runtime rebind persists a retry-safe handoff and imports it before opening the target session", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-rebind-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	t.after(() => {
		sessionStore.close();
		dataStore.close();
	});
	const created = sessionStore.create({
		...sessionRecord("ps_runtime_rebind"),
		id: "ps_runtime_rebind",
	});
	const ingest = ingestConversation(sessionStore.getDataStore(), created);
	const { registry, target, unsupported, unavailable } = buildRegistry();
	let router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	await assert.rejects(
		() => router.rebindSessionRuntime(created.id, {
			runtimeInstanceId: "unavailable-runtime",
			expectedRevision: created.runtimeBinding.revision,
		}),
		/Runtime target preflight failed: The target runtime executable is unavailable/,
	);
	assert.equal(sessionStore.getRuntimeBinding(created.id).runtimeInstanceId, "source-runtime", "failed target preflight must preserve the source binding");
	assert.equal(unavailable.openInputs.length, 0, "target preflight must fail before a native target opens");
	const pending = await router.rebindSessionRuntime(created.id, {
		runtimeInstanceId: "target-runtime",
		expectedRevision: created.runtimeBinding.revision,
	});
	assert.equal(pending.state, "unbound");
	assert.equal(pending.runtimeInstanceId, "target-runtime");
	assert.equal(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].status, "pending");
	assert.equal(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].mode, "import");
	assert.equal(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].sourceRuntimeInstanceId, "source-runtime");
	assert.equal(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].targetRuntimeInstanceId, "target-runtime");
	assert.equal(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].targetAdapterId, "target-adapter");
	assert.equal(sessionStore.get(created.id).activeModel, undefined, "cross-runtime rebinding must clear the source runtime's model namespace immediately");
	assert.equal(target.openInputs.length, 0, "rebind must persist the handoff before opening a native target session");

	ingest.ingestUserMessageAccepted({
		session: sessionStore.get(created.id),
		roomId: created.metadata.chatRoomId,
		actorId: "user:test",
		text: "Do not include this post-checkpoint message.",
		clientTxnId: "post-checkpoint",
		legacyEvent: { createdAt: "2026-08-20T00:03:00.000Z" },
	});
	await router.disposeAll();

	router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	await router.getSessionStatusSnapshot(created.id);
	assert.equal(target.openInputs.length, 1);
	assert.equal(target.openInputs[0].binding.state, "unbound");
	assert.equal(target.openInputs[0].activeModel, undefined, "source-runtime model identities must not leak into a different runtime namespace");
	assert.equal(target.openInputs[0].piboSession.activeModel, undefined, "the adapter-facing Pibo Session must not expose the source runtime model either");
	assert.equal(target.openInputs[0].profile.runtimeOptions && Object.keys(target.openInputs[0].profile.runtimeOptions).length, 0);
	assert.equal(target.openInputs[0].profile.nativeSubagents, undefined, "source-runtime native feature overrides must not cross runtime namespaces");
	assert.equal(target.openInputs[0].historyHandoff.mode, "import");
	const imported = JSON.stringify(target.openInputs[0].historyHandoff.history);
	assert.match(imported, /Remember alpha/);
	assert.doesNotMatch(imported, /post-checkpoint/);
	const completed = sessionStore.getRuntimeBinding(created.id);
	assert.equal(sessionStore.get(created.id).activeModel, undefined);
	assert.equal(completed.state, "bound");
	assert.equal(completed.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY], undefined);
	assert.equal(completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].status, "completed");
	assert.equal(completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].mode, "import");
	assert.deepEqual(
		completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].checkpoint,
		pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].checkpoint,
	);
	assert.ok(completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].entryCount > 0);

	router.syncLiveSessionRuntimeBinding(created.id, target.sessions[0]);
	const completedAfterLiveSync = sessionStore.getRuntimeBinding(created.id);
	assert.equal(completedAfterLiveSync.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY], undefined);
	assert.equal(completedAfterLiveSync.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].status, "completed");
	assert.deepEqual(
		completedAfterLiveSync.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].checkpoint,
		pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].checkpoint,
	);

	await assert.rejects(
		() => router.rebindSessionRuntime(created.id, {
			runtimeInstanceId: "unsupported-runtime",
			expectedRevision: completed.revision,
		}),
		/history.*cannot import portable history|cannot import portable history/i,
	);
	assert.equal(sessionStore.getRuntimeBinding(created.id).runtimeInstanceId, "target-runtime");
	await assert.rejects(
		() => router.rebindSessionRuntime(created.id, {
			runtimeInstanceId: "unsupported-runtime",
			nativeSessionId: "must-not-attach",
			state: "bound",
			startFresh: true,
			expectedRevision: completed.revision,
		}),
		/create a new native session/i,
	);
	const fresh = await router.rebindSessionRuntime(created.id, {
		runtimeInstanceId: "unsupported-runtime",
		startFresh: true,
		expectedRevision: completed.revision,
	});
	assert.equal(fresh.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].status, "pending");
	assert.equal(fresh.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].mode, "fresh");
	await router.getSessionStatusSnapshot(created.id);
	assert.equal(unsupported.openInputs.at(-1).historyHandoff.mode, "fresh");
	const freshCompleted = sessionStore.getRuntimeBinding(created.id);
	assert.equal(freshCompleted.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY], undefined);
	assert.equal(freshCompleted.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].status, "completed");
	assert.equal(freshCompleted.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].mode, "fresh");
	await router.disposeAll();
});

test("runtime rebind quiesces the source before taking its portable-history checkpoint", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-rebind-quiescence-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	t.after(() => {
		sessionStore.close();
		dataStore.close();
	});
	const created = sessionStore.create({
		...sessionRecord("ps_runtime_rebind_quiescence"),
		id: "ps_runtime_rebind_quiescence",
	});
	ingestConversation(sessionStore.getDataStore(), created);
	const { registry } = buildRegistry();
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	await router.getSessionStatusSnapshot(created.id);
	let releaseReset;
	let resetStartedResolve;
	const resetStarted = new Promise((resolve) => { resetStartedResolve = resolve; });
	const resetGate = new Promise((resolve) => { releaseReset = resolve; });
	const originalReset = router.resetCachedSession.bind(router);
	router.resetCachedSession = async (...args) => {
		resetStartedResolve();
		await resetGate;
		return await originalReset(...args);
	};
	const rebind = router.rebindSessionRuntime(created.id, {
		runtimeInstanceId: "target-runtime",
		expectedRevision: created.runtimeBinding.revision,
	});
	await resetStarted;
	await assert.rejects(
		() => router.emit({
			type: "message",
			piboSessionId: created.id,
			id: "concurrent-rebind-message",
			text: "must not enter the old runtime after the handoff checkpoint",
			source: "user",
		}),
		/quiescing/,
	);
	releaseReset();
	await rebind;
	await router.disposeAll();
});

test("runtime rebind retries the same persisted handoff checkpoint after target startup failure", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-runtime-rebind-retry-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	t.after(() => {
		sessionStore.close();
		dataStore.close();
	});
	const created = sessionStore.create({
		...sessionRecord("ps_runtime_rebind_retry"),
		id: "ps_runtime_rebind_retry",
	});
	const ingest = ingestConversation(sessionStore.getDataStore(), created);
	const { registry, target } = buildRegistry();
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	const pending = await router.rebindSessionRuntime(created.id, {
		runtimeInstanceId: "target-runtime",
		expectedRevision: created.runtimeBinding.revision,
	});
	const persistedCheckpoint = structuredClone(pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].checkpoint);
	const originalOpenSession = target.openSession.bind(target);
	let attempts = 0;
	target.openSession = async (input) => {
		attempts += 1;
		if (attempts === 1) {
			target.openInputs.push(input);
			throw new Error("fixture target startup failure");
		}
		return await originalOpenSession(input);
	};

	ingest.ingestUserMessageAccepted({
		session: sessionStore.get(created.id),
		roomId: created.metadata.chatRoomId,
		actorId: "user:test",
		text: "post-checkpoint retry message",
		clientTxnId: "post-checkpoint-retry",
		legacyEvent: { createdAt: "2026-08-20T00:04:00.000Z" },
	});
	await assert.rejects(() => router.getSessionStatusSnapshot(created.id), /fixture target startup failure/);
	const afterFailure = sessionStore.getRuntimeBinding(created.id);
	assert.equal(afterFailure.state, "unbound");
	assert.deepEqual(afterFailure.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY].checkpoint, persistedCheckpoint);
	assert.equal(target.openInputs.length, 1);

	await router.getSessionStatusSnapshot(created.id);
	assert.equal(attempts, 2);
	assert.equal(target.openInputs.length, 2);
	for (const input of target.openInputs) {
		assert.deepEqual(input.historyHandoff.history.checkpoint, persistedCheckpoint);
		assert.doesNotMatch(JSON.stringify(input.historyHandoff.history), /post-checkpoint retry message/);
	}
	assert.deepEqual(
		target.openInputs[0].historyHandoff.history,
		target.openInputs[1].historyHandoff.history,
		"a retry must import exactly the checkpointed handoff rather than rebuilding a moving transcript",
	);
	const completed = sessionStore.getRuntimeBinding(created.id);
	assert.equal(completed.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY], undefined);
	assert.equal(completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].status, "completed");
	assert.equal(completed.metadata[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY].mode, "import");
	await router.disposeAll();

	const corrupted = sessionStore.updateRuntimeBinding(created.id, {
		...completed,
		metadata: {
			...completed.metadata,
			[PORTABLE_HISTORY_HANDOFF_METADATA_KEY]: { version: 999, mode: "import" },
		},
	}, { expectedRevision: completed.revision });
	assert.ok(corrupted);
	const corruptRouter = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	await assert.rejects(
		() => corruptRouter.getSessionStatusSnapshot(created.id),
		/refusing to start a contextless target runtime/,
	);
	assert.equal(target.openInputs.length, 2, "invalid handoff metadata must fail before the adapter opens");
	await corruptRouter.disposeAll();

	const corruptBinding = sessionStore.getRuntimeBinding(created.id);
	const mismatched = sessionStore.updateRuntimeBinding(created.id, {
		...corruptBinding,
		metadata: {
			...corruptBinding.metadata,
			[PORTABLE_HISTORY_HANDOFF_METADATA_KEY]: {
				...pending.metadata[PORTABLE_HISTORY_HANDOFF_METADATA_KEY],
				targetRuntimeInstanceId: "different-target-runtime",
			},
		},
	}, { expectedRevision: corruptBinding.revision });
	assert.ok(mismatched);
	const mismatchRouter = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore });
	await assert.rejects(
		() => mismatchRouter.getSessionStatusSnapshot(created.id),
		/targets a different runtime binding/,
	);
	assert.equal(target.openInputs.length, 2, "mismatched handoff metadata must fail before the adapter opens");
	await mismatchRouter.disposeAll();
});
