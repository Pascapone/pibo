import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA,
	defaultCodexNativeRuntimeConfig,
	parseCodexNativeRuntimeConfig,
} from "../dist/agent-runtimes/codex-native/config.js";
import {
	buildCodexNativeProcessEnvironment,
	CodexNativeProcessError,
	diagnoseCodexNativeRuntime,
	disposeCodexNativeSessionPaths,
	prepareCodexNativeInstancePaths,
	prepareCodexNativeSessionPaths,
	removeCodexNativeInstanceState,
	startCodexNativeAppServer,
} from "../dist/agent-runtimes/codex-native/process.js";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-runtime-process-fake.mjs", import.meta.url));

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-process-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await chmod(fixturePath, 0o755);
	return root;
}

function config(root, overrides = {}) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: [
			"PATH",
			"PIBO_ALLOWED_VALUE",
			"PIBO_CODEX_RUNTIME_FAKE_SCENARIO",
			"PIBO_CODEX_RUNTIME_FAKE_SENTINEL",
			"PIBO_CODEX_RUNTIME_FAKE_VERSION",
		],
		diagnosticTimeoutMs: 250,
		startupTimeoutMs: 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
		...overrides,
	});
}

function fakeEnvironment(overrides = {}) {
	return {
		PATH: process.env.PATH,
		PIBO_ALLOWED_VALUE: "allowed-value",
		PIBO_UNRELATED_SECRET: "must-not-be-inherited",
		PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "happy",
		...overrides,
	};
}

async function assertPrivatePath(path, kind) {
	if (process.platform === "win32") assertPrivateWindowsAcl(path, kind);
	else assert.equal((await stat(path)).mode & 0o777, kind === "directory" ? 0o700 : 0o600);
}

test("Codex native config has safe defaults and rejects unknown, relative, or protected values", async (t) => {
	const root = await testRoot(t);
	const defaults = defaultCodexNativeRuntimeConfig();
	assert.equal(defaults.executable, "codex");
	assert.equal(defaults.homeRoot.endsWith(join("agent-runtimes", "codex-native")), true);
	assert.ok(defaults.environmentAllowlist.includes("PATH"));
	assert.equal(defaults.experimentalUserInput, false);
	assert.equal(CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA.additionalProperties, false);
	assert.equal(CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA.properties.experimentalUserInput.default, false);

	const parsed = parseCodexNativeRuntimeConfig({ homeRoot: join(root, "state") });
	assert.equal(parsed.executable, "codex");
	assert.equal(parsed.homeRoot, join(root, "state"));
	assert.equal(parsed.experimentalUserInput, false);
	assert.notEqual(parsed.environmentAllowlist, defaults.environmentAllowlist);
	assert.equal(parseCodexNativeRuntimeConfig({ homeRoot: join(root, "experimental"), experimentalUserInput: true }).experimentalUserInput, true);

	assert.throws(() => parseCodexNativeRuntimeConfig({ homeRoot: "relative" }), /absolute path/);
	assert.throws(() => parseCodexNativeRuntimeConfig({ homeRoot: root, unknown: true }), /unsupported config field/);
	assert.throws(
		() => parseCodexNativeRuntimeConfig({ homeRoot: root, environmentAllowlist: ["PATH", "path"] }),
		/duplicate key/,
	);
	assert.throws(
		() => parseCodexNativeRuntimeConfig({ homeRoot: root, environmentAllowlist: ["CODEX_HOME"] }),
		/reserved key/,
	);
	assert.throws(() => parseCodexNativeRuntimeConfig({ homeRoot: root, startupTimeoutMs: 0 }), /positive integer/);
	assert.throws(() => parseCodexNativeRuntimeConfig({ homeRoot: root, experimentalUserInput: "yes" }), /must be boolean/);
});

