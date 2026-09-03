import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

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

test("chat upload rejects overflow before creating or writing the upload directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-chat-upload-limit-"));
	try {
		const piboHome = join(root, "instance-home");
		const result = spawnSync(process.execPath, [
			"--input-type=module",
			"--eval",
			`import { existsSync } from "node:fs";
import { CHAT_UPLOAD_DIR, saveUploadedChatFiles } from ${JSON.stringify(chatFilesModuleUrl)};
const form = new FormData();
for (let index = 1; index <= 11; index += 1) form.append("files", new File([String(index)], \`upload-\${index}.txt\`, { type: "text/plain" }));
try {
  await saveUploadedChatFiles(new Request("http://localhost/api/chat/upload", { method: "POST", body: form }));
  console.log(JSON.stringify({ unexpected: true }));
} catch (error) {
  console.log(JSON.stringify({ status: error.statusCode, message: error.message, uploadDirExists: existsSync(CHAT_UPLOAD_DIR) }));
}`,
		], { env: { ...process.env, PIBO_HOME: piboHome }, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout.trim()), {
			status: 400,
			message: "At most 10 uploaded files can be attached",
			uploadDirExists: false,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("chat uploads follow PIBO_HOME and use a private directory", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-chat-upload-home-"));
	try {
		const piboHome = join(root, "instance-home");
		const result = runUploadDirectoryProbe(piboHome);
		assert.equal(result.status, 0, result.stderr);
		const output = JSON.parse(result.stdout.trim());
		assert.equal(output.path, join(piboHome, "uploads"));
		if (process.platform === "win32") assertPrivateWindowsAcl(output.path, "directory");
		else assert.equal(output.mode, 0o700);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
