import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	listWebAnnotations,
	patchWebAnnotation,
	type WebAnnotationMessageAttachment,
} from "./api-web-annotations";
import {
	parseStoredWebAnnotationOverlayState,
	parseWebAnnotationOverlayState,
	readStoredSelectedWebAnnotationIds,
	readStoredWebAnnotationOverlayState,
	readStoredWebAnnotationsPanelCollapsed,
	storedWebAnnotationOverlayStateKey,
	writeStoredSelectedWebAnnotationIds,
	writeStoredWebAnnotationsPanelCollapsed,
	type WebAnnotationOverlayPanelState,
} from "./web-annotation-storage";

export function useSessionWebAnnotations({
	selectedPiboSessionId,
	onError,
	formatError,
}: {
	selectedPiboSessionId: string | null | undefined;
	onError: (message: string | null) => void;
	formatError: (caught: unknown, fallback: string) => string;
}) {
	const [selectedWebAnnotationIds, setSelectedWebAnnotationIds] = useState<string[]>([]);
	const [webAnnotationsPanelVisible, setWebAnnotationsPanelVisible] = useState(false);
	const [webAnnotationOverlayState, setWebAnnotationOverlayState] = useState<WebAnnotationOverlayPanelState | null>(() => selectedPiboSessionId ? readStoredWebAnnotationOverlayState(selectedPiboSessionId) : null);
	const [webAnnotationsPanelCollapsed, setWebAnnotationsPanelCollapsed] = useState(() => readStoredWebAnnotationsPanelCollapsed());
	const [clearingWebAnnotations, setClearingWebAnnotations] = useState(false);

	const webAnnotationOverlayInstalled = Boolean(
		selectedPiboSessionId
		&& webAnnotationOverlayState?.piboSessionId === selectedPiboSessionId
		&& webAnnotationOverlayState.installed,
	);
	const webAnnotationsPanelRendered = Boolean(selectedPiboSessionId) && (webAnnotationsPanelVisible || webAnnotationOverlayInstalled);

	const webAnnotationsQuery = useQuery({
		queryKey: ["web-annotations", "app", selectedPiboSessionId],
		queryFn: async () => {
			if (!selectedPiboSessionId) throw new Error("Session is required");
			return listWebAnnotations(selectedPiboSessionId, { limit: 100, scope: "app" });
		},
		enabled: Boolean(selectedPiboSessionId) && (webAnnotationsPanelRendered || selectedWebAnnotationIds.length > 0),
		staleTime: 1_000,
		refetchOnWindowFocus: webAnnotationsPanelRendered,
		refetchInterval: webAnnotationsPanelRendered ? 5_000 : false,
		retry: 1,
	});
	const refetchWebAnnotations = webAnnotationsQuery.refetch;
	const visibleWebAnnotations = useMemo(
		() => (webAnnotationsQuery.data?.annotations ?? []).filter((annotation) => annotation.status !== "resolved" && annotation.status !== "dismissed"),
		[webAnnotationsQuery.data?.annotations],
	);
	const selectedWebAnnotations = useMemo(
		() => selectedWebAnnotationIds
			.map((id) => visibleWebAnnotations.find((annotation) => annotation.id === id))
			.filter((annotation): annotation is WebAnnotationMessageAttachment => Boolean(annotation)),
		[selectedWebAnnotationIds, visibleWebAnnotations],
	);

	useEffect(() => {
		setSelectedWebAnnotationIds(selectedPiboSessionId ? readStoredSelectedWebAnnotationIds(selectedPiboSessionId) : []);
		setWebAnnotationOverlayState(selectedPiboSessionId ? readStoredWebAnnotationOverlayState(selectedPiboSessionId) : null);
	}, [selectedPiboSessionId]);

	useEffect(() => {
		if (!selectedPiboSessionId) return;
		const applyOverlayState = (state: WebAnnotationOverlayPanelState | null) => {
			if (!state || state.piboSessionId !== selectedPiboSessionId) return;
			setWebAnnotationOverlayState((current) => {
				if (state.installed) return state;
				if (current?.installed && current.bindingId && state.bindingId && current.bindingId !== state.bindingId) return current;
				return state;
			});
			if (state.installed) {
				void refetchWebAnnotations();
			} else {
				setWebAnnotationsPanelVisible(false);
			}
		};
		const handleOverlayState = (event: Event) => applyOverlayState(parseWebAnnotationOverlayState((event as CustomEvent).detail));
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== storedWebAnnotationOverlayStateKey(selectedPiboSessionId)) return;
			applyOverlayState(parseStoredWebAnnotationOverlayState(event.newValue));
		};
		const refreshFromStorage = () => applyOverlayState(readStoredWebAnnotationOverlayState(selectedPiboSessionId));
		window.addEventListener("pibo:web-annotation-overlay-state", handleOverlayState);
		window.addEventListener("storage", handleStorage);
		window.addEventListener("focus", refreshFromStorage);
		document.addEventListener("visibilitychange", refreshFromStorage);
		refreshFromStorage();
		return () => {
			window.removeEventListener("pibo:web-annotation-overlay-state", handleOverlayState);
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener("focus", refreshFromStorage);
			document.removeEventListener("visibilitychange", refreshFromStorage);
		};
	}, [refetchWebAnnotations, selectedPiboSessionId]);

	useEffect(() => {
		if (!webAnnotationsQuery.data) return;
		if (!visibleWebAnnotations.length) {
			setSelectedWebAnnotationIds((current) => {
				if (current.length && selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, []);
				return current.length ? [] : current;
			});
			return;
		}
		const visibleIds = new Set(visibleWebAnnotations.map((annotation) => annotation.id));
		setSelectedWebAnnotationIds((current) => {
			const next = current.filter((id) => visibleIds.has(id));
			if (next.length !== current.length && selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, next);
			return next.length === current.length ? current : next;
		});
	}, [selectedPiboSessionId, visibleWebAnnotations, webAnnotationsQuery.data]);

	useEffect(() => {
		const handleSaved = () => {
			setWebAnnotationsPanelVisible(true);
			void refetchWebAnnotations();
		};
		window.addEventListener("pibo:web-annotation-saved", handleSaved);
		return () => window.removeEventListener("pibo:web-annotation-saved", handleSaved);
	}, [refetchWebAnnotations]);

	const updateSelectedWebAnnotationIds = useCallback((updater: (current: string[]) => string[]) => {
		setSelectedWebAnnotationIds((current) => {
			const next = updater(current);
			if (selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, next);
			return next;
		});
	}, [selectedPiboSessionId]);

	const toggleWebAnnotationAttachment = useCallback((annotationId: string) => {
		updateSelectedWebAnnotationIds((current) => current.includes(annotationId)
			? current.filter((id) => id !== annotationId)
			: [...current, annotationId].slice(0, 5));
	}, [updateSelectedWebAnnotationIds]);

	const clearSelectedWebAnnotationAttachments = useCallback(() => updateSelectedWebAnnotationIds(() => []), [updateSelectedWebAnnotationIds]);

	const detachWebAnnotationAttachment = useCallback((annotationId: string) => {
		updateSelectedWebAnnotationIds((current) => current.filter((candidate) => candidate !== annotationId));
	}, [updateSelectedWebAnnotationIds]);

	const toggleWebAnnotationsPanelCollapsed = useCallback(() => {
		setWebAnnotationsPanelCollapsed((current) => {
			const next = !current;
			writeStoredWebAnnotationsPanelCollapsed(next);
			return next;
		});
	}, []);

	const clearVisibleWebAnnotations = useCallback(async () => {
		if (!visibleWebAnnotations.length || clearingWebAnnotations) return;
		if (!window.confirm(`Dismiss ${visibleWebAnnotations.length} visible web annotations? This keeps sent messages but clears the annotation list.`)) return;
		setClearingWebAnnotations(true);
		try {
			await Promise.all(visibleWebAnnotations.map((annotation) => patchWebAnnotation(annotation.id, { piboSessionId: annotation.piboSessionId, status: "dismissed", summary: "Cleared from Chat Web UI" })));
			clearSelectedWebAnnotationAttachments();
			await refetchWebAnnotations();
		} catch (caught) {
			onError(formatError(caught, "Could not clear web annotations"));
		} finally {
			setClearingWebAnnotations(false);
		}
	}, [clearingWebAnnotations, clearSelectedWebAnnotationAttachments, formatError, onError, refetchWebAnnotations, visibleWebAnnotations]);

	return {
		selectedWebAnnotationIds,
		selectedWebAnnotations,
		visibleWebAnnotations,
		webAnnotationsPanelCollapsed,
		webAnnotationsPanelRendered,
		webAnnotationsPanelVisible,
		webAnnotationsQuery,
		clearingWebAnnotations,
		setWebAnnotationsPanelVisible,
		toggleWebAnnotationAttachment,
		detachWebAnnotationAttachment,
		clearSelectedWebAnnotationAttachments,
		toggleWebAnnotationsPanelCollapsed,
		clearVisibleWebAnnotations,
	};
}
