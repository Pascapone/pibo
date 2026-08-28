import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PI_AGENT_RUNTIME_DRIVER } from "../../dist/agent-runtimes/pi/adapter.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../../dist/agent-runtimes/codex-native/config.js";
import { startCodexNativeAppServer } from "../../dist/agent-runtimes/codex-native/process.js";

const codexFixturePath = fileURLToPath(new URL("./codex-app-server-thread-fake.mjs", import.meta.url));

export function piTranscriptMessage(id, role, content, timestamp, extra = {}) {
	return {
		type: "message",
		id,
		timestamp,
		message: { role, content, ...extra },
	};
}

export function createBuiltInPiHistory(t, input) {
	const root = mkdtempSync(join(tmpdir(), "pibo-built-in-pi-history-"));
	const workspace = join(root, "workspace");
	const nativeSessionId = input.nativeSessionId;
	const path = join(root, `${nativeSessionId}.jsonl`);
	const timestamp = input.timestamp ?? "2026-01-01T00:00:00.000Z";
	mkdirSync(workspace, { recursive: true });
	writeFileSync(path, [
		JSON.stringify({ type: "session", id: nativeSessionId, timestamp, cwd: workspace }),
		...input.entries.map((entry) => JSON.stringify(entry)),
	].join("\n") + "\n", "utf8");
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const binding = {
		piboSessionId: input.piboSessionId ?? "ps_history",
		runtimeInstanceId: input.runtimeInstanceId ?? "pi",
		adapterId: "pi",
		nativeSessionId,
		state: "bound",
		protocol: "pi-sdk",
		locator: { kind: "local-file", value: path },
		revision: 1,
	};
	const adapter = PI_AGENT_RUNTIME_DRIVER.create({
		instanceId: binding.runtimeInstanceId,
		enabled: true,
		config: {},
	});
	return {
		adapter,
		binding,
		workspace,
		read: (pageInput = {}) => adapter.readHistory({ binding, workspace, ...pageInput }),
	};
}

function codexRuntimeConfig(root) {
	return parseCodexNativeRuntimeConfig({
		executable: codexFixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

export async function createBuiltInCodexHistory(t, input) {
	const root = mkdtempSync(join(tmpdir(), "pibo-built-in-codex-history-"));
	chmodSync(codexFixturePath, 0o755);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const runtimeInstanceId = input.runtimeInstanceId ?? "codex-native-history-test";
	const config = codexRuntimeConfig(root);
	const processHandle = await startCodexNativeAppServer({
		config,
		runtimeInstanceId,
		piboSessionId: `seed-${input.thread.id}`,
		sessionGeneration: `seed-${input.thread.id}`,
		workspace: root,
		clientVersion: "built-in-history-test",
	});
	try {
		await processHandle.client.request("test/seedThread", {
			runtimeInstanceId,
			threadId: input.thread.id,
			workspace: root,
			cwd: root,
			...input.thread,
		});
	} finally {
		await processHandle.close();
	}
	const adapter = CODEX_NATIVE_AGENT_RUNTIME_DRIVER.create({
		instanceId: runtimeInstanceId,
		displayName: "Codex Native History Test",
		enabled: true,
		config,
	});
	const binding = {
		piboSessionId: input.piboSessionId ?? "ps_history",
		runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId: input.thread.id,
		state: "bound",
		protocol: "codex-app-server-v2",
		protocolVersion: "0.147.0",
		revision: 1,
	};
	return {
		adapter,
		binding,
		workspace: root,
		read: (pageInput = {}) => adapter.readHistory({ binding, workspace: root, ...pageInput }),
	};
}
