import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createLocalRoutedTuiClient, createLocalRoutedTuiExtension } from "../dist/local/tui.js";

// Pi message components read the interactive theme singleton during render.
initTheme("dark", false);

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
	const terminalInputHandlers = [];
	const widgets = new Map();
	let renderCount = 0;
	let editorText = "";
	return {
		autocompleteProviders,
		terminalInputHandlers,
		widgets,
		get renderCount() {
			return renderCount;
		},
		get editorText() {
			return editorText;
		},
		set editorText(value) {
			editorText = value;
		},
		ui: {
			setStatus(key, text) {
				statuses.set(key, text);
			},
			addAutocompleteProvider(provider) {
				autocompleteProviders.push(provider);
			},
			setWidget(key, content) {
				const existing = widgets.get(key);
				existing?.dispose?.();
				widgets.delete(key);
				if (content === undefined) return;
				const widget =
					typeof content === "function"
						? content({
								requestRender() {
									renderCount += 1;
								},
							})
						: content;
				widgets.set(key, widget);
			},
			onTerminalInput(handler) {
				terminalInputHandlers.push(handler);
				return () => {
					const index = terminalInputHandlers.indexOf(handler);
					if (index !== -1) terminalInputHandlers.splice(index, 1);
				};
			},
			getEditorText() {
				return editorText;
			},
			setEditorText(text) {
				editorText = text;
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
		piboSession: {
			id: "ps_local_tui",
			piSessionId: "local-session-1",
			channel: "local-tui",
			kind: "local",
			profile: "codex-compat-openai-web",
			title: "default",
			createdAt: "2026-04-27T00:00:00.000Z",
			updatedAt: "2026-04-27T00:00:00.000Z",
		},
		capabilities: {
			actions: [
				{ name: "status", slashCommands: ["status"] },
				{ name: "thinking", slashCommands: ["thinking"] },
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

	assert.match(fake.messages[0].content, /Connected to pibo local routed session ps_local_tui/);
	assert.match(fake.messages[0].content, /Routed commands: \/status, \/thinking, \/session-current/);
	assert.doesNotMatch(fake.messages[0].content, /Routed commands: .*\/session(?:,|\n|$)/);
	assert.doesNotMatch(fake.messages[0].content, /\/tree\b/);
	assert.deepEqual([...fake.commands.keys()], ["status", "thinking", "session-current", "thinking-show"]);
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

	await fake.commands.get("thinking").handler("high");
	assert.deepEqual(client.sentExecutions[1], { action: "thinking", params: { level: "high" } });

	await fake.commands.get("thinking-show").handler("");
	assert.match(fake.messages.at(-1).content, /Thinking display: on/);

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
	assert.equal(client.sentExecutions.length, 2);

	const thinkingResult = await fake.handlers.get("input")(
		{ type: "input", text: "/thinking low", source: "interactive" },
		ctx,
	);
	assert.deepEqual(thinkingResult, { action: "handled" });
	assert.deepEqual(client.sentExecutions.at(-1), { action: "thinking", params: { level: "low" } });

	for (const listener of client.eventListeners) {
		listener({
			type: "assistant_message",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "Antwort aus der lokalen Session",
		});
	}
	assert.equal(fake.messages.at(-1).content, "Antwort aus der lokalen Session");

	await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
	assert.equal(client.closeCount, 1);
});

test("local routed TUI forwards compact instructions additively", async () => {
	const client = createFakeClient();
	client.capabilities.actions.push({ name: "compact", slashCommands: ["compact"] });
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const result = await fake.handlers.get("input")(
		{ type: "input", text: "/compact Fokus auf offene TODOs", source: "interactive" },
		ctx,
	);

	assert.deepEqual(result, { action: "handled" });
	assert.deepEqual(client.sentExecutions.at(-1), {
		action: "compact",
		params: { customInstructions: "Fokus auf offene TODOs" },
	});
});

test("local routed TUI reports rejected routed requests and keeps input handled", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	client.sendMessage = (text) => {
		client.sentMessages.push(text);
		return Promise.reject(new Error("message transport down"));
	};
	client.sendExecution = (action, params) => {
		client.sentExecutions.push({ action, params });
		return Promise.reject(new Error("execution transport down"));
	};

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const messageResult = await fake.handlers.get("input")(
		{ type: "input", text: "Bitte sende trotz Fehler", source: "interactive" },
		ctx,
	);
	assert.deepEqual(messageResult, { action: "handled" });
	assert.deepEqual(client.sentMessages, ["Bitte sende trotz Fehler"]);
	assert.match(fake.messages.at(-1).content, /Local routed request failed: message transport down/);
	assert.equal(fake.messages.at(-1).details.role, "error");

	const commandResult = await fake.handlers.get("input")(
		{ type: "input", text: "/status", source: "interactive" },
		ctx,
	);
	assert.deepEqual(commandResult, { action: "handled" });
	assert.deepEqual(client.sentExecutions, [{ action: "status", params: undefined }]);
	assert.match(fake.messages.at(-1).content, /Local routed request failed: execution transport down/);
	assert.equal(fake.messages.at(-1).details.role, "error");
});

test("local routed TUI renders execution results for routed control actions", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const initialMessageCount = fake.messages.length;
	for (const listener of client.eventListeners) {
		listener({
			type: "execution_result",
			piboSessionId: "ps_local_tui",
			eventId: "exec-1",
			action: "status",
			result: {
				piboSessionId: "ps_local_tui",
				queuedMessages: 2,
				processing: true,
				streaming: false,
			},
		});
		listener({
			type: "execution_result",
			piboSessionId: "ps_local_tui",
			eventId: "exec-2",
			action: "thinking",
			result: { level: "low", supported: false },
		});
		listener({
			type: "execution_result",
			piboSessionId: "ps_local_tui",
			eventId: "exec-3",
			action: "clear_queue",
			result: { cleared: 3 },
		});
		listener({
			type: "execution_result",
			piboSessionId: "ps_local_tui",
			eventId: "exec-4",
			action: "custom.action",
			result: { ok: true },
		});
	}

	const executionMessages = fake.messages.slice(initialMessageCount);
	assert.deepEqual(
		executionMessages.map((message) => message.details.role),
		["execution", "execution", "execution", "execution"],
	);
	assert.equal(
		executionMessages[0].content,
		"status: session=ps_local_tui queued=2 processing=true streaming=false",
	);
	assert.equal(executionMessages[1].content, "thinking: low (current model does not support thinking)");
	assert.equal(executionMessages[2].content, "clear: removed 3 queued message(s)");
	assert.equal(executionMessages[3].content, 'custom.action: {"ok":true}');
	assert.equal(statuses.get("pibo.local"), "local connected");
});

test("local routed TUI streams assistant deltas into a live widget", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const initialMessageCount = fake.messages.length;
	for (const listener of client.eventListeners) {
		listener({
			type: "message_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "",
		});
		listener({
			type: "assistant_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "Hallo",
		});
		listener({
			type: "assistant_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: " streaming",
		});
	}

	const widget = ctx.widgets.get("pibo.local.streaming");
	assert.ok(widget);
	assert.equal(fake.messages.length, initialMessageCount);
	assert.equal(widget.render(80).some((line) => line.includes("Hallo streaming")), true);
	assert.equal(statuses.get("pibo.local"), "local running");

	for (const listener of client.eventListeners) {
		listener({
			type: "assistant_message",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "Hallo streaming",
		});
	}

	assert.equal(ctx.widgets.has("pibo.local.streaming"), false);
	assert.equal(fake.messages.at(-1).content, "Hallo streaming");
	assert.equal(statuses.get("pibo.local"), "local connected");
});

