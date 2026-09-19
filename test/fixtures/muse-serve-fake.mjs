#!/usr/bin/env node
// Minimal fake `muse serve` MSP host for Pibo muse-native adapter tests.
// Speaks just enough of the Muse Session Protocol for the real @muse-code/sdk
// client: initialize, session/start|resume|read|list|fork, turn/start,
// turn/interrupt|turn/cancel, approval/decide, model/list, session/setModel,
// session/setReasoningEffort and session/compact.
//
// Prompt scripting markers (matched against the submitted text):
//   [tool]       emit a toolCall item round-trip
//   [approval]   request approval mid-turn and wait for approval/decide
//   [fail]       end the turn with terminal "failed"
//   [slow]       delay completion so abort/steer tests can intervene
//   [hang]       never produce turn output (past any idle budget) for timeout tests
//   [viewdeath]  emit the opening frames live, then withhold the rest (view/page still serves them)
//   [drip]       emit steady items over ~200ms so activity-timeout tests can intervene
//   [context]    emit a session/contextUsage notification
//   [secretargs] include a secret-bearing key in the toolCall args
//   [nodesc]     omit description from the toolCall args
//   [reclaim]    reclaim the turn before launch (turn/unqueued, no terminal)
//   [patch]      repeat an identical patchSummary across tool item revisions
//   [reasoning]  emit a reasoning item with summary deltas
//   [bigargs]    send toolCall args larger than the adapter arg bound
//   [noname]     send a toolCall without a tool name
//
// Environment scripting:
//   MUSE_FAKE_HANG_METHODS    comma-separated MSP methods that never answer
//   MUSE_FAKE_VERSION_OUTPUT  verbatim --version output (default "muse 1.3.0")
//   MUSE_FAKE_DENY_CAPABILITIES comma-separated capability names withheld from grantedCapabilities
// A JSON array at <stateDir>/hang-methods.json hangs the same way and can be
// written or removed at any time, including mid-test for recovery assertions.
// A JSON object at <stateDir>/fail-turn-start.json rejects the next N
// turn/start intakes: { "times": N, "kind": "<msp kind>", "message": "<text>" }.
// "times" is decremented per rejection so tests can script fail-once recovery.
// A JSON object at <stateDir>/compact-noop.json answers session/compact with
// { "status": "noop", "reason": "<text>" } instead of "accepted".
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const args = process.argv.slice(2);
if (args[0] === "--version") {
	process.stdout.write(`${process.env.MUSE_FAKE_VERSION_OUTPUT ?? "muse 1.3.0"}\n`);
	process.exit(0);
}

