import { randomUUID } from "node:crypto";

export type CdpRuntimeResult = {
	result?: {
		type?: string;
		value?: unknown;
		description?: string;
	};
	exceptionDetails?: unknown;
};

export type CdpResponse = {
	id?: number;
	result?: unknown;
	error?: { message?: string; code?: number; data?: unknown };
};

export type CdpTarget = {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
};

export type CdpTargetListOptions = {
	cdpUrl?: string;
	timeoutMs?: number;
};

export const DEFAULT_CDP_URL = "http://127.0.0.1:56663";
export const DEFAULT_CDP_TIMEOUT_MS = 2_500;
const CDP_JSON_CHUNK_SIZE = 256 * 1024;

export class CdpClient {
	private nextId = 0;
	private readonly pending = new Map<number, { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private socket?: WebSocket;

	constructor(private readonly webSocketUrl: string) {}

	connect(timeoutMs = 3_000): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(this.webSocketUrl);
			this.socket = socket;
			let settled = false;
			const timer = setTimeout(() => fail(new Error("Timed out connecting to CDP target")), timeoutMs);

			const settle = () => {
				if (settled) return false;
				settled = true;
				clearTimeout(timer);
				return true;
			};
			const succeed = () => {
				if (settle()) resolve();
			};
			const fail = (error: Error) => {
				if (settle()) reject(error);
			};

			socket.addEventListener("open", succeed);
			socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
			socket.addEventListener("error", () => fail(new Error(`CDP WebSocket error connecting to ${this.webSocketUrl}`)));
			socket.addEventListener("close", (event) => {
				const detail = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
				for (const [id, pending] of this.pending) {
					clearTimeout(pending.timer);
					pending.reject(new Error(`CDP target closed during ${pending.method} (${detail})`));
					this.pending.delete(id);
				}
			});
		});
	}

	send(method: string, params?: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP target is not connected");
		const id = ++this.nextId;
		const payload = params ? { id, method, params } : { id, method };
		const promise = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for CDP method ${method}`));
			}, timeoutMs);
			this.pending.set(id, { method, resolve, reject, timer });
		});
		this.socket.send(JSON.stringify(payload));
		return promise;
	}

	private sendDetached(method: string, params?: Record<string, unknown>): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
		const id = ++this.nextId;
		this.socket.send(JSON.stringify(params ? { id, method, params } : { id, method }));
	}

	async evaluate<T>(expression: string, timeoutMs = 10_000): Promise<T> {
		const response = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		}, timeoutMs) as CdpRuntimeResult;
		if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
		return response.result?.value as T;
	}

	async evaluateJson<T>(expression: string, timeoutMs = 10_000): Promise<T> {
		const deadlineMs = Date.now() + timeoutMs;
		const cleanupReserveMs = Math.min(100, Math.max(1, Math.floor(timeoutMs / 10)));
		const transferDeadlineMs = deadlineMs - cleanupReserveMs;
		const storageKey = `__piboCdpJsonResult_${randomUUID()}`;
		const keyLiteral = JSON.stringify(storageKey);
		try {
			const descriptor = await this.evaluate<{ length: number }>(`(async () => {
				const deadlineMs = ${deadlineMs};
				if (Date.now() >= deadlineMs) throw new Error("CDP JSON evaluation exceeded its deadline");
				const state = { cancelled: false, json: undefined, cleanupTimer: undefined };
				Object.defineProperty(globalThis, ${keyLiteral}, { value: state, configurable: true });
				state.cleanupTimer = setTimeout(() => {
					state.cancelled = true;
					if (globalThis[${keyLiteral}] === state) delete globalThis[${keyLiteral}];
				}, Math.max(0, deadlineMs - Date.now()));
				try {
					const value = await (${expression});
					const json = JSON.stringify(value);
					if (typeof json !== "string") throw new Error("CDP evaluation result is not JSON serializable");
					if (Date.now() >= deadlineMs || state.cancelled || globalThis[${keyLiteral}] !== state) throw new Error("CDP JSON evaluation exceeded its deadline");
					state.json = json;
					return { length: json.length };
				} catch (error) {
					state.cancelled = true;
					clearTimeout(state.cleanupTimer);
					if (globalThis[${keyLiteral}] === state) delete globalThis[${keyLiteral}];
					throw error;
				}
			})()`, remainingTime(transferDeadlineMs, "evaluating JSON through CDP"));
			if (!Number.isInteger(descriptor?.length) || descriptor.length < 0) throw new Error("CDP evaluation returned an invalid JSON result length");
			const chunks: string[] = [];
			for (let offset = 0; offset < descriptor.length; offset += CDP_JSON_CHUNK_SIZE) {
				const end = Math.min(descriptor.length, offset + CDP_JSON_CHUNK_SIZE);
				chunks.push(await this.evaluate<string>(`(() => {
					const state = globalThis[${keyLiteral}];
					if (!state || typeof state.json !== "string") throw new Error("CDP JSON result storage is unavailable");
					return state.json.slice(${offset}, ${end});
				})()`, remainingTime(transferDeadlineMs, "retrieving JSON chunks through CDP")));
			}
			return JSON.parse(chunks.join("")) as T;
		} finally {
			const cleanupExpression = `(() => {
				const state = globalThis[${keyLiteral}];
				if (state && typeof state === "object") {
					state.cancelled = true;
					clearTimeout(state.cleanupTimer);
				}
				return delete globalThis[${keyLiteral}];
			})()`;
			const cleanupTimeoutMs = remainingTimeOrZero(deadlineMs);
			if (cleanupTimeoutMs > 0) {
				await this.evaluate(cleanupExpression, cleanupTimeoutMs).catch(() => undefined);
			} else {
				this.sendDetached("Runtime.evaluate", {
					expression: cleanupExpression,
					awaitPromise: true,
					returnByValue: true,
					userGesture: true,
				});
			}
		}
	}

	close(): void {
		try {
			this.socket?.close();
		} catch {
			// ignore close races
		}
	}

	private handleMessage(raw: string): void {
		let message: CdpResponse;
		try {
			message = JSON.parse(raw) as CdpResponse;
		} catch {
			return;
		}
		if (typeof message.id !== "number") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
			return;
		}
		pending.resolve(message.result);
	}
}

export function normalizeCdpUrlSync(value: string): string {
	return value.replace(/\/+$/, "");
}

export async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to fetch ${url}: ${reason}`);
	} finally {
		clearTimeout(timeout);
	}
}

