import type {
	WorkflowCatalogAction,
	WorkflowCatalogVersionRecord,
	WorkflowVersionHistoryOption,
} from "../api-workflows";

export type WorkflowVersionHistoryGroup = {
	workflowId: string;
	title: string;
	source: WorkflowCatalogVersionRecord["source"];
	records: WorkflowVersionHistoryOption[];
};

export function groupWorkflowVersionHistory(rows: WorkflowVersionHistoryOption[]): WorkflowVersionHistoryGroup[] {
	const groups = new Map<string, WorkflowVersionHistoryGroup>();
	for (const row of rows) {
		const existing = groups.get(row.id);
		if (existing) {
			existing.records.push(row);
			if (row.status === "published" && existing.records[0]?.status !== "published") {
				existing.title = row.title;
				existing.source = row.source;
			}
			continue;
		}
		groups.set(row.id, {
			workflowId: row.id,
			title: row.title,
			source: row.source,
			records: [row],
		});
	}
	return [...groups.values()];
}

export function workflowHistoryStatusDescription(record: WorkflowCatalogVersionRecord): string {
	if (record.status === "published") return "Published workflow version — selectable for Project sessions and safe to duplicate into UI drafts.";
	if (record.status === "archived") return "Archived workflow version — shown for lifecycle history but hidden from default Project session creation choices.";
	if (record.status === "deleted") return "Deleted workflow definition — historical runs must render from immutable snapshots instead of live catalog links.";
	return "Draft workflow version — not published and unavailable for Project session creation.";
}

export function hasWorkflowCatalogAction(record: { actions: WorkflowCatalogAction[] }, action: WorkflowCatalogAction): boolean {
	return record.actions.includes(action);
}

export function workflowCatalogActionLabel(action: WorkflowCatalogAction): string {
	switch (action) {
		case "view": return "View";
		case "duplicate": return "Duplicate";
		case "create_project_session": return "Create Project session";
		case "edit_draft": return "Edit draft";
		case "validate": return "Validate";
		case "publish": return "Publish";
		case "create_next_draft": return "Create next draft";
		case "version_history": return "Version history";
		case "archive": return "Archive";
		case "delete": return "Delete";
	}
}
