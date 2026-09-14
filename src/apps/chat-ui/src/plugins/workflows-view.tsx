import { MinimalWorkflowsArea } from "../MinimalWorkflowsArea";
import { WorkflowVersionPanel } from "../desktop-workflow-version-panel";
import type { PluginViewProps } from "./browser-host";
import { useBoundBootstrap } from "./use-bound-bootstrap";

export function WorkflowsView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	const viewWorkflowId = typeof props.state.viewWorkflowId === "string" ? props.state.viewWorkflowId : undefined;
	const viewWorkflowVersion = typeof props.state.viewWorkflowVersion === "string" ? props.state.viewWorkflowVersion : undefined;
	if (!bootstrap) return <p role={error ? "alert" : "status"}>{error ?? "Loading workflows…"}</p>;
	if (viewWorkflowId && viewWorkflowVersion) return <WorkflowVersionPanel workflowId={viewWorkflowId} workflowVersion={viewWorkflowVersion} />;
	return <MinimalWorkflowsArea
		room={bootstrap.room}
		draftId={typeof props.state.draftId === "string" ? props.state.draftId : undefined}
		onNavigateDraft={(draftId) => props.updateState({ ...props.state, draftId })}
	/>;
}
