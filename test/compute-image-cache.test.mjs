import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getSourceHash, saveHash, shouldRebuild } from "../dist/compute/docker.js";

async function workspace(files) {
	const root = await mkdtemp(path.join(os.tmpdir(), "pibo-compute-image-hash-"));
	for (const [name, content] of Object.entries(files)) {
		const target = path.join(root, name);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	return root;
}
async function replace(root, name, content) {
	const target = path.join(root, name);
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, content);
}

test("one-time image hash follows the effective Docker build context", async (t) => {
	const root = await workspace({
		Dockerfile: "FROM scratch\nCOPY . /app\n",
		".dockerignore": ".saved-hash\ngenerated\n*.md\n",
		"package.json": "{}\n",
		"package-lock.json": "{}\n",
		"tsconfig.json": "{}\n",
		"scripts/entrypoint.sh": "#!/bin/sh\necho v1\n",
		"scripts/build.mjs": "export const value = 'v1';\n",
		"src/control.ts": "export const value = 'v1';\n",
		"src/page.html": "<p>v1</p>\n",
		"src/page.css": "p { color: red; }\n",
		"generated/ignored.ts": "export const ignored = 'v1';\n",
		"notes.md": "ignored v1\n",
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	const hashFile = path.join(root, ".saved-hash");
	const baseline = await getSourceHash(root);
	await saveHash(root, hashFile);
	assert.equal(await shouldRebuild(root, hashFile), false);

	for (const [name, content] of [
		["src/control.ts", "export const value = 'v2';\n"],
		["scripts/entrypoint.sh", "#!/bin/sh\necho v2\n"],
		["scripts/build.mjs", "export const value = 'v2';\n"],
		["src/page.html", "<p>v2</p>\n"],
		["src/page.css", "p { color: blue; }\n"],
		["tsconfig.json", "{\"compilerOptions\":{\"strict\":true}}\n"],
		["package.json", "{\"name\":\"v2\"}\n"],
		["package-lock.json", "{\"name\":\"v2\"}\n"],
		["Dockerfile", "FROM scratch\nCOPY . /app\n# v2\n"],
		[".dockerignore", ".saved-hash\ngenerated\n*.md\n*.tmp\n"],
	]) {
		const original = await readFile(path.join(root, name), "utf8");
		await replace(root, name, content);
		assert.notEqual(await getSourceHash(root), baseline, `${name} must invalidate the image`);
		assert.equal(await shouldRebuild(root, hashFile), true, `${name} must request a rebuild`);
		await replace(root, name, original);
	}

	for (const [name, content] of [
		["generated/ignored.ts", "export const ignored = 'v2';\n"],
		["notes.md", "ignored v2\n"],
	]) {
		await replace(root, name, content);
		assert.equal(await getSourceHash(root), baseline, `${name} must not cause rebuild churn`);
		assert.equal(await shouldRebuild(root, hashFile), false);
	}
});

test("one-time image hash includes copied paths, modes, and symlink targets", async (t) => {
	const root = await workspace({
		Dockerfile: "FROM scratch\nCOPY . /app\n",
		".dockerignore": "dist\n",
		"scripts/entrypoint.sh": "#!/bin/sh\necho ok\n",
		"target-a": "same\n",
		"target-b": "same\n",
		"dist/generated.js": "v1\n",
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await chmod(path.join(root, "scripts/entrypoint.sh"), 0o644);
	await symlink("target-a", path.join(root, "current-target"));
	const baseline = await getSourceHash(root);

	await rename(path.join(root, "target-b"), path.join(root, "renamed-target"));
	assert.notEqual(await getSourceHash(root), baseline);
	await rename(path.join(root, "renamed-target"), path.join(root, "target-b"));
	await chmod(path.join(root, "scripts/entrypoint.sh"), 0o755);
	assert.notEqual(await getSourceHash(root), baseline);
	await chmod(path.join(root, "scripts/entrypoint.sh"), 0o644);
	await unlink(path.join(root, "current-target"));
	await symlink("target-b", path.join(root, "current-target"));
	assert.notEqual(await getSourceHash(root), baseline);
	await unlink(path.join(root, "current-target"));
	await symlink("target-a", path.join(root, "current-target"));
	await replace(root, "dist/generated.js", "v2\n");
	assert.equal(await getSourceHash(root), baseline);
});

test("one-time image hash follows Docker-specific matching and negation", async (t) => {
	const root = await workspace({
		Dockerfile: "FROM scratch\nCOPY . /app\n",
		".dockerignore": "*.md\nignored\n!ignored/kept.txt\n",
		"root.md": "ignored v1\n",
		"nested/included.md": "included v1\n",
		"ignored/dropped.txt": "ignored v1\n",
		"ignored/kept.txt": "included v1\n",
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	const baseline = await getSourceHash(root);

	await replace(root, "root.md", "ignored v2\n");
	assert.equal(await getSourceHash(root), baseline, "root-level *.md matches must stay ignored");
	await replace(root, "ignored/dropped.txt", "ignored v2\n");
	assert.equal(await getSourceHash(root), baseline, "excluded children must stay ignored");
	await replace(root, "nested/included.md", "included v2\n");
	assert.notEqual(await getSourceHash(root), baseline, "Docker root globs must not exclude nested matches");
	await replace(root, "nested/included.md", "included v1\n");
	await replace(root, "ignored/kept.txt", "included v2\n");
	assert.notEqual(await getSourceHash(root), baseline, "negations must re-include children of excluded directories");
});

test("Dockerfile-specific ignore rules take precedence", async (t) => {
	const root = await workspace({
		Dockerfile: "FROM scratch\nCOPY . /app\n",
		".dockerignore": "root-only.txt\n",
		"Dockerfile.dockerignore": "specific-only.txt\n",
		"root-only.txt": "included v1\n",
		"specific-only.txt": "ignored v1\n",
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	const baseline = await getSourceHash(root);

	await replace(root, "specific-only.txt", "ignored v2\n");
	assert.equal(await getSourceHash(root), baseline);
	await replace(root, "root-only.txt", "included v2\n");
	assert.notEqual(await getSourceHash(root), baseline);
});
