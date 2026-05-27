import type { ChatAppRoute } from "./app-routes";
import type { StoredSelection } from "./app-storage";

export type RouteSelectionRequest = {
	requestedRoomId?: string;
	requestedPiboSessionId?: string;
};

export type BootstrapRouteSelection = {
	selectedRoomId: string;
	selectedPiboSessionId: string;
};

export function routeSelectionRequest(route: ChatAppRoute, stored: StoredSelection): RouteSelectionRequest {
	const routeRoomId = route.area === "sessions" ? route.roomId : undefined;
	const routePiboSessionId = route.area === "sessions" || route.area === "projects" || route.area === "context" ? route.piboSessionId : undefined;
	const storedPiboSessionId = routeRoomId ? stored.sessionsByRoom?.[routeRoomId] : stored.piboSessionId;
	const requestedRoomId = route.area === "sessions"
		? (routeRoomId ?? (!routePiboSessionId ? stored.roomId : undefined))
		: route.area === "context" && routePiboSessionId
			? undefined
			: stored.roomId;
	const requestedPiboSessionId = route.area === "sessions"
		? (routePiboSessionId ?? (!routePiboSessionId ? storedPiboSessionId : undefined))
		: route.area === "context"
			? routePiboSessionId
			: stored.piboSessionId;

	return { requestedRoomId, requestedPiboSessionId };
}

export function shouldSkipRouteSelectionLoad(input: {
	bootstrap?: BootstrapRouteSelection | null;
	creatingSession: boolean;
	route: ChatAppRoute;
}): boolean {
	const { bootstrap, creatingSession, route } = input;
	const routePiboSessionId = route.area === "sessions" || route.area === "projects" || route.area === "context" ? route.piboSessionId : undefined;
	if (bootstrap && route.area !== "sessions") {
		if (route.area !== "context" || !routePiboSessionId || bootstrap.selectedPiboSessionId === routePiboSessionId) return true;
	}
	if (creatingSession) return true;
	return Boolean(
		bootstrap &&
		route.area === "sessions" &&
		route.piboSessionId &&
		bootstrap.selectedPiboSessionId === route.piboSessionId &&
		bootstrap.selectedRoomId === route.roomId,
	);
}

export function sessionsRouteCanonicalSelection(
	route: ChatAppRoute,
	selection: BootstrapRouteSelection,
): BootstrapRouteSelection | undefined {
	if (route.area !== "sessions") return undefined;
	if (!selection.selectedPiboSessionId) return undefined;
	if (route.roomId === selection.selectedRoomId && route.piboSessionId === selection.selectedPiboSessionId) return undefined;
	return selection;
}

export function hasExplicitSessionsRouteSelection(route: ChatAppRoute): boolean {
	return route.area === "sessions" && Boolean(route.roomId || route.piboSessionId);
}
