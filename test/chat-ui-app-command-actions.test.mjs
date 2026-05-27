import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runCommandActionScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			commandActionParams,
			getResultPiboSessionId,
			normalizeDownloadCommandPath,
			parseForkActionResponse,
		} = await import("./src/apps/chat-ui/src/app-command-actions.ts");

		assert.equal(normalizeDownloadCommandPath(" /tmp/output.txt "), "/tmp/output.txt");
		assert.equal(normalizeDownloadCommandPath(" '/tmp/output with spaces.txt' "), "/tmp/output with spaces.txt");
		assert.equal(normalizeDownloadCommandPath(' "relative/path.md" '), "relative/path.md");
		assert.equal(normalizeDownloadCommandPath(' "unterminated '), '"unterminated');

		assert.deepEqual(commandActionParams("thinking", "full extra"), { level: "full" });
		assert.deepEqual(commandActionParams("compact", "keep the summary concise"), { customInstructions: "keep the summary concise" });
		assert.equal(commandActionParams("thinking", ""), undefined);
		assert.equal(commandActionParams("session.fork", "ignored"), undefined);

		assert.equal(getResultPiboSessionId({ result: { piboSessionId: "ps-derived" } }), "ps-derived");
		assert.equal(getResultPiboSessionId({ result: { piboSessionId: 123 } }), undefined);
		assert.equal(getResultPiboSessionId({ result: null }), undefined);
		assert.equal(getResultPiboSessionId(null), undefined);

		const forkResponse = parseForkActionResponse({ result: { piboSessionId: "ps-fork", selectedText: "quote" } });
		assert.deepEqual(forkResponse, { result: { piboSessionId: "ps-fork", selectedText: "quote" } });
		assert.deepEqual(parseForkActionResponse({ result: { cancelled: true } }), { result: { cancelled: true } });
		assert.equal(parseForkActionResponse({ result: null }), null);
		assert.equal(parseForkActionResponse([]), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app command action helpers parse command args and action responses", async () => {
	await assert.doesNotReject(runCommandActionScenario());
});