test("local routed TUI shows thinking deltas only when enabled", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client, { showThinking: true })(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	for (const listener of client.eventListeners) {
		listener({
			type: "message_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "",
		});
		listener({
			type: "thinking_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "Ich denke",
		});
		listener({
			type: "thinking_finished",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
		});
		listener({
			type: "thinking_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
		});
		listener({
			type: "thinking_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "weiter",
		});
		listener({
			type: "assistant_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "Antwort",
		});
	}

	let widget = ctx.widgets.get("pibo.local.streaming");
	assert.ok(widget);
	assert.equal(widget.render(80).some((line) => line.includes("Ich denke")), true);
	assert.equal(widget.render(80).some((line) => line.includes("weiter")), true);
	assert.equal(widget.render(80).some((line) => line.includes("Antwort")), true);

	await fake.commands.get("thinking-show").handler("");
	widget = ctx.widgets.get("pibo.local.streaming");
	assert.ok(widget);
	assert.equal(widget.render(80).some((line) => line.includes("Ich denke")), false);
	assert.equal(widget.render(80).some((line) => line.includes("weiter")), false);
	assert.match(fake.messages.at(-1).content, /Thinking display: off/);

	await fake.commands.get("thinking-show").handler("");
	widget = ctx.widgets.get("pibo.local.streaming");
	assert.ok(widget);
	assert.equal(widget.render(80).some((line) => line.includes("Ich denke")), true);
	assert.equal(widget.render(80).some((line) => line.includes("weiter")), true);
	assert.match(fake.messages.at(-1).content, /Thinking display: on/);
});

test("local routed TUI preserves thinking blocks when the assistant message finishes", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client, { showThinking: true })(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	for (const listener of client.eventListeners) {
		listener({
			type: "message_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "",
		});
		listener({
			type: "thinking_delta",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "erster Block",
		});
		listener({
			type: "thinking_finished",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
		});
		listener({
			type: "thinking_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
		});
		listener({
			type: "thinking_finished",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "zweiter Block",
		});
		listener({
			type: "assistant_message",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "finale Antwort",
		});
	}

	assert.equal(ctx.widgets.has("pibo.local.streaming"), false);
	assert.equal(fake.messages.at(-2).details.role, "thinking");
	assert.equal(fake.messages.at(-2).content, "erster Block\n\nzweiter Block");
	assert.equal(fake.messages.at(-1).details.role, "assistant");
	assert.equal(fake.messages.at(-1).content, "finale Antwort");
});

