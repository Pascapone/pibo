import assert from "node:assert/strict";
import test from "node:test";
import { buildObserveModuleTools } from "../dist/remote-agent/modules/observe.js";

function fixture(messages) {
	const cursors = new Map();
	const port = {
		getRoomSession: (room, session) => room === "room-a" && ["ps_a", "ps_b"].includes(session) ? { id: session, title: session } : undefined,
		listSessionMessages: () => messages,
		listSessionObservations: () => [],
		getObservationCursor: (session, scope) => cursors.get(`${session}:${scope}`),
		advanceObservationCursor(session, scope, sequence) {
			const key = `${session}:${scope}`;
			const next = Math.max(cursors.get(key) ?? 0, sequence);
			cursors.set(key, next);
			return next;
		},
	};
	const tool = buildObserveModuleTools(port).find(tool => tool.name === "remote_session_observe");
	assert.ok(tool);
	const context = { roomId: "room-a", tokenId: "token-a", label: "fixture", mode: "sandbox", cwd: "/unused", sandboxRoot: "/unused", toolCallId: "observe" };
	return { observe: (args, ctx = context) => tool.execute(args, ctx), context, cursors };
}
const message = (id, text) => ({ id, role: "assistant", text, createdAt: "2026-09-22T00:00:00.000Z" });

// Characterization, NOT a cursor-correctness claim. Preserve and expose F1
// during the mechanical shared-engine move rather than silently changing it.
test("remote positional cursors can repeat an old record and miss a late timestamp tie", async () => {
	const messages = [message("b", "existing B"), message("d", "existing D")];
	const { observe } = fixture(messages);
	const first = await observe({ sessionId: "ps_a", limit: 1 });
	assert.deepEqual(first.details.observations.map(row => row.text), ["existing D"]);
	assert.equal(first.details.autoCursorSequence, 2);
	messages.push(message("a", "late A"));
	const next = await observe({ sessionId: "ps_a", limit: 1 });
	assert.deepEqual(next.details.observations.map(row => row.text), ["existing D"]);
	assert.equal(next.details.autoCursorSequence, 3);
	assert.equal((await observe({ sessionId: "ps_a" })).details.observations.length, 0);
	const history = await observe({ sessionId: "ps_a", cursorMode: "history", order: "asc" });
	assert.deepEqual(history.details.observations.map(row => row.text), ["late A", "existing B", "existing D"]);
});

test("remote auto-cursors belong to session plus query, not an entitled token", async () => {
	const { observe, context } = fixture([message("a", "alpha"), message("b", "beta")]);
	assert.equal((await observe({ sessionId: "ps_a" })).details.observations.length, 2);
	const secondToken = { ...context, tokenId: "token-b" };
	assert.equal((await observe({ sessionId: "ps_a" }, secondToken)).details.observations.length, 0);
	assert.equal((await observe({ sessionId: "ps_b" }, secondToken)).details.observations.length, 2);
	assert.deepEqual((await observe({ sessionId: "ps_a", textContains: "beta" }, secondToken)).details.observations.map(row => row.text), ["beta"]);
	assert.equal((await observe({ sessionId: "ps_a", cursorMode: "history" }, secondToken)).details.observations.length, 2);
	await assert.rejects(observe({ sessionId: "ps_a" }, { ...context, roomId: "room-b" }), error => error.code === "session_forbidden");
});

test("remote output limit does not bound record normalization work", async () => {
	const read = new Set();
	const messages = Array.from({ length: 2048 }, (_, index) => ({
		id: `m${String(index).padStart(4, "0")}`,
		role: "assistant",
		createdAt: new Date(Date.UTC(2026, 8, 22) + index * 1000).toISOString(),
		get text() { read.add(index); return `row ${index}`; },
	}));
	const { observe } = fixture(messages);
	const result = await observe({ sessionId: "ps_a", cursorMode: "history", limit: 1 });
	assert.equal(result.details.observations.length, 1);
	assert.equal(result.details.truncated, true);
	assert.equal(read.size, messages.length, "bounded output is not bounded work; no scalability fix is claimed");
});
