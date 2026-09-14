import { useCallback, useEffect, useMemo, useState } from "react";
import {
	getSessionLivePreviews,
	removeSessionLivePreview,
	startSessionLivePreview,
	stopSessionLivePreview,
	subscribeSessionLivePreviewEvents,
	type SessionLivePreview,
} from "../api-previews";
import { SessionLivePreviewPanel } from "../session-live-preview";
import type { PluginViewProps } from "./browser-host";

export function PreviewView(props: PluginViewProps) {
	const [previews, setPreviews] = useState<SessionLivePreview[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [reloadKey, setReloadKey] = useState(0);
	const [pendingId, setPendingId] = useState<string | undefined>();
	const [fullscreen, setFullscreen] = useState(false);
	const selectedId = typeof props.state.previewId === "string" ? props.state.previewId : previews[0]?.id;
	const selectedPreview = useMemo(() => previews.find((preview) => preview.id === selectedId) ?? previews[0], [previews, selectedId]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const result = await getSessionLivePreviews(props.piboSessionId, { signal: props.signal });
			if (props.signal.aborted) return;
			setPreviews(result.previews);
			const selected = result.previews.find((preview) => preview.id === selectedId) ?? result.previews[0];
			if (selected && selected.id !== selectedId) props.updateState({ ...props.state, previewId: selected.id });
		} catch (caught) {
			if (!props.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			if (!props.signal.aborted) setLoading(false);
		}
	}, [props.piboSessionId, props.signal, selectedId]);

	useEffect(() => { void load(); }, [load]);
	useEffect(() => subscribeSessionLivePreviewEvents(props.piboSessionId, ({ preview }) => {
		if (preview.piboSessionId !== props.piboSessionId) return;
		setPreviews((current) => [...current.filter((candidate) => candidate.id !== preview.id), preview]);
		props.updateState({ ...props.state, previewId: preview.id });
	}), [props.piboSessionId]);

	const run = async (previewId: string, action: "start" | "stop" | "remove") => {
		if (pendingId) return;
		setPendingId(previewId);
		setError(undefined);
		try {
			if (action === "remove") {
				await removeSessionLivePreview(previewId);
				setPreviews((current) => current.filter((preview) => preview.id !== previewId));
			} else {
				const preview = action === "start" ? await startSessionLivePreview(previewId) : await stopSessionLivePreview(previewId);
				if (preview.piboSessionId !== props.piboSessionId) throw new Error("Preview lifecycle response belongs to a different Pibo Session");
				setPreviews((current) => current.map((candidate) => candidate.id === preview.id ? preview : candidate));
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPendingId(undefined);
		}
	};

	return <div className={fullscreen ? "fixed inset-0 z-[100] flex min-h-0 flex-col bg-[#0e1116]" : "flex h-full min-h-0 flex-col"}>
		<SessionLivePreviewPanel
			previews={previews}
			selectedPreview={selectedPreview}
			loading={loading}
			error={error}
			reloadKey={reloadKey}
			actionPending={Boolean(pendingId)}
			fullscreen={fullscreen}
			onSelect={(previewId) => props.updateState({ ...props.state, previewId })}
			onRefresh={() => { void load(); }}
			onReload={() => setReloadKey((value) => value + 1)}
			onStart={(previewId) => { void run(previewId, "start"); }}
			onStop={(previewId) => { void run(previewId, "stop"); }}
			onRemove={(previewId) => { void run(previewId, "remove"); }}
			onEnterFullscreen={() => setFullscreen(true)}
			onExitFullscreen={() => setFullscreen(false)}
		/>
	</div>;
}
