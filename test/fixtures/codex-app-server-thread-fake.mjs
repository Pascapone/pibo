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
	const activeTurns = {};
	const pendingServerRequests = new Map();
	const serverResponseSummaries = [];
	let nextServerRequest = 1;
	const load = () => existsSync(statePath)
		? JSON.parse(readFileSync(statePath, "utf8"))
		: {
			nextThread: 1,
			nextTurn: 1,
			clock: 1_780_000_000,
			threads: {},
			threadSettings: {},
			threadTokenUsage: {},
			turnRequests: [],
		};
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
	const defaultThreadSettings = () => ({
		model: "gpt-5.6-sol",
		effort: "high",
		serviceTier: null,
		personality: null,
		summary: null,
	});
	const responseFor = (state, thread) => {
		const settings = state.threadSettings?.[thread.id] ?? defaultThreadSettings();
		return ({
		thread,
		model: settings.model,
		modelProvider: thread.modelProvider,
		cwd: thread.cwd,
		reasoningEffort: settings.effort,
		serviceTier: settings.serviceTier,
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandbox: { type: "workspaceWrite" },
		instructionSources: [],
	});
	};
	const models = [
		{
			id: "gpt-5.6-sol",
			model: "gpt-5.6-sol",
			displayName: "GPT-5.6 Sol",
			description: "Primary fixture model.",
			hidden: false,
			isDefault: true,
			supportedReasoningEfforts: [
				{ reasoningEffort: "low", description: "Low reasoning" },
				{ reasoningEffort: "medium", description: "Medium reasoning" },
				{ reasoningEffort: "high", description: "High reasoning" },
				{ reasoningEffort: "xhigh", description: "Extra-high reasoning" },
				{ reasoningEffort: "max", description: "Maximum reasoning" },
				{ reasoningEffort: "ultra", description: "Native-only ultra reasoning" },
			],
			defaultReasoningEffort: "high",
			serviceTiers: [{ id: "priority", name: "Priority", description: "Priority service" }],
			defaultServiceTier: null,
			inputModalities: ["text", "image"],
			supportsPersonality: true,
			modelSpecialty: null,
			upgrade: null,
		},
		{
			id: "gpt-5.2",
			model: "gpt-5.2",
			displayName: "GPT-5.2",
			description: "Fixture model without priority service.",
			hidden: false,
			isDefault: false,
			supportedReasoningEfforts: [
				{ reasoningEffort: "low", description: "Low reasoning" },
				{ reasoningEffort: "medium", description: "Medium reasoning" },
				{ reasoningEffort: "high", description: "High reasoning" },
				{ reasoningEffort: "xhigh", description: "Extra-high reasoning" },
			],
			defaultReasoningEffort: "medium",
			serviceTiers: [],
			defaultServiceTier: null,
			inputModalities: ["text"],
			supportsPersonality: false,
			modelSpecialty: null,
			upgrade: null,
		},
	];
	const missing = (id, threadId) => ({ id, error: { code: -32600, message: `no rollout found for thread id ${threadId}` } });
	const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
	const notify = (method, params) => send({ method, params });
	const inputText = (input) => Array.isArray(input)
		? input.filter((entry) => entry?.type === "text" && typeof entry.text === "string").map((entry) => entry.text).join("\n")
		: "";
	const turnSnapshot = (active, status = "inProgress", items = []) => ({
		id: active.turnId,
		status,
		items: clone(items),
		itemsView: items.length > 0 ? "summary" : "notLoaded",
		startedAt: active.startedAt,
		completedAt: status === "inProgress" ? null : active.completedAt ?? active.startedAt + 1,
		durationMs: status === "inProgress" ? null : 1_000,
		...(active.error ? { error: clone(active.error) } : {}),
	});
	const itemStarted = (active, item) => {
		active.items.push(clone(item));
		notify("item/started", {
			threadId: active.threadId,
			turnId: active.turnId,
			item: clone(item),
			startedAtMs: active.startedAt * 1_000 + active.eventSequence++,
		});
	};
	const itemCompleted = (active, item) => {
		const index = active.items.findIndex((entry) => entry.id === item.id);
		if (index >= 0) active.items[index] = clone(item);
		else active.items.push(clone(item));
		notify("item/completed", {
			threadId: active.threadId,
			turnId: active.turnId,
			item: clone(item),
			completedAtMs: active.startedAt * 1_000 + active.eventSequence++,
		});
	};
	const emitTurnStarted = (active) => {
		if (active.started) return;
		active.started = true;
		notify("thread/status/changed", { threadId: active.threadId, status: { type: "active", activeFlags: [] } });
		notify("turn/started", { threadId: active.threadId, turn: turnSnapshot(active) });
	};
	const emitUserItem = (active, text, suffix = "user") => {
		const item = {
			id: `${active.turnId}-${suffix}`,
			type: "userMessage",
			content: [{ type: "text", text }],
		};
		itemStarted(active, item);
		itemCompleted(active, item);
	};
	const emitReasoning = (active) => {
		const itemId = `${active.turnId}-reasoning`;
		itemStarted(active, { id: itemId, type: "reasoning", summary: [], content: [] });
		notify("item/reasoning/summaryPartAdded", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId,
			summaryIndex: 0,
		});
		notify("item/reasoning/summaryTextDelta", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId,
			summaryIndex: 0,
			delta: "Checking ",
		});
		notify("item/reasoning/summaryTextDelta", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId,
			summaryIndex: 0,
			delta: "the request.",
		});
		itemCompleted(active, { id: itemId, type: "reasoning", summary: ["Checking the request."], content: [] });
	};
	const emitTools = (active) => {
		const commandId = `${active.turnId}-command`;
		itemStarted(active, {
			id: commandId,
			type: "commandExecution",
			command: "printf ok",
			cwd: "/private/workspace",
			status: "inProgress",
			commandActions: [{ type: "read", path: "/private/workspace/input.txt" }],
			source: "agent",
		});
		notify("item/commandExecution/outputDelta", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId: commandId,
			delta: "o",
		});
		notify("item/commandExecution/outputDelta", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId: commandId,
			delta: "k",
		});
		itemCompleted(active, {
			id: commandId,
			type: "commandExecution",
			command: "printf ok",
			cwd: "/private/workspace",
			status: "completed",
			commandActions: [{ type: "read", path: "/private/workspace/input.txt" }],
			source: "agent",
			aggregatedOutput: "ok",
			exitCode: 0,
			durationMs: 5,
		});

		const fileId = `${active.turnId}-file`;
		itemStarted(active, {
			id: fileId,
			type: "fileChange",
			status: "inProgress",
			changes: [{ path: "src/example.ts", kind: "update" }],
		});
		notify("item/fileChange/patchUpdated", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId: fileId,
			changes: [{ path: "src/example.ts", kind: "update" }],
		});
		itemCompleted(active, {
			id: fileId,
			type: "fileChange",
			status: "completed",
			changes: [{ path: "src/example.ts", kind: "update" }],
		});

		const mcpId = `${active.turnId}-mcp`;
		itemStarted(active, {
			id: mcpId,
			type: "mcpToolCall",
			server: "native-server",
			tool: "lookup",
			status: "inProgress",
			arguments: { query: "pibo", apiKey: "sk-fixture-secret" },
		});
		notify("item/mcpToolCall/progress", {
			threadId: active.threadId,
			turnId: active.turnId,
			itemId: mcpId,
			message: "working",
		});
		itemCompleted(active, {
			id: mcpId,
			type: "mcpToolCall",
			server: "native-server",
			tool: "lookup",
			status: "completed",
			arguments: { query: "pibo", apiKey: "sk-fixture-secret" },
			result: { content: "found", accessToken: "fixture-token" },
		});
	};
	const emitAssistant = (active, text) => {
		const itemId = `${active.turnId}-assistant`;
		const midpoint = Math.max(1, Math.floor(text.length / 2));
		itemStarted(active, { id: itemId, type: "agentMessage", text: "" });
		for (const delta of [text.slice(0, midpoint), text.slice(midpoint)]) {
			if (!delta) continue;
			notify("item/agentMessage/delta", {
				threadId: active.threadId,
				turnId: active.turnId,
				itemId,
				delta,
			});
		}
		const item = { id: itemId, type: "agentMessage", text };
		itemCompleted(active, item);
		if (active.mode.includes("duplicate")) itemCompleted(active, item);
		return item;
	};
	const emitUsage = (active) => {
		const state = load();
		state.threadTokenUsage ??= {};
		const previous = state.threadTokenUsage[active.threadId]?.tokenUsage?.total?.totalTokens ?? 0;
		const totalTokens = previous + 20;
		const tokenUsage = {
			last: { cachedInputTokens: 3, inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 2, totalTokens: 20 },
			total: {
				cachedInputTokens: Math.round(totalTokens * 0.15),
				inputTokens: Math.round(totalTokens * 0.55),
				outputTokens: Math.round(totalTokens * 0.35),
				reasoningOutputTokens: Math.round(totalTokens * 0.1),
				totalTokens,
			},
			modelContextWindow: 200_000,
		};
		state.threadTokenUsage[active.threadId] = { turnId: active.turnId, tokenUsage };
		save(state);
		notify("thread/tokenUsage/updated", {
			threadId: active.threadId,
			turnId: active.turnId,
			tokenUsage,
		});
	};
	const requestClient = (active, method, params, onResponse) => {
		const id = `server-request-${nextServerRequest++}`;
		active.pendingServerRequestIds ??= [];
		active.pendingServerRequestIds.push(id);
		pendingServerRequests.set(id, { id, method, active, onResponse });
		send({ id, method, params });
	};
	const removeActiveServerRequest = (active, requestId) => {
		active.pendingServerRequestIds = (active.pendingServerRequestIds ?? []).filter((id) => id !== requestId);
	};
	const resolveServerRequest = (message) => {
		const pending = pendingServerRequests.get(message.id);
		if (!pending) {
			serverResponseSummaries.push({ requestId: String(message.id), unexpected: true });
			return;
		}
		pendingServerRequests.delete(message.id);
		removeActiveServerRequest(pending.active, message.id);
		notify("serverRequest/resolved", { threadId: pending.active.threadId, requestId: message.id });
		if (pending.method === "item/tool/requestUserInput") {
			const answers = message.result?.answers ?? {};
			serverResponseSummaries.push({
				requestId: String(message.id),
				method: pending.method,
				error: Boolean(message.error),
				answerIds: Object.keys(answers),
				answerCount: Object.values(answers).reduce((total, value) => total + (Array.isArray(value?.answers) ? value.answers.length : 0), 0),
			});
		} else {
			serverResponseSummaries.push({
				requestId: String(message.id),
				method: pending.method,
				error: Boolean(message.error),
				decision: message.result?.decision,
			});
		}
		pending.onResponse(message);
	};
	const clearServerRequests = (active) => {
		for (const requestId of [...(active.pendingServerRequestIds ?? [])]) {
			if (!pendingServerRequests.delete(requestId)) continue;
			notify("serverRequest/resolved", { threadId: active.threadId, requestId });
		}
		active.pendingServerRequestIds = [];
	};
	const persistTurn = (active, status) => {
		const state = load();
		const thread = loadedThreads[active.threadId] ?? state.threads[active.threadId];
		if (!thread) return;
		active.completedAt = nextTimestamp(state);
		const fullTurn = turnSnapshot(active, status, active.items);
		thread.turns = [...thread.turns.filter((turn) => turn.id !== active.turnId), fullTurn];
		thread.preview ||= active.userText.slice(0, 120);
		thread.updatedAt = active.completedAt;
		thread.recencyAt = active.completedAt;
		thread.status = { type: "idle" };
		thread.path ??= `/private/fake-codex/${thread.id}.jsonl`;
		loadedThreads[thread.id] = thread;
		state.threads[thread.id] = clone(thread);
		save(state);
	};
	const completeActive = (active, status, finalAssistant) => {
		if (!active || active.terminal) return;
		active.terminal = true;
		clearServerRequests(active);
		persistTurn(active, status);
		const summaryItems = finalAssistant ? [finalAssistant] : [];
		notify("turn/completed", {
			threadId: active.threadId,
			turn: turnSnapshot(active, status, summaryItems),
		});
		notify("thread/status/changed", { threadId: active.threadId, status: { type: "idle" } });
		delete activeTurns[active.threadId];
		if (active.mode.includes("duplicate")) {
			notify("turn/completed", {
				threadId: active.threadId,
				turn: turnSnapshot(active, status, summaryItems),
			});
		}
	};
	const runActive = (active) => {
		emitTurnStarted(active);
		notify("turn/started", { threadId: "foreign-thread", turn: turnSnapshot({ ...active, threadId: "foreign-thread", turnId: "foreign-turn" }) });
		emitUserItem(active, active.userText);
		if (active.mode.includes("crash") && !active.mode.includes("approval-crash")) {
			setImmediate(() => process.exit(17));
			return;
		}
		if (active.mode.includes("malformed")) {
			notify("item/agentMessage/delta", {
				threadId: active.threadId,
				turnId: active.turnId,
				itemId: `${active.turnId}-assistant`,
				delta: 42,
			});
			return;
		}
		if (active.mode.includes("approval-command")) {
			const itemId = `${active.turnId}-approval-command`;
			const command = "printf approved token=fixture-command-secret";
			itemStarted(active, {
				id: itemId,
				type: "commandExecution",
				command,
				cwd: "/private/approval-workspace",
				status: "inProgress",
				commandActions: [{ type: "read", path: "/private/approval-workspace/input.txt" }],
				source: "agent",
			});
			requestClient(active, "item/commandExecution/requestApproval", {
				threadId: active.mode.includes("approval-foreign") ? "foreign-thread" : active.threadId,
				turnId: active.turnId,
				itemId,
				startedAtMs: active.mode.includes("approval-invalid-timestamp") ? "invalid" : active.startedAt * 1_000 + active.eventSequence++,
				approvalId: null,
				environmentId: "private-environment-id",
				reason: "The command needs approval secret=fixture-approval-secret.",
				command,
				cwd: "/private/approval-workspace",
				commandActions: [{ type: "read", path: "/private/approval-workspace/input.txt" }],
				networkApprovalContext: { host: "example.test", apiKey: "fixture-network-secret" },
				proposedExecpolicyAmendment: ["prefix_rule", "token=fixture-policy-secret"],
				proposedNetworkPolicyAmendments: [{ host: "example.test", secret: "fixture-policy-network-secret" }],
			}, (response) => {
				if (response.error) {
					active.error = { type: "approval_error", message: "approval response failed" };
					completeActive(active, "failed");
					return;
				}
				const decision = response.result?.decision;
				const declined = decision === "decline" || decision === "cancel";
				itemCompleted(active, {
					id: itemId,
					type: "commandExecution",
					command,
					cwd: "/private/approval-workspace",
					status: declined ? "declined" : "completed",
					commandActions: [{ type: "read", path: "/private/approval-workspace/input.txt" }],
					source: "agent",
					aggregatedOutput: declined ? "" : "approved",
					exitCode: declined ? null : 0,
					durationMs: 4,
				});
				if (decision === "cancel") {
					completeActive(active, "interrupted");
					return;
				}
				const finalAssistant = emitAssistant(active, declined ? "Command declined." : "Command approved.");
				emitUsage(active);
				completeActive(active, "completed", finalAssistant);
			});
			if (active.mode.includes("approval-crash")) setTimeout(() => process.exit(18), 20);
			return;
		}
		if (active.mode.includes("approval-file")) {
			const itemId = `${active.turnId}-approval-file`;
			const changes = [{ path: "src/approved.ts", kind: "update" }];
			itemStarted(active, { id: itemId, type: "fileChange", status: "inProgress", changes });
			requestClient(active, "item/fileChange/requestApproval", {
				threadId: active.threadId,
				turnId: active.turnId,
				itemId,
				startedAtMs: active.startedAt * 1_000 + active.eventSequence++,
				reason: "Apply the proposed edit.",
				grantRoot: "/private/approval-workspace",
			}, (response) => {
				if (response.error) {
					active.error = { type: "approval_error", message: "file approval response failed" };
					completeActive(active, "failed");
					return;
				}
				const decision = response.result?.decision;
				const declined = decision === "decline" || decision === "cancel";
				itemCompleted(active, { id: itemId, type: "fileChange", status: declined ? "declined" : "completed", changes });
				if (decision === "cancel") {
					completeActive(active, "interrupted");
					return;
				}
				const finalAssistant = emitAssistant(active, declined ? "File change declined." : "File change approved.");
				emitUsage(active);
				completeActive(active, "completed", finalAssistant);
			});
			return;
		}
		if (active.mode.includes("user-input")) {
			const itemId = `${active.turnId}-user-input`;
			requestClient(active, "item/tool/requestUserInput", {
				threadId: active.threadId,
				turnId: active.turnId,
				itemId,
				isBlocking: true,
				autoResolutionMs: null,
				questions: [{
					id: "approach",
					header: "Approach",
					question: "Which implementation approach should Codex use?",
					isOther: !active.mode.includes("listed"),
					isSecret: active.mode.includes("secret"),
					options: [
						{ label: "Safe (Recommended)", description: "Use the conservative implementation." },
						{ label: "Fast", description: "Prefer the shortest implementation." },
					],
				}],
			}, (response) => {
				if (response.error) {
					active.error = { type: "user_input_error", message: "user input response failed" };
					completeActive(active, "failed");
					return;
				}
				const finalAssistant = emitAssistant(active, "User input accepted.");
				emitUsage(active);
				completeActive(active, "completed", finalAssistant);
			});
			return;
		}
		if (active.mode.includes("hold") || active.mode.includes("steer")) return;
		if (active.mode.includes("failure")) {
			notify("error", {
				threadId: active.threadId,
				turnId: active.turnId,
				error: { type: "transient", message: "temporary provider issue" },
				willRetry: true,
			});
			active.error = { type: "provider_error", message: "provider failed token=fixture-secret" };
			notify("error", {
				threadId: active.threadId,
				turnId: active.turnId,
				error: clone(active.error),
				willRetry: false,
			});
			completeActive(active, "failed");
			return;
		}
		emitReasoning(active);
		if (active.mode.includes("tools")) emitTools(active);
		const answer = active.mode.includes("redaction")
			? "Bearer sk-fixture-secret token=fixture-token"
			: "Codex answer.";
		const finalAssistant = emitAssistant(active, answer);
		emitUsage(active);
		completeActive(active, "completed", finalAssistant);
	};

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
		if (message.method === "model/list") {
			const offset = typeof message.params?.cursor === "string" && message.params.cursor.startsWith("model-offset:")
				? Number(message.params.cursor.slice("model-offset:".length))
				: 0;
			const pageSize = 1;
			const page = models.slice(offset, offset + pageSize);
			send({ id: message.id, result: {
				data: clone(page),
				nextCursor: offset + page.length < models.length ? `model-offset:${offset + page.length}` : null,
			} });
			return;
		}
		if (message.method === undefined && Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
			resolveServerRequest(message);
			return;
		}

		const state = load();
		state.nextTurn ??= 1;
		state.threadSettings ??= {};
		state.threadTokenUsage ??= {};
		state.turnRequests ??= [];
		const params = message.params ?? {};
		if (message.method === "thread/start") {
			const threadId = `thread-${state.nextThread++}`;
			const thread = makeThread(state, threadId, params.cwd ?? process.cwd(), { path: null });
			state.threadSettings[threadId] = {
				...defaultThreadSettings(),
				...(typeof params.model === "string" ? { model: params.model } : {}),
				...(Object.hasOwn(params, "serviceTier") ? { serviceTier: params.serviceTier } : {}),
				...(Object.hasOwn(params, "personality") ? { personality: params.personality } : {}),
			};
			loadedThreads[threadId] = thread;
			save(state);
			send({ id: message.id, result: responseFor(state, clone(thread)) });
			return;
		}
		if (message.method === "thread/resume") {
			const thread = loadedThreads[params.threadId] ?? state.threads[params.threadId];
			if (!thread) {
				send(missing(message.id, params.threadId));
				return;
			}
			if (params.cwd) thread.cwd = params.cwd;
			const settings = state.threadSettings[params.threadId] ?? defaultThreadSettings();
			if (typeof params.model === "string") settings.model = params.model;
			if (Object.hasOwn(params, "serviceTier")) settings.serviceTier = params.serviceTier;
			if (Object.hasOwn(params, "personality")) settings.personality = params.personality;
			state.threadSettings[params.threadId] = settings;
			thread.updatedAt = nextTimestamp(state);
			thread.recencyAt = thread.updatedAt;
			loadedThreads[params.threadId] = thread;
			if (state.threads[params.threadId]) state.threads[params.threadId] = thread;
			save(state);
			send({ id: message.id, result: responseFor(state, clone(thread)) });
			const restoredUsage = state.threadTokenUsage[params.threadId];
			if (restoredUsage) setImmediate(() => notify("thread/tokenUsage/updated", {
				threadId: params.threadId,
				turnId: restoredUsage.turnId,
				tokenUsage: clone(restoredUsage.tokenUsage),
			}));
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
				if (Array.isArray(params.sourceKinds) && params.sourceKinds.length > 0 && !params.sourceKinds.includes(thread.source)) return false;
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
			state.threadSettings[threadId] = clone(state.threadSettings[source.id] ?? defaultThreadSettings());
			if (state.threadTokenUsage[source.id]) state.threadTokenUsage[threadId] = clone(state.threadTokenUsage[source.id]);
			loadedThreads[threadId] = forked;
			save(state);
			send({ id: message.id, result: responseFor(state, clone(forked)) });
			return;
		}
		if (message.method === "turn/start") {
			const thread = loadedThreads[params.threadId] ?? state.threads[params.threadId];
			if (!thread) {
				send(missing(message.id, params.threadId));
				return;
			}
			if (activeTurns[params.threadId]) {
				send({ id: message.id, error: { code: -32600, message: "thread already has an active turn" } });
				return;
			}
			const settings = state.threadSettings[params.threadId] ?? defaultThreadSettings();
			if (typeof params.model === "string") settings.model = params.model;
			if (typeof params.effort === "string") settings.effort = params.effort;
			if (Object.hasOwn(params, "serviceTier")) settings.serviceTier = params.serviceTier;
			if (Object.hasOwn(params, "summary")) settings.summary = params.summary;
			if (Object.hasOwn(params, "personality")) settings.personality = params.personality;
			state.threadSettings[params.threadId] = settings;
			state.turnRequests.push({
				threadId: params.threadId,
				model: params.model ?? null,
				effort: params.effort ?? null,
				serviceTier: params.serviceTier ?? null,
				summary: params.summary ?? null,
				personality: params.personality ?? null,
			});
			const turnId = `turn-${state.nextTurn++}`;
			const active = {
				threadId: params.threadId,
				turnId,
				startedAt: nextTimestamp(state),
				started: false,
				terminal: false,
				items: [],
				eventSequence: 1,
				userText: inputText(params.input),
				clientUserMessageId: params.clientUserMessageId,
				mode: inputText(params.input).toLowerCase(),
			};
			activeTurns[params.threadId] = active;
			save(state);
			if (active.mode.includes("early")) emitTurnStarted(active);
			send({ id: message.id, result: { turn: turnSnapshot(active) } });
			setImmediate(() => {
				notify("thread/settings/updated", {
					threadId: params.threadId,
					threadSettings: {
						model: settings.model,
						modelProvider: thread.modelProvider,
						serviceTier: settings.serviceTier,
						effort: settings.effort,
						summary: settings.summary,
						personality: settings.personality,
					},
				});
				runActive(active);
			});
			return;
		}
		if (message.method === "turn/steer") {
			const active = activeTurns[params.threadId];
			if (!active || active.turnId !== params.expectedTurnId) {
				send({ id: message.id, error: { code: -32600, message: "expected turn is not active" } });
				return;
			}
			send({ id: message.id, result: { turnId: active.turnId } });
			const text = inputText(params.input);
			emitUserItem(active, text, `steer-${active.eventSequence}`);
			if (active.mode.includes("steer")) {
				const finalAssistant = emitAssistant(active, "Steered answer.");
				emitUsage(active);
				completeActive(active, "completed", finalAssistant);
			}
			return;
		}
		if (message.method === "turn/interrupt") {
			const active = activeTurns[params.threadId];
			if (!active || active.turnId !== params.turnId) {
				send({ id: message.id, error: { code: -32600, message: "turn is not active" } });
				return;
			}
			send({ id: message.id, result: {} });
			setImmediate(() => completeActive(active, "interrupted"));
			return;
		}
		if (message.method === "thread/delete" || message.method === "test/deleteThread") {
			if (activeTurns[params.threadId]) clearServerRequests(activeTurns[params.threadId]);
			delete loadedThreads[params.threadId];
			delete activeTurns[params.threadId];
			delete state.threads[params.threadId];
			delete state.threadSettings[params.threadId];
			delete state.threadTokenUsage[params.threadId];
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
			state.threadSettings[params.threadId] = defaultThreadSettings();
			loadedThreads[params.threadId] = thread;
			save(state);
			send({ id: message.id, result: { thread: clone(thread) } });
			return;
		}
		if (message.method === "test/getState") {
			send({ id: message.id, result: {
				...clone(state),
				activeTurns: clone(activeTurns),
				pendingServerRequestCount: pendingServerRequests.size,
				serverResponseSummaries: clone(serverResponseSummaries),
			} });
			return;
		}
		send({ id: message.id, result: {} });
	});
	lines.on("close", () => process.exit(0));
}
