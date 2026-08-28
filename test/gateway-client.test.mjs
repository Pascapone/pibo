import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import test from "node:test";

import {
	createGatewayClientRequestFrame,
	createGatewayClientSubscriptionFrame,
	parseGatewayClientMessage,
} from "../dist/gateway/client.js";
import { isGatewayRequestFrame } from "../dist/gateway/protocol.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;
const stackTracePattern = /GatewayClientExpectedError|\n\s*at\s|node:internal/;

async function runCliFailure(args) {
	try {
		await execFileAsync(process.execPath, [cliPath, ...args]);
		assert.fail(`Expected CLI failure for: ${args.join(" ")}`);
	} catch (error) {
		assert.equal(error.code, 1);
		return error;
	}
}

async function closeServer(server) {
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withMockGateway(handler) {
	const frames = [];
	const sockets = new Set();
	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					const frame = JSON.parse(line);
					frames.push(frame);
					handler(frame, socket, frames);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
		socket.once("close", () => sockets.delete(socket));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		port: server.address().port,
		frames,
		async close() {
			for (const socket of sockets) socket.destroy();
			await closeServer(server);
		},
	};
}

function writeFrame(socket, frame) {
	if (!socket.destroyed) socket.write(`${JSON.stringify(frame)}\n`);
}

function subscriptionResponse(frame, overrides = {}) {
	return {
		type: "res",
		id: frame.id,
		ok: true,
		payload: { subscription: frame.subscription },
		...overrides,
	};
}

function queuedResponse(frame) {
	return {
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
	};
}

function routerEvent(payload) {
	return { type: "event", event: "router", payload };
}

