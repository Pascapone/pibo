const OPTIMISTIC_SESSION_ID_PREFIX = "optimistic-session-";

export function isOptimisticSessionId(piboSessionId: string | null | undefined): boolean {
	return piboSessionId?.startsWith(OPTIMISTIC_SESSION_ID_PREFIX) === true;
}

export function selectedSessionBackendId(piboSessionId: string | null | undefined): string | null {
	return piboSessionId && !isOptimisticSessionId(piboSessionId) ? piboSessionId : null;
}
