import { requestJson } from "./api-http";

export type WebAnnotationTargetSummary = {
	id: string;
	type: string;
	title: string;
	url: string;
	attachable: boolean;
};

export type WebAnnotationBindingSummary = {
	id: string;
	piboSessionId: string;
	piboRoomId?: string;
	state: string;
	url: string;
	title?: string;
	targetId?: string;
	createdAt: string;
	lastInjectedAt?: string;
	error?: string;
};

export type WebAnnotationOverlayConfig = {
	bindingId: string;
	bindingToken: string;
	piboSessionId?: string;
	apiBaseUrl?: string;
	annotationShortcut?: string;
};

export type WebAnnotationBindingResponse = {
	ok: true;
	binding: WebAnnotationBindingSummary;
	target?: WebAnnotationTargetSummary;
	overlay?: WebAnnotationOverlayConfig;
	injected?: boolean;
	stopped?: boolean;
};

export type WebAnnotationStatus = "open" | "attached" | "acknowledged" | "applying" | "needs_review" | "resolved" | "dismissed" | "failed";

export type WebAnnotationMessageAttachment = {
	id: string;
	status: WebAnnotationStatus;
	targetKind: string;
	piboSessionId: string;
	piboRoomId?: string;
	url: string;
	label?: string;
	selector?: string;
	primaryTarget?: string;
	piboContext?: string;
	sourceHint?: string;
	sourceHints?: string[];
	position?: string;
	text?: string;
	note: string;
	createdAt: string;
};

export type WebAnnotationListResponse = {
	ok: true;
	scope?: "session" | "app";
	annotations: WebAnnotationMessageAttachment[];
};

export async function listWebAnnotations(piboSessionId: string, input: { status?: WebAnnotationStatus; limit?: number; scope?: "session" | "app" } = {}): Promise<WebAnnotationListResponse> {
	const params = new URLSearchParams({ piboSessionId });
	if (input.status) params.set("status", input.status);
	if (input.limit) params.set("limit", String(input.limit));
	if (input.scope) params.set("scope", input.scope);
	return requestJson<WebAnnotationListResponse>(`/api/web-annotations?${params.toString()}`);
}

export async function patchWebAnnotation(annotationId: string, input: { piboSessionId: string; status?: WebAnnotationStatus; summary?: string | null }): Promise<{ ok: true; annotation: WebAnnotationMessageAttachment }> {
	return requestJson<{ ok: true; annotation: WebAnnotationMessageAttachment }>(`/api/web-annotations/${encodeURIComponent(annotationId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function listWebAnnotationTargets(cdpUrl?: string): Promise<{ ok: true; targets: WebAnnotationTargetSummary[] }> {
	const params = new URLSearchParams();
	if (cdpUrl?.trim()) params.set("cdpUrl", cdpUrl.trim());
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<{ ok: true; targets: WebAnnotationTargetSummary[] }>(`/api/web-annotations/targets${suffix}`);
}

export async function createWebAnnotationBinding(input: {
	piboSessionId: string;
	piboRoomId?: string;
	url?: string;
	title?: string;
	targetId?: string;
	cdpUrl?: string;
	sameOrigin?: boolean;
	annotationShortcut?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>("/api/web-annotations/bindings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function injectWebAnnotationBinding(bindingId: string, input: {
	piboSessionId: string;
	piboRoomId?: string;
	cdpUrl?: string;
	annotationShortcut?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>(`/api/web-annotations/bindings/${encodeURIComponent(bindingId)}/inject`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== "")) as Partial<T>;
}
