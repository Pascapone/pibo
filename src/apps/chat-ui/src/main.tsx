import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider, useRouterState } from "@tanstack/react-router";
import { App, type ChatAppRoute } from "./App";
import "./styles.css";

function ChatRoot() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	return <App route={chatRouteFromPath(pathname)} />;
}

function chatRouteFromPath(pathname: string): ChatAppRoute {
	const path = pathname.startsWith("/apps/chat") ? pathname.slice("/apps/chat".length) || "/" : pathname;
	const parts = path
		.split("/")
		.filter(Boolean)
		.map((part) => decodeURIComponent(part));
	if (parts[0] === "agents") return { area: "agents" };
	if (parts[0] === "settings") return { area: "settings" };
	if (parts[0] === "rooms" && parts[1] && parts[2] === "sessions" && parts[3]) {
		return { area: "sessions", roomId: parts[1], piboSessionId: parts[3] };
	}
	if (parts[0] === "rooms" && parts[1]) return { area: "sessions", roomId: parts[1] };
	if (parts[0] === "sessions" && parts[1]) return { area: "sessions", piboSessionId: parts[1] };
	return { area: "sessions" };
}

const rootRoute = createRootRoute({
	component: ChatRoot,
});
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
});
const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "sessions/$piboSessionId",
});
const roomRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "rooms/$roomId",
});
const roomSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "rooms/$roomId/sessions/$piboSessionId",
});
const agentsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "agents",
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings",
});
const router = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, sessionRoute, roomRoute, roomSessionRoute, agentsRoute, settingsRoute]),
	basepath: "/apps/chat",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>,
);
