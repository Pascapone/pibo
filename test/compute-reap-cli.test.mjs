import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

async function makeDockerFixture({ candidate = true } = {}) {
	const root = await mkdtemp(join(tmpdir(), "pibo-compute-reap-cli-"));
	const bin = join(root, "bin");
	const state = join(root, "state");
	const home = join(root, "home");
	const log = join(state, "docker.log");
	await mkdir(bin, { recursive: true });
	await mkdir(state, { recursive: true });
	await mkdir(home, { recursive: true });
	await writeFile(log, "");
	if (candidate) {
		await writeFile(join(state, "worker.active"), "");
		await writeFile(join(state, "lease.active"), "");
	}
	const dockerPath = join(bin, "docker");
	await writeFile(dockerPath, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$PIBO_FAKE_DOCKER_LOG"
case "\${1:-}" in
  ps)
    if [ -f "$PIBO_FAKE_DOCKER_STATE/worker.active" ]; then
      case "$*" in
        *"pibo.compute.role=worker"*)
          printf 'fixture-id\\tpibo-worker-cli-fixture\\trunning\\tUp 5 minutes\\t\\tpibo.compute.role=worker,pibo.compute.createdAt=2020-01-01T00:00:00.000Z\\n'
          ;;
      esac
    fi
    ;;
  inspect)
    exit 1
    ;;
  stop)
    : > "$PIBO_FAKE_DOCKER_STATE/worker.stopped"
    ;;
  rm)
    rm -f "$PIBO_FAKE_DOCKER_STATE/worker.active" "$PIBO_FAKE_DOCKER_STATE/lease.active"
    : > "$PIBO_FAKE_DOCKER_STATE/worker.removed"
    ;;
  *)
    exit 97
    ;;
esac
`);
	await chmod(dockerPath, 0o755);
	return {
		root,
		state,
		log,
		env: {
			...process.env,
			HOME: home,
			PIBO_HOME: join(home, ".pibo"),
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			PIBO_FAKE_DOCKER_STATE: state,
			PIBO_FAKE_DOCKER_LOG: log,
		},
	};
}

async function invokeReap(args, fixture) {
	try {
		const result = await execFileAsync(process.execPath, [cliPath, "compute", "reap", ...args], { env: fixture.env });
		return { code: 0, ...result };
	} catch (error) {
		return {
			code: error.code,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

async function exists(path) {
	try {
		await readFile(path);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}

test("compute reap rejects conflicting modes before Docker or lease mutation in either order", async (t) => {
	for (const flags of [["--dry-run", "--apply"], ["--apply", "--dry-run"]]) {
		await t.test(flags.join(" "), async () => {
			const fixture = await makeDockerFixture();
			try {
				const result = await invokeReap([...flags, "--max-age-minutes", "60", "--json"], fixture);
				assert.equal(result.code, 1);
				assert.match(result.stderr, /Use either --apply or --dry-run, not both/);
				assert.equal(await readFile(fixture.log, "utf8"), "");
				assert.equal(await exists(join(fixture.state, "worker.active")), true);
				assert.equal(await exists(join(fixture.state, "lease.active")), true);
				assert.equal(await exists(join(fixture.state, "worker.stopped")), false);
				assert.equal(await exists(join(fixture.state, "worker.removed")), false);
			} finally {
				await rm(fixture.root, { recursive: true, force: true });
			}
		});
	}
});

test("compute reap preserves dry-run defaults, apply, no-candidate, JSON, and text behavior", async (t) => {
	const cases = [
		{ name: "dry-run JSON", args: ["--dry-run", "--max-age-minutes", "60", "--json"], dryRun: true, applied: false, removed: false },
		{ name: "apply JSON", args: ["--apply", "--max-age-minutes", "60", "--json"], dryRun: false, applied: true, removed: true },
		{ name: "neither mode defaults to dry-run JSON", args: ["--max-age-minutes", "60", "--json"], dryRun: true, applied: false, removed: false },
	];
	for (const scenario of cases) {
		await t.test(scenario.name, async () => {
			const fixture = await makeDockerFixture();
			try {
				const result = await invokeReap(scenario.args, fixture);
				assert.equal(result.code, 0);
				const output = JSON.parse(result.stdout);
				assert.equal(output.dryRun, scenario.dryRun);
				assert.equal(output.applied, scenario.applied);
				assert.equal(output.plan.summary.selected, 1);
				assert.equal(await exists(join(fixture.state, "worker.active")), !scenario.removed);
				assert.equal(await exists(join(fixture.state, "lease.active")), !scenario.removed);
				const log = await readFile(fixture.log, "utf8");
				assert.equal(log.includes("stop -t 10 pibo-worker-cli-fixture"), scenario.removed);
				assert.equal(log.includes("rm pibo-worker-cli-fixture"), scenario.removed);
			} finally {
				await rm(fixture.root, { recursive: true, force: true });
			}
		});
	}

	await t.test("apply with no candidate", async () => {
		const fixture = await makeDockerFixture({ candidate: false });
		try {
			const result = await invokeReap(["--apply", "--max-age-minutes", "60", "--json"], fixture);
			assert.equal(result.code, 0);
			const output = JSON.parse(result.stdout);
			assert.equal(output.applied, true);
			assert.equal(output.plan.summary.selected, 0);
			assert.deepEqual(output.removed, []);
			assert.doesNotMatch(await readFile(fixture.log, "utf8"), /^(stop|rm) /m);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	await t.test("dry-run text output", async () => {
		const fixture = await makeDockerFixture();
		try {
			const result = await invokeReap(["--dry-run", "--max-age-minutes", "60"], fixture);
			assert.equal(result.code, 0);
			assert.match(result.stdout, /Compute reap dry-run: 1 selected/);
			assert.match(result.stdout, /Dry-run only\./);
			assert.doesNotMatch(await readFile(fixture.log, "utf8"), /^(stop|rm) /m);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});
