import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("chat image preview URLs prefer exact trace payloads and keep path/artifact fallbacks", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { chatImagePreviewUrls } = await import("./src/apps/chat-ui/src/api-chat-files.ts");
		const urls = chatImagePreviewUrls({
			payloadRef: "trace_payload_ref",
			payloadImageIndex: 2,
			path: "/tmp/viewed image.png",
			generatedToolCallId: "call/image",
		}, "ps_test");
		assert.deepEqual(urls, [
			"/api/chat/image-preview?ref=trace_payload_ref&index=2",
			"/api/chat/image-preview?path=%2Ftmp%2Fviewed+image.png&piboSessionId=ps_test",
			"/api/chat/image-preview?generatedToolCallId=call%2Fimage&piboSessionId=ps_test",
		]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("compact terminal exposes a minimal accessible image dialog", async () => {
	const source = await readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
	assert.match(source, /label=\{images\.length > 1 \? `View \$\{images\.length\} images` : "View image"\}/);
	assert.match(source, /<DialogShell[\s\S]*title="Image preview"/);
	assert.match(source, /maxWidthClassName="max-w-6xl"/);
	assert.match(source, /alt=\{`Tool image: \$\{image\.label\}`\}/);
	assert.match(source, /role="status">Loading image/);
	assert.match(source, /role="alert">Image preview is no longer available/);
	assert.match(source, /label="Previous image"/);
	assert.match(source, /label="Next image"/);
});
