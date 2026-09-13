export type OptimisticSessionTitleIntent = {
	operationId: string;
	originRoomId: string;
	tempId: string;
	piboSessionId: string;
	createStatus: "pending" | "created";
	editorStatus: "editing" | "confirmed" | "cancelled";
	draftTitle: string;
	confirmedTitle: string | null;
	persistedTitle: string;
	confirmationVersion: number;
	patchStartedVersion: number;
	patchStatus: "idle" | "queued" | "in-flight" | "failed";
};

export type OptimisticSessionTitlePatch = {
	operationId: string;
	originRoomId: string;
	piboSessionId: string;
	title: string | null;
	confirmationVersion: number;
};

export type DeferredOptimisticSessionHydrationOwner = {
	piboSessionId: string;
	bootstrapRequestId: number;
	roomSwitchGeneration: number;
	sessionSelectionGeneration: number;
};

export function ownsDeferredOptimisticSessionHydration(
	owner: DeferredOptimisticSessionHydrationOwner,
	current: {
		selectedPiboSessionId: string | null;
		bootstrapRequestId: number;
		roomSwitchGeneration: number;
		sessionSelectionGeneration: number;
	},
): boolean {
	return current.selectedPiboSessionId === owner.piboSessionId
		&& current.bootstrapRequestId === owner.bootstrapRequestId
		&& current.roomSwitchGeneration === owner.roomSwitchGeneration
		&& current.sessionSelectionGeneration === owner.sessionSelectionGeneration;
}

export function createOptimisticSessionTitleIntent(input: {
	operationId: string;
	originRoomId: string;
	tempId: string;
}): OptimisticSessionTitleIntent {
	return {
		...input,
		piboSessionId: input.tempId,
		createStatus: "pending",
		editorStatus: "editing",
		draftTitle: "",
		confirmedTitle: null,
		persistedTitle: "New Session",
		confirmationVersion: 0,
		patchStartedVersion: 0,
		patchStatus: "idle",
	};
}

export function updateOptimisticSessionTitleDraft(
	intent: OptimisticSessionTitleIntent,
	draftTitle: string,
): OptimisticSessionTitleIntent {
	if (intent.editorStatus !== "editing") return intent;
	return { ...intent, draftTitle, patchStatus: intent.patchStatus === "failed" ? "idle" : intent.patchStatus };
}

export function confirmOptimisticSessionTitle(
	intent: OptimisticSessionTitleIntent,
): OptimisticSessionTitleIntent {
	if (intent.editorStatus !== "editing") return intent;
	const title = intent.draftTitle.trim() || null;
	return {
		...intent,
		editorStatus: "confirmed",
		confirmedTitle: title,
		confirmationVersion: intent.confirmationVersion + 1,
		patchStatus: "queued",
	};
}

export function cancelOptimisticSessionTitle(
	intent: OptimisticSessionTitleIntent,
): OptimisticSessionTitleIntent {
	if (intent.editorStatus !== "editing") return intent;
	return {
		...intent,
		editorStatus: "cancelled",
		confirmedTitle: null,
		patchStatus: "idle",
	};
}

export function handoffOptimisticSessionTitle(
	intent: OptimisticSessionTitleIntent,
	piboSessionId: string,
	persistedTitle: string,
): OptimisticSessionTitleIntent {
	return {
		...intent,
		piboSessionId,
		persistedTitle,
		createStatus: "created",
		patchStatus: intent.editorStatus === "confirmed" ? "queued" : "idle",
	};
}

export function beginOptimisticSessionTitlePatch(
	intent: OptimisticSessionTitleIntent,
): { intent: OptimisticSessionTitleIntent; request: OptimisticSessionTitlePatch } | null {
	if (
		intent.createStatus !== "created"
		|| intent.editorStatus !== "confirmed"
		|| intent.confirmationVersion <= intent.patchStartedVersion
	) return null;
	return {
		intent: {
			...intent,
			patchStartedVersion: intent.confirmationVersion,
			patchStatus: "in-flight",
		},
		request: {
			operationId: intent.operationId,
			originRoomId: intent.originRoomId,
			piboSessionId: intent.piboSessionId,
			title: intent.confirmedTitle,
			confirmationVersion: intent.confirmationVersion,
		},
	};
}

export function failOptimisticSessionTitlePatch(
	intent: OptimisticSessionTitleIntent,
	confirmationVersion: number,
): OptimisticSessionTitleIntent {
	if (intent.confirmationVersion !== confirmationVersion || intent.patchStartedVersion !== confirmationVersion) return intent;
	return {
		...intent,
		editorStatus: "editing",
		draftTitle: intent.confirmedTitle ?? "",
		patchStatus: "failed",
	};
}

export function optimisticSessionTitleDisplay(intent: OptimisticSessionTitleIntent): string {
	if (intent.editorStatus === "confirmed") return intent.confirmedTitle ?? "Untitled Session";
	return intent.persistedTitle;
}
