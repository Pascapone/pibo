import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/codex-native/adapter.js";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

const fixture = resolve("test/fixtures/codex-app-server-auth-fake.mjs");

async function tempRoot(label) {
	const path = join(tmpdir(), `pibo-codex-auth-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(path, { recursive: true, mode: 0o700 });
	return path;
}

function createRegistry(homeRoot, instanceId, overrides = {}) {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: "codex-native",
		config: {
			executable: fixture,
			homeRoot,
			environmentAllowlist: ["PATH", "PIBO_CODEX_AUTH_FAKE_SCENARIO", "PIBO_CODEX_AUTH_FAKE_DELAY_MS"],
			experimentalUserInput: false,
			diagnosticTimeoutMs: 500,
			startupTimeoutMs: 1_000,
			requestTimeoutMs: 250,
			authLoginTimeoutMs: 2_000,
			shutdownTimeoutMs: 500,
			killTimeoutMs: 100,
			...overrides,
		},
	});
	return registry;
}

async function waitForTerminal(registry, runtimeInstanceId, flow, timeoutMs = 1_000) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const result = await registry.completeAuth(runtimeInstanceId, {
			providerId: "openai-codex",
			flowId: flow.flowId,
		});
		if (result.state !== "pending") return result;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
	}
	throw new Error("Timed out waiting for deterministic native Codex auth completion");
}

async function readTree(root) {
	const output = [];
	async function visit(path) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) await visit(child);
			else output.push({ path: child, content: await readFile(child, "utf8") });
		}
	}
	await visit(root);
	return output;
}

async function withScenario(scenario, operation, delayMs = "20") {
	const previousScenario = process.env.PIBO_CODEX_AUTH_FAKE_SCENARIO;
	const previousDelay = process.env.PIBO_CODEX_AUTH_FAKE_DELAY_MS;
	process.env.PIBO_CODEX_AUTH_FAKE_SCENARIO = scenario;
	process.env.PIBO_CODEX_AUTH_FAKE_DELAY_MS = delayMs;
	try {
		return await operation();
	} finally {
		if (previousScenario === undefined) delete process.env.PIBO_CODEX_AUTH_FAKE_SCENARIO;
		else process.env.PIBO_CODEX_AUTH_FAKE_SCENARIO = previousScenario;
		if (previousDelay === undefined) delete process.env.PIBO_CODEX_AUTH_FAKE_DELAY_MS;
		else process.env.PIBO_CODEX_AUTH_FAKE_DELAY_MS = previousDelay;
	}
}

test("native Codex device login uses official account notifications and persists in the private instance home", async () => {
	const root = await tempRoot("device");
	try {
		await chmod(fixture, 0o755);
		await withScenario("device-success", async () => {
			const registry = createRegistry(root, "codex-auth-device");
			const initial = await registry.getAuthStatus("codex-auth-device");
			assert.deepEqual(initial.map(({ id, state, configured }) => ({ id, state, configured })), [
				{ id: "openai-codex", state: "disconnected", configured: false },
			]);

			const started = await registry.startAuth("codex-auth-device", {
				providerId: "openai-codex",
				method: "device_code",
			});
			assert.equal(started.runtimeInstanceId, "codex-auth-device");
			assert.equal(started.state, "pending");
			assert.equal(started.flow.method, "device_code");
			assert.equal(started.flow.completion, "notification");
			assert.equal(started.flow.verificationUrl, "https://example.invalid/device");
			assert.equal(started.flow.userCode, "TEST-CODE");
			assert.doesNotMatch(JSON.stringify(started), /native-login-fixed|loginId|email|accountId/i);

			const completed = await waitForTerminal(registry, "codex-auth-device", started.flow);
			assert.equal(completed.state, "connected");
			assert.deepEqual(completed.details, { accountType: "chatgpt", planType: "plus" });
			assert.doesNotMatch(JSON.stringify(completed), /native-login-fixed|loginId|email|accountId/i);
			await registry.disposeAuth();
			assert.equal((await registry.getAuthStatus("codex-auth-device"))[0].state, "connected", "auth controller remains reusable after router disposal");
			await registry.disposeAuth();

			const restarted = createRegistry(root, "codex-auth-device");
			const persisted = await restarted.getAuthStatus("codex-auth-device");
			assert.equal(persisted[0].state, "connected");
			assert.deepEqual(persisted[0].details, { accountType: "chatgpt", planType: "plus" });
			await restarted.disposeAuth();
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("native Codex API-key login, logout, and same-adapter instances remain isolated without leaking the key", async () => {
	const root = await tempRoot("isolation");
	const piHome = await tempRoot("pi-decoy");
	const globalCodexHome = await tempRoot("global-decoy");
	const apiKey = "sk-fixture-sensitive-value-123456789";
	const previousPiHome = process.env.PI_CODING_AGENT_DIR;
	const previousGlobalCodexHome = process.env.CODEX_HOME;
	process.env.PI_CODING_AGENT_DIR = piHome;
	process.env.CODEX_HOME = globalCodexHome;
	await writeFile(join(globalCodexHome, "marker.txt"), "unchanged\n", { mode: 0o600 });
	try {
		await withScenario("device-success", async () => {
			const registry = new AgentRuntimeAdapterRegistry();
			registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
			for (const id of ["codex-auth-one", "codex-auth-two"]) {
				registry.registerInstance({
					id,
					adapterId: "codex-native",
					config: {
						executable: fixture,
						homeRoot: root,
						environmentAllowlist: ["PATH", "PIBO_CODEX_AUTH_FAKE_SCENARIO", "PIBO_CODEX_AUTH_FAKE_DELAY_MS"],
						experimentalUserInput: false,
						diagnosticTimeoutMs: 500,
						startupTimeoutMs: 1_000,
						requestTimeoutMs: 250,
						authLoginTimeoutMs: 2_000,
						shutdownTimeoutMs: 500,
						killTimeoutMs: 100,
					},
				});
			}

			const first = await registry.startAuth("codex-auth-one", {
				providerId: "openai-codex",
				method: "api_key",
				apiKey,
			});
			assert.deepEqual(
				{ runtimeInstanceId: first.runtimeInstanceId, state: first.state, details: first.details },
				{ runtimeInstanceId: "codex-auth-one", state: "connected", details: { accountType: "api_key" } },
			);
			assert.equal((await registry.getAuthStatus("codex-auth-two"))[0].state, "disconnected");

			const secondStarted = await registry.startAuth("codex-auth-two", {
				providerId: "openai-codex",
				method: "device_code",
			});
			assert.equal((await waitForTerminal(registry, "codex-auth-two", secondStarted.flow)).state, "connected");

			assert.equal((await registry.logoutAuth("codex-auth-one", { providerId: "openai-codex" })).state, "disconnected");
			assert.equal((await registry.getAuthStatus("codex-auth-one"))[0].state, "disconnected");
			assert.equal((await registry.getAuthStatus("codex-auth-two"))[0].state, "connected");

			const files = await readTree(root);
			assert.equal(files.some((file) => file.content.includes(apiKey)), false);
			assert.equal(JSON.stringify({ first, files: files.map((file) => file.path) }).includes(apiKey), false);
			assert.equal(await readFile(join(globalCodexHome, "marker.txt"), "utf8"), "unchanged\n");
			await assert.rejects(() => readFile(join(piHome, "auth.json"), "utf8"), /ENOENT/);
			for (const file of files) {
				if (process.platform === "win32") assertPrivateWindowsAcl(file.path, "file");
				else assert.equal((await stat(file.path)).mode & 0o077, 0);
			}
			await registry.disposeAuth();
		});
	} finally {
		if (previousPiHome === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousPiHome;
		if (previousGlobalCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = previousGlobalCodexHome;
		await rm(root, { recursive: true, force: true });
		await rm(piHome, { recursive: true, force: true });
		await rm(globalCodexHome, { recursive: true, force: true });
	}
});

test("native Codex auth handles cancellation, timeout, process failure, provider failure, and malformed responses safely", async (t) => {
	await t.test("cancellation", async () => {
		const root = await tempRoot("cancel");
		try {
			await withScenario("device-pending", async () => {
				const registry = createRegistry(root, "codex-auth-cancel");
				await registry.startAuth("codex-auth-cancel", {
					providerId: "openai-codex",
					method: "api_key",
					apiKey: "deterministic-previous-key",
				});
				const started = await registry.startAuth("codex-auth-cancel", { providerId: "openai-codex", method: "device_code" });
				const cancelled = await registry.cancelAuth("codex-auth-cancel", { providerId: "openai-codex", flowId: started.flow.flowId });
				assert.equal(cancelled.state, "connected");
				assert.deepEqual(cancelled.details, { accountType: "api_key" });
				assert.equal(cancelled.message, "Login was canceled.");
				assert.equal((await registry.getAuthStatus("codex-auth-cancel"))[0].state, "connected");
				await registry.disposeAuth();
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	await t.test("timeout", async () => {
		const root = await tempRoot("timeout");
		try {
			await withScenario("device-pending", async () => {
				const registry = createRegistry(root, "codex-auth-timeout", { authLoginTimeoutMs: 35 });
				const started = await registry.startAuth("codex-auth-timeout", { providerId: "openai-codex", method: "device_code" });
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
				const completed = await registry.completeAuth("codex-auth-timeout", { providerId: "openai-codex", flowId: started.flow.flowId });
				assert.equal(completed.state, "failed");
				assert.match(completed.message, /timed out/i);
				await registry.disposeAuth();
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	await t.test("process failure", async () => {
		const root = await tempRoot("crash");
		try {
			await withScenario("device-crash", async () => {
				const registry = createRegistry(root, "codex-auth-crash");
				const started = await registry.startAuth("codex-auth-crash", { providerId: "openai-codex", method: "device_code" });
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
				const completed = await registry.completeAuth("codex-auth-crash", { providerId: "openai-codex", flowId: started.flow.flowId });
				assert.equal(completed.state, "failed");
				assert.doesNotMatch(JSON.stringify(completed), /native-login-fixed|fixture-sensitive-value/i);
				await registry.disposeAuth();
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	await t.test("provider completion failure is redacted", async () => {
		const root = await tempRoot("failure");
		try {
			await withScenario("device-failure", async () => {
				const registry = createRegistry(root, "codex-auth-failure");
				const started = await registry.startAuth("codex-auth-failure", { providerId: "openai-codex", method: "device_code" });
				const completed = await waitForTerminal(registry, "codex-auth-failure", started.flow);
				assert.equal(completed.state, "failed");
				assert.doesNotMatch(JSON.stringify(completed), /Bearer|fixture-sensitive-value|native-login-fixed/i);
				await registry.disposeAuth();
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	await t.test("malformed start and account read", async () => {
		const startRoot = await tempRoot("malformed-start");
		const readRoot = await tempRoot("malformed-read");
		try {
			await withScenario("malformed-start", async () => {
				const registry = createRegistry(startRoot, "codex-auth-malformed-start");
				await assert.rejects(
					() => registry.startAuth("codex-auth-malformed-start", { providerId: "openai-codex", method: "device_code" }),
					(error) => error?.name === "AgentRuntimeAuthError" && /invalid response/i.test(error.message),
				);
				await registry.disposeAuth();
			});
			await withScenario("malformed-read", async () => {
				const registry = createRegistry(readRoot, "codex-auth-malformed-read");
				const status = await registry.getAuthStatus("codex-auth-malformed-read");
				assert.equal(status[0].state, "failed");
				assert.doesNotMatch(JSON.stringify(status), /must-not-escape|email/i);
				await registry.disposeAuth();
			});
		} finally {
			await rm(startRoot, { recursive: true, force: true });
			await rm(readRoot, { recursive: true, force: true });
		}
	});

	await t.test("status timeout", async () => {
		const root = await tempRoot("read-timeout");
		try {
			await withScenario("read-timeout", async () => {
				const registry = createRegistry(root, "codex-auth-read-timeout", { requestTimeoutMs: 30 });
				const status = await registry.getAuthStatus("codex-auth-read-timeout");
				assert.equal(status[0].state, "failed");
				await registry.disposeAuth();
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
