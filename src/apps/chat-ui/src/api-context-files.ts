import { requestJson } from "./api-http";

export type ContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	absolutePath: string;
	source: "plugin" | "managed";
	scope: "global" | "agent";
	agentProfileName?: string;
	managed: boolean;
	dynamic: boolean;
	editable: boolean;
	removable: boolean;
	exists: boolean;
	bytes?: number;
	updatedAt?: string;
	version?: string;
	sourceRef?: string;
	sourceHash?: string;
	linkState: "plugin-only" | "linked-clean" | "linked-dirty" | "linked-stale" | "orphaned" | "managed-unlinked";
	activeRevisionId?: string;
};

export type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

export type ContextFileRevision = {
	id: string;
	kind: "source-snapshot" | "working";
	contentHash: string;
	createdAt: string;
	actorId?: string;
	basedOnRevisionId?: string;
	sourceHashAtCreation?: string;
	note?: string;
	content: string;
	active: boolean;
};

export type ContextFileDiff = {
	base: { kind: "source" | "working"; contentHash?: string };
	target: { kind: "source" | "working"; contentHash?: string };
	chunks: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>;
};

export async function postContextFile(input: {
	label: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<{
	file: ContextFileDocument;
}> {
	return requestJson("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function listContextFiles(): Promise<ContextFileInfo[]> {
	return (await requestJson<{ files: ContextFileInfo[] }>("/api/context-files")).files;
}

export async function readContextFile(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`)).file;
}

export async function createContextFile(input: {
	label?: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function linkContextFileFromPlugin(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string } = {},
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/link-from-plugin`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function saveContextFile(
	key: string,
	input: { markdown: string; expectedVersion?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function updateContextFileMetadata(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function removeContextFile(key: string, deleteFile: boolean): Promise<void> {
	await requestJson(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ deleteFile }),
	});
}

export async function listContextFileRevisions(key: string): Promise<{ revisions: ContextFileRevision[]; activeRevisionId?: string }> {
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/revisions`);
}

export async function diffContextFile(
	key: string,
	base: "source" | "working" = "source",
	target: "source" | "working" = "working",
): Promise<ContextFileDiff> {
	const params = new URLSearchParams({ base, target });
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/diff?${params.toString()}`);
}

export async function resetContextFileToSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/reset-to-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function adoptContextFileSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/adopt-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function restoreContextFileRevision(key: string, revisionId: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/restore-revision`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ revisionId }),
	})).file;
}