test("Codex native diagnostics report exact, compatible, unsupported, missing, failed, and bounded version probes", async (t) => {
	const root = await testRoot(t);
	const exactConfig = config(root);
	const exact = await diagnoseCodexNativeRuntime(exactConfig, "codex-native", {
		baseEnvironment: fakeEnvironment(),
	});
	assert.ok(exact.some((diagnostic) => diagnostic.code === "codex_native_home_ready"));
	const available = exact.find((diagnostic) => diagnostic.code === "codex_native_available");
	assert.equal(available.severity, "info");
	assert.deepEqual(available.details, {
		version: "0.147.0",
		validatedVersion: "0.147.0",
		supportedRange: ">=0.147.0 <0.148.0",
		protocol: "codex-app-server-v2",
	});

	const isolationSentinel = join(root, "escaped-version-probe");
	const isolated = await diagnoseCodexNativeRuntime(exactConfig, "codex-isolated-probe", {
		baseEnvironment: fakeEnvironment({
			PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "version-require-isolation",
			PIBO_CODEX_RUNTIME_FAKE_SENTINEL: isolationSentinel,
		}),
	});
	assert.ok(isolated.some((diagnostic) => diagnostic.code === "codex_native_available"));
	assert.equal(existsSync(isolationSentinel), false);
	const isolatedPaths = await prepareCodexNativeInstancePaths(exactConfig, "codex-isolated-probe");
	assert.deepEqual(await readdir(isolatedPaths.sessions), []);

	const compatible = await diagnoseCodexNativeRuntime(exactConfig, "codex-compatible", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_VERSION: "0.147.9" }),
	});
	assert.equal(compatible.find((diagnostic) => diagnostic.code === "codex_native_compatible_version")?.severity, "warning");

	const unsupported = await diagnoseCodexNativeRuntime(exactConfig, "codex-unsupported", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_VERSION: "0.148.0" }),
	});
	assert.equal(unsupported.find((diagnostic) => diagnostic.code === "codex_native_version_unsupported")?.severity, "error");

	const unreadable = await diagnoseCodexNativeRuntime(exactConfig, "codex-unreadable", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "version-unreadable" }),
	});
	assert.ok(unreadable.some((diagnostic) => diagnostic.code === "codex_native_version_unreadable"));

	const failed = await diagnoseCodexNativeRuntime(exactConfig, "codex-failed", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "version-failed" }),
	});
	const failureText = JSON.stringify(failed);
	assert.ok(failed.some((diagnostic) => diagnostic.code === "codex_native_version_probe_failed"));
	assert.doesNotMatch(failureText, /fixture-secret-token|fixture-access-value/);

	const timeoutConfig = config(root, { diagnosticTimeoutMs: 30 });
	const timeoutStarted = performance.now();
	const timedOut = await diagnoseCodexNativeRuntime(timeoutConfig, "codex-timeout", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "version-timeout" }),
	});
	assert.ok(timedOut.some((diagnostic) => diagnostic.code === "codex_native_version_probe_timeout"));
	assert.ok(performance.now() - timeoutStarted < 1_000);

	const tooLarge = await diagnoseCodexNativeRuntime(exactConfig, "codex-too-large", {
		baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "version-too-large" }),
	});
	assert.ok(tooLarge.some((diagnostic) => diagnostic.code === "codex_native_version_probe_too_large"));

	const missing = await diagnoseCodexNativeRuntime(
		config(root, { executable: join(root, "missing-codex") }),
		"codex-missing",
		{ baseEnvironment: fakeEnvironment() },
	);
	assert.ok(missing.some((diagnostic) => diagnostic.code === "codex_native_executable_not_found"));
	assert.doesNotMatch(JSON.stringify(missing), /missing-codex/);
});

test("Codex native homes are private, configured-instance scoped, and generation isolated", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = config(root);
	const firstInstance = await prepareCodexNativeInstancePaths(runtimeConfig, "codex-work");
	const secondInstance = await prepareCodexNativeInstancePaths(runtimeConfig, "codex-personal");
	assert.notEqual(firstInstance.root, secondInstance.root);
	assert.notEqual(firstInstance.codexHome, secondInstance.codexHome);
	await assertPrivatePath(firstInstance.root, "directory");
	await assertPrivatePath(firstInstance.codexHome, "directory");
	await assertPrivatePath(firstInstance.configFile, "file");
	assert.equal(await readFile(firstInstance.configFile, "utf8"), "# Managed by Pibo for this configured Codex runtime instance.\n# Session-specific settings are supplied through process-scoped official overrides.\n[analytics]\nenabled = false\n");

	const first = await prepareCodexNativeSessionPaths({
		config: runtimeConfig,
		runtimeInstanceId: "codex-work",
		piboSessionId: "ps_same",
		sessionGeneration: "generation-a",
	});
	const second = await prepareCodexNativeSessionPaths({
		config: runtimeConfig,
		runtimeInstanceId: "codex-work",
		piboSessionId: "ps_other",
		sessionGeneration: "generation-b",
	});
	assert.equal(first.codexHome, second.codexHome);
	assert.notEqual(first.processHome, second.processHome);
	assert.notEqual(first.temp, second.temp);
	for (const path of [first.sessionRoot, first.generationRoot, first.processHome, first.temp, first.xdgConfig]) {
		await assertPrivatePath(path, "directory");
	}

	await disposeCodexNativeSessionPaths(first);
	assert.equal(existsSync(first.generationRoot), false);
	assert.equal(existsSync(first.codexHome), true);
	assert.equal(existsSync(second.generationRoot), true);
	await disposeCodexNativeSessionPaths(second);
	await removeCodexNativeInstanceState(firstInstance);
	assert.equal(existsSync(firstInstance.root), false);
	assert.equal(existsSync(secondInstance.root), true);
});

