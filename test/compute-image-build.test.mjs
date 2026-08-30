import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	buildDevWorkerDockerRunArgs,
	buildDockerBuildArgs,
	buildWorkerDockerRunArgs,
	dockerBuild,
	getSourceHash,
	resolveComputeImageBuildConfig,
} from "../dist/compute/docker.js";

const execFileAsync = promisify(execFile);
const packageRoot = "/opt/pibo-runtime/node_modules/@pasko70/pibo";
const packageDockerfile = `${packageRoot}/compute-image/Dockerfile`;

test("compute image build falls back to package-owned inputs outside a source checkout", () => {
	const config = resolveComputeImageBuildConfig("/tmp/arbitrary-caller", {
		packageRoot,
		env: {},
		fileExists: (candidate) => candidate === packageDockerfile,
	});

	assert.deepEqual(config, {
		imageName: "pibo:latest",
		buildContext: packageRoot,
		dockerfile: packageDockerfile,
		source: "package",
	});
	assert.equal(
		resolveComputeImageBuildConfig("/var/other-caller", {
			packageRoot,
			env: {},
			fileExists: (candidate) => candidate === packageDockerfile,
		}).buildContext,
		packageRoot,
	);
});

test("installed-package image hashing follows the packaged Dockerfile ignore and skips nested dependencies", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-compute-package-context-"));
	const packDir = join(root, "pack");
	const extractDir = join(root, "installed");
	try {
		await mkdir(packDir, { recursive: true });
		await mkdir(extractDir, { recursive: true });
		const { stdout } = await execFileAsync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
			cwd: process.cwd(),
			maxBuffer: 16 * 1024 * 1024,
		});
		const [report] = JSON.parse(stdout);
		await execFileAsync("tar", ["-xzf", join(packDir, report.filename), "-C", extractDir]);
		const installedRoot = join(extractDir, "package");
		const dockerfile = join(installedRoot, "compute-image", "Dockerfile");
		assert.match(await readFile(`${dockerfile}.dockerignore`, "utf8"), /^node_modules$/m);
		const config = resolveComputeImageBuildConfig("/tmp/arbitrary-caller", { packageRoot: installedRoot, env: {} });
		assert.equal(config.source, "package");
		assert.equal(config.dockerfile, dockerfile);

		await mkdir(join(installedRoot, "node_modules", "large-production-dependency"), { recursive: true });
		await writeFile(join(installedRoot, "node_modules", "large-production-dependency", "payload.js"), "dependency-v1\n");
		const before = await getSourceHash(installedRoot, dockerfile);
		await writeFile(join(installedRoot, "node_modules", "large-production-dependency", "payload.js"), "dependency-v2\n");
		assert.equal(await getSourceHash(installedRoot, dockerfile), before);
		await writeFile(join(installedRoot, "dist", "bin", "pibo.js"), "runtime-change\n");
		assert.notEqual(await getSourceHash(installedRoot, dockerfile), before);

		const binDir = join(root, "bin");
		const dockerLog = join(root, "docker-log.json");
		await mkdir(binDir, { recursive: true });
		await writeFile(join(binDir, "docker"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.PIBO_TEST_DOCKER_LOG, JSON.stringify({
	args: process.argv.slice(2),
	cwd: process.cwd(),
	files: fs.readdirSync(process.cwd()).sort(),
}));
`);
		await chmod(join(binDir, "docker"), 0o755);
		const previousPath = process.env.PATH;
		const previousLog = process.env.PIBO_TEST_DOCKER_LOG;
		process.env.PATH = `${binDir}:${previousPath}`;
		process.env.PIBO_TEST_DOCKER_LOG = dockerLog;
		try {
			await dockerBuild(config);
		} finally {
			process.env.PATH = previousPath;
			if (previousLog === undefined) delete process.env.PIBO_TEST_DOCKER_LOG;
			else process.env.PIBO_TEST_DOCKER_LOG = previousLog;
		}
		const stagedBuild = JSON.parse(await readFile(dockerLog, "utf8"));
		assert.deepEqual(stagedBuild.args, ["build", "-t", "pibo:latest", "."]);
		assert.deepEqual(stagedBuild.files, ["Dockerfile", "pibo-package.tgz"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("compute image build preserves source-checkout and explicit image controls", () => {
	const source = resolveComputeImageBuildConfig("/repo/pibo", {
		packageRoot,
		env: { PIBO_COMPUTE_IMAGE: "pibo:issue-733" },
		fileExists: (candidate) => candidate === "/repo/pibo/Dockerfile" || candidate === "/repo/pibo/package.json",
		readTextFile: () => JSON.stringify({ name: "@pasko70/pibo" }),
	});

	assert.deepEqual(source, {
		imageName: "pibo:issue-733",
		buildContext: "/repo/pibo",
		source: "workspace",
	});
	assert.deepEqual(buildDockerBuildArgs(source), ["build", "-t", "pibo:issue-733", "."]);

	const unrelatedCaller = resolveComputeImageBuildConfig("/repo/unrelated-app", {
		packageRoot,
		env: {},
		fileExists: (candidate) => [
			"/repo/unrelated-app/Dockerfile",
			"/repo/unrelated-app/package.json",
			packageDockerfile,
		].includes(candidate),
		readTextFile: () => JSON.stringify({ name: "unrelated-app" }),
	});
	assert.deepEqual(unrelatedCaller, {
		imageName: "pibo:latest",
		buildContext: packageRoot,
		dockerfile: packageDockerfile,
		source: "package",
	});

	const runArgs = buildWorkerDockerRunArgs({
		id: "pibo-worker-explicit-image",
		createdAt: "2026-08-30T00:00:00.000Z",
		imageName: source.imageName,
	});
	assert.equal(runArgs.at(-2), "pibo:issue-733");

	const devRunArgs = buildDevWorkerDockerRunArgs({
		id: "pibo-dev-explicit-image",
		imageName: source.imageName,
		worktreePath: "/repo/pibo/.worktrees/explicit-image",
		worktreeName: "explicit-image",
		block: 0,
		gatewayPort: 4800,
		cdpPort: 4801,
		webPort: 4802,
		webUIPortChat: 4803,
		webUIPortContext: 4804,
		createdAt: "2026-08-30T00:00:00.000Z",
	});
	assert.equal(devRunArgs.at(-3), "pibo:issue-733");
});

test("compute image build reports a missing source and package Dockerfile before invoking Docker", () => {
	assert.throws(
		() => resolveComputeImageBuildConfig("/tmp/arbitrary-caller", { packageRoot, env: {}, fileExists: () => false }),
		/No compute Dockerfile found.*arbitrary-caller.*compute-image\/Dockerfile/,
	);
});
