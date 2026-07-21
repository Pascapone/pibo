import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiboSessionListItem } from "../../core/events.js";
import type { ModelProfile } from "../../core/profiles.js";
import type { PiboSession } from "../../sessions/store.js";
import { buildTraceViewFromEvents } from "../../shared/trace-engine.js";
import type { TraceMessageTurnTiming } from "../../shared/trace-event-projection.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../../shared/trace-types.js";
import type { ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "./read-model.js";
import { isChatWebSessionArchived } from "./session-metadata.js";
import { workflowSessionKindFromMetadata, type PiboWorkflowSessionKind } from "../../sessions/workflow-session-kind.js";

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboWebDerivedSessionNode = {
	piboSessionId: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
	workflowSessionKind?: PiboWorkflowSessionKind;
	title: string;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
};

export type PiboWebSessionNode = {
	piboSessionId: string;
	piSessionId: string;
	parentId?: string;
	originId?: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
	workflowSessionKind?: PiboWorkflowSessionKind;
	title: string;
	subtitle?: string;
	archived?: boolean;
	status: PiboWebSessionStatus;
	lastActivityAt?: string;
	unreadCount?: number;
	derivedSessions: PiboWebDerivedSessionNode[];
	children: PiboWebSessionNode[];
};

export type {
	PiboTraceNode,
	PiboTraceNodeType,
	PiboTraceNodeStatus,
	PiboTraceSource,
	PiboTraceOrderKey,
	PiboSessionTraceView,
} from "../../shared/trace-types.js";

export {
	compareTraceNodes,
	sortTraceNodes,
	nestTraceNodes,
	flattenTraceNodes,
	mapTraceNodesById,
	buildTraceViewFromEvents,
	traceNodesFromEntries,
} from "../../shared/trace-engine.js";

type SessionMetadata = {
	sessionPath?: string;
	sessionSize?: number;
	sessionMtimeMs?: number;
	name?: string;
	firstMessage?: string;
	modified?: string;
};

export const TRACE_TRANSCRIPT_TAIL_MAX_BYTES = 2 * 1024 * 1024;
export const TRACE_TRANSCRIPT_HISTORY_PAGE_MAX_BYTES = 512 * 1024;
export const TRACE_TRANSCRIPT_HISTORY_SCAN_MAX_BYTES = 16 * 1024 * 1024;

type TraceBuildInput = {
	session: PiboSession;
	sessions: PiboSession[];
	events: ChatWebStoredPiboEvent[];
	status?: PiboWebSessionStatus;
	cwd?: string;
	metadata?: SessionMetadata;
	transcriptEntries?: SessionEntry[];
	transcriptOrderOffset?: number;
	turnTimings?: TraceMessageTurnTiming[];
	includeRawEvents?: boolean;
	rawEventsLimit?: number;
	latestStreamId?: number;
};

export type TranscriptHistoryPage = {
	entries: SessionEntry[];
	nextBeforeByte?: number;
	hasOlder: boolean;
	scannedBytes: number;
	startByte: number;
	endByte: number;
};

export async function loadPiSessionMetadata(
	session: PiboSession,
	cwd = process.cwd(),
): Promise<SessionMetadata> {
	const piSession = await findPiSession(session, cwd);
	return metadataFromPiSession(piSession);
}

export async function loadPiSessionFastMetadata(
	session: PiboSession,
	cwd = process.cwd(),
): Promise<SessionMetadata> {
	const piSession = findPiSessionDirectFast(session.piSessionId, cwd)
		?? findPiSessionDirect(session.piSessionId, cwd, { fast: true });
	return metadataFromPiSession(piSession);
}

function metadataFromPiSession(piSession: PiboSessionListItem | undefined): SessionMetadata {
	if (!piSession) return {};
	let sessionSize: number | undefined;
	let sessionMtimeMs: number | undefined;
	try {
		const stats = statSync(piSession.path);
		sessionSize = stats.size;
		sessionMtimeMs = stats.mtimeMs;
	} catch {
		// The session list can contain a file that was removed before trace rendering.
	}
	return {
		sessionPath: piSession.path,
		sessionSize,
		sessionMtimeMs,
		name: piSession.name,
		firstMessage: piSession.firstMessage,
		modified: piSession.modified,
	};
}

export async function buildSessionNodes(
	sessions: PiboSession[],
	indexItems: ChatWebSessionIndexItem[],
	cwd = process.cwd(),
	unreadCounts: ReadonlyMap<string, number> = new Map(),
	options: { skipPiMetadataFallback?: boolean } = {},
): Promise<PiboWebSessionNode[]> {
	const indexByKey = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	const nodes = new Map<string, PiboWebSessionNode>();
	const piSessionsByCwd = new Map<string, Promise<PiboSessionListItem[]>>();

	for (const session of sessions) {
		let metadata: SessionMetadata = {};
		if (!session.title && !options.skipPiMetadataFallback) {
			const sessionCwd = session.workspace ?? cwd;
			let piSessions = piSessionsByCwd.get(sessionCwd);
			if (!piSessions) {
				piSessions = listPiSessions(sessionCwd);
				piSessionsByCwd.set(sessionCwd, piSessions);
			}
			metadata = metadataFromPiSession(
				(await piSessions).find((piSession) => piSession.id === session.piSessionId),
			);
		}
		const indexed = indexByKey.get(session.id);
		nodes.set(session.id, {
			piboSessionId: session.id,
			piSessionId: session.piSessionId,
			parentId: session.parentId,
			originId: session.originId,
			profile: session.profile,
			activeModel: session.activeModel,
			subagentName: stringValue(session.metadata?.subagentName),
			workflowSessionKind: workflowSessionKindFromMetadata(session.metadata),
			title: createSessionTitle(session, metadata),
			subtitle: session.id,
			archived: isChatWebSessionArchived(session),
			status: sessionNodeStatus(indexed?.status),
			lastActivityAt: indexed?.lastActivityAt ?? indexed?.createdAt ?? session.createdAt,
			unreadCount: unreadCounts.get(session.id) || undefined,
			derivedSessions: [],
			children: [],
		});
	}

	const roots: PiboWebSessionNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parentId ? nodes.get(node.parentId) : undefined;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	for (const node of nodes.values()) {
		if (!node.originId) continue;
		const origin = nodes.get(node.originId);
		if (!origin) continue;
		origin.derivedSessions.push({
			piboSessionId: node.piboSessionId,
			profile: node.profile,
			subagentName: node.subagentName,
			workflowSessionKind: node.workflowSessionKind,
			title: node.title,
			status: node.status,
			lastActivityAt: node.lastActivityAt,
		});
	}

	const sortNodes = (items: PiboWebSessionNode[]): void => {
		items.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
		for (const item of items) {
			item.derivedSessions.sort((left, right) => (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? ""));
			sortNodes(item.children);
		}
	};
	sortNodes(roots);
	return roots;
}

function sessionNodeStatus(indexedStatus: PiboWebSessionStatus | undefined): PiboWebSessionStatus {
	return indexedStatus ?? "idle";
}

export async function buildTraceView(input: TraceBuildInput): Promise<PiboSessionTraceView> {
	const metadata = input.metadata ?? (await loadPiSessionMetadata(input.session, input.session.workspace ?? input.cwd));
	const allEntries = input.transcriptEntries ?? (metadata.sessionPath ? readEntries(metadata.sessionPath) : []);
	const sessionStatus = input.status ?? "idle";

	const view = buildTraceViewFromEvents({
		session: {
			id: input.session.id,
			piSessionId: input.session.piSessionId,
			title: createSessionTitle(input.session, metadata),
		},
		events: input.events as unknown as import("../../shared/trace-types.js").ChatWebStoredEvent[],
		turnTimings: input.turnTimings,
		transcriptEntries: allEntries,
		sessions: input.sessions.map((s) => ({
			id: s.id,
			parentId: s.parentId ?? null,
			originId: s.originId ?? null,
			updatedAt: s.updatedAt,
			title: s.title ?? null,
			metadata: s.metadata,
		})),
		status: sessionStatus,
		latestStreamId: input.latestStreamId,
		includeRawEvents: input.includeRawEvents,
		rawEventsLimit: input.rawEventsLimit,
	});
	if (input.transcriptOrderOffset && input.transcriptOrderOffset > 0) {
		offsetTranscriptTraceOrder(view.nodes, input.transcriptOrderOffset);
	}
	annotateForkableUserMessageNodes(view.nodes, allEntries);

	return {
		...view,
		version: createTraceViewVersion({
			session: input.session,
			sessions: input.sessions,
			events: input.events,
			status: sessionStatus,
			metadata,
			latestStreamId: input.latestStreamId,
		}),
	};
}

export async function loadPiSessionTailEntries(
	session: PiboSession,
	cwd = process.cwd(),
	maxBytes = TRACE_TRANSCRIPT_TAIL_MAX_BYTES,
): Promise<{ metadata: SessionMetadata; entries: SessionEntry[] }> {
	const metadata = await loadPiSessionMetadata(session, cwd);
	if (!metadata.sessionPath) return { metadata, entries: [] };
	return { metadata, entries: readTailEntries(metadata.sessionPath, maxBytes) };
}

export function createTraceViewVersion(input: {
	session: PiboSession;
	sessions: PiboSession[];
	events: Pick<ChatWebStoredPiboEvent, "id" | "eventSequence" | "createdAt">[];
	status?: PiboWebSessionStatus;
	metadata?: SessionMetadata;
	latestStreamId?: number;
}): string {
	const relevantSessions = input.sessions
		.map((session) => ({
			id: session.id,
			parentId: session.parentId ?? null,
			originId: session.originId ?? null,
			updatedAt: session.updatedAt,
			title: session.title ?? null,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	const eventTail = input.events.at(-1);
	return createHash("sha1")
		.update(
			JSON.stringify({
				traceProjection: "turn-timing-v2",
				session: {
					id: input.session.id,
					piSessionId: input.session.piSessionId,
					profile: input.session.profile,
					title: input.session.title ?? null,
					updatedAt: input.session.updatedAt,
				},
				metadata: {
					sessionPath: input.metadata?.sessionPath ?? null,
					sessionSize: input.metadata?.sessionSize ?? null,
					sessionMtimeMs: input.metadata?.sessionMtimeMs ?? null,
					name: input.metadata?.name ?? null,
					firstMessage: input.metadata?.firstMessage ?? null,
					modified: input.metadata?.modified ?? null,
				},
				status: input.status ?? "idle",
				events: {
					lastSequence: eventTail?.eventSequence ?? null,
					lastCreatedAt: eventTail?.createdAt ?? null,
					latestStreamId: input.latestStreamId ?? null,
				},
				sessions: relevantSessions,
			}),
		)
		.digest("hex");
}

const PI_SESSION_LIST_CACHE_TTL_MS = 5_000;
const PI_SESSION_DIRECT_CACHE_TTL_MS = 5_000;
const PI_SESSION_FAST_HEAD_BYTES = 64 * 1024;
const piSessionListCache = new Map<string, { expiresAt: number; promise: Promise<PiboSessionListItem[]> }>();
const piSessionDirectCache = new Map<string, {
	expiresAt: number;
	path: string;
	size: number;
	mtimeMs: number;
	item: PiboSessionListItem;
}>();

export async function listPiSessions(cwd = process.cwd()): Promise<PiboSessionListItem[]> {
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

function createSessionTitle(session: PiboSession, metadata: SessionMetadata): string {
	const candidate = session.title || metadata.name || metadata.firstMessage || session.id;
	return truncateTitle(candidate);
}

function truncateTitle(title: string, maxLength = 56): string {
	const normalized = title.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized || "Untitled Session";
	return `${normalized.slice(0, maxLength - 1)}…`;
}

async function findPiSession(piboSession: PiboSession, cwd: string): Promise<PiboSessionListItem | undefined> {
	return (
		findPiSessionDirect(piboSession.piSessionId, cwd) ??
		(await listPiSessions(cwd)).find((session) => session.id === piboSession.piSessionId)
	);
}

function findPiSessionDirectFast(piSessionId: string, cwd: string): PiboSessionListItem | undefined {
	const cacheKey = `${cwd}\0${piSessionId}`;
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

function setPiSessionDirectFastCache(piSessionId: string, cwd: string, item: PiboSessionListItem, stats: { size: number; mtimeMs: number }): void {
	piSessionDirectCache.set(`${cwd}\0${piSessionId}`, {
		expiresAt: Date.now() + PI_SESSION_DIRECT_CACHE_TTL_MS,
		path: item.path,
		size: stats.size,
		mtimeMs: stats.mtimeMs,
		item,
	});
}

function findPiSessionDirect(piSessionId: string, cwd: string, options: { fast?: boolean } = {}): PiboSessionListItem | undefined {
	const sessionDir = defaultPiSessionDir(cwd);
	if (!existsSync(sessionDir)) return undefined;
	try {
		const file = readdirSync(sessionDir).find((candidate) => candidate.endsWith(`_${piSessionId}.jsonl`));
		if (!file) return undefined;
		const sessionPath = join(sessionDir, file);
		const stats = statSync(sessionPath);
		const entries = options.fast
			? readHeadEntries(sessionPath, stats.size, PI_SESSION_FAST_HEAD_BYTES)
			: parseSessionEntries(readFileSync(sessionPath, "utf8"));
		const header = entries.find((entry) => entry.type === "session") as
			| { id?: unknown; timestamp?: unknown; cwd?: unknown; parentSession?: unknown }
			| undefined;
		if (header?.id !== piSessionId) return undefined;

		let name: string | undefined;
		let firstMessage = "";
		let messageCount = 0;
		for (const entry of entries) {
			if (entry.type === "session_info") name = stringValue((entry as { name?: unknown }).name)?.trim() || undefined;
			if (entry.type !== "message") continue;
			messageCount++;
			if (firstMessage || messageRole(entry) !== "user") continue;
			firstMessage = extractMessageText(messageContent(entry));
		}

		const item = {
			path: sessionPath,
			id: piSessionId,
			cwd: stringValue(header.cwd) ?? cwd,
			name,
			parentSessionPath: stringValue(header.parentSession),
			created: stringValue(header.timestamp) ?? stats.birthtime.toISOString(),
			modified: options.fast
				? stats.mtime.toISOString()
				: sessionModifiedIso(
					entries.filter((entry): entry is SessionEntry => entry.type !== "session"),
					stringValue(header.timestamp),
					stats.mtime,
				),
			messageCount,
			firstMessage: firstMessage || "(no messages)",
		};
		if (options.fast) setPiSessionDirectFastCache(piSessionId, cwd, item, stats);
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
	const headerTime = headerTimestamp ? new Date(headerTimestamp).getTime() : NaN;
	return !Number.isNaN(headerTime) ? new Date(headerTime).toISOString() : statsMtime.toISOString();
}

function readEntries(path: string): SessionEntry[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	return parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
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

export function readTailEntries(path: string, maxBytes = TRACE_TRANSCRIPT_TAIL_MAX_BYTES): SessionEntry[] {
	if (!existsSync(path)) return [];
	const stats = statSync(path);
	if (stats.size <= maxBytes) return readEntries(path);
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

export function readTranscriptHistoryPage(
	path: string,
	input: {
		beforeByte?: number;
		beforeTimestamp?: string;
		limit?: number;
		pageBytes?: number;
		maxScanBytes?: number;
	} = {},
): TranscriptHistoryPage {
	if (!existsSync(path)) return { entries: [], hasOlder: false, scannedBytes: 0, startByte: 0, endByte: 0 };
	const stats = statSync(path);
	const fileSize = Math.max(0, stats.size);
	const initialEnd = input.beforeByte === undefined
		? fileSize
		: Math.max(0, Math.min(input.beforeByte, fileSize));
	const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
	const pageBytes = Math.max(1024, Math.min(input.pageBytes ?? TRACE_TRANSCRIPT_HISTORY_PAGE_MAX_BYTES, TRACE_TRANSCRIPT_HISTORY_SCAN_MAX_BYTES));
	const maxScanBytes = Math.max(pageBytes, Math.min(input.maxScanBytes ?? TRACE_TRANSCRIPT_HISTORY_SCAN_MAX_BYTES, 32 * 1024 * 1024));
	const beforeTime = input.beforeTimestamp ? Date.parse(input.beforeTimestamp) : undefined;
	const entries: Array<{ entry: SessionEntry; startByte: number }> = [];
	let cursorEnd = initialEnd;
	let scannedBytes = 0;
	let nextBeforeByte: number | undefined;

	while (cursorEnd > 0 && entries.length < limit && scannedBytes < maxScanBytes) {
		const chunkStart = Math.max(0, cursorEnd - pageBytes);
		const chunk = readUtf8Range(path, chunkStart, cursorEnd);
		scannedBytes += cursorEnd - chunkStart;
		const records = transcriptLineRecords(chunk, chunkStart, cursorEnd);
		for (let index = records.length - 1; index >= 0; index -= 1) {
			const record = records[index];
			const parsed = parseTranscriptLine(record.text);
			for (let entryIndex = parsed.length - 1; entryIndex >= 0; entryIndex -= 1) {
				const entry = parsed[entryIndex];
				if (beforeTime !== undefined && entryTimestampMs(entry) >= beforeTime) continue;
				entries.push({ entry, startByte: record.startByte });
				if (entries.length >= limit) {
					nextBeforeByte = record.startByte;
					break;
				}
			}
			if (entries.length >= limit) break;
		}
		cursorEnd = chunkStart;
	}

	if (nextBeforeByte === undefined) nextBeforeByte = cursorEnd > 0 ? cursorEnd : undefined;
	return {
		entries: entries.reverse().map((item) => item.entry),
		nextBeforeByte,
		hasOlder: nextBeforeByte !== undefined && nextBeforeByte > 0,
		scannedBytes,
		startByte: nextBeforeByte ?? 0,
		endByte: initialEnd,
	};
}

function readUtf8Range(path: string, start: number, end: number): string {
	const length = Math.max(0, end - start);
	if (length === 0) return "";
	const buffer = Buffer.alloc(length);
	const fd = openSync(path, "r");
	try {
		const bytesRead = readSync(fd, buffer, 0, length, start);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

function transcriptLineRecords(content: string, startByte: number, endByte: number): Array<{ text: string; startByte: number }> {
	let text = content;
	let byteOffset = startByte;
	if (startByte > 0) {
		const firstNewline = text.indexOf("\n");
		if (firstNewline < 0) return [];
		const skipped = text.slice(0, firstNewline + 1);
		byteOffset += Buffer.byteLength(skipped, "utf8");
		text = text.slice(firstNewline + 1);
	}
	if (endByte > startByte && text && !text.endsWith("\n")) {
		const lastNewline = text.lastIndexOf("\n");
		if (lastNewline >= 0) text = text.slice(0, lastNewline + 1);
	}
	const records: Array<{ text: string; startByte: number }> = [];
	const segments = text.match(/[^\n]*(?:\n|$)/g) ?? [];
	for (const segment of segments) {
		if (!segment) continue;
		const lineStart = byteOffset;
		byteOffset += Buffer.byteLength(segment, "utf8");
		const line = segment.replace(/\r?\n$/, "");
		if (line.trim()) records.push({ text: line, startByte: lineStart });
	}
	return records;
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

function offsetTranscriptTraceOrder(nodes: PiboTraceNode[], offset: number): void {
	for (const node of nodes) {
		if (node.source === "transcript" && node.orderKey) {
			const transcriptIndex = node.orderKey.transcriptIndex;
			node.orderKey = {
				...node.orderKey,
				turnSeq: node.orderKey.turnSeq + offset,
				transcriptIndex: transcriptIndex === undefined ? undefined : transcriptIndex + offset,
			};
		}
		offsetTranscriptTraceOrder(node.children, offset);
	}
}

function annotateForkableUserMessageNodes(nodes: PiboTraceNode[], entries: SessionEntry[]): void {
	const candidates = userMessageForkCandidates(entries);
	if (!candidates.length) return;
	const used = new Set<string>();
	for (const node of flattenTraceNodesForForkAnnotation(nodes)) {
		if (node.type !== "user.message" || node.entryId) continue;
		const text = stringValue(node.output) ?? stringValue(node.summary) ?? "";
		const candidate = candidates.find((item) => !used.has(item.entryId) && item.text === text);
		if (!candidate) continue;
		node.entryId = candidate.entryId;
		used.add(candidate.entryId);
	}
}

function flattenTraceNodesForForkAnnotation(nodes: PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const visit = (items: PiboTraceNode[]) => {
		for (const item of items) {
			flattened.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return flattened;
}

function userMessageForkCandidates(entries: SessionEntry[]): Array<{ entryId: string; text: string }> {
	const candidates: Array<{ entryId: string; text: string }> = [];
	for (const entry of entries) {
		if (entry.type !== "message" || messageRole(entry) !== "user") continue;
		const text = extractMessageText(messageContent(entry));
		if (text) candidates.push({ entryId: entry.id, text });
	}
	return candidates;
}

function messageRole(entry: SessionEntry): unknown {
	return entry.type === "message" ? (entry.message as { role?: unknown }).role : undefined;
}

function messageContent(entry: SessionEntry): unknown {
	return entry.type === "message" ? (entry.message as { content?: unknown }).content : undefined;
}

function extractMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const typed = part as { type?: unknown; text?: unknown };
			return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
		})
		.join("");
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
