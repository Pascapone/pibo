import type { WorkflowHandlerPickerOption, WorkflowProfilePickerOption, WorkflowRegisteredRefOption, WorkflowVersionPickerOption } from "../api-workflows";
import { workflowVersionSelectionKey } from "./workflow-routes";

export function profileOptionLabel(option: WorkflowProfilePickerOption): string {
	return option.source === "custom" ? `${option.displayName} (custom)` : `${option.displayName} (global)`;
}

export function handlerOptionLabel(option: WorkflowHandlerPickerOption): string {
	return `${option.displayName} (${option.id})`;
}

export function registeredRefOptionLabel(option: WorkflowRegisteredRefOption): string {
	return `${option.displayName} (${option.id})`;
}

export function humanActionOptionLabel(option: WorkflowRegisteredRefOption): string {
	return `${option.displayName}${option.kind ? ` · ${option.kind}` : ""} (${option.id})`;
}

export function workflowVersionOptionKey(option: WorkflowVersionPickerOption): string {
	return workflowVersionSelectionKey(option.id, option.version);
}

export function workflowVersionOptionLabel(option: WorkflowVersionPickerOption): string {
	return `${option.title} (${workflowVersionOptionKey(option)})`;
}
