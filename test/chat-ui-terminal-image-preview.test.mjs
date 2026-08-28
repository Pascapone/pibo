import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const terminalPath = path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx");
const dialogPath = path.resolve("src/apps/chat-ui/src/components/DialogShell.tsx");

test("terminal image URL authority is exact-only when a payload reference exists", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { chatImagePreviewUrls } = await import("./src/apps/chat-ui/src/api-chat-files.ts");
		const exact = chatImagePreviewUrls({
			payloadRef: "trace-ref",
			payloadImageIndex: 3,
			traceNodeId: "node-image",
			path: "/tmp/newer.png",
			generatedToolCallId: "call-newer",
		}, "ps_exact");
		assert.equal(exact.length, 1);
		const exactUrl = new URL(exact[0], "https://example.test");
		assert.equal(exactUrl.pathname, "/api/chat/image-preview");
		assert.deepEqual(Object.fromEntries(exactUrl.searchParams), {
			ref: "trace-ref",
			nodeId: "node-image",
			piboSessionId: "ps_exact",
			index: "3",
		});
		assert.deepEqual(chatImagePreviewUrls({ payloadRef: "trace-ref", path: "/tmp/fallback.png" }, "ps_exact"), []);

		const generated = new URL(chatImagePreviewUrls({ generatedToolCallId: "call-generated" }, "ps_generated")[0], "https://example.test");
		assert.deepEqual(Object.fromEntries(generated.searchParams), { generatedToolCallId: "call-generated", piboSessionId: "ps_generated" });
		const pathOnly = new URL(chatImagePreviewUrls({ path: "/tmp/image.png" }, "ps_path")[0], "https://example.test");
		assert.deepEqual(Object.fromEntries(pathOnly.searchParams), { path: "/tmp/image.png", piboSessionId: "ps_path" });
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});

test("terminal image dialog keeps accessible lazy navigation outside the virtualized rows", () => {
	const source = fs.readFileSync(terminalPath, "utf8");
	const dialogSource = fs.readFileSync(dialogPath, "utf8");
	assert.match(source, /label=\{images\.length === 1 \? "View image preview"/);
	assert.match(source, /<DialogShell[\s\S]*title="Image preview"[\s\S]*maxWidthClassName="max-w-6xl"/);
	assert.match(source, /alt=\{`Tool image:/);
	assert.match(source, /loading="lazy"/);
	assert.match(source, /decoding="async"/);
	assert.match(source, /role="status"/);
	assert.match(source, /role="alert"/);
	assert.match(source, /label="Previous image"/);
	assert.match(source, /label="Next image"/);
	assert.match(source, /initialFocusRef=\{navigationFocusRef\}/);
	assert.match(source, /<DialogShell[\s\S]*onKeyDown=\{handleKeyDown\}/, "gallery navigation must receive keys from every dialog control");
	assert.match(source, /window\.requestAnimationFrame\(\(\) => navigationFocusRef\.current\?\.focus\(\)\)/);
	for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) assert.match(source, new RegExp(`event\\.key === "${key}"`));
	assert.ok(source.indexOf("<Virtuoso") < source.indexOf("<TerminalImageDialog\n"), "dialog must render outside Virtuoso row measurement");
	assert.match(source, /<MessageForkButton entryId=\{forkEntryId\} onFork=\{onFork\}/, "fork controls remain in Compact Terminal");

	assert.match(dialogSource, /event\.key === "Escape"/);
	assert.match(dialogSource, /event\.key !== "Tab"/);
	assert.match(dialogSource, /previouslyFocused\?\.isConnected/);
	assert.match(dialogSource, /role="dialog"/);
	assert.match(dialogSource, /aria-modal="true"/);
});
