import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runChatApiRoutesScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { sessionActionResource, sessionResourceId } = await import("./src/apps/chat/chat-api-routes.ts");

		assert.deepEqual(sessionActionResource("/api/chat/sessions/ps_1/read"), { piboSessionId: "ps_1", action: "read" });
		assert.deepEqual(sessionActionResource("/api/chat/sessions/ps%201/kill"), { piboSessionId: "ps 1", action: "kill" });
		assert.deepEqual(sessionActionResource("/api/chat/sessions/ps_1/kill-all"), { piboSessionId: "ps_1", action: "kill-all" });
		assert.equal(sessionActionResource("/api/chat/sessions/ps_1"), undefined);
		assert.equal(sessionActionResource("/api/chat/sessions/ps_1/rename"), undefined);
		assert.equal(sessionResourceId("/api/chat/sessions/ps_1/read"), undefined);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat API route helpers parse session action resources", async () => {
	await assert.doesNotReject(runChatApiRoutesScenario());
});
