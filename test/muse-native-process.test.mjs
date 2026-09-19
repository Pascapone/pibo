import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import {
	MUSE_NATIVE_ADAPTER_ID,
	MUSE_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../dist/agent-runtimes/muse-native/adapter.js";
import { parseMuseNativeRuntimeConfig } from "../dist/agent-runtimes/muse-native/config.js";
import {
	buildHostEnvironment,
	disposeMuseNativeSessionPaths,
	prepareMuseNativeSessionPaths,
	resolveMuseSandboxArgs,
	withTimeout,
} from "../dist/agent-runtimes/muse-native/process.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";

const fixturePath = fileURLToPath(new URL("./fixtures/muse-serve-fake.mjs", import.meta.url));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-muse-native-process-"));
	t.after(async () => {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	await chmod(fixturePath, 0o755);
	const fakeStateDir = join(root, "fake-state");
	process.env.MUSE_FAKE_STATE_DIR = fakeStateDir;
	return { root, fakeStateDir };
}

function runtimeConfig(root, overrides = {}) {
	const allowlist = process.platform === "win32"
		? ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "MUSE_FAKE_STATE_DIR", "MUSE_FAKE_VERSION_OUTPUT"]
		: ["PATH", "MUSE_FAKE_STATE_DIR", "MUSE_FAKE_VERSION_OUTPUT"];
	return parseMuseNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: allowlist,
		diagnosticTimeoutMs: 2_000,
		startupTimeoutMs: process.platform === "win32" ? 15_000 : 5_000,
		requestTimeoutMs: 10_000,
		shutdownTimeoutMs: 500,
		...overrides,
	});
}

function createAdapter(root, instanceId, configOverrides = {}) {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		displayName: "Muse Native Process Test",
		config: runtimeConfig(root, configOverrides),
	});
	return { registry, adapter, instanceId };
}

function openInput(instanceId, workspace, piboSessionId) {
	const selectedProfile = new InitialSessionContextBuilder(`profile-${instanceId}`)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const binding = {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: MUSE_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
	const piboSession = createPiboSession({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: selectedProfile.profileName,
		workspace,
		runtimeBinding: binding,
	});
	return { piboSession, profile: selectedProfile, binding, workspace, productContext: { piboSessionId } };
}

async function waitForPidExit(pid, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await delay(50);
	}
	throw new Error(`Muse fake host ${pid} survived its shutdown`);
}

async function onlyHostPid(fakeStateDir) {
	const pidFiles = (await readdir(fakeStateDir)).filter((name) => name.startsWith("fake-host-") && name.endsWith(".pid"));
	assert.equal(pidFiles.length, 1);
	return Number(await readFile(join(fakeStateDir, pidFiles[0]), "utf8"));
}

async function setHangMethods(fakeStateDir, methods) {
	await mkdir(fakeStateDir, { recursive: true });
	const path = join(fakeStateDir, "hang-methods.json");
	if (methods.length === 0) await rm(path, { force: true });
	else await writeFile(path, JSON.stringify(methods));
}

test("Muse native withTimeout resolves values and bounds hangs", async () => {
	assert.equal(await withTimeout(Promise.resolve("ok"), 1_000, "must not fire"), "ok");
	await assert.rejects(() => withTimeout(new Promise(() => {}), 50, "boom-label"), /boom-label/);
});

test("Muse native handshake timeout closes the host process", async (t) => {
	const { root, fakeStateDir } = await testRoot(t);
	await setHangMethods(fakeStateDir, ["initialize"]);
	const { registry, instanceId } = createAdapter(root, "muse-native-hang", { startupTimeoutMs: 500 });
	await assert.rejects(
		() => registry.openSession(instanceId, openInput(instanceId, root, "ps_muse_hang")),
		/timed out after 500ms/,
	);
	await waitForPidExit(await onlyHostPid(fakeStateDir));
});

test("Muse native session open timeout bounds a hanging host", async (t) => {
	const { root, fakeStateDir } = await testRoot(t);
	await setHangMethods(fakeStateDir, ["session/start"]);
	const { registry, instanceId } = createAdapter(root, "muse-native-starthang", { requestTimeoutMs: 500 });
	await assert.rejects(
		() => registry.openSession(instanceId, openInput(instanceId, root, "ps_muse_starthang")),
		/session open timed out after 500ms/,
	);
	await waitForPidExit(await onlyHostPid(fakeStateDir));
});

test("Muse native host environment filters reserved and dynamic-loader keys", async (t) => {
	const { root } = await testRoot(t);
	const config = runtimeConfig(root, { environmentAllowlist: ["PATH"] });
	const paths = await prepareMuseNativeSessionPaths({
		config,
		runtimeInstanceId: "muse-native-env",
		piboSessionId: "ps_muse_env",
		sessionGeneration: "gen-1",
	});
	const env = buildHostEnvironment({
		config,
		runtimeInstanceId: "muse-native-env",
		piboSessionId: "ps_muse_env",
		sessionGeneration: "gen-1",
		workspace: root,
		baseEnvironment: { PATH: "/base/bin" },
		resourceEnvironment: {
			PIBO_OK: "1",
			PATH: "/evil",
			MUSE_HOME: "/evil",
			DYLD_INSERT_LIBRARIES: "/evil",
			dyld_fallback_library_path: "/evil",
		},
	}, paths);
	assert.equal(env.HOME, paths.processHome);
	assert.equal(env.PATH, "/base/bin");
	assert.equal(env.PIBO_OK, "1");
	assert.equal(env.MUSE_HOME, undefined);
	assert.equal(env.DYLD_INSERT_LIBRARIES, undefined);
	assert.equal(env.dyld_fallback_library_path, undefined);
});

