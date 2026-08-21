import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	CodexAppServerClient,
	CodexAppServerClientError,
	CodexAppServerRpcResponseError,
} from "../dist/agent-runtimes/codex-native/client.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-fake.mjs", import.meta.url));

function clientOptions(scenario = "happy", overrides = {}) {
	return {
		command: process.execPath,
		args: [fixturePath],
		env: { ...process.env, PIBO_CODEX_FAKE_SCENARIO: scenario },
		clientInfo: { name: "pibo-codex-client-test", title: "Pibo Codex Client Test", version: "1.0.0" },
		startupTimeoutMs: 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
		overloadRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 4, jitterRatio: 0 },
		...overrides,
	};
}

async function startClient(t, scenario = "happy", overrides = {}) {
	const client = await CodexAppServerClient.start(clientOptions(scenario, overrides));
	t.after(() => client.close());
	return client;
}

function isClientError(code) {
	return (error) => error instanceof CodexAppServerClientError && error.code === code;
}

test("Codex App Server client applies a private POSIX child file-creation mask without changing the parent mask", { skip: process.platform === "win32" }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-client-umask-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const created = join(root, "created");
	const parentMask = process.umask();
	const client = await startClient(t, "happy", {
		fileCreationMask: 0o077,
		env: {
			...process.env,
			PIBO_CODEX_FAKE_SCENARIO: "happy",
			PIBO_CODEX_FAKE_CREATE_PATH: created,
		},
	});
	assert.equal(process.umask(), parentMask);
	assert.equal((await stat(created)).mode & 0o777, 0o700);
	assert.equal((await stat(join(created, "created.txt"))).mode & 0o777, 0o600);
	await client.close();
	await assert.rejects(
		CodexAppServerClient.start(clientOptions("happy", { fileCreationMask: 0o1000 })),
		/fileCreationMask/,
	);
});

test("Codex App Server client performs initialize/initialized before other requests", async (t) => {
	const client = await startClient(t);
	assert.deepEqual(client.initializeResponse, {
		codexHome: "/tmp/fake-codex-home",
		platformFamily: "unix",
		platformOs: "linux",
		userAgent: "fake-codex-app-server/0.147.0",
	});
	assert.equal(client.snapshot.state, "ready");
	assert.equal(Object.isFrozen(client.initializeResponse), true);

	const response = await client.request("test/sequence", {});
	assert.deepEqual(response.sequence, ["initialize", "initialized", "test/sequence"]);
	assert.deepEqual(response.initializeCapabilities, { experimentalApi: false });
	assert.equal(response.jsonrpcSeen, false);
	await assert.rejects(client.request("initialize", {}), isClientError("protocol_error"));
	await assert.rejects(client.notify("initialized"), isClientError("protocol_error"));
});

test("Codex App Server client correlates out-of-order responses and forwards notifications", async (t) => {
	const client = await startClient(t);
	const notifications = [];
	client.subscribeNotifications((notification) => notifications.push(notification));

	const slow = client.request("test/echo", { value: "slow", delayMs: 30 });
	const fast = client.request("test/echo", { value: "fast", delayMs: 0 });
	assert.deepEqual(await fast, { value: "fast" });
	assert.deepEqual(await slow, { value: "slow" });

	await client.request("test/notify", { value: "notice" });
	assert.deepEqual(notifications, [{ method: "test/notification", params: { value: "notice" } }]);
});

test("Codex App Server client handles server-initiated requests", async (t) => {
	const client = await startClient(t);
	client.setServerRequestHandler(async (request) => ({ echoed: request.params.value, method: request.method }));

	const response = await client.request("test/serverRequest", { value: "from-server" });
	assert.deepEqual(response, {
		clientResult: { echoed: "from-server", method: "test/serverRequest" },
	});
});

test("Codex App Server client retries overload responses with a bounded policy", async (t) => {
	const client = await startClient(t, "happy", {
		env: {
			...process.env,
			PIBO_CODEX_FAKE_SCENARIO: "happy",
			PIBO_CODEX_FAKE_OVERLOAD_FAILURES: "2",
		},
	});
	assert.deepEqual(await client.request("test/overload", {}), { attempts: 3 });

	const exhausted = await startClient(t, "happy", {
		env: {
			...process.env,
			PIBO_CODEX_FAKE_SCENARIO: "happy",
			PIBO_CODEX_FAKE_OVERLOAD_FAILURES: "4",
		},
		overloadRetry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
	});
	await assert.rejects(
		exhausted.request("test/overload", {}),
		(error) => error instanceof CodexAppServerRpcResponseError && error.rpcCode === -32001,
	);
});

test("Codex App Server client bounds pending requests, timeouts, and aborts", async (t) => {
	const client = await startClient(t, "happy", { maxPendingRequests: 1, requestTimeoutMs: 100 });
	const pending = client.request("test/never", {}, { timeoutMs: 80 });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(client.snapshot.pendingRequests, 1);
	await assert.rejects(client.request("test/echo", { value: "blocked" }), isClientError("pending_limit"));
	await assert.rejects(pending, isClientError("timeout"));
	assert.equal(client.snapshot.pendingRequests, 0);

	const controller = new AbortController();
	const aborted = client.request("test/never", {}, { signal: controller.signal, timeoutMs: 1_000 });
	controller.abort();
	await assert.rejects(aborted, isClientError("aborted"));
	assert.equal(client.snapshot.pendingRequests, 0);
});

