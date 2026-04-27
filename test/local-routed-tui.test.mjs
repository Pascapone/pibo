import assert from "node:assert/strict";
import test from "node:test";
import { createLocalRoutedTuiClient, createLocalRoutedTuiExtension } from "../dist/local/tui.js";

function createFakeExtensionApi() {
	const handlers = new Map();
	const commands = new Map();
	const renderers = new Map();
	const messages = [];

	return {
		handlers,
		commands,
		renderers,
		messages,
		api: {
			on(event, handler) {
				handlers.set(event, handler);
			},
			registerCommand(name, options) {
				commands.set(name, options);
			},
			registerMessageRenderer(customType, renderer) {
				renderers.set(customType, renderer);
			},
			sendMessage(message) {
				messages.push(message);
			},
		},
	};
}

function createFakeExtensionContext(statuses) {
	const autocompleteProviders = [];
	return {
		autocompleteProviders,
		ui: {
			setStatus(key, text) {
				statuses.set(key, text);
			},
			addAutocompleteProvider(provider) {
				autocompleteProviders.push(provider);
			},
		},
	};
}

function createFakeClient() {
	const eventListeners = new Set();
	const sentMessages = [];
	const sentExecutions = [];
	let closeCount = 0;

	return {
		eventListeners,
		sentMessages,
		sentExecutions,
		get closeCount() {
			return closeCount;
		},
		binding: {
			sessionKey: "local-tui:pibo-run-yield-qa:default",
			sessionId: "local-session-1",
			channel: "local-tui",
			externalId: "pibo-run-yield-qa:default",
			originalProfile: "pibo-run-yield-qa",
			createdAt: "2026-04-27T00:00:00.000Z",
			updatedAt: "2026-04-27T00:00:00.000Z",
		},
		capabilities: {
			actions: [
				{ name: "status", slashCommands: ["status"] },
				{ name: "session_id", slashCommands: ["session"] },
				{ name: "session.tree", slashCommands: ["tree"] },
				{ name: "session.current", slashCommands: ["session-current"] },
			],
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		sendMessage(text) {
			sentMessages.push(text);
			return Promise.resolve({ ok: true });
		},
		sendExecution(action, params) {
			sentExecutions.push({ action, params });
			return Promise.resolve({ ok: true });
		},
		close() {
			closeCount += 1;
		},
	};
}

test("local routed TUI extension routes input through the local client", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);

	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	assert.match(fake.messages[0].content, /Connected to pibo local routed session local-tui:pibo-run-yield-qa:default/);
	assert.match(fake.messages[0].content, /Routed commands: \/status, \/session-current/);
	assert.doesNotMatch(fake.messages[0].content, /Routed commands: .*\/session(?:,|\n|$)/);
	assert.doesNotMatch(fake.messages[0].content, /\/tree\b/);
	assert.deepEqual([...fake.commands.keys()], ["status", "session-current"]);
	assert.equal(typeof fake.renderers.get("pibo.local-routed"), "function");
	assert.equal(ctx.autocompleteProviders.length, 1);
	assert.equal(statuses.get("pibo.local"), "local connected");

	const messageResult = await fake.handlers.get("input")(
		{ type: "input", text: "Hallo local", source: "interactive" },
		ctx,
	);
	assert.deepEqual(messageResult, { action: "handled" });
	assert.deepEqual(client.sentMessages, ["Hallo local"]);
	assert.equal(fake.messages[1].content, "Hallo local");

	await fake.commands.get("status").handler("");
	assert.deepEqual(client.sentExecutions[0], { action: "status", params: undefined });

	const quitResult = await fake.handlers.get("input")(
		{ type: "input", text: "/quit", source: "interactive" },
		ctx,
	);
	assert.deepEqual(quitResult, { action: "continue" });

	const blockedResult = await fake.handlers.get("input")(
		{ type: "input", text: "/tree", source: "interactive" },
		ctx,
	);
	assert.deepEqual(blockedResult, { action: "handled" });
	assert.match(fake.messages.at(-1).content, /not available in local routed mode/);
	assert.equal(client.sentExecutions.length, 1);

	for (const listener of client.eventListeners) {
		listener({
			type: "assistant_message",
			sessionKey: "local-tui:pibo-run-yield-qa:default",
			eventId: "msg-1",
			text: "Antwort aus der lokalen Session",
		});
	}
	assert.equal(fake.messages.at(-1).content, "Antwort aus der lokalen Session");

	await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
	assert.equal(client.closeCount, 1);
});

test("local routed TUI client uses a profile-scoped local session key", async () => {
	const client = createLocalRoutedTuiClient({ profile: "run-yield-qa", persistSession: false });

	try {
		assert.equal(client.binding.sessionKey, "local-tui:pibo-run-yield-qa:default");
		assert.equal(client.binding.channel, "local-tui");
		assert.equal(client.binding.externalId, "pibo-run-yield-qa:default");
		assert.equal(client.binding.originalProfile, "pibo-run-yield-qa");
		assert.ok(client.capabilities.actions.some((action) => action.name === "status"));
	} finally {
		await client.close();
	}
});
