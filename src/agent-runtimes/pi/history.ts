import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { contentText } from "@earendil-works/pi-ai";
import type { AgentRuntimeForkCandidate, ResolveAgentRuntimeBindingInput } from "../../agent-runtime/types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiboJsonObject, PiboJsonValue, PiboSessionListItem } from "../../core/events.js";
import type {
	AgentRuntimeHistoryContentPart,
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	InspectAgentRuntimeHistoryInput,
	ReadAgentRuntimeHistoryInput,
} from "../../agent-runtime/history.js";
import { historyReconciliationDigest } from "../../agent-runtime/history.js";
import { TRACE_RECONCILIATION_ENTRY_CAP } from "../../shared/trace-limits.js";

export type PiHistoryMetadata = {
	sessionPath?: string;
	sessionSize?: number;
	sessionMtimeMs?: number;
	name?: string;
	firstMessage?: string;
	created?: string;
	modified?: string;
	messageCount?: number;
};

export type PiTranscriptHistoryPage = {
	entries: SessionEntry[];
	entryPositions: string[];
	nextBeforeByte?: number;
	hasOlder: boolean;
	scannedBytes: number;
	startByte: number;
	endByte: number;
};

export const PI_HISTORY_TAIL_MAX_BYTES = 2 * 1024 * 1024;
export const PI_HISTORY_PAGE_MAX_BYTES = 512 * 1024;
export const PI_HISTORY_SCAN_MAX_BYTES = 16 * 1024 * 1024;

const PI_SESSION_LIST_CACHE_TTL_MS = 5_000;
const PI_SESSION_DIRECT_CACHE_TTL_MS = 5_000;
const PI_SESSION_FAST_HEAD_BYTES = 64 * 1024;
const PI_HISTORY_CURSOR_PREFIX = "pi-history:";
// One bounded entry: repeated sidebar/trace refreshes must not repeatedly scan a large transcript.
let piForkCandidatesCache: { key: string; candidates: AgentRuntimeForkCandidate[] } | undefined;
const PI_FORK_CANDIDATE_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const piSessionListCache = new Map<string, { expiresAt: number; promise: Promise<PiboSessionListItem[]> }>();
const piSessionDirectCache = new Map<string, {
	expiresAt: number;
	path: string;
	size: number;
	mtimeMs: number;
	item: PiboSessionListItem;
}>();

type PiHistoryCursor = {
	beforeByte?: number;
	beforeTimestamp?: string;
};

type MessageSessionEntry = Extract<SessionEntry, { type: "message" }>;

type PiMessagePart = {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	id?: unknown;
	name?: unknown;
	arguments?: unknown;
};

