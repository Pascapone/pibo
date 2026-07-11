import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
import { PiboRalphService } from "../dist/ralph/service.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { resolvePiboSessionInitialFastMode, resolvePiboSessionInitialThinkingLevel } from "../dist/core/session-router.js";
import { createPiboSession } from "../dist/sessions/store.js";

const execFileAsync = promisify(execFile);

test("Ralph store persists and clears runtime overrides", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "Keep checking the inbox.",
			maxIterations: 3,
			modelOverride: { provider: "openai", id: "gpt-5" },
			thinkingLevel: "max",
			fastMode: true,
		});

		const reloaded = store.getJob(job.id);
		assert.deepEqual(reloaded?.modelOverride, { provider: "openai", id: "gpt-5" });
		assert.equal(reloaded?.thinkingLevel, "max");
		assert.equal(reloaded?.fastMode, true);
		assert.equal(reloaded?.maxIterations, 3);

		const cleared = store.updateJob(job.id, {
			modelOverride: null,
			thinkingLevel: null,
			fastMode: null,
			maxIterations: null,
		});
		assert.equal(cleared?.modelOverride, undefined);
		assert.equal(cleared?.thinkingLevel, undefined);
		assert.equal(cleared?.fastMode, undefined);
		assert.equal(cleared?.maxIterations, undefined);
	} finally {
		store.close();
	}
});

test("Ralph CLI adds, edits, and clears runtime overrides", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-cli-overrides-"));
	const storePath = join(dir, "ralph.sqlite");
	try {
		const addResult = await execFileAsync("node", [
			"dist/bin/pibo.js", "ralph", "--store", storePath, "add",
			"--default-chat", "--prompt", "test", "--model", "openai/gpt-5", "--thinking", "max", "--fast", "--json",
		], { cwd: process.cwd() });
		const added = JSON.parse(addResult.stdout);
		assert.deepEqual(added.modelOverride, { provider: "openai", id: "gpt-5" });
		assert.equal(added.thinkingLevel, "max");
		assert.equal(added.fastMode, true);

		const editResult = await execFileAsync("node", [
			"dist/bin/pibo.js", "ralph", "--store", storePath, "edit", added.id,
			"--model", "anthropic/claude-sonnet", "--thinking", "low", "--no-fast", "--json",
		], { cwd: process.cwd() });
		const edited = JSON.parse(editResult.stdout);
		assert.deepEqual(edited.modelOverride, { provider: "anthropic", id: "claude-sonnet" });
		assert.equal(edited.thinkingLevel, "low");
		assert.equal(edited.fastMode, false);

		const clearResult = await execFileAsync("node", [
			"dist/bin/pibo.js", "ralph", "--store", storePath, "edit", added.id,
			"--clear-model", "--clear-thinking", "--clear-fast", "--json",
		], { cwd: process.cwd() });
		const cleared = JSON.parse(clearResult.stdout);
		assert.equal(cleared.modelOverride, undefined);
		assert.equal(cleared.thinkingLevel, undefined);
		assert.equal(cleared.fastMode, undefined);

		await assert.rejects(
			execFileAsync("node", ["dist/bin/pibo.js", "ralph", "--store", storePath, "add", "--default-chat", "--prompt", "test", "--model", "gpt-5", "--json"], { cwd: process.cwd() }),
			(error) => String(error.stderr ?? error.message).includes("--model must use provider/model syntax"),
		);
		await assert.rejects(
			execFileAsync("node", ["dist/bin/pibo.js", "ralph", "--store", storePath, "add", "--default-chat", "--prompt", "test", "--thinking", "turbo", "--json"], { cwd: process.cwd() }),
			(error) => String(error.stderr ?? error.message).includes("Invalid thinking level"),
		);

		const addHelp = await execFileAsync("node", ["dist/bin/pibo.js", "ralph", "add", "--help"], { cwd: process.cwd() });
		assert.match(addHelp.stdout, /--model <provider\/model>/);
		assert.match(addHelp.stdout, /--thinking <level>/);
		assert.match(addHelp.stdout, /--fast/);
		const editHelp = await execFileAsync("node", ["dist/bin/pibo.js", "ralph", "edit", "--help"], { cwd: process.cwd() });
		assert.match(editHelp.stdout, /--clear-model/);
		assert.match(editHelp.stdout, /--clear-thinking/);
		assert.match(editHelp.stdout, /--clear-fast/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Ralph service passes runtime overrides to created sessions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-overrides-"));
	const store = new PiboRalphStore({ path: ":memory:" });
	const listeners = new Set();
	const createdSessions = [];
	const context = {
		async emit(event) {
			if (event.type === "message") {
				queueMicrotask(() => {
					for (const listener of listeners) {
						listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "done" });
						listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id });
					}
				});
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		createSession(input) {
			createdSessions.push(input);
			return createPiboSession({ ...input, id: `ps_ralph_override_${createdSessions.length}` });
		},
		getSession() { return undefined; },
		findSessions() { return []; },
		getGatewayActions() { return []; },
		getWebApps() { return []; },
	};
	const service = new PiboRalphService({
		store,
		context,
		dataStorePath: join(dir, "pibo-data.sqlite"),
		dataPayloadRootDir: join(dir, "payloads"),
		runTimeoutMs: 5_000,
	});

	try {
		const job = store.createJob({
			target: { kind: "default-chat" }, profile: "codex",
			prompt: "Keep checking the inbox.",
			modelOverride: { provider: "openai", id: "gpt-5" },
			thinkingLevel: "high",
			fastMode: true,
		});

		const run = await service.startJob(job.id);
		assert.ok(run);
		await waitFor(() => store.getJob(job.id)?.state.lastStatus === "ok");

		assert.equal(createdSessions.length, 1);
		const input = createdSessions[0];
		assert.deepEqual(input.activeModel, { provider: "openai", id: "gpt-5" });
		assert.equal(input.metadata.initialThinkingLevel, "high");
		assert.equal(input.metadata.initialFastMode, true);
		assert.equal(resolvePiboSessionInitialThinkingLevel({ metadata: input.metadata }), "high");
		assert.equal(resolvePiboSessionInitialFastMode({ metadata: input.metadata }), true);
	} finally {
		service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
