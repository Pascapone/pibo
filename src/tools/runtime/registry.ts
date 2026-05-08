import { randomUUID } from "node:crypto";
import type {
	RuntimeBackend,
	RuntimeCloseInput,
	RuntimeCloseResult,
	RuntimeExecInput,
	RuntimeExecResult,
	RuntimeHistoryEntry,
	RuntimeInspectInput,
	RuntimeInspectResult,
	RuntimeInterruptInput,
	RuntimeInterruptResult,
	RuntimeListResult,
	RuntimeSessionRecord,
	RuntimeSessionStatus,
	RuntimeStartInput,
	RuntimeStartResult,
	RuntimeVarsInput,
	RuntimeVarsResult,
} from "./types.js";
import { PythonRuntimeBackend } from "./python-backend.js";

export type RuntimeSessionRegistryOptions = {
	cwd: string;
	maxHistoryEntries?: number;
};

type RuntimeSession = RuntimeSessionRecord & {
	ownerPiboSessionId: string;
	backend: RuntimeBackend;
	history: RuntimeHistoryEntry[];
};

function nowIso(): string {
	return new Date().toISOString();
}

function notFoundExec(sessionId: string): RuntimeExecResult {
	return {
		status: "not_found",
		sessionId,
		durationMs: 0,
		error: { name: "RuntimeNotFound", message: `Runtime session "${sessionId}" was not found.` },
	};
}

function notFoundInspect(sessionId: string): RuntimeInspectResult {
	return {
		status: "not_found",
		sessionId,
		error: { name: "RuntimeNotFound", message: `Runtime session "${sessionId}" was not found.` },
	};
}

function notFoundVars(sessionId: string): RuntimeVarsResult {
	return {
		status: "not_found",
		sessionId,
		variables: [],
		error: { name: "RuntimeNotFound", message: `Runtime session "${sessionId}" was not found.` },
	};
}

export class RuntimeSessionRegistry {
	private readonly sessions = new Map<string, RuntimeSession>();
	private readonly maxHistoryEntries: number;

	constructor(private readonly options: RuntimeSessionRegistryOptions) {
		this.maxHistoryEntries = options.maxHistoryEntries ?? 100;
	}

	async start(ownerPiboSessionId: string, input: RuntimeStartInput): Promise<RuntimeStartResult> {
		if (input.runtime !== "python") {
			return {
				status: "error",
				error: { name: "UnsupportedRuntime", message: `Runtime "${input.runtime}" is not implemented yet.` },
			};
		}
		if (input.target?.type && input.target.type !== "local") {
			return {
				status: "error",
				error: { name: "UnsupportedRuntimeTarget", message: `Runtime target "${input.target.type}" is not implemented yet.` },
			};
		}
		const sessionId = `rt_python_${randomUUID().slice(0, 8)}`;
		try {
			const backend = await PythonRuntimeBackend.start(this.options.cwd, input);
			const startedAt = nowIso();
			const record = backend.getRecord();
			const session: RuntimeSession = {
				sessionId,
				runtime: "python",
				name: input.name,
				cwd: record.cwd,
				status: "idle",
				startedAt,
				updatedAt: startedAt,
				executionCount: 0,
				pid: record.pid,
				executable: record.executable,
				ownerPiboSessionId,
				backend,
				history: [],
			};
			this.sessions.set(sessionId, session);
			return { status: "ok", sessionId, runtime: "python", name: input.name, ...record, startedAt };
		} catch (error) {
			return {
				status: "failed",
				sessionId,
				runtime: "python",
				error: error instanceof Error
					? { name: error.name, message: error.message, stack: error.stack }
					: { name: "RuntimeStartError", message: String(error) },
			};
		}
	}

	async exec(ownerPiboSessionId: string, input: RuntimeExecInput): Promise<RuntimeExecResult> {
		const session = this.getOwned(ownerPiboSessionId, input.sessionId);
		if (!session) return notFoundExec(input.sessionId);
		if (session.status === "closed" || session.status === "failed") return notFoundExec(input.sessionId);
		if (session.status === "busy") {
			return {
				status: "failed",
				sessionId: input.sessionId,
				runtime: session.runtime,
				durationMs: 0,
				error: { name: "RuntimeBusy", message: `Runtime session "${input.sessionId}" is already busy.` },
			};
		}
		const startedAt = nowIso();
		session.status = "busy";
		session.updatedAt = startedAt;
		const result = await session.backend.exec(input);
		result.sessionId = session.sessionId;
		result.runtime = session.runtime;
		session.executionCount += 1;
		result.executionCount = session.executionCount;
		session.lastExecAt = startedAt;
		session.updatedAt = nowIso();
		if (result.status === "failed" && !session.backend.isAlive()) {
			session.status = "failed";
		} else {
			session.status = "idle";
		}
		this.appendHistory(session, {
			id: randomUUID(),
			startedAt,
			durationMs: result.durationMs,
			mode: input.mode ?? "exec",
			code: input.code,
			status: result.status,
			error: result.error,
		});
		if (input.closeOnSuccess === true && result.status === "ok") {
			await this.close(ownerPiboSessionId, { sessionId: session.sessionId });
			result.autoClosed = true;
		}
		return result;
	}

