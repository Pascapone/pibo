import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runRoomFallbackScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const { fallbackRoomIdWhenHidingArchived } = await import("./src/apps/chat-ui/src/session-sidebar-helpers.ts");

		const room = (id, metadata = {}, children = []) => ({
			id,
			name: id,
			type: "chat",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			metadata,
			children,
		});
		const archived = { chatRoomArchivedAt: "2026-01-02T00:00:00.000Z" };
		const rooms = [
			room("shared", { default: true }),
			room("active", {}, [room("archived-child", archived)]),
			room("archived-parent", archived, [room("hidden-active-child")]),
		];

		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "archived-child"), "shared");
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "archived-parent"), "shared");
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "hidden-active-child"), "shared");
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "active"), undefined);
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "shared"), undefined);
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, "missing"), undefined);
		assert.equal(fallbackRoomIdWhenHidingArchived(rooms, null), undefined);
		assert.equal(fallbackRoomIdWhenHidingArchived([room("archived", archived)], "archived"), undefined);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("hiding archived rooms falls back only when the selected room becomes hidden", async () => {
	await assert.doesNotReject(runRoomFallbackScenarios());
});
