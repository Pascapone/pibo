import { ResponsiveTabSidebarPanel } from "../responsive-pane-sidebar";
import type { PluginViewProps } from "./browser-host";
import { FirstPartySubviewNavigation, type FirstPartySubview } from "./first-party-subview-navigation";

const TOOL_FAMILY_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "settings", title: "Settings", description: "configuration + lifecycle" },
	{ id: "context", title: "Context", description: "runtime delivery" },
];

export function ToolFamilyView(props: PluginViewProps) {
	const pluginId = props.tab.pluginId;
	const subview = props.tab.subviewId === "context" ? "context" : "settings";
	return <ResponsiveTabSidebarPanel
		label={props.tab.fallback}
		sidebar={<FirstPartySubviewNavigation label={props.tab.fallback} activeId={subview} items={TOOL_FAMILY_SUBVIEWS} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
	>
		<div className="space-y-3 p-4 text-sm text-slate-300">
			<h2 className="font-semibold text-slate-100">{subview === "context" ? "Context delivery" : props.tab.fallback}</h2>
			<p>{subview === "context" ? "Context and runtime delivery follow the immutable plugin selection and capability report." : "Agent delivery is controlled by the immutable plugin selection and runtime capability report. This system view does not grant tools."}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-slate-500">Plugin</dt><dd className="font-mono">{pluginId}</dd><dt className="text-slate-500">Revision</dt><dd className="break-all font-mono">{props.tab.pluginRevision}</dd><dt className="text-slate-500">Session</dt><dd className="font-mono">{props.piboSessionId}</dd></dl>
		</div>
	</ResponsiveTabSidebarPanel>;
}
