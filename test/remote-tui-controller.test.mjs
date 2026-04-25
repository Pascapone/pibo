import assert from "node:assert/strict";
import test from "node:test";
import { createRemoteAgentChannel } from "../dist/remote/channel.js";
import { createRemoteAgentTuiExtension } from "../dist/remote/examples/tui-controller.js";

class MemoryBindingStore {
	resolve(input) {
		const now = new Date().toISOString();
		return {
			sessionKey: input.sessionKey ?? `${input.channel}:${input.externalId}`,
			channel: input.channel,
			externalId: input.externalId,
			originalProfile: input.defaultProfile,
			createdAt: now,
			updatedAt: now,
		};
	}
}

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

async function waitFor(assertion) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			assertion();
			return;
		} catch (error) {
			if (attempt === 19) throw error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
}

test("remote TUI extension routes input through the remote agent channel", async () => {
	const emitted = [];
	const listeners = [];
	const bindings = new MemoryBindingStore();
	const statuses = new Map();
	const channel = createRemoteAgentChannel({ port: 0, announce: false });

	await channel.start({
		emit(event) {
			emitted.push(event);
			return Promise.resolve({
				type: event.type === "message" ? "message_queued" : "execution_result",
				sessionKey: event.sessionKey,
				eventId: event.id,
				queuedMessages: event.type === "message" ? 1 : undefined,
				text: event.type === "message" ? event.text : undefined,
				action: event.type === "execution" ? event.action : undefined,
				result: event.type === "execution" ? { ok: true } : undefined,
			});
		},
		subscribe(listener) {
			listeners.push(listener);
			return () => {};
		},
		resolveSession(input) {
			return bindings.resolve(input);
		},
		getGatewayActions() {
			return [
				{ name: "status", slashCommands: ["status"] },
				{ name: "session_id", slashCommands: ["session"] },
			];
		},
	});

	const fake = createFakeExtensionApi();
	const ctx = createFakeExtensionContext(statuses);

	try {
		const address = channel.getAddress();
		assert.ok(address);

		createRemoteAgentTuiExtension({
			host: address.host,
			port: address.port,
			sessionName: "local-a",
			profile: "pibo-minimal",
		})(fake.api);

		await fake.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

		assert.match(fake.messages[0].content, /Connected to pibo remote session remote-agent:local-a/);
		assert.match(fake.messages[0].content, /Remote commands: \/status/);
		assert.doesNotMatch(fake.messages[0].content, /\/session/);
		assert.deepEqual([...fake.commands.keys()], ["status"]);
		assert.equal(typeof fake.renderers.get("pibo.remote"), "function");
		assert.equal(ctx.autocompleteProviders.length, 1);
		assert.equal(statuses.get("pibo.remote"), "remote connected");

		const result = await fake.handlers.get("input")(
			{ type: "input", text: "Hallo remote", source: "interactive" },
			ctx,
		);
		assert.deepEqual(result, { action: "handled" });
		assert.deepEqual(emitted[0], {
			type: "message",
			sessionKey: "remote-agent:local-a",
			id: emitted[0].id,
			text: "Hallo remote",
			source: "ui",
		});
		assert.equal(fake.messages[1].content, "Hallo remote");

		await fake.commands.get("status").handler("");
		assert.equal(emitted[1].type, "execution");
		assert.equal(emitted[1].action, "status");

		listeners[0]({
			type: "assistant_message",
			sessionKey: "remote-agent:local-a",
			eventId: "msg-1",
			text: "Antwort aus der Remote Session",
		});
		await waitFor(() => assert.equal(fake.messages.at(-1).content, "Antwort aus der Remote Session"));
	} finally {
		await fake.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, ctx);
		await channel.stop?.();
	}
});
