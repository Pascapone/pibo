import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { replaceDirectory } from "../scripts/lib/replace-directory.mjs";

test("replaceDirectory removes files absent from the current bundle", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-vscode-bundle-"));
	const source = join(root, "source");
	const target = join(root, "target");
	try {
		mkdirSync(join(source, "assets"), { recursive: true });
		writeFileSync(join(source, "index.html"), "current index");
		writeFileSync(join(source, "assets", "current.js"), "current asset");
		mkdirSync(join(target, "assets"), { recursive: true });
		writeFileSync(join(target, "assets", "obsolete.js"), "obsolete asset");

		replaceDirectory(source, target);

		assert.equal(existsSync(join(target, "assets", "obsolete.js")), false);
		assert.equal(readFileSync(join(target, "index.html"), "utf8"), "current index");
		assert.equal(readFileSync(join(target, "assets", "current.js"), "utf8"), "current asset");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
