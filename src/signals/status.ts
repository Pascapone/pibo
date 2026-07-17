import type { PiboSessionSignalSnapshot, PiboSessionSignalStatus } from "./types.js";

export function summarizeSessionSignalStatus(snapshot: PiboSessionSignalSnapshot): PiboSessionSignalStatus {
	const isTurnActive = snapshot.latestTurn?.state === "running";
	const hasError = snapshot.hasError || snapshot.hasErrorDescendant || snapshot.aggregateStatus === "error";
	const isTreeActive = snapshot.isTreeActive || isTurnActive;
	return {
		piboSessionId: snapshot.piboSessionId,
		rootPiboSessionId: snapshot.rootPiboSessionId,
		updatedAt: snapshot.updatedAt,
		status: isTreeActive ? "running" : hasError ? "error" : "idle",
		isTreeActive,
	};
}
