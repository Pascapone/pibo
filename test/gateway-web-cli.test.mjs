import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function reserveLoopbackPorts(count) {
	const servers = [];
	try {
		for (let index = 0; index < count; index += 1) {
			const server = net.createServer();
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", resolve);
			});
			servers.push(server);
		}
		return servers.map((server) => server.address().port);
	} finally {
		await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
	}
}

async function closeServerIfListening(server) {
	if (!server.listening) return;
	await new Promise((resolve) => server.close(resolve));
}

async function reserveAdjacentLoopbackPorts() {
	for (let port = 30000; port < 65000; port += 10) {
		const webServer = net.createServer();
		const gatewayServer = net.createServer();
		try {
			await new Promise((resolve, reject) => {
				webServer.once("error", reject);
				webServer.listen(port, "127.0.0.1", resolve);
			});
			await new Promise((resolve, reject) => {
				gatewayServer.once("error", reject);
				gatewayServer.listen(port + 1, "127.0.0.1", resolve);
			});
			return [port, port + 1];
		} catch {
			// Try the next pair.
		} finally {
			await Promise.all([closeServerIfListening(webServer), closeServerIfListening(gatewayServer)]);
		}
	}
	throw new Error("Unable to reserve adjacent loopback ports");
}

function canConnect(port) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.setTimeout(500);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", () => resolve(false));
	});
}

async function waitForLog(pattern, child, logs) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		assert.equal(child.exitCode, null, `gateway process exited early\n${logs.join("")}`);
		if (pattern.test(logs.join(""))) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.fail(`timed out waiting for log ${pattern}\n${logs.join("")}`);
}

async function waitForPorts(ports, children, logs) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		for (const child of children) {
			assert.equal(child.exitCode, null, `gateway process exited early\n${logs.join("")}`);
		}
		const reachable = await Promise.all(ports.map(canConnect));
		if (reachable.every(Boolean)) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	assert.fail(`timed out waiting for ports ${ports.join(", ")}\n${logs.join("")}`);
}

async function stopChild(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise((resolve) => child.once("exit", resolve)),
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (child.exitCode === null) child.kill("SIGKILL");
}

test("gateway:web CLI announces explicit web port with loopback Better Auth base URL", { timeout: 30_000 }, async () => {
	const [webPort, gatewayPort] = await reserveLoopbackPorts(2);
	const tmp = await mkdtemp(path.join(os.tmpdir(), "pibo-gateway-web-cli-"));
	const piboHome = path.join(tmp, "pibo");
	const logs = [];
	await mkdir(piboHome, { recursive: true });
	await writeFile(
		path.join(piboHome, "config.json"),
		JSON.stringify({
			auth: {
				baseURL: "http://127.0.0.1:4788",
				secret: "12345678901234567890123456789012",
				googleClientId: "test-client-id",
				googleClientSecret: "test-client-secret",
				allowedEmails: ["test@example.com"],
			},
		}),
	);

	const child = spawn(process.execPath, ["dist/bin/pibo.js", "gateway:web", "--web-host", "127.0.0.1", "--web-port", String(webPort), "--gateway-port", String(gatewayPort)], {
		cwd: repoRoot,
		env: { ...process.env, HOME: path.join(tmp, "home"), PIBO_HOME: piboHome },
	});
	child.stdout.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));
	child.stderr.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));

	try {
		await waitForLog(new RegExp(`pibo chat app available at http://127\\.0\\.0\\.1:${webPort}/apps/chat`), child, logs);
	} finally {
		await stopChild(child);
		await rm(tmp, { recursive: true, force: true });
	}
});

test("gateway:web CLI derives gateway port from explicit web port", { timeout: 30_000 }, async () => {
	const [webPort, derivedGatewayPort] = await reserveAdjacentLoopbackPorts();
	const tmp = await mkdtemp(path.join(os.tmpdir(), "pibo-gateway-web-cli-"));
	const logs = [];
	const child = spawn(process.execPath, ["dist/bin/pibo.js", "gateway:web", "--auth=local", "--web-host", "127.0.0.1", "--web-port", String(webPort)], {
		cwd: repoRoot,
		env: { ...process.env, HOME: path.join(tmp, "home"), PIBO_HOME: path.join(tmp, "pibo") },
	});
	child.stdout.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));
	child.stderr.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));

	try {
		await waitForPorts([webPort, derivedGatewayPort], [child], logs);
		await waitForLog(new RegExp(`pibo chat app available at http://127\\.0\\.0\\.1:${webPort}/apps/chat`), child, logs);
	} finally {
		await stopChild(child);
		await rm(tmp, { recursive: true, force: true });
	}
});

test("gateway:web CLI accepts distinct gateway ports for parallel instances", { timeout: 30_000 }, async () => {
	const [webPortOne, gatewayPortOne, webPortTwo, gatewayPortTwo] = await reserveLoopbackPorts(4);
	const tmp = await mkdtemp(path.join(os.tmpdir(), "pibo-gateway-web-cli-"));
	const logs = [];
	const children = [
		spawn(process.execPath, ["dist/bin/pibo.js", "gateway:web", "--auth=local", "--web-host", "127.0.0.1", "--web-port", String(webPortOne), "--gateway-port", String(gatewayPortOne)], {
			cwd: repoRoot,
			env: { ...process.env, HOME: path.join(tmp, "home-one"), PIBO_HOME: path.join(tmp, "pibo") },
		}),
		spawn(process.execPath, ["dist/bin/pibo.js", "gateway:web", "--auth=local", "--web-host", "127.0.0.1", "--web-port", String(webPortTwo), "--gateway-port", String(gatewayPortTwo)], {
			cwd: repoRoot,
			env: { ...process.env, HOME: path.join(tmp, "home-two"), PIBO_HOME: path.join(tmp, "pibo") },
		}),
	];
	for (const child of children) {
		child.stdout.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk) => logs.push(chunk));
	}

	try {
		await waitForPorts([webPortOne, gatewayPortOne, webPortTwo, gatewayPortTwo], children, logs);
	} finally {
		await Promise.all(children.map(stopChild));
		await rm(tmp, { recursive: true, force: true });
	}
});
