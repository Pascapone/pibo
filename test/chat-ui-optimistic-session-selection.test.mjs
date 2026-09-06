import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function evaluateTypeScript(script) {
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return JSON.parse(stdout);
}

async function resolveScenario(input) {
	const script = `
		import {
			replaceOptimisticSessionNode,
			resolveOptimisticSessionCreateOutcome,
			restoreBootstrapSelection,
		} from "./src/apps/chat-ui/src/app-bootstrap-mutations.ts";
		const input = ${JSON.stringify(input)};
		const outcome = resolveOptimisticSessionCreateOutcome(input);
		if (input.status === "success") {
			const reconciled = replaceOptimisticSessionNode({
				selectedPiboSessionId: input.currentSelectedPiboSessionId,
				session: { id: "ps_previous" },
				sessions: [{ piboSessionId: input.tempId, children: [] }],
			}, input.tempId, {
				piboSessionId: input.createdPiboSessionId,
				piSessionId: "pi_created",
				profile: "base",
				title: "New Session",
				status: "idle",
				derivedSessions: [],
				children: [],
			});
			process.stdout.write(JSON.stringify({
				outcome,
				cacheSelectedPiboSessionId: reconciled.selectedPiboSessionId,
				cachedSessionIds: reconciled.sessions.map((session) => session.piboSessionId),
			}));
		} else {
			const restored = restoreBootstrapSelection({ selectedPiboSessionId: "ps_previous" }, outcome.selectedPiboSessionId);
			process.stdout.write(JSON.stringify({
				outcome,
				cacheSelectedPiboSessionId: restored.selectedPiboSessionId,
			}));
		}
	`;
	return evaluateTypeScript(script);
}

async function resolveRouteSelection(input) {
	return evaluateTypeScript(`
		import {
			sessionsRouteCanonicalSelection,
			shouldSkipRouteSelectionLoad,
		} from "./src/apps/chat-ui/src/app-route-selection.ts";
		const input = ${JSON.stringify(input)};
		process.stdout.write(JSON.stringify({
			skipLoad: shouldSkipRouteSelectionLoad(input),
			canonicalSelection: sessionsRouteCanonicalSelection(input.route, input.bootstrap),
		}));
	`);
}

test("post-create hydration defers to immediate user selection and rechecks ownership before navigation", () => {
	const app = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	const select = app.slice(app.indexOf("const selectSession = useCallback"), app.indexOf("const selectRoom = useCallback"));
	assert.match(select, /if \(selectedPiboSessionIdRef.current !== piboSessionId\) bootstrapRequestId.current \+= 1;/);
	assert.ok(select.indexOf("bootstrapRequestId.current += 1") < select.indexOf("flushSync"));
	const create = app.slice(app.indexOf("const createSession = async"), app.indexOf("const toggleArchivedSessions = async"));
	assert.match(create, /await loadBootstrap\(created.session.id[\s\S]*?if \(selectedPiboSessionIdRef.current !== created.session.id \|\| bootstrapRef.current\?\.selectedRoomId !== originRoomId\) return;\s*navigateToSelectedSession/);
});

test("optimistic session create keeps selecting the created session when untouched", async () => {
	assert.deepEqual(await resolveScenario({
		status: "success",
		currentSelectedPiboSessionId: "optimistic-session-create-1",
		tempId: "optimistic-session-create-1",
		previousSelectedPiboSessionId: "ps_previous",
		createdPiboSessionId: "ps_created",
	}), {
		outcome: {
			selectedPiboSessionId: "ps_created",
			navigateToCreatedSession: true,
			autoRenameCreatedSession: true,
		},
		cacheSelectedPiboSessionId: "ps_created",
		cachedSessionIds: ["ps_created"],
	});
});

test("optimistic session create preserves navigation before success", async () => {
	assert.deepEqual(await resolveScenario({
		status: "success",
		currentSelectedPiboSessionId: "ps_user_selected",
		tempId: "optimistic-session-create-1",
		previousSelectedPiboSessionId: "ps_previous",
		createdPiboSessionId: "ps_created",
	}), {
		outcome: {
			selectedPiboSessionId: "ps_user_selected",
			navigateToCreatedSession: false,
			autoRenameCreatedSession: false,
		},
		cacheSelectedPiboSessionId: "ps_user_selected",
		cachedSessionIds: ["ps_created"],
	});
});

test("optimistic session create restores the pre-create selection when untouched failure occurs", async () => {
	assert.deepEqual(await resolveScenario({
		status: "failure",
		currentSelectedPiboSessionId: "optimistic-session-create-1",
		tempId: "optimistic-session-create-1",
		previousSelectedPiboSessionId: "ps_previous",
	}), {
		outcome: {
			selectedPiboSessionId: "ps_previous",
			navigateToCreatedSession: false,
			autoRenameCreatedSession: false,
		},
		cacheSelectedPiboSessionId: "ps_previous",
	});
});

test("optimistic session create preserves navigation before failure", async () => {
	assert.deepEqual(await resolveScenario({
		status: "failure",
		currentSelectedPiboSessionId: "ps_user_selected",
		tempId: "optimistic-session-create-1",
		previousSelectedPiboSessionId: "ps_previous",
	}), {
		outcome: {
			selectedPiboSessionId: "ps_user_selected",
			navigateToCreatedSession: false,
			autoRenameCreatedSession: false,
		},
		cacheSelectedPiboSessionId: "ps_user_selected",
	});
});

test("route selection stays dormant while optimistic session creation is pending", async () => {
	assert.deepEqual(await resolveRouteSelection({
		bootstrap: { selectedRoomId: "room_a", selectedPiboSessionId: "optimistic-session-create-1" },
		creatingSession: true,
		route: { area: "sessions", roomId: "room_a", piboSessionId: "ps_user_selected" },
	}), {
		skipLoad: true,
		canonicalSelection: { selectedRoomId: "room_a", selectedPiboSessionId: "optimistic-session-create-1" },
	});
});

test("route selection stays dormant after the explicit route and selection agree", async () => {
	assert.deepEqual(await resolveRouteSelection({
		bootstrap: { selectedRoomId: "room_a", selectedPiboSessionId: "ps_user_selected" },
		creatingSession: false,
		route: { area: "sessions", roomId: "room_a", piboSessionId: "ps_user_selected" },
	}), {
		skipLoad: true,
	});
});
