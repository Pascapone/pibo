import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, RouterProvider, useRouterState } from "@tanstack/react-router";
import { App } from "./App";
import { chatRouteFromLocation } from "./app-routes";
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