test("local routed TUI renders tool execution events with Pi tool styling", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	for (const listener of client.eventListeners) {
		listener({
			type: "message_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			text: "",
		});
		listener({
			type: "tool_call",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			toolCallId: "tool-1",
			toolName: "bash",
			args: { command: "echo Hallo" },
			argsComplete: true,
		});
		listener({
			type: "tool_execution_started",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			toolCallId: "tool-1",
			toolName: "bash",
			args: { command: "echo Hallo" },
		});
	}

	const liveWidget = ctx.widgets.get("pibo.local.tool.tool-1");
	assert.ok(liveWidget);
	assert.equal(liveWidget.render(80).some((line) => line.includes("echo Hallo")), true);

	for (const listener of client.eventListeners) {
		listener({
			type: "tool_execution_finished",
			piboSessionId: "ps_local_tui",
			eventId: "msg-1",
			toolCallId: "tool-1",
			toolName: "bash",
			result: { content: [{ type: "text", text: "Echo: Hallo" }] },
			isError: false,
		});
	}

	assert.equal(ctx.widgets.has("pibo.local.tool.tool-1"), false);
	assert.equal(fake.messages.at(-1).details.role, "tool");

	const renderer = fake.renderers.get("pibo.local-routed");
	const rendered = renderer(fake.messages.at(-1)).render(80);
	assert.equal(rendered.some((line) => line.includes("Echo: Hallo")), true);
});

test("local routed TUI submit guard blocks leading conflicting Pi commands only", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	assert.equal(ctx.terminalInputHandlers.length, 1);
	const guard = ctx.terminalInputHandlers[0];

	ctx.editorText = "  /fork";
	assert.deepEqual(guard("\r"), { consume: true });
	assert.equal(ctx.editorText, "");
	assert.match(fake.messages.at(-1).content, /Command "\/fork" is not available in local routed mode/);

	ctx.editorText = "Bitte erkläre /fork im Text";
	assert.equal(guard("\r"), undefined);
	assert.equal(ctx.editorText, "Bitte erkläre /fork im Text");

	ctx.editorText = "/forked";
	assert.equal(guard("\r"), undefined);
	assert.equal(ctx.editorText, "/forked");

	ctx.editorText = "/clone now";
	assert.deepEqual(guard("\n"), { consume: true });
	assert.equal(ctx.editorText, "");
	assert.match(fake.messages.at(-1).content, /Command "\/clone now" is not available in local routed mode/);

	await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
	assert.equal(ctx.terminalInputHandlers.length, 0);
});

test("local routed TUI renderer delegates messages to Pi components", async () => {
	const client = createFakeClient();
	const statuses = new Map();
	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	createLocalRoutedTuiExtension(client)(fake.api);
	await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

	const renderer = fake.renderers.get("pibo.local-routed");
	const userLines = renderer({
		content: "Hallo",
		details: { role: "user" },
	}).render(24);
	const assistantLines = renderer({
		content: "Hallo",
		details: { role: "assistant" },
	}).render(24);
	const thinkingLines = renderer({
		content: "Ich denke",
		details: { role: "thinking" },
	}).render(24);
	const executionLines = renderer({
		content: "status: ok",
		details: { role: "execution" },
	}).render(24);

	assert.equal(userLines.some((line) => line.includes("you -> local")), false);
	assert.equal(assistantLines.some((line) => line.includes("local assistant")), false);
	assert.equal(thinkingLines.some((line) => line.includes("local thinking")), false);
	assert.equal(executionLines.some((line) => line.includes("local execution")), false);
	assert.equal(userLines.some((line) => line.includes("Hallo")), true);
	assert.equal(assistantLines.some((line) => line.includes("Hallo")), true);
	assert.equal(thinkingLines.some((line) => line.includes("Ich denke")), true);
	assert.equal(executionLines.some((line) => line.includes("status: ok")), true);
});

test("local routed TUI client creates a profile-scoped local Pibo session", async () => {
	const client = createLocalRoutedTuiClient({ profile: "codex", persistSession: false, thinkingLevel: "high" });

	try {
		assert.match(client.piboSession.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(client.piboSession.channel, "local-tui");
		assert.equal(client.piboSession.kind, "local");
		assert.equal(client.piboSession.profile, "codex-compat-openai-web");
		assert.equal(client.piboSession.title, "default");
		assert.equal(client.router.options.thinkingLevel, "high");
		assert.ok(client.capabilities.actions.some((action) => action.name === "status"));
	} finally {
		await client.close();
	}
});
