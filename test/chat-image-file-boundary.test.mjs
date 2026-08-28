import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveImagePreviewPath, resolveImagePreviewPathWithinRoots, responseChatImagePreview } from "../dist/apps/chat/chat-files.js";

function pngBytes(fill) {
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(32, fill),
	]);
}

test("image preview rejects a symlink swap after path authorization", () => {
	const workspace = mkdtempSync(join(tmpdir(), "pibo-image-boundary-workspace-"));
	const outside = mkdtempSync(join(tmpdir(), "pibo-image-boundary-outside-"));
	const requestedPath = join(workspace, "preview.png");
	const outsidePath = join(outside, "private.png");
	writeFileSync(requestedPath, pngBytes(1));
	writeFileSync(outsidePath, pngBytes(2));

	try {
		const authorized = resolveImagePreviewPath("preview.png", workspace);
		unlinkSync(requestedPath);
		symlinkSync(outsidePath, requestedPath);
		assert.throws(
			() => responseChatImagePreview(authorized.path, authorized.allowedRoots),
			(error) => error?.status === 409 || error?.statusCode === 409,
		);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("image preview rejects an authorized parent directory swapped outside its root", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-image-parent-root-"));
	const outside = mkdtempSync(join(tmpdir(), "pibo-image-parent-outside-"));
	const sessionDir = join(root, "session");
	const movedSessionDir = join(root, "session-moved");
	const requestedPath = join(sessionDir, "preview.png");
	mkdirSync(sessionDir);
	writeFileSync(requestedPath, pngBytes(1));
	writeFileSync(join(outside, "preview.png"), pngBytes(2));

	try {
		const authorized = resolveImagePreviewPathWithinRoots(requestedPath, [root]);
		renameSync(sessionDir, movedSessionDir);
		symlinkSync(outside, sessionDir);
		assert.throws(
			() => responseChatImagePreview(authorized.path, authorized.allowedRoots),
			(error) => error?.statusCode === 403 || error?.statusCode === 409,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});
