import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runOptimisticSessionBackendScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { isOptimisticSessionId, selectedSessionBackendId } = await import("./src/apps/chat-ui/src/selected-session-backend.ts");
		const {
			addSessionNodeToBootstrap,
			createOptimisticSessionNode,
			replaceOptimisticSessionNode,
			sessionNodeFromSession,
		} = await import("./src/apps/chat-ui/src/app-bootstrap-mutations.ts");

		const previousId = "ps-previous";
		const optimisticId = "optimistic-session-web-test";
		const persistedId = "ps-created";
		const sessionNode = (piboSessionId, title) => ({
			piboSessionId,
			piSessionId: \`pi-\${piboSessionId}\`,
			profile: "pibo-agent",
			title,
			status: "idle",
			lastActivityAt: "2026-08-07T15:00:00.000Z",
			derivedSessions: [],
			children: [],
		});
		const previousNode = sessionNode(previousId, "Previous");
		const base = {
			identity: { userId: "user-1" },
			session: {
				id: previousId,
				piSessionId: \`pi-\${previousId}\`,
				channel: "web",
				kind: "chat",
				profile: "pibo-agent",
				title: "Previous",
				metadata: {},
				createdAt: "2026-08-07T15:00:00.000Z",
				updatedAt: "2026-08-07T15:00:00.000Z",
			},
			selectedRoomId: "room-1",
			selectedPiboSessionId: previousId,
			room: { id: "room-1", name: "Room", type: "chat", createdAt: "2026-08-07T15:00:00.000Z", updatedAt: "2026-08-07T15:00:00.000Z", metadata: {}, children: [] },
			rooms: [],
			sessions: [previousNode],
			agents: [{ name: "pibo-agent", aliases: [] }],
			customAgents: [],
			capabilities: { actions: [] },
		};
		const backendStarts = (selectedId) => {
			const backendId = selectedSessionBackendId(selectedId);
			return backendId ? [\`trace:\${backendId}\`, \`signal-tree:\${backendId}\`, \`signal-sse:\${backendId}\`] : [];
		};

		assert.equal(isOptimisticSessionId(optimisticId), true);
		assert.equal(isOptimisticSessionId(persistedId), false);
		assert.equal(selectedSessionBackendId(null), null);
		assert.equal(selectedSessionBackendId(optimisticId), null);
		assert.deepEqual(backendStarts(optimisticId), [], "synthetic IDs must not start selected-session backend effects");
		assert.deepEqual(backendStarts(persistedId), [
			\`trace:\${persistedId}\`,
			\`signal-tree:\${persistedId}\`,
			\`signal-sse:\${persistedId}\`,
		]);

		const optimistic = {
			...addSessionNodeToBootstrap(base, createOptimisticSessionNode(optimisticId, "pibo-agent")),
			selectedPiboSessionId: optimisticId,
		};
		assert.equal(optimistic.sessions[0].title, "New Session", "optimistic sidebar and title state remains immediate");
		assert.deepEqual(backendStarts(optimistic.selectedPiboSessionId), []);

		const createdSession = {
			...base.session,
			id: persistedId,
			piSessionId: "pi-created",
			title: "Created",
		};
		const succeeded = replaceOptimisticSessionNode(optimistic, optimisticId, sessionNodeFromSession(createdSession));
		assert.equal(succeeded.selectedPiboSessionId, persistedId);
		assert.equal(succeeded.sessions.some((node) => node.piboSessionId === optimisticId), false);
		assert.deepEqual(backendStarts(succeeded.selectedPiboSessionId), [
			\`trace:\${persistedId}\`,
			\`signal-tree:\${persistedId}\`,
			\`signal-sse:\${persistedId}\`,
		]);

		const rolledBack = base;
		assert.equal(rolledBack.selectedPiboSessionId, previousId);
		assert.equal(rolledBack.sessions.some((node) => node.piboSessionId === optimisticId), false);
		assert.deepEqual(backendStarts(rolledBack.selectedPiboSessionId), [
			\`trace:\${previousId}\`,
			\`signal-tree:\${previousId}\`,
			\`signal-sse:\${previousId}\`,
		]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("optimistic session IDs stay local until success or rollback selects a persisted session", async () => {
	await assert.doesNotReject(runOptimisticSessionBackendScenario());
});

test("selected-session backend effects use only persisted session IDs", () => {
	const appSource = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	const paneSource = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");

	assert.match(appSource, /const selectedBackendPiboSessionId = selectedSessionBackendId\(selectedPiboSessionId\)/);
	assert.match(appSource, /onError: \(_error, _variables, context\) => \{[\s\S]*restoreBootstrapSnapshot\(context\?\.snapshot\);[\s\S]*setSelectedPiboSessionId\(context\?\.previousSelectedPiboSessionId \?\? null\)/);
	assert.match(appSource, /onSuccess: \(created, _variables, context\) => \{[\s\S]*setSelectedPiboSessionId\(created\.session\.id\);[\s\S]*replaceOptimisticSessionNode\(current, context\?\.tempId/);
	assert.match(appSource, /if \(area !== "sessions" \|\| !selectedBackendPiboSessionId\)/);
	assert.match(appSource, /fetchSignalTree\(selectedBackendPiboSessionId/);
	assert.match(appSource, /subscribeSignalTree\(selectedBackendPiboSessionId/);
	assert.doesNotMatch(appSource, /fetchSignalTree\(selectedPiboSessionId/);
	assert.doesNotMatch(appSource, /subscribeSignalTree\(selectedPiboSessionId/);
	assert.match(appSource, /if \(selectedPiboSessionId && !selectedBackendPiboSessionId\) return;[\s\S]*loadNavigation\(selectedBackendPiboSessionId \?\? undefined/);
	assert.doesNotMatch(appSource, /loadNavigation\(selectedPiboSessionId \?\? undefined, showArchivedRef\.current, activeRoomId/);

	assert.match(paneSource, /const selectedBackendPiboSessionId = selectedSessionBackendId\(selectedPiboSessionId\)/);
	assert.match(paneSource, /useSessionTracePage\(\{[\s\S]*selectedPiboSessionId: selectedBackendPiboSessionId/);
	assert.match(paneSource, /useSessionWebAnnotations\(\{[\s\S]*selectedPiboSessionId: selectedBackendPiboSessionId/);
	assert.match(paneSource, /useSessionTraceLiveStream\(\{[\s\S]*selectedPiboSessionId: selectedBackendPiboSessionId/);
});
