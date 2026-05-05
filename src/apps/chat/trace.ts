import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseSessionEntries, SessionManager, type SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PiboSessionListItem } from "../../core/events.js";
import type { ModelProfile } from "../../core/profiles.js";
import type { PiboSession } from "../../sessions/store.js";
import { buildTraceViewFromEvents } from "../../shared/trace-engine.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../../shared/trace-types.js";
import type { ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "./read-model.js";
import { isChatWebSessionArchived } from "./session-metadata.js";

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboWebDerivedSessionNode = {
	piboSessionId: string;
	profile: string;
	activeModel?: ModelProfile;
	subagentName?: string;
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
	name?: string;
	firstMessage?: string;
	modified?: string;
};

type TraceBuildInput = {
	session: PiboSession;
	sessions: PiboSession[];
	events: ChatWebStoredPiboEvent[];
	status?: PiboWebSessionStatus;
	cwd?: string;
	includeRawEvents?: boolean;
	rawEventsLimit?: number;
	latestStreamId?: number;
};

export async function loadPiSessionMetadata(
	session: PiboSession,
	cwd = process.cwd(),
): Promise<SessionMetadata> {
	const piSession = await findPiSession(session, cwd);
	return metadataFromPiSession(piSession);
}

function metadataFromPiSession(piSession: PiboSessionListItem | undefined): SessionMetadata {
	if (!piSession) return {};
	return {
		sessionPath: piSession.path,
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
): Promise<PiboWebSessionNode[]> {
	const indexByKey = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	const nodes = new Map<string, PiboWebSessionNode>();
	const piSessionsByCwd = new Map<string, Promise<PiboSessionListItem[]>>();

	for (const session of sessions) {
		const sessionCwd = session.workspace ?? cwd;
		let piSessions = piSessionsByCwd.get(sessionCwd);
		if (!piSessions) {
			piSessions = listPiSessions(sessionCwd);
			piSessionsByCwd.set(sessionCwd, piSessions);
		}
		const metadata = metadataFromPiSession(
			(await piSessions).find((piSession) => piSession.id === session.piSessionId),
		);
		const indexed = indexByKey.get(session.id);
		nodes.set(session.id, {
			piboSessionId: session.id,
			piSessionId: session.piSessionId,
			parentId: session.parentId,
			originId: session.originId,
			profile: session.profile,
			activeModel: session.activeModel,
			subagentName: stringValue(session.metadata?.subagentName),
			title: createSessionTitle(session, metadata),
			subtitle: session.id,
			archived: isChatWebSessionArchived(session),
			status: indexed?.status ?? "idle",
			lastActivityAt: indexed?.lastActivityAt ?? metadata.modified ?? session.updatedAt,
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

export async function buildTraceView(input: TraceBuildInput): Promise<PiboSessionTraceView> {
	const metadata = await loadPiSessionMetadata(input.session, input.session.workspace ?? input.cwd);
	const allEntries = metadata.sessionPath ? readEntries(metadata.sessionPath) : [];
	const sessionStatus = input.status ?? "idle";

	const view = buildTraceViewFromEvents({
		session: {
			id: input.session.id,
			piSessionId: input.session.piSessionId,
			title: createSessionTitle(input.session, metadata),
		},
		events: input.events as unknown as import("../../shared/trace-types.js").ChatWebStoredEvent[],
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
				session: {
					id: input.session.id,
					piSessionId: input.session.piSessionId,
					profile: input.session.profile,
					title: input.session.title ?? null,
					updatedAt: input.session.updatedAt,
				},
				metadata: {
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

export async function listPiSessions(cwd = process.cwd()): Promise<PiboSessionListItem[]> {
	const sessions = await SessionManager.list(cwd);
	return sessions.map((session) => ({
		path: session.path,
		id: session.id,
		cwd: session.cwd,
		name: session.name,
		parentSessionPath: session.parentSessionPath,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	}));
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
	const sessions = await listPiSessions(cwd);
	return sessions.find((session) => session.id === piboSession.piSessionId);
}

function readEntries(path: string): SessionEntry[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	return parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
