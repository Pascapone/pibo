import { useState } from "react";
import { RemoteAgentArea } from "../RemoteAgentArea";
import { RemoteAgentHistoryArea } from "../RemoteAgentHistoryArea";
import { ResponsiveTabSidebarPanel } from "../responsive-pane-sidebar";
import type { PluginViewProps } from "./browser-host";
import { FirstPartySubviewNavigation, type FirstPartySubview } from "./first-party-subview-navigation";
import { useBoundBootstrap } from "./use-bound-bootstrap";

const REMOTE_AGENT_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "config", title: "Configuration", description: "rooms + connections" },
	{ id: "history", title: "History", description: "tool call history" },
];

export function RemoteAgentView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	const [subview, setSubview] = useState("config");
	if (!bootstrap) {
		return <p role={error ? "alert" : "status"}>{error ?? "Loading remote agent…"}</p>;
	}
	return <ResponsiveTabSidebarPanel
		label="Remote Agent"
		sidebar={<FirstPartySubviewNavigation label="Remote Agent" activeId={subview} items={REMOTE_AGENT_SUBVIEWS} onSelect={setSubview} />}
	>
		{subview === "history"
			? <RemoteAgentHistoryArea bootstrap={bootstrap} initialRoomId={props.roomId} />
			: <RemoteAgentArea bootstrap={bootstrap} initialRoomId={props.roomId} />}
	</ResponsiveTabSidebarPanel>;
}
