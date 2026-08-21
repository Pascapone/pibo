import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

function canonical(path) {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function defaultTestFiles() {
	return [
		...readdirSync("test")
			.filter((name) => name.endsWith(".test.mjs"))
			.sort()
			.map((name) => join("test", name)),
		...readdirSync(join("test", "chat-vscode"))
			.filter((name) => name.endsWith(".test.mjs"))
			.sort()
			.map((name) => join("test", "chat-vscode", name)),
	];
}

const testRoot = mkdtempSync(join(tmpdir(), "pibo-test-suite-"));
const isolatedHome = join(testRoot, "home");
const isolatedPiboHome = join(isolatedHome, ".pibo");
const isolatedTemp = join(testRoot, "tmp");
const callerHome = canonical(process.env.HOME ?? homedir());
const callerPiboHome = canonical(process.env.PIBO_HOME ?? join(callerHome, ".pibo"));

mkdirSync(isolatedPiboHome, { recursive: true });
mkdirSync(isolatedTemp, { recursive: true });

const resolvedTestRoot = canonical(testRoot);
const resolvedHome = canonical(isolatedHome);
const resolvedPiboHome = canonical(isolatedPiboHome);
if (!resolvedHome.startsWith(`${resolvedTestRoot}${sep}`) || !resolvedPiboHome.startsWith(`${resolvedTestRoot}${sep}`)) {
	throw new Error("Refusing to run tests outside the isolated test root");
}
if (resolvedHome === callerHome || resolvedPiboHome === callerPiboHome) {
	throw new Error(`Refusing to run tests against the invoking user's home (${callerPiboHome})`);
}

const args = process.argv.slice(2);
const childEnv = {
	...process.env,
	NODE_ENV: "test",
	HOME: isolatedHome,
	USERPROFILE: isolatedHome,
	PIBO_HOME: isolatedPiboHome,
	...(process.platform === "win32" ? { TEMP: isolatedTemp, TMP: isolatedTemp } : {}),
	XDG_CACHE_HOME: join(testRoot, "xdg", "cache"),
	XDG_CONFIG_HOME: join(testRoot, "xdg", "config"),
	XDG_DATA_HOME: join(testRoot, "xdg", "data"),
	XDG_STATE_HOME: join(testRoot, "xdg", "state"),
};
delete childEnv.NODE_TEST_CONTEXT;
delete childEnv.NODE_TEST_WORKER_ID;

const platformArgs = process.platform === "win32" ? ["--test-concurrency=4"] : [];
const child = spawn(process.execPath, ["--test", ...platformArgs, ...(args.length > 0 ? args : defaultTestFiles())], {
	cwd: process.cwd(),
	env: childEnv,
	stdio: "inherit",
});

const forwardSigint = () => {
	if (!child.killed) child.kill("SIGINT");
};
const forwardSigterm = () => {
	if (!child.killed) child.kill("SIGTERM");
};
process.once("SIGINT", forwardSigint);
process.once("SIGTERM", forwardSigterm);

child.once("error", (error) => {
	console.error(error);
	process.exitCode = 1;
});

child.once("close", (code, signal) => {
	process.removeListener("SIGINT", forwardSigint);
	process.removeListener("SIGTERM", forwardSigterm);
	rmSync(testRoot, { recursive: true, force: true });
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exitCode = code ?? 1;
});
