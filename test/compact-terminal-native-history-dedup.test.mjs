import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runNativeHistoryAssistantDedupScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { buildCompactTerminalRows } = await import("./src/session-ui/terminalRows.ts");

		const piboSessionId = "ps-test";
		const text = "Erledigt.";
		const assistantNode = ({ eventId, assistantIndex = 2, source, startedAt }) => ({
			id: \`event:assistant:\${eventId}:assistant:\${assistantIndex}\`,
			piboSessionId,
			eventId,
			type: "assistant.message",
			title: "Agent Message",
			status: "done",
			startedAt,
			completedAt: startedAt,
			output: text,
			source,
			stableKey: \`assistant:\${eventId}:assistant:\${assistantIndex}\`,
			children: [],
		});
		const rows = (nodes) => buildCompactTerminalRows({
			piboSessionId,
			title: "Test",
			version: "test",
			eventCount: nodes.length,
			eventLimit: 100,
			hasOlderEvents: false,
			rawEvents: [],
			nodes,
		}, { showThinking: true }).filter((row) => row.kind === "message.assistant");

		const canonical = assistantNode({
			eventId: "web-turn",
			source: "event-log",
			startedAt: "2026-09-02T09:47:44.300Z",
		});
		const nativeFallback = assistantNode({
			eventId: "native-history-group:pi-byte:27101130:0",
			source: "transcript",
			startedAt: "2026-09-02T09:47:44.305Z",
		});
		const canonicalTurn = {
			id: "event:turn:web-turn",
			piboSessionId,
			eventId: "web-turn",
			type: "agent.turn",
			title: "Agent Turn",
			status: "done",
			startedAt: "2026-09-02T09:46:00.000Z",
			completedAt: "2026-09-02T09:47:44.310Z",
			durationMs: 104_310,
			source: "event-log",
			children: [canonical],
		};
		const reconciled = rows([canonicalTurn, nativeFallback]);
		assert.equal(reconciled.length, 1);
		assert.equal(reconciled[0].id, "terminal:assistant:web-turn:assistant:2");
		assert.equal(reconciled[0].eventId, "web-turn");
		assert.deepEqual(reconciled[0].sourceNodeIds, [canonical.id, nativeFallback.id]);

		const ambiguous = rows([
			canonical,
			assistantNode({ eventId: "web-turn-two", source: "event-log", startedAt: "2026-09-02T09:47:44.310Z" }),
			nativeFallback,
		]);
		assert.equal(ambiguous.length, 3, "ambiguous exact-text candidates must remain distinct");

		assert.equal(rows([
			canonical,
			assistantNode({
				eventId: "native-history-group:pi-byte:27101130:0",
				source: "transcript",
				startedAt: "2026-09-02T09:47:46.000Z",
			}),
		]).length, 2, "distant repeated answers must remain distinct");

		assert.equal(rows([
			canonical,
			assistantNode({
				eventId: "native-history-group:pi-byte:27101130:0",
				assistantIndex: 1,
				source: "transcript",
				startedAt: "2026-09-02T09:47:44.305Z",
			}),
		]).length, 2, "different assistant parts must remain distinct");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Compact Terminal reconciles a recent canonical assistant with its fail-closed native-history echo", async () => {
	await assert.doesNotReject(runNativeHistoryAssistantDedupScenario());
});
