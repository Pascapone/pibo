import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("composer transcription appends recordings without replacing existing text", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { appendTranscribedText } = await import("./src/apps/chat-ui/src/composer/Composer.tsx");
		assert.equal(appendTranscribedText("", " first recording "), "first recording");
		assert.equal(appendTranscribedText("Existing draft", "second recording"), "Existing draft\\n\\nsecond recording");
		assert.equal(appendTranscribedText("Existing draft\\n", "second recording"), "Existing draft\\nsecond recording");
		assert.equal(appendTranscribedText("Keep this", "   "), "Keep this");
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
