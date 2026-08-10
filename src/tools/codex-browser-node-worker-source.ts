export const CODEX_BROWSER_NODE_WORKER_SOURCE = String.raw`
const vm = require("node:vm");
const util = require("node:util");
const { Parser } = require(process.argv[1]);
const walk = require(process.argv[2]);

let context;
let currentOutput = null;
let browserRequestCounter = 0;
let timerCounter = 0;
const pendingBrowserRequests = new Map();
const timers = new Map();

function hardenFunction(fn) {
	Object.setPrototypeOf(fn, null);
	return Object.freeze(fn);
}

function nullObject(properties) {
	return Object.freeze(Object.assign(Object.create(null), properties));
}

function bounded(value, maxBytes = 8192) {
	const text = String(value);
	const bytes = Buffer.byteLength(text, "utf8");
	if (bytes <= maxBytes) return text;
	return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8") + "\n...<truncated>";
}

function safeInspect(value, maxBytes = 4096) {
	try {
		return bounded(util.inspect(value, { depth: 4, maxArrayLength: 100, breakLength: 120 }), maxBytes);
	} catch (error) {
		return "<inspect failed: " + (error?.name || "Error") + ": " + (error?.message || String(error)) + ">";
	}
}

function summarize(value, maxBytes = 4096) {
	const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
	const result = { type, repr: safeInspect(value, maxBytes) };
	try {
		if (value != null && typeof value.length === "number") result.length = value.length;
		if (value && typeof value === "object") {
			const keys = Object.keys(value).slice(0, 100);
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
	const match = stack.match(/<node_repl>:(\d+):(\d+)/) || stack.match(/evalmachine\.<anonymous>:(\d+):(\d+)/);
	if (match) {
		out.line = Number(match[1]);
		out.column = Number(match[2]);
	}
	return out;
}

function appendStdout(chunk) {
	if (currentOutput) currentOutput.stdout += String(chunk);
}

function appendStderr(chunk) {
	if (currentOutput) currentOutput.stderr += String(chunk);
}

function requestBrowser(operation, input = {}) {
	const id = "browser_" + (++browserRequestCounter);
	const promise = new Promise((resolve, reject) => {
		pendingBrowserRequests.set(id, { resolve, reject });
		writeMessage({ type: "browser_request", id, operation, input });
	});
	return nullObject({
		then: hardenFunction((resolve, reject) => promise.then(resolve, reject)),
	});
}

function createTimer(repeat, callback, delay, args) {
	if (typeof callback !== "function") throw new TypeError("Timer callback must be a function");
	const id = ++timerCounter;
	const invoke = () => callback(...args);
	const timer = repeat ? setInterval(invoke, delay) : setTimeout(() => {
		timers.delete(id);
		invoke();
	}, delay);
	timers.set(id, { repeat, timer });
	return id;
}

function clearTimer(id) {
	const entry = timers.get(id);
	if (!entry) return;
	timers.delete(id);
	if (entry.repeat) clearInterval(entry.timer);
	else clearTimeout(entry.timer);
}

function clearAllTimers() {
	for (const id of [...timers.keys()]) clearTimer(id);
}

function createContext() {
	clearAllTimers();
	const consoleProxy = nullObject({
		log: hardenFunction((...args) => appendStdout(util.format(...args) + "\n")),
		info: hardenFunction((...args) => appendStdout(util.format(...args) + "\n")),
		debug: hardenFunction((...args) => appendStdout(util.format(...args) + "\n")),
		warn: hardenFunction((...args) => appendStderr(util.format(...args) + "\n")),
		error: hardenFunction((...args) => appendStderr(util.format(...args) + "\n")),
		dir: hardenFunction((value, options) => appendStdout(util.inspect(value, options) + "\n")),
	});
	const browser = nullObject({
		openTabs: hardenFunction(() => requestBrowser("open_tabs")),
		use: hardenFunction((action, params = {}) => {
			const input = action && typeof action === "object" ? action : { ...params, action };
			return requestBrowser("use", input);
		}),
	});
	const sandbox = Object.assign(Object.create(null), {
		console: consoleProxy,
		browser,
		setTimeout: hardenFunction((callback, delay = 0, ...args) => createTimer(false, callback, delay, args)),
		clearTimeout: hardenFunction((id) => clearTimer(id)),
		setInterval: hardenFunction((callback, delay = 0, ...args) => createTimer(true, callback, delay, args)),
		clearInterval: hardenFunction((id) => clearTimer(id)),
		setImmediate: hardenFunction((callback, ...args) => createTimer(false, callback, 0, args)),
		clearImmediate: hardenFunction((id) => clearTimer(id)),
		queueMicrotask: hardenFunction((callback) => { Promise.resolve().then(callback); }),
	});
	context = vm.createContext(sandbox, {
		name: "node_repl",
		codeGeneration: { strings: false, wasm: false },
	});
	context.global = context;
	context.globalThis = context;
}

async function withTimeout(value, timeoutMs) {
	if (!value || typeof value.then !== "function") return value;
	let timer;
	try {
		return await Promise.race([
			value,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("JavaScript execution timed out after " + timeoutMs + "ms")), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// Adapt Node REPL's top-level-await rewrite to the restricted vm context.
function isTopLevelDeclaration(state) {
	return state.ancestors[state.ancestors.length - 2] === state.body;
}

const noopVisitor = () => {};
const topLevelAwaitVisitorsWithoutAncestors = {
	ClassDeclaration(node, state, c) {
		if (isTopLevelDeclaration(state)) {
			state.prepend(node, node.id.name + "=");
			state.hoistedDeclarationStatements.push("let " + node.id.name + "; ");
		}
		walk.base.ClassDeclaration(node, state, c);
	},
	ForOfStatement(node, state, c) {
		if (node.await === true) state.containsAwait = true;
		walk.base.ForOfStatement(node, state, c);
	},
	FunctionDeclaration(node, state) {
		state.prepend(node, "this." + node.id.name + " = " + node.id.name + "; ");
		state.hoistedDeclarationStatements.push("var " + node.id.name + "; ");
	},
	FunctionExpression: noopVisitor,
	ArrowFunctionExpression: noopVisitor,
	MethodDefinition: noopVisitor,
	AwaitExpression(node, state, c) {
		state.containsAwait = true;
		walk.base.AwaitExpression(node, state, c);
	},
	ReturnStatement(node, state, c) {
		state.containsReturn = true;
		walk.base.ReturnStatement(node, state, c);
	},
	VariableDeclaration(node, state, c) {
		const variableKind = node.kind;
		const parent = state.ancestors[state.ancestors.length - 2];
		const isIterableForDeclaration = parent.type === "ForOfStatement" || parent.type === "ForInStatement";
		if (variableKind === "var" || isTopLevelDeclaration(state)) {
			state.replace(
				node.start,
				node.start + variableKind.length + (isIterableForDeclaration ? 1 : 0),
				variableKind === "var" && isIterableForDeclaration ? "" : "void" + (node.declarations.length === 1 ? "" : " ("),
			);
			if (!isIterableForDeclaration) {
				for (const declaration of node.declarations) {
					state.prepend(declaration, "(");
					state.append(declaration, declaration.init ? ")" : "=undefined)");
				}
				if (node.declarations.length !== 1) state.append(node.declarations[node.declarations.length - 1], ")");
			}

			const variableIdentifiersToHoist = { var: [], let: [] };
			function registerVariableDeclarationIdentifiers(pattern) {
				if (!pattern) return;
				if (pattern.type === "Identifier") {
					variableIdentifiersToHoist[variableKind === "var" ? "var" : "let"].push(pattern.name);
					return;
				}
				if (pattern.type === "ObjectPattern") {
					for (const property of pattern.properties) registerVariableDeclarationIdentifiers(property.value || property.argument);
					return;
				}
				if (pattern.type === "ArrayPattern") {
					for (const element of pattern.elements) registerVariableDeclarationIdentifiers(element);
				}
			}
			for (const declaration of node.declarations) registerVariableDeclarationIdentifiers(declaration.id);
			for (const kind of ["var", "let"]) {
				const identifiers = variableIdentifiersToHoist[kind];
				if (identifiers.length > 0) state.hoistedDeclarationStatements.push(kind + " " + identifiers.join(", ") + "; ");
			}
		}
		walk.base.VariableDeclaration(node, state, c);
	},
};

const topLevelAwaitVisitors = {};
for (const nodeType of Object.keys(walk.base)) {
	const callback = topLevelAwaitVisitorsWithoutAncestors[nodeType] || walk.base[nodeType];
	topLevelAwaitVisitors[nodeType] = (node, state, c) => {
		const isNew = node !== state.ancestors[state.ancestors.length - 1];
		if (isNew) state.ancestors.push(node);
		callback(node, state, c);
		if (isNew) state.ancestors.pop();
	};
}

function processTopLevelAwait(source) {
	const wrapPrefix = "(async () => { ";
	const wrapped = wrapPrefix + source + " })()";
	const chars = wrapped.split("");
	let root;
	try {
		root = Parser.parse(wrapped, { ecmaVersion: "latest" });
	} catch {
		return null;
	}
	const body = root.body[0].expression.callee.body;
	const state = {
		body,
		ancestors: [],
		hoistedDeclarationStatements: [],
		containsAwait: false,
		containsReturn: false,
		replace(from, to, text) {
			for (let index = from; index < to; index += 1) chars[index] = "";
			if (from === to) text += chars[from];
			chars[from] = text;
		},
		prepend(node, text) {
			chars[node.start] = text + chars[node.start];
		},
		append(node, text) {
			chars[node.end - 1] += text;
		},
	};
	walk.recursive(body, state, topLevelAwaitVisitors);
	if (!state.containsAwait || state.containsReturn) return null;

	for (let index = body.body.length - 1; index >= 0; index -= 1) {
		const node = body.body[index];
		if (node.type === "EmptyStatement") continue;
		if (node.type === "ExpressionStatement") {
			state.prepend(node.expression, "{ value: (");
			state.prepend(node, "return ");
			state.append(node.expression, ") }");
		}
		break;
	}
	return state.hoistedDeclarationStatements.join("") + chars.join("");
}

async function execute(req) {
	const output = { stdout: "", stderr: "" };
	currentOutput = output;
	try {
		const timeoutMs = Number(req.timeoutMs || 30000);
		const code = req.code || "";
		let transformedTopLevelAwait = false;
		let value;
		try {
			value = vm.runInContext(code, context, {
				filename: "<node_repl>",
				timeout: timeoutMs,
			});
		} catch (error) {
			const transformed = error && error.name === "SyntaxError" ? processTopLevelAwait(code) : null;
			if (!transformed) throw error;
			transformedTopLevelAwait = true;
			value = vm.runInContext(transformed, context, {
				filename: "<node_repl>",
				timeout: timeoutMs,
			});
		}
		const settled = await withTimeout(value, timeoutMs);
		const result = transformedTopLevelAwait && settled && Object.prototype.hasOwnProperty.call(settled, "value")
			? settled.value
			: settled;
		return {
			type: "response",
			id: req.id,
			status: "ok",
			stdout: output.stdout,
			stderr: output.stderr,
			result: result === undefined ? null : summarize(result),
		};
	} catch (error) {
		return {
			type: "response",
			id: req.id,
			status: "error",
			stdout: output.stdout,
			stderr: output.stderr,
			error: errorSummary(error),
		};
	} finally {
		currentOutput = null;
	}
}

function reset(req) {
	createContext();
	return { type: "response", id: req.id, status: "ok", reset: true };
}

function handleBrowserResponse(req) {
	const pending = pendingBrowserRequests.get(req.id);
	if (!pending) return;
	pendingBrowserRequests.delete(req.id);
	if (req.error) {
		const error = new Error(req.error.message || String(req.error));
		error.name = req.error.name || "BrowserUseError";
		pending.reject(error);
		return;
	}
	const json = JSON.stringify(req.result === undefined ? null : req.result);
	const contextValue = vm.runInContext("JSON.parse(" + JSON.stringify(json) + ")", context);
	pending.resolve(contextValue);
}

function writeMessage(message) {
	process.stdout.write(JSON.stringify(message) + "\n");
}

function handleRequest(req) {
	if (req.type === "browser_response") {
		handleBrowserResponse(req);
		return;
	}
	if (req.type === "exec") {
		void execute(req).then(writeMessage);
		return;
	}
	if (req.type === "reset") {
		writeMessage(reset(req));
		return;
	}
	if (req.type === "shutdown") {
		writeMessage({ type: "response", id: req.id, status: "ok", shutdown: true });
		process.exit(0);
		return;
	}
	writeMessage({ type: "response", id: req.id, status: "error", error: { name: "NodeReplProtocolError", message: "Unknown request type " + req.type } });
}

createContext();
writeMessage({ type: "ready", id: "ready", status: "ready" });
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (!line.trim()) continue;
		try {
			handleRequest(JSON.parse(line));
		} catch (error) {
			writeMessage({ type: "response", status: "error", error: errorSummary(error) });
		}
	}
});
`;
