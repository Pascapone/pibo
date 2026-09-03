import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";
import type { Readable } from "node:stream";
import { PYTHON_RUNTIME_WORKER_SOURCE } from "./python-worker-source.js";
import type {
	RuntimeBackend,
	RuntimeErrorSummary,
	RuntimeExecInput,
	RuntimeExecResult,
	RuntimeInspectInput,
	RuntimeInspectResult,
	RuntimeStartInput,
	RuntimeVarsInput,
	RuntimeVarsResult,
} from "./types.js";

type Pending = {
	requestType: string;
	resolve(value: WorkerResponse): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
};

type WorkerResponse = {
	id?: string;
	status?: string;
	stdout?: string;
	stderr?: string;
	result?: unknown;
	error?: RuntimeErrorSummary;
	summary?: unknown;
	signature?: string;
	members?: string[];
	source?: string;
	doc?: string;
	variables?: unknown;
	truncated?: boolean;
};

function resolveCwd(baseCwd: string, cwd?: string): string {
	if (!cwd || cwd.trim().length === 0) return baseCwd;
	return isAbsolute(cwd) ? cwd : resolve(baseCwd, cwd);
}

function errorSummary(error: unknown, name = "RuntimeWorkerError"): RuntimeErrorSummary {
	return error instanceof Error
		? { name: error.name || name, message: error.message, stack: error.stack }
		: { name, message: String(error) };
}

function asErrorSummary(value: unknown): RuntimeErrorSummary | undefined {
	if (!value || typeof value !== "object") return undefined;
	const error = value as Record<string, unknown>;
	return {
		name: typeof error.name === "string" ? error.name : "RuntimeError",
		message: typeof error.message === "string" ? error.message : "Runtime error",
		line: typeof error.line === "number" ? error.line : undefined,
		column: typeof error.column === "number" ? error.column : undefined,
		traceback: typeof error.traceback === "string" ? error.traceback : undefined,
		stack: typeof error.stack === "string" ? error.stack : undefined,
	};
}

export class PythonRuntimeBackend implements RuntimeBackend {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<string, Pending>();
	private requestCounter = 0;
	private alive = true;
	private diagnostics = "";
	private readyPromise: Promise<void>;
	private readyResolve!: () => void;
	private readyReject!: (error: Error) => void;

	private constructor(
		private readonly cwd: string,
		private readonly executable: string,
		args: string[],
		env?: Record<string, string>,
	) {
		this.readyPromise = new Promise((resolveReady, rejectReady) => {
			this.readyResolve = resolveReady;
			this.readyReject = rejectReady;
		});
		this.child = spawn(executable, [...args, "-u", "-c", PYTHON_RUNTIME_WORKER_SOURCE], {
			cwd,
			env: { ...process.env, ...(env ?? {}) },
			stdio: ["pipe", "pipe", "pipe", "pipe"],
		});
		const protocol = this.child.stdio[3];
		if (!protocol) throw new Error("Python runtime protocol pipe was not created");
		const responses = createInterface({ input: protocol as Readable });
		responses.on("line", (line) => this.handleLine(line));
		this.child.stdout.on("data", (chunk) => {
			this.diagnostics += String(chunk);
		});
		this.child.stderr.on("data", (chunk) => {
			this.diagnostics += String(chunk);
		});
		this.child.stdin.on("error", (error) => {
			this.alive = false;
			this.rejectAll(error);
		});
		this.child.once("error", (error) => {
			this.alive = false;
			this.readyReject(error);
			this.rejectAll(error);
		});
		this.child.once("close", (code, signal) => {
			this.alive = false;
			const error = new Error(`Python runtime worker exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`);
			this.readyReject(error);
			this.rejectAll(error);
		});
	}

	static async start(baseCwd: string, input: RuntimeStartInput): Promise<PythonRuntimeBackend> {
		const target = input.target ?? {};
		const backend = new PythonRuntimeBackend(
			resolveCwd(baseCwd, target.cwd),
			target.executable ?? (process.platform === "win32" ? "python" : "python3"),
			target.args ?? [],
			target.env,
		);
		try {
			await backend.waitReady(input.timeoutMs ?? 10000);
			return backend;
		} catch (error) {
			await backend.close(true).catch(() => undefined);
			throw error;
		}
	}

	isAlive(): boolean {
		return this.alive;
	}

	isBusy(): boolean {
		return [...this.pending.values()].some((pending) => pending.requestType === "exec");
	}

	getRecord() {
		return { pid: this.child.pid, cwd: this.cwd, executable: this.executable };
	}

