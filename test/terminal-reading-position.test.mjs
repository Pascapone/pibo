import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("terminal reading position persists conceptual row identity and validates stored offsets", async () => {
	const script = `
		import assert from "node:assert/strict";
		const values = new Map();
		globalThis.sessionStorage = {
			getItem: (key) => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, String(value)),
			removeItem: (key) => values.delete(key),
		};
		const {
			parseTerminalReadingPosition,
			readTerminalReadingPosition,
			writeTerminalReadingPosition,
		} = await import("./src/apps/chat-ui/src/session-views/compact-terminal/terminal-reading-position.ts");

		writeTerminalReadingPosition("ps-long", { rowId: "terminal:tool:call-42", offsetPx: -17.25 });
		assert.deepEqual(readTerminalReadingPosition("ps-long"), {
			rowId: "terminal:tool:call-42",
			offsetPx: -17.25,
		});
		writeTerminalReadingPosition("ps-long", undefined);
		assert.equal(readTerminalReadingPosition("ps-long"), undefined);
		assert.equal(parseTerminalReadingPosition(null), undefined);
		assert.equal(parseTerminalReadingPosition("not-json"), undefined);
		assert.equal(parseTerminalReadingPosition(JSON.stringify({ rowId: "", offsetPx: 2 })), undefined);
		assert.equal(parseTerminalReadingPosition(JSON.stringify({ rowId: "row", offsetPx: "2" })), undefined);
		assert.equal(parseTerminalReadingPosition(JSON.stringify({ rowId: "row", offsetPx: null })), undefined);

		globalThis.sessionStorage = {
			getItem() { throw new Error("blocked"); },
			setItem() { throw new Error("blocked"); },
			removeItem() { throw new Error("blocked"); },
		};
		assert.equal(readTerminalReadingPosition("ps-long"), undefined);
		assert.doesNotThrow(() => writeTerminalReadingPosition("ps-long", { rowId: "row", offsetPx: 0 }));
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
