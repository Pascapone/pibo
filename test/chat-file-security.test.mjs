import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const chatFilesModuleUrl = new URL("../dist/apps/chat/chat-files.js", import.meta.url).href;

function runUploadDirectoryProbe(piboHome) {
	return spawnSync(process.execPath, [
		"--input-type=module",
		"--eval",
		`import { statSync } from "node:fs";
import { CHAT_UPLOAD_DIR, ensurePrivateChatUploadDirectory } from ${JSON.stringify(chatFilesModuleUrl)};
const path = ensurePrivateChatUploadDirectory();
console.log(JSON.stringify({ path, mode: statSync(path).mode & 0o777 }));`,
	], {
		env: { ...process.env, PIBO_HOME: piboHome },
		encoding: "utf8",
	});
}

test("chat uploads follow PIBO_HOME and use a private directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-chat-upload-home-"));
	try {
		const piboHome = join(root, "instance-home");
		const result = runUploadDirectoryProbe(piboHome);
		assert.equal(result.status, 0, result.stderr);
		const output = JSON.parse(result.stdout.trim());
		assert.equal(output.path, join(piboHome, "uploads"));
		if (process.platform !== "win32") assert.equal(output.mode, 0o700);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
