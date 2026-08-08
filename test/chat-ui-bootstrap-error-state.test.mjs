import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runBootstrapErrorStateScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { classifyBootstrapError } = await import("./src/apps/chat-ui/src/app-bootstrap-error.ts");

		const unauthenticated = Object.assign(new Error("Unauthenticated"), { status: 401 });
		assert.deepEqual(classifyBootstrapError(unauthenticated), {
			kind: "authentication-required",
			message: "Unauthenticated",
		});

		const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
		assert.deepEqual(classifyBootstrapError(forbidden), {
			kind: "authentication-required",
			message: "Forbidden",
		});

		assert.deepEqual(classifyBootstrapError(new TypeError("Failed to fetch")), {
			kind: "load-failed",
			message: "Could not connect to Pibo Chat. Check your network connection and try again.",
		});

		const notFound = Object.assign(new Error("Not found"), { status: 404 });
		assert.deepEqual(classifyBootstrapError(notFound), {
			kind: "load-failed",
			message: "Could not load Pibo Chat. Try again.",
		});

		const serverFailure = Object.assign(new Error("Request failed"), { status: 503 });
		assert.deepEqual(classifyBootstrapError(serverFailure), {
			kind: "load-failed",
			message: "Could not load Pibo Chat. The server may be unavailable. Try again.",
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("initial bootstrap errors distinguish authentication from retryable load failures", async () => {
	await assert.doesNotReject(runBootstrapErrorStateScenario());
});

test("initial load failure UI retries the current URL without offering Google sign-in", async () => {
	const appSource = await readFile("src/apps/chat-ui/src/App.tsx", "utf8");
	const chromeSource = await readFile("src/apps/chat-ui/src/app-chrome.tsx", "utf8");

	assert.match(appSource, /bootstrapError\.kind === "authentication-required"[\s\S]*<SignedOut/);
	assert.match(appSource, /<BootstrapLoadError[\s\S]*onRetry=\{\(\) => window\.location\.reload\(\)\}/);
	assert.match(chromeSource, /export function BootstrapLoadError/);
	assert.match(chromeSource, /\bRetry\b/);
	assert.doesNotMatch(chromeSource.match(/export function BootstrapLoadError[\s\S]*?\n\}/)?.[0] ?? "", /Sign in with Google|signInWithGoogle/);
});
