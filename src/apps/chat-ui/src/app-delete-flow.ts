import { roomSubtreeIds, sessionSubtreeIds } from "./app-bootstrap-mutations";
import type { PiboRoom, PiboWebSessionNode } from "./types";

export type OptimisticSessionDeletePlan = {
	deletedSessionIds: Set<string>;
	selectedSessionDeleted: boolean;
	restoreSelectedPiboSessionId: string | null;
};

export type OptimisticRoomDeletePlan = {
	deletedRoomIds: Set<string>;
	selectedRoomDeleted: boolean;
	restoreSelectedRoomId: string | null;
	restoreSelectedPiboSessionId: string | null;
};

export function planOptimisticSessionDelete(target: PiboWebSessionNode, selectedPiboSessionId: string | null): OptimisticSessionDeletePlan {
	const deletedSessionIds = sessionSubtreeIds(target);
	const selectedSessionDeleted = selectedPiboSessionId ? deletedSessionIds.has(selectedPiboSessionId) : false;
	return {
		deletedSessionIds,
		selectedSessionDeleted,
		restoreSelectedPiboSessionId: selectedPiboSessionId,
	};
}

export function responseDeletesSelectedSession(
	deletedSessionIds: string[],
	selectedPiboSessionId: string | null,
	optimisticSelectedDeleted: boolean,
): boolean {
	return selectedPiboSessionId ? deletedSessionIds.includes(selectedPiboSessionId) : optimisticSelectedDeleted;
}

export function nextSelectedSessionAfterDelete(selectedPiboSessionId: string | null, selectedSessionDeleted: boolean): string | undefined {
	return selectedSessionDeleted ? undefined : (selectedPiboSessionId ?? undefined);
}

export function planOptimisticRoomDelete(
	target: PiboRoom,
	selectedRoomId: string | null,
	selectedPiboSessionId: string | null,
): OptimisticRoomDeletePlan {
	const deletedRoomIds = roomSubtreeIds(target);
	const selectedRoomDeleted = selectedRoomId ? deletedRoomIds.has(selectedRoomId) : false;
	return {
		deletedRoomIds,
		selectedRoomDeleted,
		restoreSelectedRoomId: selectedRoomId,
		restoreSelectedPiboSessionId: selectedPiboSessionId,
	};
}

export function deleteTargetMatchesSelectedRoom(targetRoomId: string, selectedRoomId: string | null): boolean {
	return selectedRoomId === targetRoomId;
}
