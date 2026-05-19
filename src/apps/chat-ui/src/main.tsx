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
	const contextPiboSessionId = typeof search.piboSessionId === "string" && search.piboSessionId.trim() ? search.piboSessionId.trim() : undefined;
	const parts = path
		.split("/")
		.filter(Boolean)
		.map((part) => decodeURIComponent(part));
	const sessionViewId = parseChatSessionViewId(search.view);
	if (parts[0] === "context") return { area: "context", ...(contextPiboSessionId ? { piboSessionId: contextPiboSessionId } : {}) };
	if (parts[0] === "workflows" && parts[1] === "drafts" && parts[2]) return { area: "workflows", draftId: parts[2] };
	if (parts[0] === "workflows" && parts[1] === "view" && parts[2] && parts[3]) return { area: "workflows", viewWorkflowId: parts[2], viewWorkflowVersion: parts[3] };
	if (parts[0] === "workflows") return { area: "workflows" };
	if (parts[0] === "agents") return { area: "agents" };
	if (parts[0] === "cron") return { area: "cron" };
	if (parts[0] === "ralph") return { area: "ralph" };
	if (parts[0] === "settings") {
		if (parts[1] === "shortcuts") return { area: "settings", panel: "shortcuts" };
		if (parts[1] === "pi-packages") return { area: "settings", panel: "pi-packages" };
		if (parts[1] === "skills") return { area: "settings", panel: "skills" };
		if (parts[1] === "providers") return { area: "settings", panel: "providers" };
		return { area: "settings", panel: "general" };
	}
	if (parts[0] === "projects" && parts[1] && parts[2] === "sessions" && parts[3]) {
		return { area: "projects", projectId: parts[1], piboSessionId: parts[3], sessionViewId };
	}
	if (parts[0] === "projects" && parts[1]) return { area: "projects", projectId: parts[1], sessionViewId };
	if (parts[0] === "projects") return { area: "projects", sessionViewId };
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
const projectsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "projects",
});
const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "projects/$projectId",
});
const projectSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "projects/$projectId/sessions/$piboSessionId",
});
const workflowsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "workflows",
});
const workflowDraftRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "workflows/drafts/$draftId",
});
const workflowViewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "workflows/view/$workflowId/$workflowVersion",
});
const agentsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "agents",
});
const cronRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "cron",
});
const ralphRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "ralph",
});
const contextRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "context",
});
const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings",
});
const settingsShortcutsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/shortcuts",
});
const settingsPiPackagesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/pi-packages",
});
const settingsSkillsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/skills",
});
const settingsProvidersRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "settings/providers",
});
const router = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, sessionRoute, roomRoute, roomSessionRoute, projectsRoute, projectRoute, projectSessionRoute, workflowsRoute, workflowDraftRoute, workflowViewRoute, agentsRoute, cronRoute, ralphRoute, contextRoute, settingsRoute, settingsShortcutsRoute, settingsPiPackagesRoute, settingsSkillsRoute, settingsProvidersRoute]),
	basepath: "/apps/chat",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
			// PWA support is optional; keep the chat UI usable when registration is unavailable.
		});
	});
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
