import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { createWebHostChannel } from "../dist/web/channel.js";

function contextFor(apps) {
	return {
		emit() { throw new Error("not used"); },
		subscribe() { return () => {}; },
		getSession() { return undefined; },
		createSession() { throw new Error("not used"); },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return apps; },
	};
}

async function start(apps) {
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	await channel.start(contextFor(apps));
	const address = channel.getAddress();
	assert.ok(address);
	return { channel, baseURL: `http://${address.host}:${address.port}`, address };
}

async function requestThatMayClose(url, options) {
	try {
		const response = await fetch(url, options);
		await response.arrayBuffer();
		return false;
	} catch {
		return true;
	}
}

function waitFor(predicate, timeoutMs = 1000) {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const poll = () => {
			if (predicate()) return resolve();
			if (Date.now() >= deadline) return reject(new Error("condition was not reached"));
			setTimeout(poll, 5);
		};
		poll();
	});
}

test("partially-written node handlers stay request-scoped", async () => {
	let partialWriteHeads = 0;
	const app = {
		name: "failure-node-app",
		mountPath: "/node",
		apiPrefix: "/api/node",
		matchesHost: () => true,
		async handleNodeRequest(request, response) {
			if (request.url?.startsWith("/error")) throw new Error("ordinary application error");
			if (request.url?.startsWith("/partial")) {
				const originalWriteHead = response.writeHead.bind(response);
				response.writeHead = (...args) => {
					partialWriteHeads += 1;
					return originalWriteHead(...args);
				};
				response.writeHead(200, { "content-type": "text/plain" });
				response.write("partial");
				throw new Error("injected post-header failure");
			}
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("independent request succeeded");
		},
	};
	const host = await start([app]);
	const diagnostics = [];
	const originalConsoleError = console.error;
	const unhandled = [];
	const onUnhandled = (error) => unhandled.push(error);
	console.error = (...args) => diagnostics.push(args.join(" "));
	process.on("unhandledRejection", onUnhandled);
	try {
		const errorResponse = await fetch(`${host.baseURL}/error`);
		assert.equal(errorResponse.status, 500);
		assert.deepEqual(await errorResponse.json(), { error: "ordinary application error" });

		assert.equal(await requestThatMayClose(`${host.baseURL}/partial?credential=secret`, {
			headers: { authorization: "Bearer secret-token", cookie: "session=secret-cookie" },
		}), true);
		assert.equal(partialWriteHeads, 1, "the catch path must not send a second header block");

		const healthy = await fetch(`${host.baseURL}/healthy`);
		assert.equal(healthy.status, 200);
		assert.equal(await healthy.text(), "independent request succeeded");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(unhandled, []);
		assert.ok(diagnostics.some((line) => line.includes("contained request failure") && line.includes("headersSent=true")));
		const joined = diagnostics.join("\n");
		assert.doesNotMatch(joined, /secret-token|secret-cookie|credential=secret/);
	} finally {
		process.off("unhandledRejection", onUnhandled);
		console.error = originalConsoleError;
		await host.channel.stop();
	}
});

test("client disconnect cancels a streaming body without an unhandled rejection", async () => {
	let canceled = false;
	const app = {
		name: "stream-app",
		mountPath: "/stream",
		apiPrefix: "/api/stream",
		handleRequest(request) {
			if (new URL(request.url).pathname === "/stream/ok") return new Response("ok");
			return new Response(new ReadableStream({
				pull(controller) {
					controller.enqueue(new Uint8Array(64 * 1024));
				},
				cancel() {
					canceled = true;
				},
			}), { headers: { "content-type": "application/octet-stream" } });
		},
	};
	const host = await start([app]);
	const unhandled = [];
	const onUnhandled = (error) => unhandled.push(error);
	process.on("unhandledRejection", onUnhandled);
	try {
		await new Promise((resolve, reject) => {
			const request = httpRequest(`${host.baseURL}/stream/drop`, (response) => {
				response.once("data", () => {
					request.destroy();
					response.destroy();
					resolve();
				});
			});
			request.on("error", (error) => {
				if (error.code === "ECONNRESET") resolve();
				else reject(error);
			});
			request.end();
		});
		await waitFor(() => canceled);
		assert.equal(await (await fetch(`${host.baseURL}/stream/ok`)).text(), "ok");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(unhandled, []);
	} finally {
		process.off("unhandledRejection", onUnhandled);
		await host.channel.stop();
	}
});

test("a defect in async upgrade error handling is contained at the socket entry point", async () => {
	const diagnostics = [];
	const originalConsoleError = console.error;
	const app = {
		name: "upgrade-app",
		mountPath: "/upgrade",
		apiPrefix: "/api/upgrade",
		matchesHost: () => true,
		handleNodeRequest(request, response) {
			response.end("ok");
		},
		async handleUpgrade(request, socket) {
			socket.end = () => { throw new Error("injected socket end defect"); };
			throw new Error("injected upgrade failure");
		},
	};
	const host = await start([app]);
	console.error = (...args) => diagnostics.push(args.join(" "));
	try {
		await new Promise((resolve, reject) => {
			const socket = connect(host.address.port, host.address.host);
			socket.on("connect", () => socket.write([
				"GET /upgrade HTTP/1.1",
				`Host: ${host.address.host}:${host.address.port}`,
				"Connection: Upgrade",
				"Upgrade: websocket",
				"",
				"",
			].join("\r\n")));
			socket.on("close", resolve);
			socket.on("error", (error) => error.code === "ECONNRESET" ? resolve() : reject(error));
		});
		assert.equal(await (await fetch(`${host.baseURL}/healthy`)).text(), "ok");
		assert.ok(diagnostics.some((line) => line.includes("contained upgrade failure")));
	} finally {
		console.error = originalConsoleError;
		await host.channel.stop();
	}
});