export async function listCdpTargets(options: CdpTargetListOptions = {}): Promise<CdpTarget[]> {
	const cdpUrl = normalizeCdpUrlSync(options.cdpUrl ?? DEFAULT_CDP_URL);
	try {
		const response = await fetchWithTimeout(`${cdpUrl}/json/list`, options.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS);
		if (!response.ok) {
			throw new Error(`Chrome target discovery responded with HTTP ${response.status} ${response.statusText}`);
		}
		const payload = await response.json();
		if (!Array.isArray(payload)) throw new Error("Chrome target discovery returned invalid JSON");
		return payload.map(normalizeCdpTarget);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Failed to fetch")) {
			throw new Error(`CDP endpoint ${cdpUrl} is unreachable. Is Chrome running with remote debugging? (${error.message})`);
		}
		throw error;
	}
}

export async function openCdpTarget(url: string, options: CdpTargetListOptions = {}): Promise<CdpTarget> {
	const cdpUrl = normalizeCdpUrlSync(options.cdpUrl ?? DEFAULT_CDP_URL);
	const timeoutMs = options.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS;
	const endpoint = `${cdpUrl}/json/new?${encodeURIComponent(url)}`;
	try {
		let response = await fetchWithTimeout(endpoint, timeoutMs, { method: "PUT" });
		if (response.status === 404 || response.status === 405) {
			response = await fetchWithTimeout(endpoint, timeoutMs);
		}
		if (!response.ok) throw new Error(`Chrome target creation responded with HTTP ${response.status} ${response.statusText}`);
		const payload = await response.json();
		return normalizeCdpTarget(payload);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Failed to fetch")) {
			throw new Error(`CDP endpoint ${cdpUrl} is unreachable. Is Chrome running with remote debugging? (${error.message})`);
		}
		throw error;
	}
}

export function findCdpTarget(targets: readonly CdpTarget[], targetIdOrUrl: string): CdpTarget | undefined {
	return targets.find((target) => target.id === targetIdOrUrl || target.url === targetIdOrUrl || target.title === targetIdOrUrl || target.webSocketDebuggerUrl === targetIdOrUrl);
}

export async function connectCdpTarget(target: CdpTarget, timeoutMs = 3_000): Promise<CdpClient> {
	if (!target.webSocketDebuggerUrl) throw new Error(`CDP target ${target.id || target.url} is not attachable (no webSocketDebuggerUrl)`);
	const client = new CdpClient(target.webSocketDebuggerUrl);
	try {
		await client.connect(timeoutMs);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to connect to CDP target ${target.id || target.url}: ${reason}`);
	}
	return client;
}

function normalizeCdpTarget(target: unknown): CdpTarget {
	const record = target && typeof target === "object" && !Array.isArray(target) ? target as Record<string, unknown> : {};
	return {
		id: stringValue(record.id),
		type: stringValue(record.type),
		title: stringValue(record.title),
		url: stringValue(record.url),
		webSocketDebuggerUrl: optionalStringValue(record.webSocketDebuggerUrl),
	};
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function optionalStringValue(value: unknown): string | undefined {
	const text = stringValue(value);
	return text || undefined;
}

function remainingTime(deadlineMs: number, operation: string): number {
	const remainingMs = remainingTimeOrZero(deadlineMs);
	if (remainingMs <= 0) throw new Error(`Timed out ${operation}`);
	return remainingMs;
}

function remainingTimeOrZero(deadlineMs: number): number {
	return Math.max(0, Math.floor(deadlineMs - Date.now()));
}
