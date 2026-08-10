export type SaveState = "idle" | "saving" | "saved" | "error";

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
};

export type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

export type ContextFileRevision = {
	id: string;
	name: string;
	contentHash: string;
	createdAt: string;
	actorId?: string;
	content: string;
};

export type ContextFileDiff = {
	base: { kind: "source" | "working"; contentHash?: string };
	target: { kind: "source" | "working"; contentHash?: string };
	chunks: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>;
};

export type ProductEvent = {
	id?: string;
	type: string;
	source: string;
	actorId?: string;
	createdAt?: string;
	payload?: {
		key?: string;
		path?: string;
		version?: string;
		updatedAt?: string;
		[name: string]: unknown;
	};
};

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

export async function listContextFileRevisions(key: string): Promise<{ revisions: ContextFileRevision[] }> {
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/revisions`);
}

export async function createContextFileRevision(key: string, name: string): Promise<ContextFileRevision> {
	return (await requestJson<{ revision: ContextFileRevision }>(`/api/context-files/${encodeURIComponent(key)}/revisions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name }),
	})).revision;
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

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(url, {
		credentials: "same-origin",
		...init,
		headers: {
			accept: "application/json",
			...init.headers,
		},
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = data && typeof data === "object" && "error" in data ? String(data.error) : response.statusText;
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = data;
		throw error;
	}
	return data as T;
}
