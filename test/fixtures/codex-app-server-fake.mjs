import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const createPath = process.env.PIBO_CODEX_FAKE_CREATE_PATH;
if (createPath) {
	mkdirSync(createPath);
	writeFileSync(join(createPath, "created.txt"), "created");
}

const scenario = process.env.PIBO_CODEX_FAKE_SCENARIO ?? "happy";
const overloadFailures = Number.parseInt(process.env.PIBO_CODEX_FAKE_OVERLOAD_FAILURES ?? "2", 10);
const oversizedBytes = Number.parseInt(process.env.PIBO_CODEX_FAKE_OVERSIZED_BYTES ?? "4096", 10);
const sequence = [];
let initialized = false;
let initializeSeen = false;
let initializeCapabilities;
let jsonrpcSeen = false;
let overloadAttempts = 0;
const awaitingServerResponse = new Map();

if (scenario === "ignore-shutdown") {
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1_000);
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message, data) {
	send({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function sendResult(id, result) {
	send({ id, result });
}

function requireInitialized(message) {
	if (initialized) return true;
	sendError(message.id, -32002, "Not initialized");
	return false;
}

async function handleRequest(message) {
	sequence.push(message.method);
	if (message.method === "initialize") {
		if (initializeSeen) {
			sendError(message.id, -32600, "Already initialized");
			return;
		}
		initializeSeen = true;
		initializeCapabilities = message.params?.capabilities;
		if (scenario === "bad-initialize") {
			sendResult(message.id, { userAgent: "incomplete" });
			return;
		}
		sendResult(message.id, {
			codexHome: "/tmp/fake-codex-home",
			platformFamily: "unix",
			platformOs: "linux",
			userAgent: "fake-codex-app-server/0.147.0",
		});
		return;
	}
	if (!requireInitialized(message)) return;

	switch (message.method) {
		case "test/sequence":
			sendResult(message.id, { sequence: [...sequence], initializeCapabilities, jsonrpcSeen });
			return;
		case "test/echo": {
			const delayMs = Number(message.params?.delayMs ?? 0);
			setTimeout(() => sendResult(message.id, { value: message.params?.value }), delayMs);
			return;
		}
		case "test/notify":
			send({ method: "test/notification", params: { value: message.params?.value } });
			sendResult(message.id, {});
			return;
		case "test/serverRequest": {
			const serverRequestId = `server-${message.id}`;
			awaitingServerResponse.set(`string:${serverRequestId}`, message.id);
			send({ id: serverRequestId, method: "test/serverRequest", params: { value: message.params?.value } });
			return;
		}
		case "test/overload":
			overloadAttempts += 1;
			if (overloadAttempts <= overloadFailures) {
				sendError(message.id, -32001, "Server overloaded; retry later.");
				return;
			}
			sendResult(message.id, { attempts: overloadAttempts });
			return;
		case "test/never":
			return;
		case "test/malformed":
			process.stdout.write("{not-json}\n");
			return;
		case "test/oversized":
			send({ method: "test/oversized", params: { text: "x".repeat(oversizedBytes) } });
			return;
		case "test/stderr": {
			const bearer = ["fixture", "bearer", "value"].join("-");
			const access = ["fixture", "access", "value"].join("-");
			const refresh = ["fixture", "refresh", "value"].join("-");
			const apiKey = ["sk", "fixture_not_a_secret_123456789"].join("-");
			process.stderr.write(`Authorization: Bearer ${bearer}\n`);
			process.stderr.write(`access_token=${access} refresh_token=${refresh}\n`);
			process.stderr.write(`api_key=${apiKey}\n`);
			sendResult(message.id, { ok: true });
			return;
		}
		case "test/crash":
			setTimeout(() => process.exit(23), 5);
			return;
		case "test/prepareBackpressure":
			sendResult(message.id, { pausedForMs: 200 });
			process.stdin.pause();
			setTimeout(() => process.stdin.resume(), 200);
			return;
		default:
			sendError(message.id, -32601, `Unknown method ${message.method}`);
	}
}

function handleResponse(message) {
	const key = `${typeof message.id}:${String(message.id)}`;
	const triggerId = awaitingServerResponse.get(key);
	if (triggerId === undefined) return;
	awaitingServerResponse.delete(key);
	if (message.error) sendError(triggerId, -32000, "Client rejected server request", message.error);
	else sendResult(triggerId, { clientResult: message.result });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (message && typeof message === "object" && Object.hasOwn(message, "jsonrpc")) jsonrpcSeen = true;
	if (message && typeof message === "object" && typeof message.method === "string") {
		if (Object.hasOwn(message, "id")) void handleRequest(message);
		else {
			sequence.push(message.method);
			if (message.method === "initialized") initialized = true;
		}
		return;
	}
	if (message && typeof message === "object" && Object.hasOwn(message, "id")) handleResponse(message);
});

input.on("close", () => {
	if (scenario === "ignore-shutdown") return;
	process.exit(0);
});