test("Codex native process environment is allowlisted, resource scoped, and cannot override isolation", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = config(root);
	const paths = await prepareCodexNativeSessionPaths({
		config: runtimeConfig,
		runtimeInstanceId: "codex-native",
		piboSessionId: "ps_environment",
		sessionGeneration: "generation-environment",
	});
	t.after(() => disposeCodexNativeSessionPaths(paths));
	const environment = buildCodexNativeProcessEnvironment({
		config: runtimeConfig,
		paths,
		baseEnvironment: fakeEnvironment(),
		resourceEnvironment: { PIBO_RESOURCE_SECRET: "resource-secret" },
	});
	assert.equal(environment.PIBO_ALLOWED_VALUE, "allowed-value");
	assert.equal(environment.PIBO_UNRELATED_SECRET, undefined);
	assert.equal(environment.PIBO_RESOURCE_SECRET, "resource-secret");
	assert.equal(environment.CODEX_HOME, paths.codexHome);
	assert.equal(environment.HOME, paths.processHome);
	assert.equal(environment.TMPDIR, paths.temp);
	assert.equal(environment.XDG_CONFIG_HOME, paths.xdgConfig);
	assert.throws(
		() => buildCodexNativeProcessEnvironment({
			config: runtimeConfig,
			paths,
			resourceEnvironment: { CODEX_HOME: "/tmp/escape" },
		}),
		(error) => error instanceof CodexNativeProcessError && error.code === "environment_invalid",
	);
	assert.throws(
		() => buildCodexNativeProcessEnvironment({
			config: runtimeConfig,
			paths,
			resourceEnvironment: { NODE_OPTIONS: "--require=/tmp/inject.js" },
		}),
		(error) => error instanceof CodexNativeProcessError && error.code === "environment_invalid",
	);
});

test("Codex native process starts the stable stdio server in isolated state and cleans only its generation", async (t) => {
	const root = await testRoot(t);
	const globalHome = join(root, "global-home");
	await writeFile(join(root, "global-marker"), "untouched", "utf8");
	const runtimeConfig = config(root);
	const runtime = await startCodexNativeAppServer({
		config: runtimeConfig,
		runtimeInstanceId: "codex-native",
		piboSessionId: "ps_process",
		sessionGeneration: "generation-process",
		workspace: root,
		clientVersion: "1.7.2-test",
		baseEnvironment: fakeEnvironment({ HOME: globalHome }),
		resourceEnvironment: { PIBO_RESOURCE_SECRET: "resource-secret" },
	});
	t.after(() => runtime.close());
	const response = await runtime.client.request("test/process", {});
	assert.equal(response.initialized, true);
	assert.deepEqual(response.args, [
		"app-server",
		"--stdio",
		"--strict-config",
		"-c",
		"tools.experimental_request_user_input.enabled=false",
		"-c",
		"features.default_mode_request_user_input=false",
	]);
	assert.equal(response.codexHome, runtime.paths.codexHome);
	assert.equal(response.home, runtime.paths.processHome);
	assert.equal(response.tmp, runtime.paths.temp);
	assert.equal(response.xdgConfig, runtime.paths.xdgConfig);
	assert.equal(response.allowedValue, "allowed-value");
	assert.equal(response.resourceValue, "resource-secret");
	assert.equal(response.unrelatedValue, null);
	assert.equal(existsSync(runtime.paths.generationRoot), true);
	assert.doesNotMatch(await readFile(runtime.paths.configFile, "utf8"), /resource-secret|allowed-value/);

	await runtime.close();
	await runtime.close();
	assert.equal(existsSync(runtime.paths.generationRoot), false);
	assert.equal(existsSync(runtime.paths.codexHome), true);
	assert.equal(await readFile(join(root, "global-marker"), "utf8"), "untouched");
});