test("Codex App Server client rejects malformed JSON and terminates the process", async (t) => {
	const client = await startClient(t);
	await assert.rejects(client.request("test/malformed", {}), isClientError("protocol_error"));
	assert.equal(client.snapshot.state, "failed");
	assert.ok(client.getDiagnostics().some((diagnostic) => diagnostic.code === "codex_malformed_json"));
});

test("Codex App Server client rejects oversized inbound and outbound messages", async (t) => {
	const inbound = await startClient(t, "happy", {
		maxMessageBytes: 512,
		env: {
			...process.env,
			PIBO_CODEX_FAKE_SCENARIO: "happy",
			PIBO_CODEX_FAKE_OVERSIZED_BYTES: "2048",
		},
	});
	await assert.rejects(inbound.request("test/oversized", {}), isClientError("message_too_large"));
	assert.ok(inbound.getDiagnostics().some((diagnostic) => diagnostic.code === "codex_message_too_large"));

	const outbound = await startClient(t, "happy", { maxMessageBytes: 512 });
	await assert.rejects(
		outbound.request("test/echo", { value: "x".repeat(2_048) }),
		isClientError("message_too_large"),
	);
	assert.equal(outbound.snapshot.pendingRequests, 0);
});

test("Codex App Server client honors stdin backpressure without reordering", async (t) => {
	const client = await startClient(t, "happy", {
		maxMessageBytes: 256 * 1024,
		maxPendingRequests: 64,
		requestTimeoutMs: 5_000,
	});
	await client.request("test/prepareBackpressure", {});
	const payload = "x".repeat(64 * 1024);
	const responses = await Promise.all(
		Array.from({ length: 32 }, (_value, index) => client.request("test/echo", { value: `${index}:${payload}` })),
	);
	assert.deepEqual(responses.map((response) => Number.parseInt(response.value.split(":", 1)[0], 10)), Array.from({ length: 32 }, (_value, index) => index));
	assert.ok(client.snapshot.writeBackpressureCount > 0);
});

test("Codex App Server client bounds and redacts stderr diagnostics", async (t) => {
	const client = await startClient(t, "happy", { maxStderrBytes: 1_024 });
	assert.deepEqual(await client.request("test/stderr", {}), { ok: true });
	await new Promise((resolve) => setImmediate(resolve));
	const stderr = client.getStderrDiagnostic();
	assert.match(stderr, /\[redacted\]/i);
	assert.doesNotMatch(stderr, /fixture-bearer-value/);
	assert.doesNotMatch(stderr, /fixture-access-value/);
	assert.doesNotMatch(stderr, /fixture-refresh-value/);
	assert.doesNotMatch(stderr, /fixture_not_a_secret/);
	assert.ok(client.snapshot.stderrBytes > 0);
});

test("Codex App Server client rejects pending work when the process crashes", async (t) => {
	const client = await startClient(t);
	await assert.rejects(client.request("test/crash", {}), isClientError("process_exited"));
	assert.equal(client.snapshot.state, "failed");
	assert.ok(client.getDiagnostics().some((diagnostic) => diagnostic.code === "codex_process_exited"));
});

test("Codex App Server client rejects spawn and initialize failures", async () => {
	await assert.rejects(
		CodexAppServerClient.start(clientOptions("bad-initialize")),
		isClientError("protocol_error"),
	);
	await assert.rejects(
		CodexAppServerClient.start({
			...clientOptions("happy"),
			command: "/definitely/missing/pibo-codex-app-server",
		}),
		isClientError("spawn_failed"),
	);
});

test("Codex App Server client shutdown remains bounded during an active backpressured write", async () => {
	const client = await CodexAppServerClient.start(clientOptions("happy", {
		maxMessageBytes: 512 * 1024,
		shutdownTimeoutMs: 30,
		killTimeoutMs: 30,
	}));
	await client.request("test/prepareBackpressure", {});
	const pending = client.request("test/echo", { value: "x".repeat(256 * 1024) });
	for (let attempt = 0; attempt < 100 && client.snapshot.writeBackpressureCount === 0; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	assert.ok(client.snapshot.writeBackpressureCount > 0);
	const started = performance.now();
	const results = await Promise.allSettled([pending, client.close()]);
	assert.equal(results[0].status, "rejected");
	assert.equal(results[1].status, "fulfilled");
	assert.ok(performance.now() - started < 500);
	assert.equal(client.snapshot.state, "closed");
});

test("Codex App Server client shutdown is idempotent and bounded", async () => {
	const client = await CodexAppServerClient.start(clientOptions("ignore-shutdown", {
		shutdownTimeoutMs: 30,
		killTimeoutMs: 30,
	}));
	const started = performance.now();
	await Promise.all([client.close(), client.close()]);
	const elapsedMs = performance.now() - started;
	assert.ok(elapsedMs < 500, `shutdown took ${elapsedMs}ms`);
	assert.equal(client.snapshot.state, "closed");
});
