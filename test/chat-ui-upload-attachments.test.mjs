import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runUploadAttachmentScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			addUploadedChatAttachmentsForSession,
			detachUploadedChatAttachmentForSession,
			clearUploadedChatAttachmentsForSession,
		} = await import("./src/apps/chat-ui/src/chat-upload-attachments.ts");

		let sequence = 0;
		const createId = () => \`upload-test-\${++sequence}\`;
		const existing = {
			"ps-1": [{ id: "existing", name: "already.txt", path: "/tmp/already.txt", size: 1 }],
			"ps-2": [{ id: "other", name: "other.txt", path: "/tmp/other.txt", size: 2 }],
		};

		const unchangedNoSession = addUploadedChatAttachmentsForSession(existing, null, [{ name: "new.txt", path: "/tmp/new.txt", size: 3 }], createId);
		assert.equal(unchangedNoSession, existing);

		const added = addUploadedChatAttachmentsForSession(existing, "ps-1", [
			{ name: "already duplicate", path: "/tmp/already.txt", size: 4 },
			{ name: "missing path", path: "", size: 5 },
			{ name: "new.txt", path: "/tmp/new.txt", size: 6, contentType: "text/plain" },
		], createId);
		assert.notEqual(added, existing);
		assert.equal(added["ps-2"], existing["ps-2"]);
		assert.deepEqual(added["ps-1"].map((attachment) => attachment.id), ["existing", "upload-test-1"]);
		assert.deepEqual(added["ps-1"].map((attachment) => attachment.path), ["/tmp/already.txt", "/tmp/new.txt"]);
		assert.equal(added["ps-1"][1].contentType, "text/plain");

		const full = { "ps-1": Array.from({ length: 9 }, (_, index) => ({ id: \`existing-\${index}\`, name: \`file-\${index}\`, path: \`/tmp/file-\${index}\`, size: index })) };
		const capped = addUploadedChatAttachmentsForSession(full, "ps-1", [
			{ name: "a", path: "/tmp/a", size: 1 },
			{ name: "b", path: "/tmp/b", size: 1 },
		], createId);
		assert.equal(capped["ps-1"].length, 10);
		assert.deepEqual(capped["ps-1"].slice(-2).map((attachment) => attachment.path), ["/tmp/file-8", "/tmp/a"]);

		const detached = detachUploadedChatAttachmentForSession(added, "ps-1", "upload-test-1");
		assert.deepEqual(detached["ps-1"].map((attachment) => attachment.id), ["existing"]);
		assert.equal(detachUploadedChatAttachmentForSession(added, "ps-1", "missing"), added);

		const cleared = clearUploadedChatAttachmentsForSession(added, "ps-1");
		assert.deepEqual(cleared["ps-1"], []);
		assert.equal(clearUploadedChatAttachmentsForSession(cleared, "ps-1"), cleared);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat upload attachment helpers preserve per-session selection behavior", async () => {
	await assert.doesNotReject(runUploadAttachmentScenario());
});
