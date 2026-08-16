#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

if (process.argv.includes("--version")) {
	process.stdout.write("codex-cli 0.147.0\n");
	process.exit(0);
}

const codexHome = process.env.CODEX_HOME;
const scenario = process.env.PIBO_CODEX_AUTH_FAKE_SCENARIO ?? "device-success";
const completionDelayMs = Number.parseInt(process.env.PIBO_CODEX_AUTH_FAKE_DELAY_MS ?? "20", 10);
const statePath = join(codexHome, "fake-auth-state.json");
let initialized = false;
let pendingLoginId;
let completionTimer;

mkdirSync(codexHome, { recursive: true, mode: 0o700 });

function loadState() {
	if (!existsSync(statePath)) return { accountType: null, planType: null, lastMethod: null, apiKeyLength: 0 };
	return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(state) {
	writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
	send({ id, result: value });
}

function error(id, code, message) {
	send({ id, error: { code, message } });
}

function notify(method, params) {
	send({ method, params });
}

function accountResponse() {
	const state = loadState();
	if (state.accountType === "apiKey") return { account: { type: "apiKey" }, requiresOpenaiAuth: true };
	if (state.accountType === "chatgpt") return { account: { type: "chatgpt", email: null, planType: state.planType ?? "plus" }, requiresOpenaiAuth: true };
	return { account: null, requiresOpenaiAuth: true };
}

function completeDevice(success) {
	if (!pendingLoginId) return;
	const loginId = pendingLoginId;
	pendingLoginId = undefined;
	if (success) {
		saveState({ accountType: "chatgpt", planType: "plus", lastMethod: "device_code", apiKeyLength: 0 });
		notify("account/login/completed", { success: true, loginId, error: null, onboardingEntrypoint: null });
		notify("account/updated", { authMode: "chatgpt", planType: "plus" });
	} else {
		notify("account/login/completed", {
			success: false,
			loginId,
			error: "Authorization: Bearer fixture-sensitive-value",
			onboardingEntrypoint: null,
		});
	}
}

async function handle(message) {
	if (message.method === "initialize") {
		result(message.id, {
			codexHome,
			platformFamily: "unix",
			platformOs: "linux",
			userAgent: "fake-codex-auth/0.147.0",
		});
		return;
	}
	if (!initialized) {
		error(message.id, -32002, "Not initialized");
		return;
	}
	if (message.method === "account/read") {
		if (scenario === "malformed-read") {
			result(message.id, { requiresOpenaiAuth: "yes", account: { type: "chatgpt", email: "must-not-escape", planType: 7 } });
			return;
		}
		if (scenario === "read-timeout") return;
		if (scenario === "read-crash") {
			setTimeout(() => process.exit(31), 5);
			return;
		}
		result(message.id, accountResponse());
		return;
	}
	if (message.method === "account/login/start") {
		if (scenario === "malformed-start") {
			result(message.id, { type: "chatgptDeviceCode", loginId: "native-login-only" });
			return;
		}
		if (message.params?.type === "apiKey") {
			const key = typeof message.params.apiKey === "string" ? message.params.apiKey : "";
			saveState({ accountType: "apiKey", planType: null, lastMethod: "api_key", apiKeyLength: key.length });
			result(message.id, { type: "apiKey" });
			return;
		}
		if (message.params?.type !== "chatgptDeviceCode") {
			error(message.id, -32602, "Unsupported login type");
			return;
		}
		pendingLoginId = "native-login-fixed";
		result(message.id, {
			type: "chatgptDeviceCode",
			loginId: pendingLoginId,
			userCode: "TEST-CODE",
			verificationUrl: "https://example.invalid/device",
		});
		if (scenario === "device-success") completionTimer = setTimeout(() => completeDevice(true), completionDelayMs);
		if (scenario === "device-failure") completionTimer = setTimeout(() => completeDevice(false), completionDelayMs);
		if (scenario === "device-crash") completionTimer = setTimeout(() => process.exit(32), completionDelayMs);
		return;
	}
	if (message.method === "account/login/cancel") {
		const status = pendingLoginId && message.params?.loginId === pendingLoginId ? "canceled" : "notFound";
		if (completionTimer) clearTimeout(completionTimer);
		completionTimer = undefined;
		pendingLoginId = undefined;
		result(message.id, { status });
		return;
	}
	if (message.method === "account/logout") {
		if (completionTimer) clearTimeout(completionTimer);
		completionTimer = undefined;
		pendingLoginId = undefined;
		saveState({ accountType: null, planType: null, lastMethod: "logout", apiKeyLength: 0 });
		result(message.id, {});
		return;
	}
	error(message.id, -32601, `Unknown method ${message.method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (!message || typeof message !== "object" || typeof message.method !== "string") return;
	if (!Object.hasOwn(message, "id")) {
		if (message.method === "initialized") initialized = true;
		return;
	}
	void handle(message);
});
input.on("close", () => process.exit(0));