export async function readPiAgentRuntimeForkCandidates(
	input: ResolveAgentRuntimeBindingInput,
): Promise<AgentRuntimeForkCandidate[] | undefined> {
	const nativeSessionId = input.binding.nativeSessionId;
	if (!nativeSessionId || input.binding.state !== "bound") return undefined;
	const item = await findPiSessionForHistory(nativeSessionId, input.workspace,
		input.binding.locator?.kind === "local-file" ? input.binding.locator.value : undefined, { fast: true });
	if (!item?.path) return undefined;
	const fileKey = () => {
		const stats = statSync(item.path);
		return `${nativeSessionId}:${item.path}:${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
	};
	const key = fileKey();
	if (piForkCandidatesCache?.key === key) return piForkCandidatesCache.candidates.map((candidate) => ({ ...candidate }));
	const stream = createReadStream(item.path, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	const candidates: AgentRuntimeForkCandidate[] = [];
	let headerSeen = false;
	try {
		// Stream native history in bounded chunks, retaining only user text rather than tool payloads.
		for await (const line of lines) {
			for (const entry of parseSessionEntries(`${line}\n`)) {
				if (!headerSeen) {
					// Older formats require the runtime's migration/identity handling.
					if (entry.type !== "session" || entry.version !== 3 || entry.id !== nativeSessionId) return undefined;
					headerSeen = true;
					continue;
				}
				if (entry.type !== "message" || entry.message.role !== "user") continue;
				const text = contentText(entry.message.content, "");
				if (text) candidates.push({ entryId: entry.id, text });
			}
		}
		if (!headerSeen) return undefined;
		const candidateBytes = candidates.reduce((bytes, candidate) => bytes + Buffer.byteLength(candidate.text) + Buffer.byteLength(candidate.entryId), 0);
		if (candidateBytes <= PI_FORK_CANDIDATE_CACHE_MAX_BYTES && key === fileKey()) {
			piForkCandidatesCache = { key, candidates: candidates.map((candidate) => ({ ...candidate })) };
		}
		return candidates;
	} finally {
		lines.close();
		stream.destroy();
	}
}

export async function inspectPiAgentRuntimeHistory(
	runtimeInstanceId: string,
	input: InspectAgentRuntimeHistoryInput,
): Promise<AgentRuntimeHistoryInspection> {
	const nativeSessionId = input.binding.nativeSessionId;
	if (!nativeSessionId) {
		return {
			runtimeInstanceId,
			adapterId: "pi",
			bindingState: input.binding.state,
			available: false,
			diagnostics: [{
				severity: "error",
				code: "pi_history_native_session_id_missing",
				message: "The Pi runtime binding has no native session id for history lookup.",
			}],
		};
	}
	const item = await findPiSessionForHistory(
		nativeSessionId,
		input.workspace,
		input.binding.locator?.kind === "local-file" ? input.binding.locator.value : undefined,
		{ fast: true },
	);
	if (!item) {
		return {
			runtimeInstanceId,
			adapterId: "pi",
			bindingState: input.binding.state,
			available: false,
			diagnostics: [{
				severity: input.binding.state === "missing" ? "error" : "warning",
				code: "pi_history_not_found",
				message: `Pi history for native session "${nativeSessionId}" was not found in workspace "${input.workspace}".`,
			}],
		};
	}
	const metadata = metadataFromPiSession(item);
	return {
		runtimeInstanceId,
		adapterId: "pi",
		bindingState: input.binding.state,
		available: true,
		locator: { kind: "local-file", value: item.path },
		title: metadata.name,
		firstMessage: metadata.firstMessage,
		createdAt: metadata.created,
		updatedAt: metadata.modified,
		entryCount: metadata.messageCount,
		sizeBytes: metadata.sessionSize,
		version: historyVersion(metadata),
		diagnostics: [],
	};
}

export async function readPiAgentRuntimeHistory(
	runtimeInstanceId: string,
	input: ReadAgentRuntimeHistoryInput,
): Promise<AgentRuntimeHistoryPage> {
	const inspection = await inspectPiAgentRuntimeHistory(runtimeInstanceId, input);
	if (!inspection.available || inspection.locator?.kind !== "local-file" || !inspection.locator.value) {
		return {
			runtimeInstanceId,
			adapterId: "pi",
			source: "native",
			entries: [],
			hasMore: false,
			inspection,
		};
	}
	const decoded = decodePiHistoryCursor(input.cursor);
	const page = readPiTranscriptHistoryPage(inspection.locator.value, {
		beforeByte: decoded.beforeByte,
		beforeTimestamp: input.beforeTimestamp ?? decoded.beforeTimestamp,
		limit: input.limit,
	});
	const historyScopeId = `pi:${runtimeInstanceId}:${input.binding.nativeSessionId ?? "unbound"}`;
	const completeProof = inspection.sizeBytes !== undefined && inspection.sizeBytes <= PI_HISTORY_SCAN_MAX_BYTES
		? readPiTranscriptEntriesWithPositions(
			inspection.locator.value,
			PI_HISTORY_SCAN_MAX_BYTES,
			TRACE_RECONCILIATION_ENTRY_CAP,
		)
		: undefined;
	const proofEntries = completeProof
		? piSessionEntriesToAgentRuntimeHistoryEntries(completeProof.entries, completeProof.entryPositions, historyScopeId)
		: undefined;
	const proofEntriesByPosition = proofEntries
		? new Map(proofEntries.map((entry) => [entry.historyPosition, entry]))
		: undefined;
	const entries = proofEntriesByPosition
		? page.entryPositions.flatMap((position) => {
			const entry = proofEntriesByPosition.get(position);
			return entry ? [entry] : [];
		})
		: piSessionEntriesToAgentRuntimeHistoryEntries(page.entries, page.entryPositions, historyScopeId);
	return {
		runtimeInstanceId,
		adapterId: "pi",
		source: "native",
		entries,
		reconciliationProof: completeProof && proofEntries
			? {
				complete: true,
				scopeId: historyScopeId,
				fullScope: { entryCount: proofEntries.length, digest: historyReconciliationDigest(proofEntries) },
				entries: proofEntries,
			}
			: { complete: false, scopeId: historyScopeId, entries },
		orderOffset: page.startByte,
		nextCursor: page.hasOlder && page.nextBeforeByte !== undefined
			? encodePiHistoryCursor({ beforeByte: page.nextBeforeByte, beforeTimestamp: input.beforeTimestamp ?? decoded.beforeTimestamp })
			: undefined,
		hasMore: page.hasOlder,
		inspection,
	};
}

export function piSessionEntriesToAgentRuntimeHistoryEntries(
	entries: readonly SessionEntry[],
	historyPositions: readonly string[] = [],
	historyScopeId?: string,
): AgentRuntimeHistoryEntry[] {
	const normalized: AgentRuntimeHistoryEntry[] = [];
	let nativeTurnId: string | undefined;
	for (let sequence = 0; sequence < entries.length; sequence += 1) {
		const entry = entries[sequence]!;
		const historyPosition = historyPositions[sequence];
		if (entry.type === "session_info" && entry.name) {
			normalized.push({
				id: `pi:${entry.id}`,
				type: "session_info",
				source: "native",
				createdAt: entry.timestamp,
				sequence,
				...(historyPosition ? { historyPosition } : {}),
				...(historyScopeId ? { historyScopeId } : {}),
				nativeEntryId: entry.id,
				name: entry.name,
			});
			continue;
		}
		if (entry.type !== "message") continue;
		const role = piMessageRole(entry);
		if (role === "user") {
			nativeTurnId = entry.id;
			normalized.push({
				id: `pi:${entry.id}`,
				type: "message",
				source: "native",
				createdAt: entry.timestamp,
				sequence,
				...(historyPosition ? { historyPosition } : {}),
				...(historyScopeId ? { historyScopeId } : {}),
				nativeTurnId,
				nativeEntryId: entry.id,
				role: "user",
				content: normalizePiTextContent(piMessageContent(entry)),
			});
			continue;
		}
		if (role === "assistant") {
			const message = entry.message as { stopReason?: unknown; errorMessage?: unknown; status?: unknown };
			normalized.push({
				id: `pi:${entry.id}`,
				type: "message",
				source: "native",
				createdAt: entry.timestamp,
				sequence,
				...(historyPosition ? { historyPosition } : {}),
				...(historyScopeId ? { historyScopeId } : {}),
				nativeTurnId,
				nativeEntryId: entry.id,
				role: "assistant",
				content: normalizePiAssistantContent(piMessageContent(entry)),
				status: piAssistantStatus(message),
				error: typeof message.errorMessage === "string" ? message.errorMessage : undefined,
				metadata: compactJsonObject({
					stopReason: jsonValue(message.stopReason),
					nativeStatus: jsonValue(message.status),
				}),
			});
			continue;
		}
		if (role === "toolResult") {
			const message = entry.message as {
				toolCallId?: unknown;
				toolName?: unknown;
				content?: unknown;
				details?: unknown;
				isError?: unknown;
			};
			normalized.push({
				id: `pi:${entry.id}`,
				type: "message",
				source: "native",
				createdAt: entry.timestamp,
				sequence,
				...(historyPosition ? { historyPosition } : {}),
				...(historyScopeId ? { historyScopeId } : {}),
				nativeTurnId,
				nativeEntryId: entry.id,
				role: "tool",
				content: normalizePiTextContent(message.content),
				toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
				toolName: typeof message.toolName === "string" ? message.toolName : undefined,
				result: jsonValue({ content: message.content, ...(message.details === undefined ? {} : { details: message.details }) }) ?? null,
				isError: message.isError === true,
				status: message.isError === true ? "error" : "complete",
			});
		}
	}
	return normalized;
}

export async function loadPiHistoryMetadata(
	nativeSessionId: string,
	cwd = process.cwd(),
): Promise<PiHistoryMetadata> {
	const item = await findPiSessionForHistory(nativeSessionId, cwd);
	return metadataFromPiSession(item);
}

export function loadPiHistoryFastMetadata(
	nativeSessionId: string,
	cwd = process.cwd(),
): PiHistoryMetadata {
	const item = findPiSessionDirectFast(nativeSessionId, cwd)
		?? findPiSessionDirect(nativeSessionId, cwd, { fast: true });
	return metadataFromPiSession(item);
}

export async function listPiHistorySessions(cwd = process.cwd()): Promise<PiboSessionListItem[]> {
	const now = Date.now();
	const cached = piSessionListCache.get(cwd);
	if (cached && cached.expiresAt > now) return cached.promise;
	const promise = SessionManager.list(cwd).then((sessions) => sessions.map((session) => ({
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	})));
	piSessionListCache.set(cwd, { expiresAt: now + PI_SESSION_LIST_CACHE_TTL_MS, promise });
	promise.catch(() => {
		if (piSessionListCache.get(cwd)?.promise === promise) piSessionListCache.delete(cwd);
	});
	return promise;
}

export function readPiTranscriptEntries(path: string): SessionEntry[] {
	if (!existsSync(path)) return [];
	return parseSessionEntries(readFileSync(path, "utf8")).filter((entry): entry is SessionEntry => entry.type !== "session");
}

export function readPiTranscriptTailEntries(path: string, maxBytes = PI_HISTORY_TAIL_MAX_BYTES): SessionEntry[] {
	if (!existsSync(path)) return [];
	const stats = statSync(path);
	if (stats.size <= maxBytes) return readPiTranscriptEntries(path);
	const length = Math.max(1, Math.min(maxBytes, stats.size));
	const start = stats.size - length;
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, "r");
	try {
		const bytesRead = readSync(fd, buffer, 0, length, start);
		let content = buffer.subarray(0, bytesRead).toString("utf8");
		const firstNewline = content.indexOf("\n");
		if (start > 0 && firstNewline >= 0) content = content.slice(firstNewline + 1);
		return parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
	} finally {
		closeSync(fd);
	}
}

export function readPiTranscriptHistoryPage(
	path: string,
	input: {
		beforeByte?: number;
		beforeTimestamp?: string;
		limit?: number;
		pageBytes?: number;
		maxScanBytes?: number;
	} = {},
): PiTranscriptHistoryPage {
	if (!existsSync(path)) return { entries: [], entryPositions: [], hasOlder: false, scannedBytes: 0, startByte: 0, endByte: 0 };
	const stats = statSync(path);
	const fileSize = Math.max(0, stats.size);
	const initialEnd = input.beforeByte === undefined
		? fileSize
		: Math.max(0, Math.min(input.beforeByte, fileSize));
	const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
	const pageBytes = Math.max(1024, Math.min(input.pageBytes ?? PI_HISTORY_PAGE_MAX_BYTES, PI_HISTORY_SCAN_MAX_BYTES));
	const maxScanBytes = Math.max(pageBytes, Math.min(input.maxScanBytes ?? PI_HISTORY_SCAN_MAX_BYTES, 32 * 1024 * 1024));
	const beforeTime = input.beforeTimestamp ? Date.parse(input.beforeTimestamp) : undefined;
	const entries: Array<{ entry: SessionEntry; startByte: number; parsedIndex: number }> = [];
	let cursorEnd = initialEnd;
	let scannedBytes = 0;
	const fd = openSync(path, "r");
	try {
		while (cursorEnd > 0 && entries.length < limit && scannedBytes < maxScanBytes) {
			const record = readPreviousTranscriptLine(fd, cursorEnd, {
				blockBytes: pageBytes,
				maxBytes: maxScanBytes - scannedBytes,
			});
			if (!record) {
				cursorEnd = 0;
				break;
			}
			cursorEnd = record.startByte;
			scannedBytes += record.scannedBytes;
			if (record.truncated) break;
			const parsed = parseTranscriptLine(record.text);
			for (let entryIndex = parsed.length - 1; entryIndex >= 0; entryIndex -= 1) {
				const entry = parsed[entryIndex]!;
				if (beforeTime !== undefined && entryTimestampMs(entry) >= beforeTime) continue;
				entries.push({ entry, startByte: record.startByte, parsedIndex: entryIndex });
				if (entries.length >= limit) break;
			}
		}
	} finally {
		closeSync(fd);
	}

	const nextBeforeByte = cursorEnd > 0 ? cursorEnd : undefined;
	const orderedEntries = entries.reverse();
	return {
		entries: orderedEntries.map((item) => item.entry),
		entryPositions: orderedEntries.map((item) => `pi-byte:${item.startByte}:${item.parsedIndex}`),
		nextBeforeByte,
		hasOlder: nextBeforeByte !== undefined,
		scannedBytes,
		startByte: nextBeforeByte ?? 0,
		endByte: initialEnd,
	};
}

function readPiTranscriptEntriesWithPositions(
	path: string,
	maxBytes: number,
	maxEntries: number,
): { entries: SessionEntry[]; entryPositions: string[] } | undefined {
	if (statSync(path).size > maxBytes) return undefined;
	const content = readFileSync(path);
	if (content.length > maxBytes) return undefined;
	const entries: SessionEntry[] = [];
	const entryPositions: string[] = [];
	let lineStart = 0;
	for (let cursor = 0; cursor <= content.length; cursor += 1) {
		if (cursor < content.length && content[cursor] !== 0x0a) continue;
		const line = content.subarray(lineStart, cursor).toString("utf8");
		const parsed = parseTranscriptLine(line);
		for (let parsedIndex = 0; parsedIndex < parsed.length; parsedIndex += 1) {
			if (entries.length >= maxEntries) return undefined;
			entries.push(parsed[parsedIndex]!);
			entryPositions.push(`pi-byte:${lineStart}:${parsedIndex}`);
		}
		lineStart = cursor + 1;
	}
	return { entries, entryPositions };
}

function normalizePiAssistantContent(content: unknown): AgentRuntimeHistoryContentPart[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	const parts: AgentRuntimeHistoryContentPart[] = [];
	for (const value of content) {
		if (!value || typeof value !== "object") continue;
		const part = value as PiMessagePart;
		if (part.type === "text" && typeof part.text === "string") {
			parts.push({ type: "text", text: part.text });
		} else if (part.type === "thinking" && typeof part.thinking === "string") {
			parts.push({ type: "reasoning", text: part.thinking });
		} else if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
			parts.push({
				type: "tool_call",
				toolCallId: part.id,
				toolName: part.name,
				input: jsonValue(part.arguments),
			});
		}
	}
	return parts;
}

function normalizePiTextContent(content: unknown): string | AgentRuntimeHistoryContentPart[] {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return stringifyUnknown(content);
	const parts: AgentRuntimeHistoryContentPart[] = [];
	for (const value of content) {
		if (!value || typeof value !== "object") continue;
		const part = value as PiMessagePart;
		if (part.type === "text" && typeof part.text === "string") parts.push({ type: "text", text: part.text });
	}
	return parts;
}

function piAssistantStatus(message: { stopReason?: unknown; errorMessage?: unknown; status?: unknown }): "complete" | "running" | "error" {
	if (message.stopReason === "error" || typeof message.errorMessage === "string") return "error";
	if (message.status === "streaming" || message.status === "in_progress") return "running";
	return "complete";
}

function piMessageRole(entry: MessageSessionEntry): unknown {
	return (entry.message as { role?: unknown }).role;
}

function piMessageContent(entry: MessageSessionEntry): unknown {
	return (entry.message as { content?: unknown }).content;
}

function stringifyUnknown(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function compactJsonObject(value: Record<string, PiboJsonValue | undefined>): PiboJsonObject | undefined {
	const compact = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject;
	return Object.keys(compact).length ? compact : undefined;
}

function jsonValue(value: unknown): PiboJsonValue | undefined {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
	} catch {
		return String(value);
	}
}

async function findPiSessionForHistory(
	nativeSessionId: string,
	cwd: string,
	locatorPath?: string,
	options: { fast?: boolean } = {},
): Promise<PiboSessionListItem | undefined> {
	if (locatorPath) {
		const located = findPiSessionAtPath(locatorPath, nativeSessionId, cwd, options);
		if (located) return located;
	}
	return findPiSessionDirect(nativeSessionId, cwd, options)
		?? (await listPiHistorySessions(cwd)).find((session) => session.id === nativeSessionId);
}

function metadataFromPiSession(item: PiboSessionListItem | undefined): PiHistoryMetadata {
	if (!item) return {};
	let sessionSize: number | undefined;
	let sessionMtimeMs: number | undefined;
	try {
		const stats = statSync(item.path);
		sessionSize = stats.size;
		sessionMtimeMs = stats.mtimeMs;
	} catch {
		// The session can be deleted after discovery and before inspection.
	}
	return {
		sessionPath: item.path,
		sessionSize,
		sessionMtimeMs,
		name: item.name,
		firstMessage: item.firstMessage,
		created: item.created,
		modified: item.modified,
		messageCount: item.messageCount,
	};
}

function historyVersion(metadata: PiHistoryMetadata): string | undefined {
	if (!metadata.sessionPath) return undefined;
	return createHash("sha1").update(JSON.stringify({
		path: metadata.sessionPath,
		size: metadata.sessionSize ?? null,
		mtime: metadata.sessionMtimeMs ?? null,
	})).digest("hex");
}

function findPiSessionDirectFast(nativeSessionId: string, cwd: string): PiboSessionListItem | undefined {
	const cacheKey = `${cwd}\0${nativeSessionId}`;
	const cached = piSessionDirectCache.get(cacheKey);
	if (!cached || cached.expiresAt <= Date.now()) return undefined;
	try {
		const stats = statSync(cached.path);
		if (stats.size === cached.size && stats.mtimeMs === cached.mtimeMs) return cached.item;
	} catch {
		piSessionDirectCache.delete(cacheKey);
	}
	return undefined;
}

function setPiSessionDirectFastCache(nativeSessionId: string, cwd: string, item: PiboSessionListItem, stats: { size: number; mtimeMs: number }): void {
	piSessionDirectCache.set(`${cwd}\0${nativeSessionId}`, {
		expiresAt: Date.now() + PI_SESSION_DIRECT_CACHE_TTL_MS,
		path: item.path,
		size: stats.size,
		mtimeMs: stats.mtimeMs,
		item,
	});
}

function findPiSessionDirect(nativeSessionId: string, cwd: string, options: { fast?: boolean } = {}): PiboSessionListItem | undefined {
	const sessionDir = defaultPiSessionDir(cwd);
	if (!existsSync(sessionDir)) return undefined;
	try {
		const file = readdirSync(sessionDir).find((candidate) => candidate.endsWith(`_${nativeSessionId}.jsonl`));
		return file ? findPiSessionAtPath(join(sessionDir, file), nativeSessionId, cwd, options) : undefined;
	} catch {
		return undefined;
	}
}

function findPiSessionAtPath(
	sessionPath: string,
	nativeSessionId: string,
	cwd: string,
	options: { fast?: boolean } = {},
): PiboSessionListItem | undefined {
	if (!existsSync(sessionPath)) return undefined;
	try {
		const stats = statSync(sessionPath);
		const entries = options.fast
			? readHeadEntries(sessionPath, stats.size, PI_SESSION_FAST_HEAD_BYTES)
			: parseSessionEntries(readFileSync(sessionPath, "utf8"));
		const header = entries.find((entry) => entry.type === "session") as
			| { id?: unknown; timestamp?: unknown; cwd?: unknown; parentSession?: unknown }
			| undefined;
		if (header?.id !== nativeSessionId) return undefined;
		let name: string | undefined;
		let firstMessage = "";
		let messageCount = 0;
		for (const entry of entries) {
			if (entry.type === "session_info") name = stringValue((entry as { name?: unknown }).name)?.trim() || undefined;
			if (entry.type !== "message") continue;
			messageCount += 1;
			if (firstMessage || piMessageRole(entry) !== "user") continue;
			firstMessage = extractPiMessageText(piMessageContent(entry));
		}
		const item: PiboSessionListItem = {
			path: sessionPath,
			id: nativeSessionId,
			cwd: stringValue(header.cwd) ?? cwd,
			name,
			parentSessionPath: stringValue(header.parentSession),
			created: stringValue(header.timestamp) ?? stats.birthtime.toISOString(),
			modified: options.fast
				? stats.mtime.toISOString()
				: sessionModifiedIso(entries.filter((entry): entry is SessionEntry => entry.type !== "session"), stringValue(header.timestamp), stats.mtime),
			messageCount,
			firstMessage: firstMessage || "(no messages)",
		};
		if (options.fast) setPiSessionDirectFastCache(nativeSessionId, cwd, item, stats);
		return item;
	} catch {
		return undefined;
	}
}

function defaultPiSessionDir(cwd: string): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const safePath = `--${cwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
	return join(agentDir, "sessions", safePath);
}

function sessionModifiedIso(entries: SessionEntry[], headerTimestamp: string | undefined, statsMtime: Date): string {
	let lastActivityTime: number | undefined;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const timestamp = (entry.message as { timestamp?: unknown }).timestamp;
		if (typeof timestamp === "number") {
			lastActivityTime = Math.max(lastActivityTime ?? 0, timestamp);
			continue;
		}
		const entryTime = new Date(entry.timestamp).getTime();
		if (!Number.isNaN(entryTime)) lastActivityTime = Math.max(lastActivityTime ?? 0, entryTime);
	}
	if (lastActivityTime) return new Date(lastActivityTime).toISOString();
	const headerTime = headerTimestamp ? new Date(headerTimestamp).getTime() : Number.NaN;
	return !Number.isNaN(headerTime) ? new Date(headerTime).toISOString() : statsMtime.toISOString();
}

function readHeadEntries(path: string, fileSize: number, maxBytes: number): ReturnType<typeof parseSessionEntries> {
	const length = Math.max(1, Math.min(maxBytes, fileSize));
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, "r");
	try {
		const bytesRead = readSync(fd, buffer, 0, length, 0);
		let content = buffer.subarray(0, bytesRead).toString("utf8");
		if (bytesRead < fileSize && !content.endsWith("\n")) {
			const lastNewline = content.lastIndexOf("\n");
			if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
		}
		if (!content.trim()) return [];
		return parseSessionEntries(content.endsWith("\n") ? content : `${content}\n`);
	} finally {
		closeSync(fd);
	}
}

