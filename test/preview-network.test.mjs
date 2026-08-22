import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";
import { findPreviewTargetProcess, isPreviewTargetProcessCurrent } from "../dist/previews/network.js";

async function availablePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return port;
}

async function startListener(port) {
	const child = spawn(process.execPath, ["-e", `require('node:net').createServer().listen(${port}, '127.0.0.1', () => console.log('ready'))`], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	await Promise.race([
		once(child.stdout, "data"),
		once(child, "exit").then(([code]) => { throw new Error(`listener exited with ${code}`); }),
	]);
	return child;
}

async function stopListener(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, "exit");
	child.kill("SIGTERM");
	await exited;
}

test("preview target identity rejects a replacement process on the same port", { skip: process.platform !== "linux" }, async (t) => {
	const port = await availablePort();
	const original = await startListener(port);
	let replacement;
	t.after(async () => {
		await stopListener(original);
		if (replacement) await stopListener(replacement);
	});

	const identity = findPreviewTargetProcess("127.0.0.1", port);
	assert.deepEqual(identity?.pid, original.pid);
	const exposure = {
		id: "pv-process-identity",
		targetHost: "127.0.0.1",
		targetPort: port,
		targetProcessId: identity.pid,
		targetProcessStartTicks: identity.startTicks,
	};
	assert.equal(isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 }), true);

	await stopListener(original);
	replacement = await startListener(port);
	assert.notEqual(replacement.pid, original.pid);
	assert.equal(isPreviewTargetProcessCurrent(exposure, { cacheMs: 0 }), false);
});
