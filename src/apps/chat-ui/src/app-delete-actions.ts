import { useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { deleteRoom, deleteSession } from "./api-chat-sessions";
import {
	createBootstrapMutationSnapshot,
	removeRoomsFromBootstrap,
	removeSessionsFromBootstrap,
	type BootstrapMutationSnapshot,
} from "./app-bootstrap-mutations";
import {
	deleteTargetMatchesSelectedRoom,
	nextSelectedSessionAfterDelete,
	planOptimisticRoomDelete,
	planOptimisticSessionDelete,
	responseDeletesSelectedSession,
} from "./app-delete-flow";
import type { NavigationOptions } from "./app-routes";
import type { BootstrapData, PiboRoom, PiboWebSessionNode } from "./types";

type LoadBootstrapOptions = {
	selectSession?: boolean;
	force?: boolean;
};

type LoadBootstrap = (
	piboSessionId?: string,
	includeArchived?: boolean,
	roomId?: string,
	options?: LoadBootstrapOptions,
) => Promise<BootstrapData>;

type NavigateToSelectedSession = (
	roomId: string | undefined,
	piboSessionId: string | undefined,
	replace?: boolean,
	options?: NavigationOptions,
) => void;

type AppDeleteActionsConfig = {
	queryClient: QueryClient;
	bootstrap: BootstrapData | null;
	selectedPiboSessionId: string | null;
	selectedRoomId: string | null;
	showArchivedRef: { current: boolean };
	isSessionsArea: boolean;
	loadBootstrap: LoadBootstrap;
	navigateToSelectedSession: NavigateToSelectedSession;
	updateBootstrapCache: (updater: (data: BootstrapData) => BootstrapData) => void;
	restoreBootstrapSnapshot: (snapshot: BootstrapMutationSnapshot | undefined) => void;
	setSelectedPiboSessionId: Dispatch<SetStateAction<string | null>>;
	setSelectedRoomId: Dispatch<SetStateAction<string | null>>;
	setError: Dispatch<SetStateAction<string | null>>;
};

export function useAppDeleteActions({
	queryClient,
	bootstrap,
	selectedPiboSessionId,
	selectedRoomId,
	showArchivedRef,
	isSessionsArea,
	loadBootstrap,
	navigateToSelectedSession,
	updateBootstrapCache,
	restoreBootstrapSnapshot,
	setSelectedPiboSessionId,
	setSelectedRoomId,
	setError,
}: AppDeleteActionsConfig) {
	const [deleteRoomTarget, setDeleteRoomTarget] = useState<PiboRoom | null>(null);
	const [deleteRoomConfirmName, setDeleteRoomConfirmName] = useState("");
	const [deletingRoom, setDeletingRoom] = useState(false);
	const [deleteSessionTarget, setDeleteSessionTarget] = useState<PiboWebSessionNode | null>(null);
	const [deleteSessionConfirmText, setDeleteSessionConfirmText] = useState("");
	const [deletingSession, setDeletingSession] = useState(false);

	const requestSessionDelete = (node: PiboWebSessionNode) => {
		setDeleteSessionTarget(node);
		setDeleteSessionConfirmText("");
	};

	const cancelSessionDelete = () => {
		setDeleteSessionTarget(null);
		setDeleteSessionConfirmText("");
	};

	const permanentlyDeleteSession = async () => {
		if (!deleteSessionTarget) return;
		setDeletingSession(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDelete = planOptimisticSessionDelete(deleteSessionTarget, selectedPiboSessionId);
		if (optimisticDelete.selectedSessionDeleted) setSelectedPiboSessionId(null);
		updateBootstrapCache((data) => removeSessionsFromBootstrap(data, optimisticDelete.deletedSessionIds));
		try {
			const deleted = await deleteSession(deleteSessionTarget.piboSessionId, deleteSessionConfirmText);
			const deletedSelected = responseDeletesSelectedSession(
				deleted.deletedSessionIds,
				selectedPiboSessionId,
				optimisticDelete.selectedSessionDeleted,
			);
			if (deletedSelected) {
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(
				nextSelectedSessionAfterDelete(selectedPiboSessionId, deletedSelected),
				showArchivedRef.current,
				selectedRoomId ?? undefined,
				{ force: true },
			);
			if (isSessionsArea) {
				navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			}
			cancelSessionDelete();
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDelete.selectedSessionDeleted) setSelectedPiboSessionId(optimisticDelete.restoreSelectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingSession(false);
		}
	};

	const requestRoomDelete = (room: PiboRoom) => {
		setDeleteRoomTarget(room);
		setDeleteRoomConfirmName("");
	};

	const cancelRoomDelete = () => {
		setDeleteRoomTarget(null);
		setDeleteRoomConfirmName("");
	};

	const permanentlyDeleteRoom = async () => {
		if (!deleteRoomTarget) return;
		setDeletingRoom(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDelete = planOptimisticRoomDelete(deleteRoomTarget, selectedRoomId, selectedPiboSessionId);
		if (optimisticDelete.selectedRoomDeleted) {
			setSelectedRoomId(null);
			setSelectedPiboSessionId(null);
		}
		updateBootstrapCache((data) => removeRoomsFromBootstrap(data, optimisticDelete.deletedRoomIds));
		try {
			await deleteRoom(deleteRoomTarget.id, deleteRoomConfirmName);
			if (deleteTargetMatchesSelectedRoom(deleteRoomTarget.id, selectedRoomId)) {
				setSelectedRoomId(null);
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(undefined, showArchivedRef.current, undefined, { force: true });
			if (isSessionsArea) navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			cancelRoomDelete();
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDelete.selectedRoomDeleted) {
				setSelectedRoomId(optimisticDelete.restoreSelectedRoomId);
				setSelectedPiboSessionId(optimisticDelete.restoreSelectedPiboSessionId);
			}
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingRoom(false);
		}
	};

	return {
		deleteRoomTarget,
		deleteRoomConfirmName,
		deletingRoom,
		setDeleteRoomConfirmName,
		requestRoomDelete,
		cancelRoomDelete,
		permanentlyDeleteRoom,
		deleteSessionTarget,
		deleteSessionConfirmText,
		deletingSession,
		setDeleteSessionConfirmText,
		requestSessionDelete,
		cancelSessionDelete,
		permanentlyDeleteSession,
	};
}
