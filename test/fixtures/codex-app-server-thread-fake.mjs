#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
if (args[0] === "--version") {
	process.stdout.write("codex-cli 0.147.0\n");
} else {
	const statePath = join(process.env.CODEX_HOME, "fake-thread-state.json");
	const loadedThreads = {};
	const load = () => existsSync(statePath)
		? JSON.parse(readFileSync(statePath, "utf8"))
		: { nextThread: 1, clock: 1_780_000_000, threads: {} };
	const save = (state) => writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
	const nextTimestamp = (state) => state.clock++;
	const clone = (value) => structuredClone(value);
	const makeThread = (state, id, cwd, overrides = {}) => {
		const createdAt = overrides.createdAt ?? nextTimestamp(state);
		return {
			id,
			preview: overrides.preview ?? "",
			modelProvider: overrides.modelProvider ?? "openai",
			createdAt,
			updatedAt: overrides.updatedAt ?? createdAt,
			recencyAt: overrides.updatedAt ?? createdAt,
			cwd,
			cliVersion: "0.147.0",
			source: overrides.source ?? "vscode",
			threadSource: null,
			status: { type: "idle" },
			ephemeral: false,
			turns: clone(overrides.turns ?? []),
			sessionId: overrides.sessionId ?? id,
			name: overrides.name ?? null,
			forkedFromId: overrides.forkedFromId ?? null,
			parentThreadId: null,
			path: Object.hasOwn(overrides, "path") ? overrides.path : `/private/fake-codex/${id}.jsonl`,
		};
	};
	const responseFor = (thread) => ({
		thread,
		model: "gpt-5.6-sol",
		modelProvider: thread.modelProvider,
		cwd: thread.cwd,
		reasoningEffort: "high",
		serviceTier: null,
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandbox: { type: "workspaceWrite" },
		instructionSources: [],
	});
	const missing = (id, threadId) => ({ id, error: { code: -32600, message: `no rollout found for thread id ${threadId}` } });
	const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
	const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

	lines.on("line", (line) => {
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			send({ id: message.id, result: {
				codexHome: process.env.CODEX_HOME,
				platformFamily: "unix",
				platformOs: "linux",
				userAgent: "fake-codex-app-server/0.147.0",
			} });
			return;
		}
		if (message.method === "initialized") return;

		const state = load();
		const params = message.params ?? {};
		if (message.method === "thread/start") {
			const threadId = `thread-${state.nextThread++}`;
			const thread = makeThread(state, threadId, params.cwd ?? process.cwd(), { path: null });
			loadedThreads[threadId] = thread;
			save(state);
			send({ id: message.id, result: responseFor(clone(thread)) });
			return;
		}
		if (message.method === "thread/resume") {
			const thread = loadedThreads[params.threadId] ?? state.threads[params.threadId];
			if (!thread) {
				send(missing(message.id, params.threadId));
				return;
			}
			if (params.cwd) thread.cwd = params.cwd;
			thread.updatedAt = nextTimestamp(state);
			thread.recencyAt = thread.updatedAt;
			loadedThreads[params.threadId] = thread;
			if (state.threads[params.threadId]) state.threads[params.threadId] = thread;
			save(state);
			send({ id: message.id, result: responseFor(clone(thread)) });
			return;
		}
		if (message.method === "thread/read") {
			const thread = loadedThreads[params.threadId] ?? state.threads[params.threadId];
			if (!thread) {
				send(missing(message.id, params.threadId));
				return;
			}
			const selected = clone(thread);
			if (!params.includeTurns) selected.turns = [];
			send({ id: message.id, result: { thread: selected } });
			return;
		}
		if (message.method === "thread/list") {
			let data = Object.values(state.threads).filter((thread) => {
				if (Array.isArray(params.sourceKinds) && params.sourceKinds.length > 0 && !params.sourceKinds.includes(thread.source)) {
					return false;
				}
				if (typeof params.cwd === "string") return thread.cwd === params.cwd;
				if (Array.isArray(params.cwd)) return params.cwd.includes(thread.cwd);
				return true;
			});
			data.sort((left, right) => (params.sortDirection === "asc" ? 1 : -1) * (left.updatedAt - right.updatedAt));
			const offset = typeof params.cursor === "string" && params.cursor.startsWith("offset:")
				? Number(params.cursor.slice("offset:".length))
				: 0;
			const limit = Number.isSafeInteger(params.limit) && params.limit > 0 ? params.limit : 50;
			const page = data.slice(offset, offset + limit).map((thread) => ({ ...clone(thread), turns: [] }));
			const nextOffset = offset + page.length;
			send({ id: message.id, result: {
				data: page,
				nextCursor: nextOffset < data.length ? `offset:${nextOffset}` : null,
				backwardsCursor: page.length > 0 ? `offset:${Math.max(0, offset - limit)}` : null,
			} });
			return;
		}
		if (message.method === "thread/fork") {
			const source = state.threads[params.threadId];
			if (!source) {
				send({ id: message.id, error: { code: -32600, message: `no rollout found for thread id ${params.threadId}` } });
				return;
			}
			let turns = clone(source.turns);
			if (params.lastTurnId) {
				const index = turns.findIndex((turn) => turn.id === params.lastTurnId);
				if (index < 0) {
					send({ id: message.id, error: { code: -32600, message: "last turn not found" } });
					return;
				}
				turns = turns.slice(0, index + 1);
			}
			const threadId = `thread-${state.nextThread++}`;
			const forked = makeThread(state, threadId, params.cwd ?? source.cwd, {
				preview: source.preview,
				name: source.name,
				turns,
				forkedFromId: source.id,
			});
			state.threads[threadId] = forked;
			loadedThreads[threadId] = forked;
			save(state);
			send({ id: message.id, result: responseFor(clone(forked)) });
			return;
		}
		if (message.method === "thread/delete" || message.method === "test/deleteThread") {
			delete loadedThreads[params.threadId];
			delete state.threads[params.threadId];
			save(state);
			send({ id: message.id, result: {} });
			return;
		}
		if (message.method === "test/seedThread") {
			const thread = makeThread(state, params.threadId, params.cwd ?? process.cwd(), {
				preview: params.preview,
				name: params.name,
				turns: params.turns,
				createdAt: params.createdAt,
				updatedAt: params.updatedAt,
			});
			state.threads[params.threadId] = thread;
			loadedThreads[params.threadId] = thread;
			save(state);
			send({ id: message.id, result: { thread: clone(thread) } });
			return;
		}
		if (message.method === "test/getState") {
			send({ id: message.id, result: clone(state) });
			return;
		}
		send({ id: message.id, result: {} });
	});
	lines.on("close", () => process.exit(0));
}