test("Codex native process opts into structured user input only through explicit private config overrides", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = { ...config(root), experimentalUserInput: true };
	const runtime = await startCodexNativeAppServer({
		config: runtimeConfig,
		runtimeInstanceId: "codex-native-user-input",
		piboSessionId: "ps_process_user_input",
		sessionGeneration: "generation-user-input",
		workspace: root,
		clientVersion: "1.7.2-test",
		baseEnvironment: fakeEnvironment(),
	});
	t.after(() => runtime.close());
	const response = await runtime.client.request("test/process", {});
	assert.deepEqual(response.args, [
		"app-server",
		"--stdio",
		"--strict-config",
		"-c",
		"tools.experimental_request_user_input.enabled=true",
		"-c",
		"features.default_mode_request_user_input=true",
	]);
	assert.doesNotMatch(await readFile(runtime.paths.configFile, "utf8"), /request_user_input|default_mode_request_user_input/);
});

test("Codex native processes isolate configured instances, session environments, and cleanup", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = config(root);
	const first = await startCodexNativeAppServer({
		config: runtimeConfig,
		runtimeInstanceId: "codex-work",
		piboSessionId: "ps_work",
		sessionGeneration: "generation-work",
		workspace: root,
		clientVersion: "test",
		baseEnvironment: fakeEnvironment(),
		resourceEnvironment: { PIBO_RESOURCE_SECRET: "work-secret" },
	});
	const second = await startCodexNativeAppServer({
		config: runtimeConfig,
		runtimeInstanceId: "codex-personal",
		piboSessionId: "ps_personal",
		sessionGeneration: "generation-personal",
		workspace: root,
		clientVersion: "test",
		baseEnvironment: fakeEnvironment(),
		resourceEnvironment: { PIBO_RESOURCE_SECRET: "personal-secret" },
	});
	t.after(() => Promise.allSettled([first.close(), second.close()]));
	const [firstState, secondState] = await Promise.all([
		first.client.request("test/process", {}),
		second.client.request("test/process", {}),
	]);
	assert.notEqual(firstState.codexHome, secondState.codexHome);
	assert.notEqual(firstState.home, secondState.home);
	assert.equal(firstState.resourceValue, "work-secret");
	assert.equal(secondState.resourceValue, "personal-secret");

	await first.close();
	assert.equal(existsSync(first.paths.generationRoot), false);
	assert.equal(existsSync(second.paths.generationRoot), true);
	assert.equal((await second.client.request("test/process", {})).resourceValue, "personal-secret");
	await second.close();
});

test("Codex native process rejects a reported home mismatch and removes failed generation state", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = config(root);
	await assert.rejects(
		startCodexNativeAppServer({
			config: runtimeConfig,
			runtimeInstanceId: "codex-native",
			piboSessionId: "ps_mismatch",
			sessionGeneration: "generation-mismatch",
			workspace: root,
			clientVersion: "test",
			baseEnvironment: fakeEnvironment({ PIBO_CODEX_RUNTIME_FAKE_SCENARIO: "home-mismatch" }),
		}),
		(error) => error instanceof CodexNativeProcessError && error.code === "isolation_failed",
	);
	const instance = await prepareCodexNativeInstancePaths(runtimeConfig, "codex-native");
	assert.deepEqual(await readdir(instance.sessions), []);
});

test("Codex native process start failure is bounded and leaves no session generation", async (t) => {
	const root = await testRoot(t);
	const runtimeConfig = config(root, { executable: join(root, "missing-codex") });
	await assert.rejects(
		startCodexNativeAppServer({
			config: runtimeConfig,
			runtimeInstanceId: "codex-native",
			piboSessionId: "ps_start_failure",
			sessionGeneration: "generation-start-failure",
			workspace: root,
			clientVersion: "test",
			baseEnvironment: fakeEnvironment(),
		}),
		(error) => error instanceof CodexNativeProcessError && error.code === "start_failed",
	);
	const instance = await prepareCodexNativeInstancePaths(runtimeConfig, "codex-native");
	assert.deepEqual(await readdir(instance.sessions), []);
});
