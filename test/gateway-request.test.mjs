import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { sendGatewayEvent, sendGatewayMessageAndWaitForReply } from "../dist/gateway/request.js";

async function closeServer(server) {
	await new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function withMockGateway(handler) {
	const receivedFrames = [];
	const server = net.createServer((socket) => {
		socket.setEncoding("utf-8");
		socket.on("data", (chunk) => {
			for (const line of chunk.trim().split("\n")) {
				if (!line) continue;
				const frame = JSON.parse(line);
				receivedFrames.push(frame);
				handler(frame, socket);
			}
		});
	});

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();

	return {
		port: address.port,
		receivedFrames,
		close: () => closeServer(server),
	};
}

test("sendGatewayEvent sends a request event and resolves the gateway response", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
	});

	try {
		const response = await sendGatewayEvent(
			{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(response.ok, true);
		assert.equal(response.payload.type, "message_queued");
		assert.equal(response.payload.text, "hello");
		assert.equal(gateway.receivedFrames.length, 1);
		assert.equal(gateway.receivedFrames[0].event.type, "message");
		assert.equal(typeof gateway.receivedFrames[0].event.id, "string");
	} finally {
		await gateway.close();
	}
});

test("sendGatewayEvent ignores responses with a different request id", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: "unrelated-request",
				ok: true,
				payload: { type: "ignored" },
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
	});

	try {
		const response = await sendGatewayEvent(
			{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(response.ok, true);
		assert.equal(response.id, gateway.receivedFrames[0].id);
		assert.equal(response.payload.type, "message_queued");
	} finally {
		await gateway.close();
	}
});

test("sendGatewayEvent buffers fragmented gateway responses", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		const responseLine = `${JSON.stringify({
			type: "res",
			id: frame.id,
			ok: true,
			payload: {
				type: "message_queued",
				piboSessionId: frame.event.piboSessionId,
				eventId: frame.event.id,
				queuedMessages: 1,
				text: frame.event.text,
				source: frame.event.source,
			},
		})}\n`;

		socket.write(responseLine.slice(0, 17));
		setImmediate(() => socket.write(responseLine.slice(17)));
	});

	try {
		const response = await sendGatewayEvent(
			{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(response.ok, true);
		assert.equal(response.id, gateway.receivedFrames[0].id);
		assert.equal(response.payload.type, "message_queued");
		assert.equal(response.payload.text, "hello");
	} finally {
		await gateway.close();
	}
});

test("sendGatewayMessageAndWaitForReply rejects when the gateway rejects the message", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: false,
				error: { message: "session is not accepting input" },
			})}\n`,
		);
	});

	try {
		await assert.rejects(
			sendGatewayMessageAndWaitForReply(
				{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
				{ port: gateway.port },
			),
			/session is not accepting input/,
		);
	} finally {
		await gateway.close();
	}
});

test("sendGatewayMessageAndWaitForReply rejects on the correlated session error", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "event",
				event: "router",
				payload: {
					type: "session_error",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					error: "model call failed",
				},
			})}\n`,
		);
	});

	try {
		await assert.rejects(
			sendGatewayMessageAndWaitForReply(
				{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
				{ port: gateway.port },
			),
			/model call failed/,
		);
	} finally {
		await gateway.close();
	}
});

test("sendGatewayMessageAndWaitForReply preserves an existing event id for reply correlation", async () => {
	const callerEventId = "caller-event-id";
	const gateway = await withMockGateway((frame, socket) => {
		assert.notEqual(frame.id, callerEventId);
		assert.equal(frame.event.id, callerEventId);
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "event",
				event: "router",
				payload: {
					type: "assistant_message",
					piboSessionId: frame.event.piboSessionId,
					eventId: callerEventId,
					text: "correlated by caller id",
				},
			})}\n`,
		);
	});

	try {
		const result = await sendGatewayMessageAndWaitForReply(
			{ id: callerEventId, type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(result.response.ok, true);
		assert.equal(result.reply.eventId, callerEventId);
		assert.equal(result.reply.text, "correlated by caller id");
	} finally {
		await gateway.close();
	}
});

test("sendGatewayMessageAndWaitForReply resolves only the correlated assistant reply", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "event",
				event: "router",
				payload: {
					type: "assistant_message",
					piboSessionId: frame.event.piboSessionId,
					eventId: "unrelated",
					text: "wrong reply",
				},
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "event",
				event: "router",
				payload: {
					type: "assistant_message",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					text: "right reply",
				},
			})}\n`,
		);
	});

	try {
		const result = await sendGatewayMessageAndWaitForReply(
			{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(result.response.ok, true);
		assert.equal(result.reply.text, "right reply");
		assert.equal(result.reply.eventId, gateway.receivedFrames[0].event.id);
	} finally {
		await gateway.close();
	}
});

test("sendGatewayMessageAndWaitForReply tolerates reply before response", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		socket.write(
			`${JSON.stringify({
				type: "event",
				event: "router",
				payload: {
					type: "assistant_message",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					text: "early reply",
				},
			})}\n`,
		);
		socket.write(
			`${JSON.stringify({
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_queued",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					queuedMessages: 1,
					text: frame.event.text,
					source: frame.event.source,
				},
			})}\n`,
		);
	});

	try {
		const result = await sendGatewayMessageAndWaitForReply(
			{ type: "message", piboSessionId: "receiver", text: "hello", source: "actor" },
			{ port: gateway.port },
		);

		assert.equal(result.response.ok, true);
		assert.equal(result.reply.text, "early reply");
	} finally {
		await gateway.close();
	}
});
