import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppRoutesScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { chatNavigationRequest, chatRouteFromLocation, navigateToChatRoute, stringifyChatSearch } = await import("./src/apps/chat-ui/src/app-routes.ts");

		assert.deepEqual(
			chatRouteFromLocation("/apps/chat/rooms/room%201/sessions/ps_1", { view: "workflow" }),
			{ area: "sessions", roomId: "room 1", piboSessionId: "ps_1", sessionViewId: "workflow" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/projects/project-a/sessions/ps_2", { view: "terminal" }),
			{ area: "projects", projectId: "project-a", piboSessionId: "ps_2", sessionViewId: "terminal" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/context", { piboSessionId: " ps_3 " }),
			{ area: "context", piboSessionId: "ps_3" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/settings/providers", {}),
			{ area: "settings", panel: "providers" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/apps/chat/vscode", {}),
			{ area: "vscode" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/settings/transcription", {}),
			{ area: "settings", panel: "transcription" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/settings/concurrency", {}),
			{ area: "settings", panel: "concurrency" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/workflows/view/wf_1/v2", {}),
			{ area: "workflows", viewWorkflowId: "wf_1", viewWorkflowVersion: "v2" },
		);
		assert.deepEqual(
			chatRouteFromLocation("/unknown", { view: "invalid" }),
			{ area: "sessions", sessionViewId: undefined },
		);

		assert.deepEqual(
			chatNavigationRequest({ area: "sessions", roomId: "room-1", piboSessionId: "ps_1" }, false, "workflow"),
			{
				to: "/rooms/$roomId/sessions/$piboSessionId",
				params: { roomId: "room-1", piboSessionId: "ps_1" },
				search: { view: "workflow" },
				replace: false,
			},
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "projects", projectId: "project-a" }, true, "terminal"),
			{
				to: "/projects/$projectId",
				params: { projectId: "project-a" },
				search: { view: "terminal" },
				replace: true,
			},
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "context", piboSessionId: "ps_3" }, false, "terminal"),
			{ to: "/context", search: { piboSessionId: "ps_3" }, replace: false },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "vscode" }, false, "terminal"),
			{ to: "/vscode", replace: false },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "settings", panel: "skills" }, true, "terminal"),
			{ to: "/settings/skills", replace: true },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "settings", panel: "transcription" }, true, "terminal"),
			{ to: "/settings/transcription", replace: true },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "settings", panel: "concurrency" }, true, "terminal"),
			{ to: "/settings/concurrency", replace: true },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "sessions" }, false, "terminal"),
			{ to: "/", search: { view: "terminal" }, replace: false },
		);

		const navigationCalls = [];
		navigateToChatRoute(
			async (options) => { navigationCalls.push(options); },
			{ area: "sessions", roomId: "room-1", piboSessionId: "ps_1" },
			true,
			"terminal",
			true,
			true,
		);
		assert.equal(navigationCalls.length, 1);
		const [{ search, ...navigation }] = navigationCalls;
		assert.deepEqual(navigation, {
			to: "/rooms/$roomId/sessions/$piboSessionId",
			params: { roomId: "room-1", piboSessionId: "ps_1" },
			replace: true,
			hash: true,
		});
		assert.equal(typeof search, "function");
		const preservedSearch = search({
			view: "workflow",
			profileRef: "profile:test",
			handlerRef: "handler:test",
			adapterRef: "adapter:test",
			tag: ["one", "two"],
			encoded: "a/b c",
			empty: "",
		});
		assert.deepEqual(preservedSearch, {
			view: "terminal",
			profileRef: "profile:test",
			handlerRef: "handler:test",
			adapterRef: "adapter:test",
			tag: ["one", "two"],
			encoded: "a/b c",
			empty: "",
		});
		const serializedSearch = stringifyChatSearch(preservedSearch);
		const serializedParams = new URLSearchParams(serializedSearch);
		assert.equal(serializedParams.get("view"), "terminal");
		assert.deepEqual(serializedParams.getAll("tag"), ["one", "two"]);
		assert.equal(serializedParams.get("encoded"), "a/b c");
		assert.equal(serializedParams.get("empty"), "");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app route helpers map browser locations and navigation requests", async () => {
	await assert.doesNotReject(runAppRoutesScenario());
});