async function runPipedClient(port, lines, timeoutMs = 12_000) {
	const startedAt = Date.now();
	const child = spawn(process.execPath, [cliPath, "client", "ps_pipe", "--host", "127.0.0.1", "--port", String(port)], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(lines);
	const code = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`piped client did not exit\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (exitCode) => {
			clearTimeout(timeout);
			resolve(exitCode);
		});
	});
	return { code, stdout, stderr, elapsedMs: Date.now() - startedAt };
}

function assertCompactFailure(result, pattern) {
	assert.equal(result.code, 1, result.stderr);
	assert.match(result.stderr, pattern);
	assert.doesNotMatch(result.stderr, stackTracePattern);
	assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /you> /);
}

test("root discovery and client help expose queue, steering, streaming EOF, and TCP security", async () => {
	const root = await execFileAsync(process.execPath, [cliPath]);
	assert.match(root.stdout, /client\s+Send queued or steering messages to one Pibo Session/);

	const help = await execFileAsync(process.execPath, [cliPath, "client", "--help"]);
	assert.match(help.stdout, /Start a console client for one Pibo Session/);
	assert.match(help.stdout, /\/steer <message>/);
	assert.match(help.stdout, /\/queue <message>/);
	assert.match(help.stdout, /--host <host>\s+Gateway host/);
	assert.match(help.stdout, /--port <port>/);
	assert.match(help.stdout, /Piped EOF waits for acknowledgements and terminal completion/);
	assert.match(help.stdout, /Prompts are shown only in a TTY/);
	assert.match(help.stdout, /unauthenticated and unencrypted/);
	assert.match(help.stdout, /trusted networks or through a secure tunnel/);
	assert.doesNotMatch(help.stdout, /Loopback gateway host|Remote hosts are not allowed|Requires an interactive TTY/);
});

test("client arguments reject empty sessions, hosts, and invalid ports", async () => {
	assert.match((await runCliFailure(["client", ""])).stderr, /Pibo Session ID must not be empty/);
	assert.match((await runCliFailure(["client", "ps_test", "--host", ""])).stderr, /Gateway host must not be empty/);
	assert.match((await runCliFailure(["client", "ps_test", "--port", "0"])).stderr, /Port must be an integer between 1 and 65535/);
});

test("gateway client messages queue by default", () => {
	assert.deepEqual(parseGatewayClientMessage("  continue normally  "), {
		ok: true,
		text: "continue normally",
	});
	assert.deepEqual(parseGatewayClientMessage("/steering is ordinary text"), {
		ok: true,
		text: "/steering is ordinary text",
	});
});

test("gateway client supports explicit queue and steering delivery with whitespace separators", () => {
	assert.deepEqual(parseGatewayClientMessage("/queue run this after the current turn"), {
		ok: true,
		text: "run this after the current turn",
		delivery: "queue",
	});
	assert.deepEqual(parseGatewayClientMessage("/steer\tchange the current approach"), {
		ok: true,
		text: "change the current approach",
		delivery: "steer",
	});
});

test("gateway client rejects empty delivery commands locally", () => {
	assert.deepEqual(parseGatewayClientMessage("/queue"), {
		ok: false,
		error: "Usage: /queue <message>",
	});
	assert.deepEqual(parseGatewayClientMessage("/steer\t  "), {
		ok: false,
		error: "Usage: /steer <message>",
	});
});

test("gateway client frames preserve Pibo Session and event identity", () => {
	const request = createGatewayClientRequestFrame({
		type: "message",
		piboSessionId: "ps_running",
		text: "change course",
		source: "user",
		delivery: "steer",
	});
	assert.equal(request.type, "req");
	assert.equal(request.event.piboSessionId, "ps_running");
	assert.equal(request.event.id, request.id);
	assert.equal(request.event.delivery, "steer");

	const preserved = createGatewayClientRequestFrame({
		type: "execution",
		id: "event-from-caller",
		piboSessionId: "ps_running",
		action: "status",
	});
	assert.equal(preserved.event.id, "event-from-caller");
	assert.notEqual(preserved.id, preserved.event.id);

	const subscription = createGatewayClientSubscriptionFrame("ps_running");
	assert.equal(subscription.type, "subscribe");
	assert.deepEqual(subscription.subscription, { type: "session", piboSessionId: "ps_running" });
	assert.ok(subscription.id.length > 0);
});

test("global gateway request validation remains compatible while the CLI validates locally", () => {
	assert.equal(isGatewayRequestFrame({
		type: "req",
		id: "",
		event: {
			type: "message",
			id: " ",
			piboSessionId: " ",
			text: " ",
			delivery: "legacy-client-value",
		},
	}), true);
});

test("piped client waits beyond acknowledgements for correlated streaming and terminal events", async () => {
	let messageIndex = 0;
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		messageIndex += 1;
		if (frame.event.delivery === "steer") {
			writeFrame(socket, {
				type: "res",
				id: frame.id,
				ok: true,
				payload: {
					type: "message_steered",
					piboSessionId: frame.event.piboSessionId,
					eventId: frame.event.id,
					activeEventId: "active-turn-1",
					text: frame.event.text,
					source: frame.event.source,
				},
			});
			setTimeout(() => {
				writeFrame(socket, routerEvent({ type: "assistant_delta", piboSessionId: "ps_pipe", eventId: "active-turn-1", text: "steered stream" }));
				writeFrame(socket, routerEvent({ type: "assistant_message", piboSessionId: "ps_pipe", eventId: "active-turn-1", text: "steered stream" }));
				writeFrame(socket, routerEvent({ type: "message_finished", piboSessionId: "ps_pipe", eventId: "active-turn-1" }));
			}, 70);
			return;
		}

		writeFrame(socket, queuedResponse(frame));
		const delay = messageIndex === 2 ? 120 : 180;
		const reply = messageIndex === 2 ? "queued follow-up" : "default queued";
		setTimeout(() => {
			writeFrame(socket, routerEvent({ type: "message_started", piboSessionId: "ps_pipe", eventId: frame.event.id, text: frame.event.text, source: "user" }));
			writeFrame(socket, routerEvent({ type: "assistant_delta", piboSessionId: "ps_pipe", eventId: frame.event.id, text: reply }));
			writeFrame(socket, routerEvent({ type: "assistant_message", piboSessionId: "ps_pipe", eventId: frame.event.id, text: reply }));
			writeFrame(socket, routerEvent({ type: "message_finished", piboSessionId: "ps_pipe", eventId: frame.event.id }));
		}, delay);
	});

	try {
		const result = await runPipedClient(gateway.port, "/steer\tchange the active approach\n/queue follow up afterward\nplain default queue\n");
		assert.equal(result.code, 0, result.stderr);
		assert.ok(result.elapsedMs >= 150, `client exited before delayed terminal output (${result.elapsedMs}ms)`);
		assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /you> /);
		assert.match(result.stderr, /steer: delivered to active turn active-turn-1/);
		assert.match(result.stdout, /steered stream/);
		assert.match(result.stdout, /queued follow-up/);
		assert.match(result.stdout, /default queued/);
		assert.equal(gateway.frames.length, 4);
		assert.deepEqual(gateway.frames[0].subscription, { type: "session", piboSessionId: "ps_pipe" });
		assert.deepEqual(gateway.frames.slice(1).map((frame) => ({
			piboSessionId: frame.event.piboSessionId,
			requestMatchesEvent: frame.id === frame.event.id,
			text: frame.event.text,
			delivery: frame.event.delivery,
		})), [
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "change the active approach", delivery: "steer" },
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "follow up afterward", delivery: "queue" },
			{ piboSessionId: "ps_pipe", requestMatchesEvent: true, text: "plain default queue", delivery: undefined },
		]);
	} finally {
		await gateway.close();
	}
});

test("piped client preserves terminal events that arrive before their acknowledgement", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		writeFrame(socket, routerEvent({ type: "assistant_message", piboSessionId: "ps_pipe", eventId: frame.event.id, text: "fast reply" }));
		writeFrame(socket, routerEvent({ type: "message_finished", piboSessionId: "ps_pipe", eventId: frame.event.id }));
		setTimeout(() => writeFrame(socket, queuedResponse(frame)), 30);
	});

	try {
		const result = await runPipedClient(gateway.port, "fast turn\n");
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /fast reply/);
	} finally {
		await gateway.close();
	}
});

test("piped client reports rejected acknowledgements with a nonzero exit code", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		writeFrame(socket, { type: "res", id: frame.id, ok: false, error: { message: "session is not accepting steering" } });
	});

	try {
		assertCompactFailure(await runPipedClient(gateway.port, "/steer too late\n"), /error: session is not accepting steering/);
	} finally {
		await gateway.close();
	}
});

test("piped client reports correlated session errors after an accepted message", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		writeFrame(socket, queuedResponse(frame));
		setTimeout(() => writeFrame(socket, routerEvent({
			type: "session_error",
			piboSessionId: frame.event.piboSessionId,
			eventId: frame.event.id,
			error: "model call failed",
		})), 20);
	});

	try {
		assertCompactFailure(await runPipedClient(gateway.port, "fail this turn\n"), /session error: model call failed/);
	} finally {
		await gateway.close();
	}
});

test("client reports subscription rejection without a Node stack trace", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		writeFrame(socket, subscriptionResponse(frame, { ok: false, payload: undefined, error: { message: "subscription denied" } }));
	});

	try {
		assertCompactFailure(await runPipedClient(gateway.port, "never sent\n"), /error: subscription denied/);
		assert.equal(gateway.frames.length, 1);
	} finally {
		await gateway.close();
	}
});

test("client reports a steering acknowledgement without active-turn correlation", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		writeFrame(socket, {
			type: "res",
			id: frame.id,
			ok: true,
			payload: { type: "message_steered", piboSessionId: frame.event.piboSessionId, eventId: frame.event.id },
		});
	});

	try {
		const result = await runPipedClient(gateway.port, "/steer change course\n");
		assertCompactFailure(result, /steering acknowledgement did not identify the active turn/);
		assert.doesNotMatch(result.stderr, /steer: delivered/);
	} finally {
		await gateway.close();
	}
});

test("client reports gateway close before terminal completion without a Node stack trace", async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") {
			writeFrame(socket, subscriptionResponse(frame));
			return;
		}
		writeFrame(socket, queuedResponse(frame));
		setTimeout(() => socket.end(), 20);
	});

	try {
		assertCompactFailure(await runPipedClient(gateway.port, "close early\n"), /Gateway connection closed before 0 acknowledgement\(s\) and 1 terminal completion\(s\)/);
	} finally {
		await gateway.close();
	}
});

test("client reports acknowledgement timeout without a Node stack trace", { timeout: 10_000 }, async () => {
	const gateway = await withMockGateway((frame, socket) => {
		if (frame.type === "subscribe") writeFrame(socket, subscriptionResponse(frame));
	});

	try {
		assertCompactFailure(await runPipedClient(gateway.port, "no acknowledgement\n"), /Timed out waiting for 1 gateway acknowledgement\(s\)/);
	} finally {
		await gateway.close();
	}
});