	async inspect(ownerPiboSessionId: string, input: RuntimeInspectInput): Promise<RuntimeInspectResult> {
		const session = this.getOwned(ownerPiboSessionId, input.sessionId);
		if (!session) return notFoundInspect(input.sessionId);
		const result = await session.backend.inspect(input);
		return { ...result, sessionId: session.sessionId };
	}

	async vars(ownerPiboSessionId: string, input: RuntimeVarsInput): Promise<RuntimeVarsResult> {
		const session = this.getOwned(ownerPiboSessionId, input.sessionId);
		if (!session) return notFoundVars(input.sessionId);
		const result = await session.backend.vars(input);
		return { ...result, sessionId: session.sessionId };
	}

	async interrupt(ownerPiboSessionId: string, input: RuntimeInterruptInput): Promise<RuntimeInterruptResult> {
		const session = this.getOwned(ownerPiboSessionId, input.sessionId);
		if (!session) return { status: "not_found", sessionId: input.sessionId, message: `Runtime session "${input.sessionId}" was not found.` };
		const result = await session.backend.interrupt();
		return { ...result, sessionId: session.sessionId };
	}

	async close(ownerPiboSessionId: string, input: RuntimeCloseInput): Promise<RuntimeCloseResult> {
		const session = this.getOwned(ownerPiboSessionId, input.sessionId);
		if (!session) return { status: "not_found", sessionId: input.sessionId, closed: false, message: `Runtime session "${input.sessionId}" was not found.` };
		try {
			await session.backend.close(input.force);
			session.status = "closed";
			session.updatedAt = nowIso();
			this.sessions.delete(session.sessionId);
			return { status: "ok", sessionId: input.sessionId, closed: true };
		} catch (error) {
			session.status = "failed";
			return {
				status: "failed",
				sessionId: input.sessionId,
				closed: false,
				error: error instanceof Error
					? { name: error.name, message: error.message, stack: error.stack }
					: { name: "RuntimeCloseError", message: String(error) },
			};
		}
	}

	list(ownerPiboSessionId: string): RuntimeListResult {
		return {
			status: "ok",
			sessions: [...this.sessions.values()]
				.filter((session) => session.ownerPiboSessionId === ownerPiboSessionId)
				.map(toRecord),
		};
	}

	async closeOwnerSessions(ownerPiboSessionId: string, options: { force?: boolean } = {}): Promise<void> {
		const sessions = [...this.sessions.values()].filter((session) => session.ownerPiboSessionId === ownerPiboSessionId);
		await Promise.all(sessions.map((session) => this.close(ownerPiboSessionId, { sessionId: session.sessionId, force: options.force })));
	}

	async closeAll(options: { force?: boolean } = {}): Promise<void> {
		const sessions = [...this.sessions.values()];
		await Promise.all(sessions.map((session) => this.close(session.ownerPiboSessionId, { sessionId: session.sessionId, force: options.force })));
	}

	pruneIdle(now = Date.now(), idleTimeoutMs = 30 * 60 * 1000): void {
		for (const session of this.sessions.values()) {
			if (session.status !== "idle") continue;
			if (now - Date.parse(session.updatedAt) > idleTimeoutMs) {
				void this.close(session.ownerPiboSessionId, { sessionId: session.sessionId, force: true });
			}
		}
	}

	createController(ownerPiboSessionId: string) {
		return {
			start: (input: RuntimeStartInput) => this.start(ownerPiboSessionId, input),
			exec: (input: RuntimeExecInput) => this.exec(ownerPiboSessionId, input),
			inspect: (input: RuntimeInspectInput) => this.inspect(ownerPiboSessionId, input),
			vars: (input: RuntimeVarsInput) => this.vars(ownerPiboSessionId, input),
			interrupt: (input: RuntimeInterruptInput) => this.interrupt(ownerPiboSessionId, input),
			close: (input: RuntimeCloseInput) => this.close(ownerPiboSessionId, input),
			list: () => this.list(ownerPiboSessionId),
		};
	}

	private getOwned(ownerPiboSessionId: string, sessionId: string): RuntimeSession | undefined {
		const session = this.sessions.get(sessionId);
		if (!session || session.ownerPiboSessionId !== ownerPiboSessionId) return undefined;
		return session;
	}

	private appendHistory(session: RuntimeSession, entry: RuntimeHistoryEntry): void {
		session.history.push(entry);
		if (session.history.length > this.maxHistoryEntries) session.history.splice(0, session.history.length - this.maxHistoryEntries);
	}
}

function toRecord(session: RuntimeSession): RuntimeSessionRecord {
	return {
		sessionId: session.sessionId,
		runtime: session.runtime,
		name: session.name,
		cwd: session.cwd,
		status: session.status as RuntimeSessionStatus,
		startedAt: session.startedAt,
		updatedAt: session.updatedAt,
		lastExecAt: session.lastExecAt,
		executionCount: session.executionCount,
		pid: session.pid,
		executable: session.executable,
	};
}
