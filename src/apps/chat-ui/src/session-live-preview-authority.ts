import type { SessionLivePreview, SessionLivePreviewList } from "./api-previews";

export type SessionLivePreviewQueryEnvelope = SessionLivePreviewList & {
	piboSessionId: string;
};

export type SessionLivePreviewAuthority =
	| { kind: "idle"; piboSessionId?: undefined; previews: readonly [] }
	| { kind: "loading"; piboSessionId: string; previews: readonly [] }
	| { kind: "error"; piboSessionId: string; previews: readonly []; message: string }
	| { kind: "unconfigured"; piboSessionId: string; previews: readonly [] }
	| { kind: "empty"; piboSessionId: string; previews: readonly [] }
	| { kind: "ready"; piboSessionId: string; previews: readonly SessionLivePreview[] };

export type SessionLivePreviewSelection = {
	piboSessionId: string;
	previewId: string;
};

export function resolveSessionLivePreviewAuthority(input: {
	selectedPiboSessionId?: string;
	data?: SessionLivePreviewQueryEnvelope;
	loading: boolean;
	error?: string;
}): SessionLivePreviewAuthority {
	const piboSessionId = input.selectedPiboSessionId;
	if (!piboSessionId) return { kind: "idle", previews: [] };
	if (input.error) return { kind: "error", piboSessionId, previews: [], message: input.error };
	if (input.loading || input.data?.piboSessionId !== piboSessionId) {
		return { kind: "loading", piboSessionId, previews: [] };
	}
	if (!input.data.configured) return { kind: "unconfigured", piboSessionId, previews: [] };
	if (input.data.previews.length === 0) return { kind: "empty", piboSessionId, previews: [] };
	return { kind: "ready", piboSessionId, previews: input.data.previews };
}

export function selectAuthoritativeLivePreview(
	authority: SessionLivePreviewAuthority,
	selection?: SessionLivePreviewSelection,
): SessionLivePreview | undefined {
	if (authority.kind !== "ready") return undefined;
	if (selection?.piboSessionId !== authority.piboSessionId) return authority.previews[0];
	return authority.previews.find((preview) => preview.id === selection.previewId) ?? authority.previews[0];
}

export function requirePreviewActionAuthority(expectedPiboSessionId: string, preview: SessionLivePreview): SessionLivePreview {
	if (preview.piboSessionId !== expectedPiboSessionId) {
		throw new Error("Preview lifecycle response belongs to a different Pibo Session");
	}
	return preview;
}