function readPreviousTranscriptLine(
	fd: number,
	cursorEnd: number,
	input: { blockBytes: number; maxBytes: number },
): { text: string; startByte: number; scannedBytes: number; truncated: boolean } | undefined {
	let lineEnd = cursorEnd;
	const byte = Buffer.allocUnsafe(1);
	while (lineEnd > 0) {
		readSync(fd, byte, 0, 1, lineEnd - 1);
		if (byte[0] !== 0x0a && byte[0] !== 0x0d) break;
		lineEnd -= 1;
	}
	if (lineEnd === 0) return undefined;

	const maxBytes = Math.max(1, input.maxBytes);
	const floor = Math.max(0, lineEnd - maxBytes);
	let scanEnd = lineEnd;
	let lineStart = floor;
	let foundBoundary = floor === 0;
	while (scanEnd > floor) {
		const scanStart = Math.max(floor, scanEnd - input.blockBytes);
		const buffer = Buffer.allocUnsafe(scanEnd - scanStart);
		const bytesRead = readSync(fd, buffer, 0, buffer.length, scanStart);
		const newlineIndex = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
		if (newlineIndex >= 0) {
			lineStart = scanStart + newlineIndex + 1;
			foundBoundary = true;
			break;
		}
		scanEnd = scanStart;
	}
	if (!foundBoundary) {
		return {
			text: "",
			startByte: floor,
			scannedBytes: cursorEnd - floor,
			truncated: true,
		};
	}
	const lineBuffer = Buffer.allocUnsafe(lineEnd - lineStart);
	const bytesRead = readSync(fd, lineBuffer, 0, lineBuffer.length, lineStart);
	return {
		text: lineBuffer.subarray(0, bytesRead).toString("utf8"),
		startByte: lineStart,
		scannedBytes: cursorEnd - lineStart,
		truncated: false,
	};
}

