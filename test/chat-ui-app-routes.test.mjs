import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppRoutesScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { chatNavigationRequest, chatRouteFromLocation } = await import("./src/apps/chat-ui/src/app-routes.ts");

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
			chatNavigationRequest({ area: "settings", panel: "skills" }, true, "terminal"),
			{ to: "/settings/skills", replace: true },
		);
		assert.deepEqual(
			chatNavigationRequest({ area: "sessions" }, false, "terminal"),
			{ to: "/", search: { view: "terminal" }, replace: false },
		);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app route helpers map browser locations and navigation requests", async () => {
	await assert.doesNotReject(runAppRoutesScenario());
});
