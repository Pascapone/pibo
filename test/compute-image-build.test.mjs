import assert from "node:assert/strict";
import test from "node:test";

import {
	buildDevWorkerDockerRunArgs,
	buildDockerBuildArgs,
	buildWorkerDockerRunArgs,
	resolveComputeImageBuildConfig,
} from "../dist/compute/docker.js";

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
	assert.deepEqual(buildDockerBuildArgs(config), [
		"build",
		"-t",
		"pibo:latest",
		"-f",
		packageDockerfile,
		".",
	]);
	assert.equal(
		resolveComputeImageBuildConfig("/var/other-caller", {
			packageRoot,
			env: {},
			fileExists: (candidate) => candidate === packageDockerfile,
		}).buildContext,
		packageRoot,
	);
});

test("compute image build preserves source-checkout and explicit image controls", () => {
	const source = resolveComputeImageBuildConfig("/repo/pibo", {
		packageRoot,
		env: { PIBO_COMPUTE_IMAGE: "pibo:issue-733" },
		fileExists: (candidate) => candidate === "/repo/pibo/Dockerfile",
	});

	assert.deepEqual(source, {
		imageName: "pibo:issue-733",
		buildContext: "/repo/pibo",
		source: "workspace",
	});
	assert.deepEqual(buildDockerBuildArgs(source), ["build", "-t", "pibo:issue-733", "."]);

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