	async exec(input: Omit<RuntimeExecInput, "sessionId" | "closeOnSuccess">): Promise<RuntimeExecResult> {
		const started = Date.now();
		try {
			const response = await this.request("exec", {
				code: input.code,
				mode: input.mode ?? "exec",
			}, input.timeoutMs ?? 30000);
			return {
				status: normalizeExecStatus(response.status),
				sessionId: "",
				stdout: response.stdout ?? "",
				stderr: response.stderr ?? "",
				result: response.result as RuntimeExecResult["result"],
				error: asErrorSummary(response.error),
				durationMs: Date.now() - started,
			};
		} catch (error) {
			return {
				status: error instanceof TimeoutError ? "timeout" : "failed",
				sessionId: "",
				durationMs: Date.now() - started,
				error: errorSummary(error),
			};
		}
	}

	async inspect(input: Omit<RuntimeInspectInput, "sessionId">): Promise<RuntimeInspectResult> {
		try {
			const response = await this.request("inspect", input, 15000);
			return {
				status: response.status === "ok" ? "ok" : "error",
				sessionId: "",
				summary: response.summary as RuntimeInspectResult["summary"],
				signature: response.signature,
				members: response.members,
				source: response.source,
				doc: response.doc,
				error: asErrorSummary(response.error),
			};
		} catch (error) {
			return { status: "failed", sessionId: "", error: errorSummary(error) };
		}
	}

	async vars(input: Omit<RuntimeVarsInput, "sessionId">): Promise<RuntimeVarsResult> {
		try {
			const response = await this.request("vars", input, 15000);
			return {
				status: response.status === "ok" ? "ok" : "failed",
				sessionId: "",
				variables: Array.isArray(response.variables) ? response.variables as RuntimeVarsResult["variables"] : [],
				truncated: response.truncated,
				error: asErrorSummary(response.error),
			};
		} catch (error) {
			return { status: "failed", sessionId: "", variables: [], error: errorSummary(error) };
		}
	}

	async interrupt() {
		if (!this.isAlive()) return { status: "failed" as const, sessionId: "", message: "Runtime worker is not alive" };
		if (!this.child.kill("SIGINT")) return { status: "failed" as const, sessionId: "", message: "Runtime worker is not alive" };
		return { status: "ok" as const, sessionId: "", message: "Sent SIGINT to runtime worker" };
	}

	async close(force = false): Promise<void> {
		if (!this.isAlive()) return;
		const closed = new Promise<void>((resolve) => this.child.once("close", () => resolve()));
		if (force) {
			this.child.kill("SIGKILL");
			await closed;
			return;
		}
		try {
			await this.request("shutdown", {}, 1000);
		} catch {
			this.child.kill("SIGTERM");
		}
		await closed;
	}

	private waitReady(timeoutMs: number): Promise<void> {
		return new Promise((resolveWait, rejectWait) => {
			const timer = setTimeout(() => rejectWait(new Error(`Timed out waiting for Python runtime worker. ${this.diagnostics}`)), timeoutMs);
			this.readyPromise.then(
				() => {
					clearTimeout(timer);
					resolveWait();
				},
				(error) => {
					clearTimeout(timer);
					rejectWait(error);
				},
			);
		});
	}

	private request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerResponse> {
		if (!this.isAlive()) return Promise.reject(new Error("Runtime worker is not alive"));
		const id = `req_${++this.requestCounter}`;
		return new Promise((resolveRequest, rejectRequest) => {
			const timer = setTimeout(() => {
				if (!this.pending.has(id)) return;
				rejectRequest(new TimeoutError(`Runtime request ${type} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { requestType: type, resolve: resolveRequest, reject: rejectRequest, timer });
			this.child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`);
		});
	}

	private handleLine(line: string): void {
		let response: WorkerResponse;
		try {
			response = JSON.parse(line) as WorkerResponse;
		} catch {
			this.alive = false;
			this.rejectAll(new Error(`Invalid runtime worker protocol line: ${line}`));
			this.child.kill("SIGTERM");
			return;
		}
		if (response.id === "ready" && response.status === "ready") {
			this.readyResolve();
			return;
		}
		const id = typeof response.id === "string" ? response.id : undefined;
		if (!id) return;
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.resolve(response);
	}

	private rejectAll(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			clearTimeout(pending.timer);
			pending.reject(error);
		}
	}
}

class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeTimeoutError";
	}
}

function normalizeExecStatus(status: unknown): RuntimeExecResult["status"] {
	if (status === "ok" || status === "error" || status === "interrupted") return status;
	return "failed";
}