const stateDir = process.env.MUSE_FAKE_STATE_DIR;
if (!stateDir) {
	process.stderr.write("MUSE_FAKE_STATE_DIR is required\n");
	process.exit(2);
}
mkdirSync(stateDir, { recursive: true });
try {
	writeFileSync(join(stateDir, `fake-host-${process.pid}.pid`), `${process.pid}\n`);
	writeFileSync(join(stateDir, `fake-host-${process.pid}.args.json`), `${JSON.stringify(args)}\n`);
} catch {}
const statePath = join(stateDir, "muse-fake-state.json");
const hangMethods = () => {
	const names = new Set((process.env.MUSE_FAKE_HANG_METHODS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
	try {
		const extra = JSON.parse(readFileSync(join(stateDir, "hang-methods.json"), "utf8"));
		if (Array.isArray(extra)) for (const entry of extra) if (typeof entry === "string" && entry.trim()) names.add(entry.trim());
	} catch {}
	return names;
};

const load = () => existsSync(statePath)
	? JSON.parse(readFileSync(statePath, "utf8"))
	: { nextSession: 1, clock: 1_800_000_000, sessions: {}, startRequests: [], decideRequests: [], interruptRequests: [], steerRequests: [], turnStartRequests: [] };
const consumeTurnStartFailure = () => {
	const path = join(stateDir, "fail-turn-start.json");
	let spec;
	try {
		spec = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
	const times = Number(spec?.times ?? 0);
	if (!Number.isFinite(times) || times <= 0) return undefined;
	try {
		writeFileSync(path, `${JSON.stringify({ ...spec, times: times - 1 })}\n`, { mode: 0o600 });
	} catch {}
	return spec;
};
const save = (state) => {
	const temporaryPath = `${statePath}.${process.pid}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, statePath);
};
const updateState = (operation) => {
	const state = load();
	const result = operation(state);
	save(state);
	return result;
};

const cursors = new Map();
const nextCursor = (sessionId) => {
	const next = (cursors.get(sessionId) ?? 1) + 1;
	cursors.set(sessionId, next);
	return String(next);
};
const range = () => ({ first: 1, last: 1, stream: "view" });
const now = () => new Date().toISOString();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const interruptedTurns = new Set();
const approvalWaiters = new Map();
// Durable-sourced view log: every notification frame in cursor order, including
// frames withheld from the live stream by [viewdeath]. Served by view/page.
const viewLog = new Map();
const silencedTurns = new Set();
const silencedItems = new Set();

function sessionObject(state, session) {
	return {
		sessionId: session.id,
		activeTurnId: session.activeTurnId ?? null,
		createdAt: session.createdAt,
		forkedFrom: session.forkedFrom ?? null,
		modelId: session.modelId,
		name: session.id,
		path: join(stateDir, `${session.id}.log`),
		providerId: session.providerId ?? null,
		status: session.activeTurnId ? "running" : "idle",
		turnCount: session.turns.length,
		updatedAt: session.updatedAt,
		workspaceRoot: session.workspaceRoot,
	};
}

function isSilenced(params) {
	// Turn id rides top-level on turn/* frames but inside item on item/* frames;
	// item/delta carries only the item id, tracked from its silenced start.
	if (params?.turnId && silencedTurns.has(params.turnId)) return true;
	const item = params?.item;
	if (item && typeof item === "object") {
		if (item.turnId && silencedTurns.has(item.turnId)) {
			if (typeof item.itemId === "string") silencedItems.add(item.itemId);
			return true;
		}
		if (typeof item.itemId === "string" && silencedItems.has(item.itemId)) return true;
	}
	return typeof params?.itemId === "string" && silencedItems.has(params.itemId);
}

function notify(method, params) {
	if (params?.sessionId) {
		const log = viewLog.get(params.sessionId) ?? [];
		log.push({ method, params });
		viewLog.set(params.sessionId, log);
	}
	// A [viewdeath] turn keeps recording (the durable log grows) but stops
	// pushing: the client must reconcile via session/read + view/page.
	if (isSilenced(params)) return;
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function respond(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, kind, message) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { kind } } })}\n`);
}

async function runTurn(sessionId, turnId, text) {
	const scripted = {
		tool: text.includes("[tool]"),
		approval: text.includes("[approval]"),
		fail: text.includes("[fail]"),
		slow: text.includes("[slow]"),
		hang: text.includes("[hang]"),
		viewDeath: text.includes("[viewdeath]"),
		drip: text.includes("[drip]"),
		context: text.includes("[context]"),
		secretArgs: text.includes("[secretargs]"),
		noDescription: text.includes("[nodesc]"),
		reclaim: text.includes("[reclaim]"),
		patch: text.includes("[patch]"),
		reasoning: text.includes("[reasoning]"),
		bigArgs: text.includes("[bigargs]"),
		noName: text.includes("[noname]"),
	};
	if (scripted.reclaim) {
		notify("turn/unqueued", { commandId: turnId, sessionId, sourceRange: range(), turnId, viewCursor: nextCursor(sessionId) });
		return;
	}
	notify("turn/started", { commandId: turnId, sessionId, sourceRange: range(), turnId, viewCursor: nextCursor(sessionId) });
	if (scripted.hang) await delay(60_000);
	else if (scripted.slow) await delay(300);
	else await delay(5);
	if (interruptedTurns.has(turnId)) return finishTurn(sessionId, turnId, "cancelled");

	const messageId = `item-${turnId}-msg`;
	const reply = `fake reply to: ${text.slice(0, 120)}`;
	notify("item/started", {
		item: { itemId: messageId, kind: "agentMessage", revision: 1, status: "inProgress", turnId, text: "" },
		sessionId,
		viewCursor: nextCursor(sessionId),
	});
	for (const chunk of [reply.slice(0, 12), reply.slice(12)]) {
		if (!chunk) continue;
		notify("item/delta", { delta: chunk, field: "text", itemId: messageId, sessionId, viewCursor: nextCursor(sessionId) });
		await delay(5);
	}
	if (interruptedTurns.has(turnId)) return finishTurn(sessionId, turnId, "cancelled");
	notify("item/completed", {
		item: { itemId: messageId, kind: "agentMessage", revision: 2, status: "completed", turnId, text: reply },
		sessionId,
		sourceRange: range(),
		viewCursor: nextCursor(sessionId),
	});
	if (scripted.viewDeath) {
		// Incident shape: the opening frames went out live, then the view died
		// mid-turn. Everything from here is recorded but withheld.
		silencedTurns.add(turnId);
	}

	if (scripted.reasoning) {
		const reasoningId = `item-${turnId}-reasoning`;
		notify("item/started", {
			item: { itemId: reasoningId, kind: "reasoning", revision: 1, status: "inProgress", turnId, summary: [""] },
			sessionId,
			viewCursor: nextCursor(sessionId),
		});
		await delay(5);
		notify("item/delta", { delta: "considering options", field: "summary.0", itemId: reasoningId, sessionId, viewCursor: nextCursor(sessionId) });
		await delay(5);
		if (interruptedTurns.has(turnId)) return finishTurn(sessionId, turnId, "cancelled");
		notify("item/completed", {
			item: { itemId: reasoningId, kind: "reasoning", revision: 2, status: "completed", turnId, summary: ["considering options"] },
			sessionId,
			sourceRange: range(),
			viewCursor: nextCursor(sessionId),
		});
	}
	if (scripted.tool) {
		const toolId = `item-${turnId}-tool`;
		const toolArgs = scripted.bigArgs
			? JSON.stringify({ command: "echo big", description: "big args call", blob: "x".repeat(20_000) })
			: scripted.secretArgs
				? JSON.stringify({ command: "echo fake-tool", description: "fake tool call", api_key: "secret-value-123" })
				: scripted.noDescription
					? JSON.stringify({ command: "echo fake-tool" })
					: JSON.stringify({ command: "echo fake-tool", description: "fake tool call" });
		const toolName = scripted.noName ? "" : "bash";
		const patchSummary = scripted.patch ? { filesChanged: 2, insertions: 10, deletions: 3 } : undefined;
		notify("item/started", {
			item: { itemId: toolId, kind: "toolCall", revision: 1, status: "inProgress", turnId, tool: toolName, args: toolArgs, taskId: `task-${turnId}`, ...(patchSummary ? { patchSummary } : {}) },
			sessionId,
			viewCursor: nextCursor(sessionId),
		});
		await delay(5);
		if (scripted.patch) {
			notify("item/updated", {
				item: { itemId: toolId, kind: "toolCall", revision: 2, status: "inProgress", turnId, tool: toolName, args: toolArgs, taskId: `task-${turnId}`, patchSummary },
				sessionId,
				sourceRange: range(),
				viewCursor: nextCursor(sessionId),
			});
			await delay(5);
		}
		if (scripted.approval) {
			const approvalId = `approval-${turnId}`;
			notify("approval/requested", {
				approvalId,
				availableChoices: [
					{ choiceId: "approve-once", decision: "approved", label: "Approve", scope: "once" },
					{ choiceId: "deny-once", decision: "denied", label: "Deny", scope: "once" },
				],
				currentRequirementId: { approvalId, sourceIndex: 0 },
				itemId: toolId,
				judgeEscalated: false,
				protectedWrite: false,
				rawArgs: toolArgs,
				sessionId,
				sourceRange: range(),
				subject: { kind: "tool", toolName: toolName || "bash" },
				taskId: `task-${turnId}`,
				toolCallId: toolId,
				toolName: "bash",
				turnId,
				viewCursor: nextCursor(sessionId),
			});
			await new Promise((resolve) => approvalWaiters.set(approvalId, resolve));
			approvalWaiters.delete(approvalId);
		}
		if (interruptedTurns.has(turnId)) return finishTurn(sessionId, turnId, "cancelled");
		notify("item/delta", { delta: "fake-tool\n", field: "output", itemId: toolId, sessionId, viewCursor: nextCursor(sessionId) });
		await delay(5);
		notify("item/completed", {
			item: { itemId: toolId, kind: "toolCall", revision: scripted.patch ? 3 : 2, status: "completed", turnId, tool: toolName, args: toolArgs, taskId: `task-${turnId}`, visibleOutput: "fake-tool\n", ...(patchSummary ? { patchSummary } : {}) },
			sessionId,
			sourceRange: range(),
			viewCursor: nextCursor(sessionId),
		});
	}
	if (scripted.drip) {
		for (let index = 0; index < 8; index += 1) {
			if (interruptedTurns.has(turnId)) return finishTurn(sessionId, turnId, "cancelled");
			const dripId = `item-${turnId}-drip-${index}`;
			notify("item/started", {
				item: { itemId: dripId, kind: "agentMessage", revision: 1, status: "inProgress", turnId, text: "" },
				sessionId,
				viewCursor: nextCursor(sessionId),
			});
			await delay(25);
			notify("item/completed", {
				item: { itemId: dripId, kind: "agentMessage", revision: 2, status: "completed", turnId, text: `drip ${index}` },
				sessionId,
				sourceRange: range(),
			});
		}
	}
	if (scripted.context) {
		notify("session/contextUsage", {
			pressure: "normal",
			sessionId,
			sourceRange: range(),
			usedTokens: 1200,
			viewCursor: nextCursor(sessionId),
			windowTokens: 100_000,
		});
	}
	if (scripted.viewDeath) {
		// Hold the silence across several client poll windows so tests observe
		// repeated backfill, then finish natively (silently).
		await delay(350);
	}
	if (scripted.fail) return finishTurn(sessionId, turnId, "failed");
	return finishTurn(sessionId, turnId, "completed");
}

function finishTurn(sessionId, turnId, terminal) {
	updateState((state) => {
		const session = state.sessions[sessionId];
		if (session) {
			session.activeTurnId = null;
			session.updatedAt = now();
			session.turns.push({ turnId, terminal });
		}
	});
	const params = {
		sessionId,
		sourceRange: range(),
		terminal,
		turnId,
		viewCursor: nextCursor(sessionId),
		usage: { cachedTokens: 0, inputTokens: 10, outputTokens: 5, reasoningTokens: 0 },
	};
	if (terminal === "failed") params.error = { kind: "scriptedFailure", message: "scripted fake failure", retryable: false };
	notify("turn/completed", params);
}

let grantedCapabilities = [];
const handlers = {
	initialize: (params) => {
		const denied = new Set((process.env.MUSE_FAKE_DENY_CAPABILITIES ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
		grantedCapabilities = [...(params?.capabilities?.requestedCapabilities ?? [])].filter((name) => !denied.has(name));
		return {
		experimentalApi: false,
		grantedCapabilities,
		museHome: stateDir,
		platformFamily: "unix",
		platformOs: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
		schema: { fingerprint: "fake-fingerprint", version: "1.3.0" },
		serverInfo: { name: "muse-fake", version: "1.3.0" },
		sessionDurability: "durable",
		userAgent: "muse-fake/1.3.0",
		};
	},
	"session/start": (params, id) => {
		if (params.config !== undefined && params.config !== null && !grantedCapabilities.includes("sessionMcp")) {
			respondError(id, "capabilityDenied", "Session MCP configuration requires the sessionMcp capability");
			return undefined;
		}
		return updateState((state) => {
		const id = `muse-fake-session-${state.nextSession++}`;
		const createdAt = now();
		state.sessions[id] = {
			id,
			workspaceRoot: params.workspaceRoot ?? process.cwd(),
			modelId: params.modelId ?? "fake-model-a",
			providerId: params.providerId ?? null,
			approvalMode: params.approvalMode ?? "onRequest",
			config: params.config ?? null,
			createdAt,
			updatedAt: createdAt,
			activeTurnId: null,
			forkedFrom: null,
			turns: [],
		};
		state.startRequests.push({
			sessionId: id,
			workspaceRoot: state.sessions[id].workspaceRoot,
			config: state.sessions[id].config ?? null,
			hostEnvScopedMcpKeys: Object.keys(process.env).filter((key) => key.startsWith("PIBO_RUNTIME_MCP_")).sort(),
			hostEnvPiboKeys: Object.keys(process.env).filter((key) => key.startsWith("PIBO_")).sort(),
		});
		cursors.set(id, 1);
		return { session: sessionObject(state, state.sessions[id]), viewCursor: "1" };
		});
	},
	"session/resume": (params, id) => {
		const state = load();
		const session = state.sessions[params.sessionId];
		if (!session) {
			respondError(id, "sessionNotFound", `session ${params.sessionId} not found`);
			return undefined;
		}
		(state.resumeRequests ??= []).push({ sessionId: params.sessionId, config: params.config ?? null });
		save(state);
		cursors.set(session.id, 1);
		return {
			history: { items: [], mode: "none", snapshot: {} },
			pendingRequests: [],
			session: sessionObject(state, session),
			viewCursor: "1",
		};
	},
	"session/read": (params, id) => {
		const state = load();
		const session = state.sessions[params.sessionId];
		if (!session) {
			respondError(id, "sessionNotFound", `session ${params.sessionId} not found`);
			return undefined;
		}
		return {
			history: { items: [], mode: "none", snapshot: {} },
			pendingRequests: [],
			session: sessionObject(state, session),
			viewCursor: "1",
		};
	},
	"view/page": (params, id) => {
		const state = load();
		if (!state.sessions[params.sessionId]) {
			respondError(id, "sessionNotFound", `session ${params.sessionId} not found`);
			return undefined;
		}
		const log = viewLog.get(params.sessionId) ?? [];
		const from = params.cursor === undefined ? 0 : Number(params.cursor);
		const start = Number.isFinite(from) ? from : 0;
		const limit = Math.min(Math.max(Number(params.limit) || 200, 1), 1000);
		const events = log
			.filter((entry) => Number(entry.params.viewCursor) > start)
			.slice(0, limit)
			.map((entry) => ({ method: entry.method, params: entry.params }));
		const last = events.at(-1);
		return { events, nextCursor: last ? last.params.viewCursor : null };
	},
	"session/list": (params, id) => {
		if (!grantedCapabilities.includes("sessionListStream")) {
			respondError(id, "capabilityDenied", "Session listing requires the sessionListStream capability");
			return undefined;
		}
		const state = load();
		return {
			nextCursor: null,
			sessions: Object.values(state.sessions).map((session) => sessionObject(state, session)),
		};
	},
	"session/fork": (params, id) => updateState((state) => {
		const source = state.sessions[params.sessionId];
		if (!source) {
			respondError(id, "sessionNotFound", `session ${params.sessionId} not found`);
			return undefined;
		}
		const lastTurnId = params.cutPoint?.lastTurnId;
		if (lastTurnId && !source.turns.some((turn) => turn.turnId === lastTurnId)) {
			respondError(id, "forkBoundaryInvalid", `turn ${lastTurnId} is not a fork boundary`);
			return undefined;
		}
		const createdAt = now();
		const forkId = `muse-fake-session-${state.nextSession++}`;
		state.sessions[forkId] = {
			...structuredClone(source),
			id: forkId,
			createdAt,
			updatedAt: createdAt,
			activeTurnId: null,
			forkedFrom: { commandId: params.commandId ?? "cmd-fork", sessionId: source.id },
		};
		cursors.set(forkId, 1);
		return {
			history: { items: [], mode: "none", snapshot: {} },
			pendingRequests: [],
			session: sessionObject(state, state.sessions[forkId]),
			viewCursor: "1",
		};
	}),
	"turn/start": (params, id) => {
		const injected = consumeTurnStartFailure();
		const turnId = params.commandId;
		updateState((state) => {
			state.turnStartRequests = Array.isArray(state.turnStartRequests) ? state.turnStartRequests : [];
			state.turnStartRequests.push({ sessionId: params.sessionId, rejected: Boolean(injected) });
			const session = state.sessions[params.sessionId];
			if (session && !injected) session.activeTurnId = turnId;
		});
		if (injected) {
			respondError(id, typeof injected.kind === "string" ? injected.kind : "commandRejected", typeof injected.message === "string" ? injected.message : "injected turn/start failure");
			return undefined;
		}
		const text = (params.input ?? []).map((part) => (part.text ?? "")).join("\n");
		const disposition = params.ifBusy === "steer" ? "steered" : "started";
		setImmediate(() => {
			runTurn(params.sessionId, turnId, text).catch((error) => process.stderr.write(`fake turn failed: ${error?.message}\n`));
		});
		return { commandId: turnId, disposition, startedNewTurn: disposition === "started", status: "accepted", turnId };
	},
	"turn/interrupt": (params) => {
		interruptedTurns.add(params.turnId ?? "");
		updateState((state) => state.interruptRequests.push({ sessionId: params.sessionId, turnId: params.turnId ?? null }));
		return { commandId: params.commandId, status: "accepted", turnId: params.turnId ?? "" };
	},
	"turn/steer": (params, id) => {
		const state = load();
		const session = state.sessions[params.sessionId];
		if (!session) {
			respondError(id, "sessionNotFound", `session ${params.sessionId} not found`);
			return undefined;
		}
		if (!params.expectedTurnId || session.activeTurnId !== params.expectedTurnId) {
			respondError(id, "commandRejected", `turn ${params.expectedTurnId ?? "(missing)"} is not the running turn`);
			return undefined;
		}
		const text = (params.input ?? []).map((part) => (part.text ?? "")).join("\n");
		updateState((state) => state.steerRequests.push({ sessionId: params.sessionId, turnId: params.expectedTurnId }));
		const steerId = `item-${params.expectedTurnId}-steer`;
		const reply = `steered: ${text.slice(0, 120)}`;
		notify("item/started", {
			item: { itemId: steerId, kind: "agentMessage", revision: 1, status: "inProgress", turnId: params.expectedTurnId, text: "" },
			sessionId: params.sessionId,
			viewCursor: nextCursor(params.sessionId),
		});
		notify("item/completed", {
			item: { itemId: steerId, kind: "agentMessage", revision: 2, status: "completed", turnId: params.expectedTurnId, text: reply },
			sessionId: params.sessionId,
			sourceRange: range(),
			viewCursor: nextCursor(params.sessionId),
		});
		return { commandId: params.commandId, status: "accepted", turnId: params.expectedTurnId };
	},
	"turn/cancel": (params) => {
		interruptedTurns.add(params.turnId ?? "");
		return { commandId: params.commandId, status: "accepted", turnId: params.turnId ?? "" };
	},
	"approval/decide": (params) => {
		updateState((state) => state.decideRequests.push({ approvalId: params.approvalId, choiceId: params.choiceId }));
		approvalWaiters.get(params.approvalId)?.();
		return { commandId: params.commandId, status: "accepted" };
	},
	"model/list": () => ({
		models: [
			{ contextLimit: 1_000_000, cost: null, description: "fake model a", displayLabel: "Fake A", isActive: true, isDefault: true, modelId: "fake-model-a", outputLimit: null, profileId: null, providerId: "fake", releaseDate: null },
			{ contextLimit: 500_000, cost: null, description: "fake model b", displayLabel: "Fake B", isActive: false, isDefault: false, modelId: "fake-model-b", outputLimit: null, profileId: null, providerId: "fake", releaseDate: null },
		],
		profileId: null,
		providerId: "fake",
		source: "fakeCatalog",
	}),
	"session/setModel": (params) => {
		updateState((state) => {
			const session = state.sessions[params.sessionId];
			if (session) {
				session.modelId = params.model?.modelId ?? session.modelId;
				session.updatedAt = now();
			}
		});
		return { commandId: params.commandId, status: "accepted" };
	},
	"session/setReasoningEffort": (params) => ({ commandId: params.commandId, status: "accepted" }),
	"session/compact": (params) => {
		try {
			const spec = JSON.parse(readFileSync(join(stateDir, "compact-noop.json"), "utf8"));
			if (spec && typeof spec.reason === "string" && spec.reason.trim()) {
				return { commandId: params.commandId, reason: spec.reason, status: "noop" };
			}
		} catch {}
		return { commandId: params.commandId, status: "accepted" };
	},
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
	if (!line.trim()) return;
	let frame;
	try {
		frame = JSON.parse(line);
	} catch {
		return;
	}
	if (frame.id === undefined) return;
	if (hangMethods().has(frame.method)) return;
	const handler = handlers[frame.method];
	if (!handler) {
		respondError(frame.id, "methodNotFound", `method ${frame.method} not found`);
		return;
	}
	try {
		const result = handler(frame.params ?? {}, frame.id);
		if (result !== undefined) respond(frame.id, result);
	} catch (error) {
		respondError(frame.id, "internal", error instanceof Error ? error.message : "fake host failed");
	}
});
rl.on("close", () => process.exit(0));
