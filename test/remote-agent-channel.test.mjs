import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import { createRemoteAgentChannel } from "../dist/remote/channel.js";
import { encodeRemoteAgentFrame } from "../dist/remote/protocol.js";

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

function readFrame(socket) {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const onData = (chunk) => {
			buffer += chunk;
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;
			cleanup();
			resolve(JSON.parse(buffer.slice(0, newlineIndex)));
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("error", onError);
		};
		socket.on("data", onData);
		socket.once("error", onError);
	});
}

test("remote agent channel attaches clients and maps input to pibo events", async () => {
	const emitted = [];
	const listeners = [];
	const bindings = new MemoryBindingStore();
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
				{
					name: "status",
					description: "Return current session status.",
					slashCommands: ["status"],
				},
			];
		},
	});

	const address = channel.getAddress();
	assert.ok(address);
	const socket = connect({ host: address.host, port: address.port });
	socket.setEncoding("utf-8");

	await new Promise((resolve, reject) => {
		socket.once("connect", resolve);
		socket.once("error", reject);
	});

	try {
		socket.write(
			encodeRemoteAgentFrame({
				type: "remote_attach",
				id: "attach-1",
				sessionName: "local-a",
				profile: "example-plugin",
			}),
		);
		const attach = await readFrame(socket);
		assert.equal(attach.ok, true);
		assert.equal(attach.payload.binding.sessionKey, "remote-agent:local-a");
		assert.equal(attach.payload.binding.originalProfile, "example-plugin");
		assert.deepEqual(attach.payload.capabilities.actions, [
			{
				name: "status",
				description: "Return current session status.",
				slashCommands: ["status"],
			},
		]);

		socket.write(
			encodeRemoteAgentFrame({
				type: "remote_capabilities",
				id: "capabilities-1",
			}),
		);
		const capabilities = await readFrame(socket);
		assert.equal(capabilities.ok, true);
		assert.deepEqual(capabilities.payload.actions, attach.payload.capabilities.actions);

		socket.write(
			encodeRemoteAgentFrame({
				type: "remote_input",
				id: "msg-1",
				input: { type: "message", text: "hello" },
			}),
		);
		const response = await readFrame(socket);
		assert.equal(response.ok, true);
		assert.deepEqual(emitted[0], {
			type: "message",
			sessionKey: "remote-agent:local-a",
			id: "msg-1",
			text: "hello",
			source: "ui",
		});

		listeners[0]({
			type: "assistant_message",
			sessionKey: "remote-agent:local-a",
			eventId: "msg-1",
			text: "hi",
		});
		const event = await readFrame(socket);
		assert.equal(event.type, "remote_event");
		assert.equal(event.payload.text, "hi");
	} finally {
		socket.destroy();
		await channel.stop?.();
	}
});
