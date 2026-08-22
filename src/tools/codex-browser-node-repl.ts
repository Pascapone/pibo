import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { CODEX_BROWSER_NODE_WORKER_SOURCE } from "./codex-browser-node-worker-source.js";

const packageRequire = createRequire(import.meta.url);
const ACORN_PATH = packageRequire.resolve("acorn");
const ACORN_WALK_PATH = packageRequire.resolve("acorn-walk");

export type CodexBrowserBridge = {
	openTabs(): Promise<unknown>;
	use(input: Record<string, unknown>): Promise<unknown>;
};

export type NodeReplValueSummary = {
	type: string;
	repr: string;
	length?: number;
	keys?: string[];
};

export type NodeReplErrorSummary = {
	name: string;
	message: string;
	line?: number;
	column?: number;
	stack?: string;
};

export type NodeReplExecResult = {
	status: "ok" | "error" | "failed" | "timeout";
	stdout: string;
	stderr: string;
	result?: NodeReplValueSummary | null;
	error?: NodeReplErrorSummary;
	durationMs: number;
	executionCount: number;
};

export type NodeReplResetResult = {
	status: "ok" | "failed";
	reset: boolean;
	error?: NodeReplErrorSummary;
};

type WorkerMessage = {
	type?: string;
	id?: string;
	status?: string;
	operation?: string;
	input?: unknown;
	stdout?: string;
	stderr?: string;
	result?: unknown;
	error?: NodeReplErrorSummary;
	reset?: boolean;
};

type PendingRequest = {
	resolve(value: WorkerMessage): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

function errorSummary(error: unknown, name = "NodeReplError"): NodeReplErrorSummary {
	return error instanceof Error
		? { name: error.name || name, message: error.message, stack: error.stack }
		: { name, message: String(error) };
}

export class CodexBrowserNodeRepl {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<string, PendingRequest>();
	private requestCounter = 0;
	private executionCount = 0;
	private alive = true;
	private busy = false;
	private diagnostics = "";
	private readonly readyPromise: Promise<void>;
	private readyResolve!: () => void;
	private readyReject!: (error: Error) => void;

	private constructor(
		private readonly bridge: CodexBrowserBridge,
		cwd: string,
	) {
		this.readyPromise = new Promise((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});
		this.child = spawn("node", ["-e", CODEX_BROWSER_NODE_WORKER_SOURCE, ACORN_PATH, ACORN_WALK_PATH], {
			cwd,
			env: minimalWorkerEnvironment(),
			stdio: "pipe",
		});
		const stdout = createInterface({ input: this.child.stdout });
		stdout.on("line", (line) => this.handleLine(line));
		this.child.stderr.on("data", (chunk) => {
			this.diagnostics += String(chunk);
		});
		this.child.once("error", (error) => {
			this.alive = false;
			this.readyReject(error);
			this.rejectAll(error);
		});
		this.child.once("close", (code, signal) => {
			this.alive = false;
			const error = new Error(`node_repl worker exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`);
			this.readyReject(error);
			this.rejectAll(error);
		});
	}

	static async start(bridge: CodexBrowserBridge, cwd: string, timeoutMs = 10_000): Promise<CodexBrowserNodeRepl> {
		const repl = new CodexBrowserNodeRepl(bridge, cwd);
		await repl.waitReady(timeoutMs);
		return repl;
	}

	isAlive(): boolean {
		return this.alive && !this.child.killed;
	}

	async exec(code: string, timeoutMs = 30_000): Promise<NodeReplExecResult> {
		const startedAt = Date.now();
		if (this.busy) {
			return {
				status: "failed",
				stdout: "",
				stderr: "",
				durationMs: 0,
				executionCount: this.executionCount,
				error: { name: "NodeReplBusy", message: "node_repl.js is already executing code." },
			};
		}
		this.busy = true;
		try {
			const response = await this.request("exec", { code, timeoutMs }, timeoutMs + 1_000);
			this.executionCount += 1;
			return {
				status: response.status === "ok" ? "ok" : "error",
				stdout: response.stdout ?? "",
				stderr: response.stderr ?? "",
				result: response.result as NodeReplValueSummary | null | undefined,
				error: response.error,
				durationMs: Date.now() - startedAt,
				executionCount: this.executionCount,
			};
		} catch (error) {
			return {
				status: error instanceof NodeReplTimeoutError ? "timeout" : "failed",
				stdout: "",
				stderr: this.diagnostics,
				durationMs: Date.now() - startedAt,
				executionCount: this.executionCount,
				error: errorSummary(error),
			};
		} finally {
			this.busy = false;
		}
	}

	async reset(timeoutMs = 10_000): Promise<NodeReplResetResult> {
		if (this.busy) {
			return {
				status: "failed",
				reset: false,
				error: { name: "NodeReplBusy", message: "node_repl.js cannot reset while code is executing." },
			};
		}
		try {
			const response = await this.request("reset", {}, timeoutMs);
			this.executionCount = 0;
			return { status: response.status === "ok" ? "ok" : "failed", reset: response.reset === true, error: response.error };
		} catch (error) {
			return { status: "failed", reset: false, error: errorSummary(error) };
		}
	}

	async dispose(): Promise<void> {
		if (!this.isAlive()) return;
		this.alive = false;
		this.rejectAll(new Error("node_repl worker was disposed"));
		const closed = new Promise<void>((resolve) => this.child.once("close", () => resolve()));
		this.child.kill("SIGTERM");
		await closed;
	}

	private waitReady(timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`Timed out waiting for node_repl worker. ${this.diagnostics}`)), timeoutMs);
			this.readyPromise.then(
				() => {
					clearTimeout(timer);
					resolve();
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	private request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerMessage> {
		if (!this.isAlive()) return Promise.reject(new Error("node_repl worker is not alive"));
		const id = `request_${++this.requestCounter}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new NodeReplTimeoutError(`node_repl request ${type} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ type, id, ...payload });
		});
	}

	private handleLine(line: string): void {
		let message: WorkerMessage;
		try {
			message = JSON.parse(line) as WorkerMessage;
		} catch {
			this.alive = false;
			this.rejectAll(new Error(`Invalid node_repl worker protocol line: ${line}`));
			this.child.kill("SIGTERM");
			return;
		}
		if (message.type === "ready" && message.status === "ready") {
			this.readyResolve();
			return;
		}
		if (message.type === "browser_request") {
			void this.handleBrowserRequest(message);
			return;
		}
		const id = message.id;
		if (!id) return;
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.resolve(message);
	}

	private async handleBrowserRequest(message: WorkerMessage): Promise<void> {
		if (!message.id) return;
		try {
			let result: unknown;
			if (message.operation === "open_tabs") {
				result = await this.bridge.openTabs();
			} else if (message.operation === "use") {
				if (!message.input || typeof message.input !== "object" || Array.isArray(message.input)) {
					throw new Error("browser.use requires an action object");
				}
				result = await this.bridge.use(message.input as Record<string, unknown>);
			} else {
				throw new Error(`Unknown browser bridge operation ${message.operation ?? ""}`);
			}
			this.write({ type: "browser_response", id: message.id, result });
		} catch (error) {
			this.write({ type: "browser_response", id: message.id, error: errorSummary(error, "BrowserUseError") });
		}
	}

	private write(message: Record<string, unknown>): void {
		if (!this.isAlive()) return;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private rejectAll(error: Error): void {
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}
}

function minimalWorkerEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const name of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"]) {
		if (process.env[name] !== undefined) env[name] = process.env[name];
	}
	return env;
}

class NodeReplTimeoutError extends Error {}
