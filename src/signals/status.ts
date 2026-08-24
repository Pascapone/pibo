import type { PiboSessionSignalSnapshot, PiboSessionSignalStatus } from "./types.js";

type SessionSignalStatusSource = {
	isTreeActive: boolean;
	localStatus?: string;
	latestTurn?: { state: string };
};

export function resolveSessionSignalStatus(snapshot: SessionSignalStatusSource): PiboSessionSignalStatus["status"] {
	if (snapshot.isTreeActive || snapshot.latestTurn?.state === "running") return "running";
	if (snapshot.localStatus === "error" || snapshot.latestTurn?.state === "failed") return "error";
	return "idle";
}

export function summarizeSessionSignalStatus(snapshot: PiboSessionSignalSnapshot): PiboSessionSignalStatus {
	const isTreeActive = snapshot.isTreeActive || snapshot.latestTurn?.state === "running";
	return {
		piboSessionId: snapshot.piboSessionId,
		rootPiboSessionId: snapshot.rootPiboSessionId,
		updatedAt: snapshot.updatedAt,
		status: resolveSessionSignalStatus(snapshot),
		isTreeActive,
	};
}
