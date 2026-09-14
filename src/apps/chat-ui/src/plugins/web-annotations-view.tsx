import { useState } from "react";
import { ResponsiveTabSidebarPanel } from "../responsive-pane-sidebar";
import { useSessionWebAnnotations } from "../use-session-web-annotations";
import { compactWebAnnotationError, WebAnnotationsControls, WebAnnotationsSessionPanel } from "../web-annotations";
import type { PluginViewProps } from "./browser-host";
import { FirstPartySubviewNavigation, type FirstPartySubview } from "./first-party-subview-navigation";

const WEB_ANNOTATION_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "annotations", title: "Annotations", description: "saved browser notes" },
	{ id: "settings", title: "Settings", description: "capture + shortcut" },
	{ id: "context", title: "Context", description: "delivery boundaries" },
];

export function WebAnnotationsView(props: PluginViewProps) {
	const [error, setError] = useState<string | null>(null);
	const annotations = useSessionWebAnnotations({
		selectedPiboSessionId: props.piboSessionId,
		onError: setError,
		formatError: compactWebAnnotationError,
		forcePanelVisible: true,
	});
	const subview = WEB_ANNOTATION_SUBVIEWS.find((item) => item.id === props.tab.subviewId)?.id ?? "annotations";
	const content = subview === "settings"
		? <WebAnnotationsControls piboSessionId={props.piboSessionId} piboRoomId={props.roomId} disabled={false} onError={setError} />
		: subview === "context"
			? <div className="space-y-2 p-4 text-sm text-slate-300"><p>Web Annotation tools receive the current Pibo Session ID from runtime context. The skill body loads progressively; API, settings, and browser state are not injected into model context.</p><p className="text-xs text-slate-500">App, agent, and session configuration previews are separate from immutable saved generation plans.</p></div>
			: <WebAnnotationsSessionPanel
				piboSessionId={props.piboSessionId}
				annotations={annotations.visibleWebAnnotations}
				selectedIds={annotations.selectedWebAnnotationIds}
				loading={annotations.webAnnotationsQuery.isFetching || annotations.clearingWebAnnotations}
				error={error ?? (annotations.webAnnotationsQuery.error ? compactWebAnnotationError(annotations.webAnnotationsQuery.error, "Could not load web annotations") : null)}
				onRefresh={() => { void annotations.webAnnotationsQuery.refetch(); }}
				onToggle={annotations.toggleWebAnnotationAttachment}
				onClear={() => { void annotations.clearVisibleWebAnnotations(); }}
			/>;
	return <ResponsiveTabSidebarPanel
		label="Web Annotations"
		sidebar={<FirstPartySubviewNavigation label="Web Annotations" activeId={subview} items={WEB_ANNOTATION_SUBVIEWS} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
	>
		{content}
	</ResponsiveTabSidebarPanel>;
}
