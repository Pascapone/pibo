import type { ChatAppRoute } from "./app-routes";
import { WorkflowVersionViewer } from "./workflows/WorkflowVersionViewer";

type WorkflowRoute = Extract<ChatAppRoute, { area: "workflows" }>;

export type DesktopWorkflowVersionSelection = {
	workflowId: string;
	workflowVersion: string;
};

export function desktopWorkflowVersionSelection(route: WorkflowRoute): DesktopWorkflowVersionSelection | undefined {
	return route.viewWorkflowId && route.viewWorkflowVersion
		? { workflowId: route.viewWorkflowId, workflowVersion: route.viewWorkflowVersion }
		: undefined;
}

export function DesktopWorkflowVersionPanel({ workflowId, workflowVersion }: DesktopWorkflowVersionSelection) {
	return (
		<main className="h-full min-h-0 overflow-auto bg-[#101d22] p-6 max-[720px]:p-4" data-pibo-debug="desktop-workflow-version-viewer">
			<div className="mx-auto w-full max-w-4xl">
				<WorkflowVersionViewer workflowId={workflowId} workflowVersion={workflowVersion} />
			</div>
		</main>
	);
}
