import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runOptimisticUserMessageScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			annotateLiveTraceForkEntryIds,
			collectPersistedUserMessageIndex,
			overlayIncludesOptimisticUserMessage,
			reconcileOptimisticUserMessages,
		} = await import("./src/apps/chat-ui/src/tracing/optimistic-user-messages.ts");

		const node = (id, output, extra = {}) => ({
			id,
			piboSessionId: "ps-test",
			parentId: undefined,
			type: "user.message",
			title: "user",
			status: "done",
			output,
			children: [],
			...extra,
		});

		const persistedA = node("transcript-a", "duplicate text", { entryId: "entry-a", source: "transcript" });
		const persistedB = node("transcript-b", "duplicate text", { entryId: "entry-b", source: "transcript" });
		const parent = node("parent", "parent text", { entryId: "entry-parent", source: "transcript", children: [persistedA] });
		const index = collectPersistedUserMessageIndex([parent, persistedB]);
		assert.deepEqual(index.get("duplicate text"), ["entry-a", "entry-b"]);
		assert.deepEqual(index.get("parent text"), ["entry-parent"]);

		const liveNodes = [
			node("live-1", "duplicate text"),
			node("live-2", "duplicate text"),
			node("live-3", "duplicate text"),
			node("live-existing", "duplicate text", { entryId: "keep-existing" }),
		];
		annotateLiveTraceForkEntryIds(liveNodes, index);
		assert.equal(liveNodes[0].entryId, "entry-a");
		assert.equal(liveNodes[1].entryId, "entry-b");
		assert.equal(liveNodes[2].entryId, undefined);
		assert.equal(liveNodes[3].entryId, "keep-existing");

		const view = {
			piboSessionId: "ps-test",
			nodes: [
				node("persisted", "hello", { source: "transcript", entryId: "entry-hello" }),
				node("optimistic:user-message:1", "hello"),
				node("optimistic:user-message:2", "hello"),
				node("optimistic:user-message:3", "unmatched"),
			],
			rawEvents: [],
		};
		const reconciled = reconcileOptimisticUserMessages(view);
		assert.notEqual(reconciled, view);
		assert.deepEqual(reconciled.nodes.map((item) => item.id), ["persisted", "optimistic:user-message:2", "optimistic:user-message:3"]);

		assert.equal(overlayIncludesOptimisticUserMessage([{ payload: { type: "message_queued", source: "user", text: "hello" } }]), true);
		assert.equal(overlayIncludesOptimisticUserMessage([{ payload: { type: "message_queued", source: "assistant", text: "hello" } }]), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("optimistic user-message helpers preserve fork-entry order and drop only confirmed duplicates", async () => {
	await assert.doesNotReject(runOptimisticUserMessageScenario());
});
