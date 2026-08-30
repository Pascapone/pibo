export type WorkflowContextMenuKeyAction =
	| { type: "focus"; index: number }
	| { type: "dismiss" };

export function workflowContextMenuKeyAction(key: string, currentIndex: number, itemCount: number): WorkflowContextMenuKeyAction | undefined {
	if (key === "Escape" || key === "Tab") return { type: "dismiss" };
	if (itemCount <= 0) return undefined;
	switch (key) {
		case "ArrowDown":
			return { type: "focus", index: (currentIndex + 1 + itemCount) % itemCount };
		case "ArrowUp":
			return { type: "focus", index: (currentIndex - 1 + itemCount) % itemCount };
		case "Home":
			return { type: "focus", index: 0 };
		case "End":
			return { type: "focus", index: itemCount - 1 };
		default:
			return undefined;
	}
}

export function isWorkflowContextMenuInvocation(key: string, shiftKey: boolean): boolean {
	return key === "ContextMenu" || (key === "F10" && shiftKey);
}
