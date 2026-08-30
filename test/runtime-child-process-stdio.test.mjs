import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuntimeSessionRegistry } from "../dist/tools/runtime/registry.js";

const pythonAvailable = spawnSync(process.platform === "win32" ? "python" : "python3", ["--version"], { stdio: "ignore" }).status === 0;

function runtimeTest(runtime, name, run) {
	test(`${runtime} ${name}`, { skip: runtime === "python" && !pythonAvailable ? "python is unavailable" : false }, run);
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Timed out waiting for ${message}`);
}

async function withRegistry(run) {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-runtime-child-stdio-"));
	const registry = new RuntimeSessionRegistry({ cwd });
	try {
		await run(registry, cwd);
	} finally {
		await registry.closeAll({ force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
}

function assignCode(runtime, name, value) {
	return runtime === "node" ? `globalThis.${name} = ${value}` : `${name} = ${value}`;
}

function synchronousOutputCode(runtime) {
	if (runtime === "node") {
		return `
const { spawnSync } = require("node:child_process");
console.log("direct-stdout");
console.error("direct-stderr");
const captured = spawnSync("/bin/sh", ["-c", "printf 'captured-stdout\\n'; printf 'captured-stderr\\n' >&2"], { encoding: "utf8" });
process.stdout.write(captured.stdout);
process.stderr.write(captured.stderr);
spawnSync("/bin/sh", ["-c", "printf 'inherited-stdout\\n'; printf 'inherited-stderr\\n' >&2"], { stdio: "inherit" });
console.log("parent-after-child");`;
	}
	return `
import subprocess
import sys
print("direct-stdout")
print("direct-stderr", file=sys.stderr)
captured = subprocess.run(["/bin/sh", "-c", "printf 'captured-stdout\\n'; printf 'captured-stderr\\n' >&2"], capture_output=True, text=True)
print(captured.stdout, end="")
print(captured.stderr, end="", file=sys.stderr)
subprocess.run(["/bin/sh", "-c", "printf 'inherited-stdout\\n'; printf 'inherited-stderr\\n' >&2"])
print("parent-after-child")`;
}

function backgroundOutputCode(runtime, markerPath) {
	const command = `sleep 0.05; printf 'background-stdout\\n'; printf 'background-stderr\\n' >&2; printf done > ${JSON.stringify(markerPath)}`;
	if (runtime === "node") {
		return `const child = require("node:child_process").spawn("/bin/sh", ["-c", ${JSON.stringify(command)}], { detached: true, stdio: "inherit" }); child.unref();`;
	}
	return `import subprocess\nsubprocess.Popen(["/bin/sh", "-c", ${JSON.stringify(command)}], start_new_session=True)`;
}

function overlappingBackgroundOutputCode(runtime, markerPath) {
	const command = `sleep 0.08; printf 'late-from-first\\n'; printf 'late-error-from-first\\n' >&2; printf done > ${JSON.stringify(markerPath)}`;
	if (runtime === "node") {
		return `const child = require("node:child_process").spawn("/bin/sh", ["-c", ${JSON.stringify(command)}], { detached: true, stdio: "inherit" }); child.unref();`;
	}
	return `import subprocess\nsubprocess.Popen(["/bin/sh", "-c", ${JSON.stringify(command)}], start_new_session=True)`;
}

function overlappingSecondCode(runtime) {
	if (runtime === "node") {
		return `(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); console.log("second-only"); console.error("second-error-only"); })()`;
	}
	return `import time\ntime.sleep(0.2)\nprint("second-only")\nprint("second-error-only", file=__import__("sys").stderr)`;
}

function errorCode(runtime) {
	return runtime === "node" ? "throw new Error('expected user error')" : "raise RuntimeError('expected user error')";
}

function directOutputExpression(runtime) {
	if (runtime === "node") return '(console.log("after-stdout"), console.error("after-stderr"), savedValue)';
	return '(print("after-stdout"), print("after-stderr", file=__import__("sys").stderr), savedValue)[-1]';
}

function assertOrdered(output, expected) {
	let previous = -1;
	for (const value of expected) {
		const index = output.indexOf(value);
		assert.ok(index > previous, `${JSON.stringify(value)} was missing or out of order in ${JSON.stringify(output)}`);
		previous = index;
	}
}

for (const runtime of ["node", "python"]) {
	runtimeTest(runtime, "keeps inherited and captured child output separate from its protocol", async () => {
		await withRegistry(async (registry) => {
			const controller = `${runtime}-stdio`;
			const setup = await registry.exec(controller, { runtime, code: assignCode(runtime, "savedValue", 42) });
			assert.equal(setup.status, "ok");
			const sessionId = setup.sessionId;

			const output = await registry.exec(controller, { sessionId, code: synchronousOutputCode(runtime) });
			assert.equal(output.status, "ok", JSON.stringify({ status: output.status, error: output.error, stdout: output.stdout, stderr: output.stderr }));
			assertOrdered(output.stdout, ["direct-stdout", "captured-stdout", "inherited-stdout", "parent-after-child"]);
			assertOrdered(output.stderr, ["direct-stderr", "captured-stderr", "inherited-stderr"]);
			assert.equal(registry.list(controller).sessions.find((session) => session.sessionId === sessionId).status, "idle");

			const userError = await registry.exec(controller, { sessionId, code: errorCode(runtime) });
			assert.equal(userError.status, "error");
			const explicit = await registry.exec(controller, { sessionId, code: "savedValue", mode: "eval" });
			assert.equal(explicit.status, "ok", JSON.stringify({ status: explicit.status, error: explicit.error }));
			assert.equal(explicit.result.repr, "42");
			const implicit = await registry.exec(controller, { runtime, code: assignCode(runtime, "afterError", 1) });
			assert.equal(implicit.status, "ok");
			assert.equal(implicit.sessionId, sessionId);
		});
	});

	runtimeTest(runtime, "survives detached child output after an exec has completed", async () => {
		await withRegistry(async (registry, cwd) => {
			const controller = `${runtime}-background`;
			const setup = await registry.exec(controller, { runtime, code: assignCode(runtime, "savedValue", 42) });
			assert.equal(setup.status, "ok");
			const sessionId = setup.sessionId;
			const markerPath = join(cwd, `${runtime}-background-done`);

			const launched = await registry.exec(controller, { sessionId, code: backgroundOutputCode(runtime, markerPath) });
			assert.equal(launched.status, "ok");
			await waitFor(() => existsSync(markerPath), `${runtime} background child output`);
			await new Promise((resolve) => setTimeout(resolve, 20));
			assert.equal(registry.list(controller).sessions.find((session) => session.sessionId === sessionId).status, "idle");

			const explicit = await registry.exec(controller, {
				sessionId,
				code: directOutputExpression(runtime),
				mode: "eval",
			});
			assert.equal(explicit.status, "ok");
			assert.equal(explicit.result.repr, "42");
			assert.match(explicit.stdout, /after-stdout/);
			assert.match(explicit.stderr, /after-stderr/);
			assert.doesNotMatch(explicit.stdout, /background-stdout/);
			assert.doesNotMatch(explicit.stderr, /background-stderr/);
			const implicit = await registry.exec(controller, { runtime, code: assignCode(runtime, "implicitReuse", 1) });
			assert.equal(implicit.status, "ok");
			assert.equal(implicit.sessionId, sessionId);
		});
	});

	runtimeTest(runtime, "does not attribute late inherited output to an overlapping later exec", async () => {
		await withRegistry(async (registry, cwd) => {
			const controller = `${runtime}-overlap`;
			const setup = await registry.exec(controller, { runtime, code: assignCode(runtime, "savedValue", 42) });
			assert.equal(setup.status, "ok");
			const sessionId = setup.sessionId;
			const markerPath = join(cwd, `${runtime}-overlap-done`);

			const launched = await registry.exec(controller, { sessionId, code: overlappingBackgroundOutputCode(runtime, markerPath) });
			assert.equal(launched.status, "ok");
			const second = await registry.exec(controller, { sessionId, code: overlappingSecondCode(runtime) });
			assert.equal(second.status, "ok", JSON.stringify(second));
			assert.match(second.stdout, /second-only/);
			assert.match(second.stderr, /second-error-only/);
			assert.doesNotMatch(second.stdout, /late-from-first/);
			assert.doesNotMatch(second.stderr, /late-error-from-first/);
			await waitFor(() => existsSync(markerPath), `${runtime} overlapping background child output`);

			const third = await registry.exec(controller, { sessionId, code: directOutputExpression(runtime), mode: "eval" });
			assert.equal(third.status, "ok");
			assert.equal(third.result.repr, "42");
			assert.doesNotMatch(third.stdout, /late-from-first/);
			assert.doesNotMatch(third.stderr, /late-error-from-first/);
		});
	});
}
