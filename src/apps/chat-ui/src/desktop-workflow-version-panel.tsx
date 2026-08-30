import type { ChatAppRoute } from "./app-routes";
import type { ReactNode } from "react";
import { WorkflowVersionViewer } from "./workflows/WorkflowVersionViewer";

type WorkflowRoute = Extract<ChatAppRoute, { area: "workflows" }>;

export type WorkflowVersionSelection = {
	workflowId: string;
	workflowVersion: string;
};

export function workflowVersionSelection(route: WorkflowRoute): WorkflowVersionSelection | undefined {
	return route.viewWorkflowId && route.viewWorkflowVersion
		? { workflowId: route.viewWorkflowId, workflowVersion: route.viewWorkflowVersion }
		: undefined;
}

export const desktopWorkflowVersionSelection = workflowVersionSelection;

export function WorkflowVersionPanel({
	workflowId,
	workflowVersion,
	surface = "desktop",
}: WorkflowVersionSelection & { surface?: "desktop" | "mobile" }) {
	return (
		<main className="h-full min-h-0 overflow-auto bg-[#101d22] p-6 max-[720px]:p-4" data-pibo-debug={`${surface}-workflow-version-viewer`}>
			<div className="mx-auto w-full max-w-4xl">
				<WorkflowVersionViewer workflowId={workflowId} workflowVersion={workflowVersion} />
			</div>
		</main>
	);
}

export function DesktopWorkflowVersionPanel(selection: WorkflowVersionSelection) {
	return <WorkflowVersionPanel {...selection} />;
}

export function RoutedWorkflowsPanel({
	route,
	surface,
	fallback,
}: {
	route: WorkflowRoute;
	surface: "desktop" | "mobile";
	fallback: ReactNode;
}) {
	const selection = workflowVersionSelection(route);
	return selection
		? <WorkflowVersionPanel {...selection} surface={surface} />
		: fallback;
}
