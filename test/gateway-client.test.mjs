import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { parseGatewayClientMessage } from "../dist/gateway/client.js";
import { isGatewayRequestFrame } from "../dist/gateway/protocol.js";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/bin/pibo.js", import.meta.url).pathname;

test("root discovery and client help expose queue and steering delivery", async () => {
	const root = await execFileAsync(process.execPath, [cliPath]);
	assert.match(root.stdout, /client\s+Send queued or steering messages to one Pibo Session/);

	const help = await execFileAsync(process.execPath, [cliPath, "client", "--help"]);
	assert.match(help.stdout, /Start a console client for one Pibo Session/);
	assert.match(help.stdout, /\/steer <message>/);
	assert.match(help.stdout, /\/queue <message>/);
	assert.match(help.stdout, /--host <host>/);
	assert.match(help.stdout, /--port <port>/);
});

test("gateway client messages queue by default", () => {
	assert.deepEqual(parseGatewayClientMessage("  continue normally  "), {
		ok: true,
		text: "continue normally",
	});
});

test("gateway client supports explicit queue and steering delivery", () => {
	assert.deepEqual(parseGatewayClientMessage("/queue run this after the current turn"), {
		ok: true,
		text: "run this after the current turn",
		delivery: "queue",
	});
	assert.deepEqual(parseGatewayClientMessage("/steer change the current approach"), {
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
	assert.deepEqual(parseGatewayClientMessage("/steer   "), {
		ok: false,
		error: "Usage: /steer <message>",
	});
});

test("gateway protocol validates optional message delivery", () => {
	for (const delivery of ["queue", "steer"]) {
		assert.equal(isGatewayRequestFrame({
			type: "req",
			id: `req-${delivery}`,
			event: {
				type: "message",
				piboSessionId: "ps_running",
				text: "hello",
				delivery,
			},
		}), true);
	}
	assert.equal(isGatewayRequestFrame({
		type: "req",
		id: "req-invalid",
		event: {
			type: "message",
			piboSessionId: "ps_running",
			text: "hello",
			delivery: "later",
		},
	}), false);
});
