import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function evaluateScenario(body) {
	const script = `
		import assert from "node:assert/strict";
		import { QueryClient } from "@tanstack/react-query";
		const {
			applyBootstrapUpdateForRoom,
			createOptimisticSessionNode,
			replaceOptimisticSessionNode,
			resolveOptimisticSessionCreateOutcome,
			rollbackOptimisticSessionNode,
			sessionNodeFromSession,
		} = await import("./src/apps/chat-ui/src/app-bootstrap-mutations.ts");

		function piboSession(overrides = {}) {
			return {
				id: overrides.id ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				channel: "web",
				kind: "chat",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? "Root",
				metadata: {},
				createdAt: "2026-08-08T00:00:00.000Z",
				updatedAt: "2026-08-08T00:00:00.000Z",
				...overrides,
			};
		}

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? "Root",
				status: "idle",
				lastActivityAt: "2026-08-08T00:00:00.000Z",
				derivedSessions: [],
				children: [],
				...overrides,
			};
		}

		function bootstrap(roomId, root, overrides = {}) {
			const room = {
				id: roomId,
				name: roomId,
				type: "chat",
				createdAt: "2026-08-08T00:00:00.000Z",
				updatedAt: "2026-08-08T00:00:00.000Z",
				metadata: {},
				children: [],
			};
			return {
				identity: { userId: "user-1" },
				session: piboSession({ id: root.piboSessionId, piSessionId: root.piSessionId, profile: root.profile, title: root.title }),
				selectedRoomId: roomId,
				selectedPiboSessionId: root.piboSessionId,
				room,
				rooms: [room],
				sessions: [root],
				agents: [],
				customAgents: [],
				capabilities: { actions: [] },
				...overrides,
			};
		}

		const originRoomId = "room-origin";
		const otherRoomId = "room-other";
		const pending = createOptimisticSessionNode("optimistic-session-pending", "worker");
		const originPersisted = sessionNode({ piboSessionId: "ps-origin", piSessionId: "pi-origin" });
		const newerOriginSelection = sessionNode({ piboSessionId: "ps-newer-selection", piSessionId: "pi-newer-selection" });
		const originBeforeCreate = bootstrap(originRoomId, originPersisted);
		const originWhileCreating = bootstrap(originRoomId, pending, { sessions: [pending, originPersisted] });
		const originAfterSameRoomSelection = bootstrap(originRoomId, newerOriginSelection, {
			sessions: [pending, newerOriginSelection, originPersisted],
			selectedPiboSessionId: newerOriginSelection.piboSessionId,
		});
		const otherPersisted = sessionNode({ piboSessionId: "ps-other", piSessionId: "pi-other" });
		const otherCurrent = bootstrap(otherRoomId, otherPersisted);
		const created = sessionNodeFromSession(piboSession({ id: "ps-created", piSessionId: "pi-created", profile: "worker", title: "Created" }));

		${body}
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("cross-room success updates only cached origin-room bootstrap data", async () => {
	await evaluateScenario(`
		const reconcile = (data) => applyBootstrapUpdateForRoom(data, originRoomId, (current) =>
			replaceOptimisticSessionNode(current, pending.piboSessionId, created),
		);
		assert.equal(reconcile(otherCurrent), otherCurrent);

		const queryClient = new QueryClient();
		const originKey = ["chat", "bootstrap", "origin"];
		const otherKey = ["chat", "bootstrap", "other"];
		queryClient.setQueryData(originKey, originWhileCreating);
		queryClient.setQueryData(otherKey, otherCurrent);
		queryClient.setQueriesData({ queryKey: ["chat", "bootstrap"] }, (current) => current ? reconcile(current) : current);
		assert.deepEqual(queryClient.getQueryData(originKey).sessions.map((session) => session.piboSessionId), [created.piboSessionId, originPersisted.piboSessionId]);
		assert.equal(queryClient.getQueryData(originKey).selectedPiboSessionId, created.piboSessionId);
		assert.equal(queryClient.getQueryData(otherKey), otherCurrent);

		assert.deepEqual(resolveOptimisticSessionCreateOutcome({
			status: "success",
			currentSelectedPiboSessionId: otherPersisted.piboSessionId,
			tempId: pending.piboSessionId,
			previousSelectedPiboSessionId: originPersisted.piboSessionId,
			createdPiboSessionId: created.piboSessionId,
		}), {
			selectedPiboSessionId: otherPersisted.piboSessionId,
			navigateToCreatedSession: false,
			autoRenameCreatedSession: false,
		});
	`);
});

test("same-room success selects and auto-renames only while the optimistic selection is untouched", async () => {
	await evaluateScenario(`
		const untouched = resolveOptimisticSessionCreateOutcome({
			status: "success",
			currentSelectedPiboSessionId: pending.piboSessionId,
			tempId: pending.piboSessionId,
			previousSelectedPiboSessionId: originPersisted.piboSessionId,
			createdPiboSessionId: created.piboSessionId,
		});
		assert.equal(untouched.selectedPiboSessionId, created.piboSessionId);
		assert.equal(untouched.navigateToCreatedSession, true);
		assert.equal(untouched.autoRenameCreatedSession, true);
		assert.equal(replaceOptimisticSessionNode(originWhileCreating, pending.piboSessionId, created).selectedPiboSessionId, created.piboSessionId);

		const changed = resolveOptimisticSessionCreateOutcome({
			status: "success",
			currentSelectedPiboSessionId: newerOriginSelection.piboSessionId,
			tempId: pending.piboSessionId,
			previousSelectedPiboSessionId: originPersisted.piboSessionId,
			createdPiboSessionId: created.piboSessionId,
		});
		assert.equal(changed.selectedPiboSessionId, newerOriginSelection.piboSessionId);
		assert.equal(changed.navigateToCreatedSession, false);
		assert.equal(changed.autoRenameCreatedSession, false);
		const reconciled = replaceOptimisticSessionNode(originAfterSameRoomSelection, pending.piboSessionId, created);
		assert.equal(reconciled.selectedPiboSessionId, newerOriginSelection.piboSessionId);
		assert.deepEqual(reconciled.sessions.map((session) => session.piboSessionId), [created.piboSessionId, newerOriginSelection.piboSessionId, originPersisted.piboSessionId]);
	`);
});

test("same-room failure removes only the pending node and preserves a newer selection", async () => {
	await evaluateScenario(`
		const untouched = rollbackOptimisticSessionNode(originWhileCreating, pending.piboSessionId, originPersisted.piboSessionId);
		assert.equal(untouched.selectedPiboSessionId, originPersisted.piboSessionId);
		assert.deepEqual(untouched.sessions.map((session) => session.piboSessionId), [originPersisted.piboSessionId]);

		const changed = rollbackOptimisticSessionNode(originAfterSameRoomSelection, pending.piboSessionId, originPersisted.piboSessionId);
		assert.equal(changed.selectedPiboSessionId, newerOriginSelection.piboSessionId);
		assert.deepEqual(changed.sessions.map((session) => session.piboSessionId), [newerOriginSelection.piboSessionId, originPersisted.piboSessionId]);
		assert.deepEqual(resolveOptimisticSessionCreateOutcome({
			status: "failure",
			currentSelectedPiboSessionId: newerOriginSelection.piboSessionId,
			tempId: pending.piboSessionId,
			previousSelectedPiboSessionId: originPersisted.piboSessionId,
		}), {
			selectedPiboSessionId: newerOriginSelection.piboSessionId,
			navigateToCreatedSession: false,
			autoRenameCreatedSession: false,
		});
	`);
});

test("cross-room failure rolls back only cached origin-room data", async () => {
	await evaluateScenario(`
		const rollback = (data) => applyBootstrapUpdateForRoom(data, originRoomId, (current) =>
			rollbackOptimisticSessionNode(current, pending.piboSessionId, originPersisted.piboSessionId),
		);
		const queryClient = new QueryClient();
		const originKey = ["chat", "bootstrap", "origin"];
		const otherKey = ["chat", "bootstrap", "other"];
		queryClient.setQueryData(originKey, originWhileCreating);
		queryClient.setQueryData(otherKey, otherCurrent);
		queryClient.setQueriesData({ queryKey: ["chat", "bootstrap"] }, (current) => current ? rollback(current) : current);
		assert.deepEqual(queryClient.getQueryData(originKey).sessions.map((session) => session.piboSessionId), [originPersisted.piboSessionId]);
		assert.equal(queryClient.getQueryData(originKey).selectedPiboSessionId, originPersisted.piboSessionId);
		assert.equal(queryClient.getQueryData(otherKey), otherCurrent);
	`);
});

test("App scopes pending insertion, replacement, and rollback to the origin room", async () => {
	const source = await readFile("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(source, /onMutate: async \(\{ profile, roomId \}\)/);
	assert.match(source, /const originRoomId = roomId \?\? bootstrap\?\.selectedRoomId \?\? ""/);
	assert.match(source, /updateBootstrapCacheForRoom\(originRoomId/);
	assert.match(source, /rollbackOptimisticSessionNode\(current, context\.tempId, context\.previousSelectedPiboSessionId \?\? null\)/);
	assert.match(source, /replaceOptimisticSessionNode\(current, context\.tempId, sessionNodeFromSession\(created\.session\)\)/);
	const createMutation = source.slice(source.indexOf("const createSessionMutation"), source.indexOf("const renameSessionMutation"));
	assert.doesNotMatch(createMutation, /restoreBootstrapSnapshot/);
	assert.match(source, /if \(outcome\?\.autoRenameCreatedSession\) setAutoRenameSessionId/);
	assert.match(source, /if \(outcome\?\.navigateToCreatedSession\)/);
});
