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

test("npm package includes runtime assets and closes installed documentation links", async () => {
	const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
		cwd: process.cwd(),
		maxBuffer: 16 * 1024 * 1024,
	});
	const [report] = JSON.parse(stdout);
	const files = report.files.map((file) => file.path);
	const packagedFiles = new Set(files);
	assert.equal(files.includes("dist/bin/pibo.js"), true);
	assert.equal(files.some((path) => path.startsWith("dist/apps/chat-ui/")), true);
	for (const module of ["web-annotations", "tool-families", "control-tools", "runtime-adapters", "profiles", "mcp-cli", "product-ui"]) {
		assert.equal(files.includes(`dist/plugins/packaged-${module}.js`), true, `npm package must include packaged-${module}.js`);
		assert.equal(files.includes(`dist/plugins/packaged-${module}.d.ts`), true, `npm package must include packaged-${module}.d.ts`);
	}
	assert.equal(files.includes("dist/apps/chat-ui/assets/pibo-builtin-plugin.js"), true);
	assert.equal(files.some((path) => /(?:^|\/)(?:chat-vscode(?:-web)?|cli-ui|cli-session|local|pi-packages|vscode)(?:\/|\.|-)/.test(path) || path.includes("vscode-artifacts")), false);
	assert.equal(files.includes(".dockerignore"), false, "packaged image context must retain built dist files");
	for (const path of [
		"compute-image/Dockerfile",
		"compute-image/Dockerfile.dockerignore",
		"scripts/docker-entrypoint.sh",
		"scripts/prepare-agent-browser-wrapper.sh",
		"scripts/prepare-browser-use-wrapper.sh",
	]) assert.equal(files.includes(path), true, `npm package must include ${path}`);
	assert.equal(files.includes("docs/README.md"), false, "an incomplete legacy documentation README must not be installed");
	assert.equal(files.includes("docs/project/README.md"), false, "an incomplete project documentation README must not be installed");
	for (const path of [
		"docs/project/installation-profiles.md",
		"docs/project/guides/pibo-on-windows-via-wsl.md",
		"docs/project/operations/install-user-host.md",
		"docs/project/operations/install-developer-host.md",
		"docs/project/operations/upgrade-user-to-developer-host.md",
	]) assert.equal(files.includes(path), true, `README-linked installed operation is missing: ${path}`);
	const operationsIndexPath = "docs/project/operations/index.md";
	if (packagedFiles.has(operationsIndexPath)) {
		const operationsIndex = await readFile(join(process.cwd(), operationsIndexPath), "utf8");
		assert.deepEqual(unresolvedPackagedLinks({ files: packagedFiles, indexPath: operationsIndexPath, markdown: operationsIndex }), []);
	}
	const packDirectory = await mkdtemp(join(tmpdir(), "pibo-package-links-"));
	try {
		const { stdout: archiveJson } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory], {
			cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024,
		});
		const [archiveReport] = JSON.parse(archiveJson);
		const archivePath = join(packDirectory, archiveReport.filename);
		const archiveFiles = new Set(archiveReport.files.map((file) => file.path));
		const markdownByPath = new Map();
		for (const path of archiveFiles) {
			if (path !== "README.md" && !path.endsWith(".md")) continue;
			const extracted = await execFileAsync("tar", ["-xOf", archivePath, `package/${path}`], { maxBuffer: 16 * 1024 * 1024 });
			markdownByPath.set(path, extracted.stdout);
		}
		assert.deepEqual(unresolvedDocumentationLinks({ files: archiveFiles, markdownByPath }), []);
	} finally {
		await rm(packDirectory, { recursive: true, force: true });
	}
});

test("npm package supports imports from the package root", async () => {
	const packageDir = await mkdtemp(join(tmpdir(), "pibo-package-root-"));
	const consumerDir = join(packageDir, "consumer");
	try {
		const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packageDir], {
			cwd: process.cwd(),
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
			"import { createDefaultPiboProfile } from '@pasko70/pibo'; console.log(typeof createDefaultPiboProfile)",
		], { cwd: consumerDir });
		assert.equal(imported.stdout.trim(), "function");
	} finally {
		await rm(packageDir, { recursive: true, force: true });
	}
});

test("npm package ships the unavailable-tool path contract", async () => {
	const packageDir = await mkdtemp(join(tmpdir(), "pibo-package-tools-contract-"));
	try {
		const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packageDir], {
			cwd: process.cwd(),
			maxBuffer: 16 * 1024 * 1024,
		});
		const [report] = JSON.parse(stdout);
		const archivePath = join(packageDir, report.filename);
		const { stdout: packagedToolsCli } = await execFileAsync("tar", ["-xOf", archivePath, "package/dist/tools/index.js"]);
		assert.match(packagedToolsCli, /CLI_TOOL_NOT_INSTALLED/);
		assert.match(packagedToolsCli, /Run pibo tools install/);
	} finally {
		await rm(packageDir, { recursive: true, force: true });
	}
});
