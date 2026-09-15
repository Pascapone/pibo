import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

function relativeMarkdownLinks(markdown) {
	const source = markdown.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "").replace(/`[^`\n]*`/g, "");
	const targets = [];
	for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
		const target = match[1].replace(/^<|>$/g, "");
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#") || target.startsWith("/")) continue;
		const clean = decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]);
		if (clean) targets.push(clean);
	}
	return targets;
}

function unresolvedPackagedLinks({ files, indexPath, markdown }) {
	return relativeMarkdownLinks(markdown).filter((target) => {
		const resolved = posix.normalize(posix.join(posix.dirname(indexPath), target));
		return !files.has(resolved) && !files.has(posix.join(resolved, "index.md"));
	});
}

function unresolvedDocumentationLinks({ files, markdownByPath }) {
	const unresolved = [];
	for (const [documentPath, markdown] of markdownByPath) {
		for (const target of unresolvedPackagedLinks({ files, indexPath: documentPath, markdown })) {
			unresolved.push({ documentPath, target });
		}
	}
	return unresolved;
}

test("packaged operations-index links cannot target an excluded runbook", () => {
	const indexPath = "docs/project/operations/index.md";
	const files = new Set([indexPath, "docs/project/operations/install-user-host.md"]);
	const markdown = [
		"[Installed guide](install-user-host.md#requirements)",
		"[Excluded release runbook](vscode-extension-release.md)",
		"```md",
		"[Example only](also-not-packaged.md)",
		"```",
	].join("\n");
	assert.deepEqual(unresolvedPackagedLinks({ files, indexPath, markdown }), ["vscode-extension-release.md"]);
});

test("package documentation link closure detects an excluded transitive target", () => {
	const files = new Set(["README.md", "docs/guide.md"]);
	const markdownByPath = new Map([
		["README.md", "[Guide](docs/guide.md)"],
		["docs/guide.md", "[Quickstart](quickstart.md)"],
	]);
	assert.deepEqual(unresolvedDocumentationLinks({ files, markdownByPath }), [
		{ documentPath: "docs/guide.md", target: "quickstart.md" },
	]);
});

test("repository root refuses direct npm publication", async () => {
	await assert.rejects(
		execFileAsync("npm", ["publish", "--dry-run"], { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }),
		(error) => {
			assert.match(error.stderr, /Refusing to publish the private repository root/);
			return true;
		},
	);
});

test("generated Minimal-Core tarball excludes repository and feature implementation surfaces", async () => {
	const workspacePackage = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
	assert.equal(workspacePackage.private, true, "the repository root is a private build workspace, not an npm release package");
	const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
		cwd: join(process.cwd(), "dist/pibo4-core-package"),
		maxBuffer: 16 * 1024 * 1024,
	});
	const [report] = JSON.parse(stdout);
	assert.equal(report.name, "@pasko70/pibo");
	const files = report.files.map((file) => file.path);
	for (const file of ["index.js", "plugin-sdk.js", "plugin-host.js", "plugin-runtime.js", "plugin-cutover.js", "product-runtime.js", "dist/bin/pibo.js", "dist/core/executable-cli.js", "dist/apps/chat-ui/index.html", "dist/apps/context-files-ui/index.html", "package.json"]) {
		assert.equal(files.includes(file), true, `Minimal-Core must include ${file}`);
	}
	assert.equal(files.some((file) => file.startsWith("docs/") || file.startsWith("compute-image/") || file.startsWith("scripts/")), false);
	assert.equal(files.some((file) => file.includes("packaged-") || file.includes("plugin-builtin") || file.split("/").at(-1)?.startsWith("pibo-plugin-")), false);
});

test("generated Minimal-Core supports public package imports from its own tarball", async () => {
	const packageDir = await mkdtemp(join(tmpdir(), "pibo-minimal-core-import-"));
	const consumerDir = join(packageDir, "consumer");
	try {
		const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packageDir], {
			cwd: join(process.cwd(), "dist/pibo4-core-package"),
			maxBuffer: 16 * 1024 * 1024,
		});
		const [report] = JSON.parse(stdout);
		const archivePath = join(packageDir, report.filename);
		await mkdir(consumerDir, { recursive: true });
		await execFileAsync("npm", ["install", "--ignore-scripts", "--no-package-lock", "--no-save", archivePath], {
			cwd: consumerDir,
			maxBuffer: 16 * 1024 * 1024,
		});
		const imported = await execFileAsync(process.execPath, [
			"--input-type=module",
			"--eval",
			"import { PluginHost, startPluginProductRuntime } from '@pasko70/pibo'; console.log(typeof PluginHost, typeof startPluginProductRuntime)",
		], { cwd: consumerDir });
		assert.equal(imported.stdout.trim(), "function function");
	} finally {
		await rm(packageDir, { recursive: true, force: true });
	}
});

test("built workspace CLI retains the unavailable-tool path contract without treating the workspace pack as release evidence", async () => {
	const builtToolsCli = await readFile(join(process.cwd(), "dist/tools/index.js"), "utf8");
	assert.match(builtToolsCli, /CLI_TOOL_NOT_INSTALLED/);
	assert.match(builtToolsCli, /Run pibo tools install/);
});
