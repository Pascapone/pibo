export const NODE_RUNTIME_WORKER_SOURCE = String.raw`
const vm = require("node:vm");
const util = require("node:util");
const fs = require("node:fs");
const childProcess = require("node:child_process");
const { AsyncLocalStorage } = require("node:async_hooks");

const outputStorage = new AsyncLocalStorage();

function bounded(value, maxBytes = 8192) {
	const text = String(value);
	const bytes = Buffer.byteLength(text, "utf8");
	if (bytes <= maxBytes) return text;
	return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8") + "\n...<truncated>";
}

function safeInspect(value, maxBytes = 4096) {
	try {
		return bounded(util.inspect(value, { depth: 3, maxArrayLength: 50, breakLength: 120 }), maxBytes);
	} catch (error) {
		return "<inspect failed: " + (error?.name || "Error") + ": " + (error?.message || String(error)) + ">";
	}
}

function summarize(value, maxBytes = 4096) {
	const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
	const result = { type, repr: safeInspect(value, maxBytes) };
	try {
		if (value != null && typeof value.length === "number") result.length = value.length;
		if (Array.isArray(value)) result.length = value.length;
		if (value && typeof value === "object") {
			const keys = Object.keys(value).slice(0, 50);
			if (keys.length > 0) result.keys = keys;
		}
	} catch {}
	return result;
}

function errorSummary(error) {
	const stack = error && error.stack ? String(error.stack) : String(error);
	const out = {
		name: error && error.name ? String(error.name) : "Error",
		message: error && error.message ? String(error.message) : String(error),
		stack,
	};
	const match = stack.match(/<pibo-runtime>:(\d+):(\d+)/) || stack.match(/evalmachine\.<anonymous>:(\d+):(\d+)/);
	if (match) {
		out.line = Number(match[1]);
		out.column = Number(match[2]);
	}
	return out;
}

function appendOutput(output, stream, chunk) {
	if (output) output[stream] += String(chunk);
	else if (stream === "stdout") process.stdout.write(String(chunk));
	else process.stderr.write(String(chunk));
}

function appendStdout(chunk) {
	appendOutput(outputStorage.getStore(), "stdout", chunk);
}

function appendStderr(chunk) {
	appendOutput(outputStorage.getStore(), "stderr", chunk);
}

function routedStdio(stdio) {
	if (stdio === "inherit") {
		return { stdio: ["inherit", "pipe", "pipe"], stdout: true, stderr: true };
	}
	if (!Array.isArray(stdio)) return undefined;
	const next = [...stdio];
	const stdout = next[1] === "inherit" || next[1] === 1;
	const stderr = next[2] === "inherit" || next[2] === 2;
	if (!stdout && !stderr) return undefined;
	if (stdout) next[1] = "pipe";
	if (stderr) next[2] = "pipe";
	return { stdio: next, stdout, stderr };
}

function captureSpawnedOutput(child, output, route) {
	if (route.stdout && child.stdout) child.stdout.on("data", (chunk) => appendOutput(output, "stdout", chunk));
	if (route.stderr && child.stderr) child.stderr.on("data", (chunk) => appendOutput(output, "stderr", chunk));
	if (child.spawnargs && child.spawnargs.length > 0 && child.stdout && typeof child.stdout.unref === "function") child.stdout.unref();
	if (child.spawnargs && child.spawnargs.length > 0 && child.stderr && typeof child.stderr.unref === "function") child.stderr.unref();
}

function routedSpawn(command, args, options) {
	const hasArgs = Array.isArray(args);
	const actualArgs = hasArgs ? args : [];
	const actualOptions = (hasArgs ? options : args) || {};
	const output = outputStorage.getStore();
	const route = output ? routedStdio(actualOptions.stdio) : undefined;
	if (!route) return hasArgs ? childProcess.spawn(command, actualArgs, actualOptions) : childProcess.spawn(command, actualOptions);
	const child = childProcess.spawn(command, actualArgs, { ...actualOptions, stdio: route.stdio });
	captureSpawnedOutput(child, output, route);
	return child;
}

function routedSpawnSync(command, args, options) {
	const hasArgs = Array.isArray(args);
	const actualArgs = hasArgs ? args : [];
	const actualOptions = (hasArgs ? options : args) || {};
	const output = outputStorage.getStore();
	const route = output ? routedStdio(actualOptions.stdio) : undefined;
	if (!route) return hasArgs ? childProcess.spawnSync(command, actualArgs, actualOptions) : childProcess.spawnSync(command, actualOptions);
	const result = childProcess.spawnSync(command, actualArgs, { ...actualOptions, stdio: route.stdio });
	if (route.stdout && result.stdout != null) appendOutput(output, "stdout", result.stdout);
	if (route.stderr && result.stderr != null) appendOutput(output, "stderr", result.stderr);
	if (route.stdout) {
		result.stdout = null;
		if (result.output) result.output[1] = null;
	}
	if (route.stderr) {
		result.stderr = null;
		if (result.output) result.output[2] = null;
	}
	return result;
}

const childProcessProxy = new Proxy(childProcess, {
	get(target, prop, receiver) {
		if (prop === "spawn") return routedSpawn;
		if (prop === "spawnSync") return routedSpawnSync;
		return Reflect.get(target, prop, receiver);
	},
});

function runtimeRequire(specifier) {
	if (specifier === "child_process" || specifier === "node:child_process") return childProcessProxy;
	return require(specifier);
}
runtimeRequire.resolve = require.resolve;
runtimeRequire.cache = require.cache;
runtimeRequire.extensions = require.extensions;
runtimeRequire.main = require.main;

const processProxy = new Proxy(process, {
	get(target, prop, receiver) {
		if (prop === "stdout") return { write: (chunk) => { appendStdout(chunk); return true; } };
		if (prop === "stderr") return { write: (chunk) => { appendStderr(chunk); return true; } };
		return Reflect.get(target, prop, receiver);
	},
});

const consoleProxy = {
	log: (...args) => appendStdout(util.format(...args) + "\n"),
	info: (...args) => appendStdout(util.format(...args) + "\n"),
	debug: (...args) => appendStdout(util.format(...args) + "\n"),
	warn: (...args) => appendStderr(util.format(...args) + "\n"),
	error: (...args) => appendStderr(util.format(...args) + "\n"),
	dir: (value, options) => appendStdout(util.inspect(value, options) + "\n"),
};

const context = vm.createContext({
	console: consoleProxy,
	require: runtimeRequire,
	process: processProxy,
	Buffer,
	URL,
	URLSearchParams,
	TextEncoder,
	TextDecoder,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	setImmediate,
	clearImmediate,
	queueMicrotask,
});
context.global = context;
context.globalThis = context;

async function execute(req) {
	const mode = req.mode || "exec";
	const code = req.code || "";
	const output = { stdout: "", stderr: "" };
	return await outputStorage.run(output, async () => {
		try {
			const value = await (async () => {
				if (mode === "eval") {
					return await vm.runInContext(code, context, { filename: "<pibo-runtime>", timeout: Number(req.timeoutMs || 30000) });
				}
				const result = vm.runInContext(code, context, { filename: "<pibo-runtime>", timeout: Number(req.timeoutMs || 30000) });
				if (result && typeof result.then === "function") await result;
				return undefined;
			})();
			return {
				id: req.id,
				status: "ok",
				stdout: output.stdout,
				stderr: output.stderr,
				result: value === undefined ? null : summarize(value),
			};
		} catch (error) {
			return {
				id: req.id,
				status: "error",
				stdout: output.stdout,
				stderr: output.stderr,
				error: errorSummary(error),
			};
		}
	});
}

async function inspectValue(req) {
	const expression = req.expression || "";
	const what = req.what || "summary";
	const maxBytes = Number(req.maxBytes || 8192);
	try {
		const value = await vm.runInContext(expression, context, { filename: "<pibo-runtime>", timeout: 15000 });
		const result = { id: req.id, status: "ok" };
		if (what === "summary" || what === "all") result.summary = summarize(value, maxBytes);
		if (what === "signature" || what === "all") result.signature = typeof value === "function" ? bounded(value.toString().split("{")[0].trim(), maxBytes) : "<signature unavailable>";
		if (what === "members" || what === "all") {
			const members = new Set();
			for (const key of Reflect.ownKeys(Object(value))) members.add(String(key));
			const proto = value == null ? undefined : Object.getPrototypeOf(value);
			if (proto) for (const key of Reflect.ownKeys(proto)) members.add(String(key));
			result.members = [...members].slice(0, 200);
		}
		if (what === "source" || what === "all") result.source = typeof value === "function" ? bounded(value.toString(), maxBytes) : "<source unavailable>";
		if (what === "doc" || what === "all") result.doc = "";
		return result;
	} catch (error) {
		return { id: req.id, status: "error", error: errorSummary(error) };
	}
}

function listVars(req) {
	const includePrivate = Boolean(req.includePrivate);
	const maxItems = Number(req.maxItems || 100);
	const maxBytes = Number(req.maxBytes || 4096);
	const hidden = new Set(["console", "require", "process", "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "global", "globalThis"]);
	const variables = [];
	for (const name of Object.keys(context).sort()) {
		if (hidden.has(name)) continue;
		if (!includePrivate && name.startsWith("_")) continue;
		variables.push({ name, summary: summarize(context[name], maxBytes) });
		if (variables.length >= maxItems) break;
	}
	return { id: req.id, status: "ok", variables, truncated: variables.length >= maxItems };
}

function writeResponse(resp) {
	fs.writeSync(3, JSON.stringify(resp) + "\n");
}

async function handle(req) {
	if (req.type === "exec") return await execute(req);
	if (req.type === "inspect") return await inspectValue(req);
	if (req.type === "vars") return listVars(req);
	if (req.type === "shutdown") return { id: req.id, status: "ok", shutdown: true };
	return { id: req.id, status: "error", error: { name: "RuntimeProtocolError", message: "unknown request type " + req.type } };
}

async function main() {
	writeResponse({ id: "ready", status: "ready" });
	let buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", async (chunk) => {
		buffer += chunk;
		let index;
		while ((index = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			if (!line.trim()) continue;
			let req;
			try {
				req = JSON.parse(line);
				const resp = await handle(req);
				writeResponse(resp);
				if (resp.shutdown) process.exit(0);
			} catch (error) {
				writeResponse({ id: req?.id, status: "error", error: errorSummary(error) });
			}
		}
	});
}

main();
`;