function parseTranscriptLine(line: string): SessionEntry[] {
	try {
		return parseSessionEntries(`${line}\n`).filter((entry): entry is SessionEntry => entry.type !== "session");
	} catch {
		return [];
	}
}

function entryTimestampMs(entry: SessionEntry): number {
	const timestamp = (entry as { timestamp?: unknown }).timestamp;
	if (typeof timestamp !== "string") return Number.POSITIVE_INFINITY;
	const parsed = Date.parse(timestamp);
	return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function encodePiHistoryCursor(cursor: PiHistoryCursor): string {
	return `${PI_HISTORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url")}`;
}

function decodePiHistoryCursor(cursor: string | undefined): PiHistoryCursor {
	if (!cursor) return {};
	if (cursor.startsWith("transcript:")) {
		const [, byteValue, encodedTimestamp] = cursor.split(":");
		const beforeByte = Number.parseInt(byteValue ?? "", 10);
		if (!Number.isFinite(beforeByte) || beforeByte < 0) throw new Error("Invalid legacy Pi transcript history cursor.");
		return {
			beforeByte,
			beforeTimestamp: encodedTimestamp ? Buffer.from(encodedTimestamp, "base64url").toString("utf8") || undefined : undefined,
		};
	}
	if (!cursor.startsWith(PI_HISTORY_CURSOR_PREFIX)) throw new Error("Invalid Pi history cursor.");
	try {
		const value = JSON.parse(Buffer.from(cursor.slice(PI_HISTORY_CURSOR_PREFIX.length), "base64url").toString("utf8")) as {
			v?: unknown;
			beforeByte?: unknown;
			beforeTimestamp?: unknown;
		};
		if (value.v !== 1) throw new Error("unsupported version");
		if (value.beforeByte !== undefined && (typeof value.beforeByte !== "number" || !Number.isInteger(value.beforeByte) || value.beforeByte < 0)) throw new Error("invalid byte offset");
		if (value.beforeTimestamp !== undefined && typeof value.beforeTimestamp !== "string") throw new Error("invalid timestamp");
		return {
			beforeByte: value.beforeByte as number | undefined,
			beforeTimestamp: value.beforeTimestamp as string | undefined,
		};
	} catch (error) {
		throw new Error(`Invalid Pi history cursor: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function extractPiMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (!part || typeof part !== "object") return "";
		const typed = part as { type?: unknown; text?: unknown };
		return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
	}).join("");
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
