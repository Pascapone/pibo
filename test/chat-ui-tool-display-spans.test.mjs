import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("tool display filtering keeps system errors visible in every compact mode", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { filterToolDisplaySpans, isToolDisplaySpan } = await import("./src/apps/chat-ui/src/tracing/tool-display-spans.ts");

		function span(id, spanType, traceNodeType, intent) {
			return {
				id,
				name: id,
				spanType,
				startTime: 1,
				status: traceNodeType === "error" ? "ERROR" : "OK",
				attributes: intent ? { intent } : {},
				events: [],
				pibo: { traceNodeType },
			};
		}

		const systemError = span("system-error", "tool.result", "error");
		const plainTool = span("plain-tool", "tool.call", "tool.call");
		const intentTool = span("intent-tool", "tool.call", "tool.call", "Reviewing project documentation");
		assert.equal(isToolDisplaySpan(systemError), false);
		assert.equal(isToolDisplaySpan(plainTool), true);
		assert.equal(isToolDisplaySpan({ ...plainTool, pibo: undefined }), true);
		assert.deepEqual(filterToolDisplaySpans([systemError, plainTool, intentTool], "hide").map((item) => item.id), ["system-error"]);
		assert.deepEqual(filterToolDisplaySpans([systemError, plainTool, intentTool], "intent").map((item) => item.id), ["system-error", "intent-tool"]);
		assert.deepEqual(filterToolDisplaySpans([systemError, plainTool, intentTool], "slim").map((item) => item.id), ["system-error", "plain-tool", "intent-tool"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