test("Muse native generation auth seeds both HOME and XDG config roots", async (t) => {
	const { root } = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root, "muse-native-authseed");
	await adapter.startAuth({ providerId: "meta", method: "api_key", apiKey: "seed-key" });
	const piboSessionId = "ps_muse_authseed";
	const sessionGeneration = "gen-authseed-1";
	const input = openInput(instanceId, root, piboSessionId);
	const session = await registry.openSession(instanceId, {
		...input,
		services: {
			resources: {
				sessionGeneration,
				getAdapterEnvironment: () => ({}),
				getMcpConfigPath: () => undefined,
			},
		},
	});
	t.after(() => session.dispose());
	const paths = await prepareMuseNativeSessionPaths({
		config: runtimeConfig(root),
		runtimeInstanceId: instanceId,
		piboSessionId,
		sessionGeneration,
	});
	for (const copy of [join(paths.processHome, ".config", "muse", "auth.json"), join(paths.xdgConfig, "muse", "auth.json")]) {
		const stored = JSON.parse(await readFile(copy, "utf8"));
		assert.equal(stored.providers.meta.api_key, "seed-key");
	}
});

test("Muse native version probe ignores non-muse triples", async (t) => {
	const { root } = await testRoot(t);
	process.env.MUSE_FAKE_VERSION_OUTPUT = "node v24.1.2\nmuse 1.3.0\n";
	try {
		const { adapter } = createAdapter(root, "muse-native-version");
		const diagnostics = await adapter.diagnose();
		assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "muse_native_version_ok"));
	} finally {
		delete process.env.MUSE_FAKE_VERSION_OUTPUT;
	}
});

test("Muse native sandbox flags honor explicit modes and skip non-Linux auto checks", async () => {
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "disabled", workspace: "/work", executable: "muse" }),
		{ args: ["--disable-sandbox"] },
	);
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "enabled", workspace: "/work", executable: "muse" }),
		{ args: [] },
	);
	assert.deepEqual(
		await resolveMuseSandboxArgs({ mode: "auto", workspace: "/work", executable: "muse", platform: "darwin" }),
		{ args: [] },
	);
});

test("Muse native auto sandbox degrades with diagnostics when Linux sandboxing cannot engage", async () => {
	const findBwrap = (name) => (name === "bwrap" ? "/usr/bin/bwrap" : undefined);
	const workingProbe = async () => true;

	const underWorkspace = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/root",
		executable: "/root/.local/bin/muse",
		platform: "linux",
		findExecutable: findBwrap,
		probeSandbox: workingProbe,
	});
	assert.deepEqual(underWorkspace.args, ["--disable-sandbox"]);
	assert.match(underWorkspace.diagnostic.message, /inside the session workspace/);

	const missingBwrap = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/work",
		executable: "/usr/local/bin/muse",
		platform: "linux",
		findExecutable: () => undefined,
		probeSandbox: workingProbe,
	});
	assert.deepEqual(missingBwrap.args, ["--disable-sandbox"]);
	assert.match(missingBwrap.diagnostic.message, /no bwrap was found on PATH/);

	const brokenBwrap = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/work",
		executable: "/usr/local/bin/muse",
		platform: "linux",
		findExecutable: findBwrap,
		probeSandbox: async () => false,
	});
	assert.deepEqual(brokenBwrap.args, ["--disable-sandbox"]);
	assert.match(brokenBwrap.diagnostic.message, /cannot sandbox/);

	const healthy = await resolveMuseSandboxArgs({
		mode: "auto",
		workspace: "/work",
		executable: "/usr/local/bin/muse",
		platform: "linux",
		findExecutable: findBwrap,
		probeSandbox: workingProbe,
	});
	assert.deepEqual(healthy, { args: [] });
});

test("muse native session store is stable per session and survives generation disposal", async (t) => {
	const { root } = await testRoot(t);
	const config = runtimeConfig(root);
	const first = await prepareMuseNativeSessionPaths({
		config,
		runtimeInstanceId: "muse-native",
		piboSessionId: "ps_stable_store",
		sessionGeneration: "generation-one",
	});
	const second = await prepareMuseNativeSessionPaths({
		config,
		runtimeInstanceId: "muse-native",
		piboSessionId: "ps_stable_store",
		sessionGeneration: "generation-two",
	});
	assert.equal(first.sessionRoot, second.sessionRoot);
	assert.notEqual(first.generationRoot, second.generationRoot);
	assert.equal(first.xdgData, second.xdgData);
	assert.ok(!first.xdgData.startsWith(`${first.generationRoot}/`));
	assert.ok(first.xdgData.startsWith(`${first.sessionRoot}/`));

	const marker = join(first.xdgData, "sessions", "native-session.json");
	await mkdir(join(first.xdgData, "sessions"), { recursive: true });
	await writeFile(marker, JSON.stringify({ nativeSessionId: "native-1" }));
	await disposeMuseNativeSessionPaths(first);
	assert.equal(await readFile(marker, "utf8"), JSON.stringify({ nativeSessionId: "native-1" }));
	await assert.rejects(readdir(first.generationRoot));

	const other = await prepareMuseNativeSessionPaths({
		config,
		runtimeInstanceId: "muse-native",
		piboSessionId: "ps_other_session",
		sessionGeneration: "generation-one",
	});
	assert.notEqual(other.xdgData, first.xdgData);
});
