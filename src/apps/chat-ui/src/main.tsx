import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider, useRouterState } from "@tanstack/react-router";
import { App, type ChatAppRoute } from "./App";
import { parseChatSessionViewId } from "./session-views/types";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

function ChatRoot() {
	const location = useRouterState({
		select: (state) => ({
			pathname: state.location.pathname,
			search: state.location.search as Record<string, unknown>,
		}),
	});
	return <App route={chatRouteFromLocation(location.pathname, location.search)} />;
}

function chatRouteFromLocation(pathname: string, search: Record<string, unknown>): ChatAppRoute {
	const path = pathname.startsWith("/apps/chat") ? pathname.slice("/apps/chat".length) || "/" : pathname;
	const parts = path
		.split("/")
		.filter(Boolean)
		.map((part) => decodeURIComponent(part));
	const sessionViewId = parseChatSessionViewId(search.view);
	if (parts[0] === "context") return { area: "context" };
	if (parts[0] === "agents") return { area: "agents" };
	if (parts[0] === "settings") {
		if (parts[1] === "pi-packages") return { area: "settings", panel: "pi-packages" };
		if (parts[1] === "skills") return { area: "settings", panel: "skills" };
		return { area: "settings", panel: "general" };
	}
	if (parts[0] === "rooms" && parts[1] && parts[2] === "sessions" && parts[3]) {
		return { area: "sessions", roomId: parts[1], piboSessionId: parts[3], sessionViewId };
	}
	if (parts[0] === "rooms" && parts[1]) return { area: "sessions", roomId: parts[1], sessionViewId };
	if (parts[0] === "sessions" && parts[1]) return { area: "sessions", piboSessionId: parts[1], sessionViewId };
	return { area: "sessions", sessionViewId };
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
const contextRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "context",
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings",
});
const settingsPiPackagesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/pi-packages",
});
const settingsSkillsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/skills",
});
const router = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, sessionRoute, roomRoute, roomSessionRoute, agentsRoute, contextRoute, settingsRoute, settingsPiPackagesRoute, settingsSkillsRoute]),
	basepath: "/apps/chat",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
