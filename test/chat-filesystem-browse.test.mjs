import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { browseFilesystemDirectory, listFilesystemRoots } from "../dist/apps/chat/chat-filesystem.js";
import { PiboWebHttpError } from "../dist/web/http.js";

function assertHttpError(task, statusCode, messagePart) {
	try {
		task();
	} catch (error) {
		assert.ok(error instanceof PiboWebHttpError, `expected PiboWebHttpError, got ${String(error)}`);
		assert.equal(error.statusCode, statusCode);
		assert.match(error.message, messagePart);
		return;
	}
	assert.fail("expected PiboWebHttpError to be thrown");
}

test("filesystem browse lists directories only, sorted, with metadata", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-fs-browse-"));
	try {
		mkdirSync(join(root, "b-dir"));
		mkdirSync(join(root, "a-dir"));
		mkdirSync(join(root, ".hidden"));
		writeFileSync(join(root, "note.txt"), "not a directory");
		const canonical = realpathSync(root);
		const result = browseFilesystemDirectory(root);
		assert.equal(result.path, canonical);
		assert.equal(result.parent, dirname(canonical));
		assert.ok(result.separator === "/" || result.separator === "\\");
		assert.ok(Array.isArray(result.roots) && result.roots.length > 0);
		assert.equal(result.truncated, false);
		const names = result.entries.map((entry) => entry.name);
		assert.deepEqual(new Set(names), new Set(["a-dir", "b-dir", ".hidden"]));
		assert.deepEqual(names, [...names].sort((left, right) => left.localeCompare(right, "de", { sensitivity: "base" })));
		for (const entry of result.entries) {
			assert.ok(isAbsolute(entry.path));
			assert.equal(entry.path, join(canonical, entry.name));
			assert.ok(entry.modifiedAt && !Number.isNaN(Date.parse(entry.modifiedAt)));
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("filesystem browse includes symlinked directories", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-fs-browse-link-"));
	try {
		mkdirSync(join(root, "target"));
		try {
			symlinkSync(join(root, "target"), join(root, "linked"), "dir");
		} catch {
			return;
		}
		const result = browseFilesystemDirectory(root);
		assert.ok(result.entries.some((entry) => entry.name === "linked"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("filesystem browse defaults to the home directory", () => {
	const result = browseFilesystemDirectory(undefined);
	assert.equal(result.path, realpathSync(homedir()));
	const emptyResult = browseFilesystemDirectory("   ");
	assert.equal(emptyResult.path, realpathSync(homedir()));
});

test("filesystem browse reports the filesystem root without a parent", () => {
	const roots = listFilesystemRoots();
	assert.ok(roots.length > 0);
	for (const root of roots) assert.ok(isAbsolute(root));
	const result = browseFilesystemDirectory(roots[0]);
	assert.equal(result.parent, null);
});

test("filesystem browse rejects invalid paths", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-fs-browse-invalid-"));
	try {
		const filePath = join(root, "file.txt");
		writeFileSync(filePath, "x");
		assertHttpError(() => browseFilesystemDirectory("relative/path"), 400, /absolute/);
		assertHttpError(() => browseFilesystemDirectory(join(root, "missing")), 404, /not found/);
		assertHttpError(() => browseFilesystemDirectory(filePath), 400, /not a directory/);
		assertHttpError(() => browseFilesystemDirectory(`/${"x".repeat(5000)}`), 400, /too long/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
