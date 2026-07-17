import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runAppSignalStatusScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			applySelectedSignalPatch,
			applySignalPatch,
			applySignalPatchToBootstrap,
			applySignalSnapshotToBootstrap,
			applySignalStatusPatch,
			applySignalStatusPatchToBootstrap,
			applySignalStatusSnapshotToBootstrap,
			retainSelectedSignalSnapshot,
			shouldCommitSelectedSignalSnapshot,
			shouldCommitSignalStatusSnapshot,
			shouldReconcileSelectedSignalTree,
			signalLegacyStatus,
			signalSnapshotIncludesSession,
		} = await import("./src/apps/chat-ui/src/app-signal-status.ts");

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? overrides.piboSessionId ?? "Root",
				status: overrides.status ?? "idle",
				lastActivityAt: overrides.lastActivityAt ?? "2026-05-27T00:00:00.000Z",
				unreadCount: overrides.unreadCount,
				derivedSessions: overrides.derivedSessions ?? [],
				children: overrides.children ?? [],
				...overrides,
			};
		}

		function room(overrides = {}) {
			return {
				id: overrides.id ?? "room-root",
				name: overrides.name ?? "Room",
				type: "chat",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				metadata: {},
				children: [],
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			const root = overrides.sessionRoot ?? sessionNode();
			const rootRoom = room();
			return {
				identity: { userId: "user-1" },
				session: { id: root.piboSessionId, piSessionId: root.piSessionId, channel: "web", kind: "chat", profile: root.profile, title: root.title, createdAt: "2026-05-27T00:00:00.000Z", updatedAt: "2026-05-27T00:00:00.000Z" },
				selectedRoomId: rootRoom.id,
				selectedPiboSessionId: root.piboSessionId,
				room: rootRoom,
				rooms: [rootRoom],
				sessions: [root],
				agents: [],
				customAgents: [],
				capabilities: { actions: [] },
				...overrides,
			};
		}

		function signalSession(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				rootPiboSessionId: overrides.rootPiboSessionId ?? "ps-root",
				version: overrides.version ?? 1,
				updatedAt: overrides.updatedAt ?? "2026-05-27T00:05:00.000Z",
				localStatus: overrides.localStatus ?? "idle",
				aggregateStatus: overrides.aggregateStatus ?? "idle",
				queuedMessages: 0,
				isLocalActive: false,
				hasActiveDescendant: false,
				isTreeActive: overrides.isTreeActive ?? false,
				isSettled: !overrides.isTreeActive,
				hasError: overrides.hasError ?? false,
				hasErrorDescendant: overrides.hasErrorDescendant ?? false,
				hasBlockedDescendant: false,
				activeToolCalls: [],
				activeRuns: [],
				activeChildren: [],
				errors: [],
				...overrides,
			};
		}

		function signalStatus(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				rootPiboSessionId: overrides.rootPiboSessionId ?? overrides.piboSessionId ?? "ps-root",
				updatedAt: overrides.updatedAt ?? "2026-05-27T00:05:00.000Z",
				status: overrides.status ?? "idle",
				isTreeActive: overrides.isTreeActive ?? overrides.status === "running",
			};
		}

		function signalNode(overrides = {}) {
			return {
				id: overrides.id ?? "node-root",
				kind: overrides.kind ?? "session",
				status: overrides.status ?? "running",
				rootPiboSessionId: overrides.rootPiboSessionId ?? "ps-root",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: overrides.updatedAt ?? "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		const derived = { piboSessionId: "ps-derived", profile: "pibo-agent", title: "Derived", status: "idle", lastActivityAt: "2026-05-27T00:00:00.000Z" };
		const child = sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child", unreadCount: 2, derivedSessions: [derived] });
		const base = bootstrap({ sessionRoot: sessionNode({ children: [child] }) });
		const snapshot = {
			rootPiboSessionId: "ps-root",
			version: 1,
			generatedAt: "2026-05-27T00:06:00.000Z",
			nodes: {},
			sessions: {
				"ps-child": signalSession({ piboSessionId: "ps-child", aggregateStatus: "error", hasError: true, isTreeActive: true, updatedAt: "2026-05-27T00:10:00.000Z" }),
				"ps-derived": signalSession({ piboSessionId: "ps-derived", aggregateStatus: "error", hasError: true, isTreeActive: true, updatedAt: "2026-05-27T00:11:00.000Z" }),
			},
		};

		function assertAtLeastIso(value, minimum) {
			assert.ok(Date.parse(value) >= Date.parse(minimum), \`expected \${value} to be at or after \${minimum}\`);
		}

		const runningTurn = {
			nodeId: "turn:ps-root:event-1",
			eventId: "event-1",
			state: "running",
			startedAt: "2026-05-27T00:04:00.000Z",
			updatedAt: "2026-05-27T00:05:00.000Z",
		};
		assert.equal(signalLegacyStatus(signalSession({ latestTurn: runningTurn })), "running", "the canonical running turn keeps sidebar status active");
		assert.equal(signalLegacyStatus(signalSession({ isTreeActive: true, latestTurn: { ...runningTurn, state: "completed", completedAt: runningTurn.updatedAt } })), "running", "background tree activity stays visible after the local turn ends");
		assert.equal(signalLegacyStatus(signalSession({ latestTurn: { ...runningTurn, state: "completed", completedAt: runningTurn.updatedAt } })), "idle", "terminal local turn settles sidebar status with the tree");

		const withSnapshot = applySignalSnapshotToBootstrap(base, snapshot);
		const updatedChild = withSnapshot.sessions[0].children[0];
		assert.equal(updatedChild.status, "error", "unread error sessions stay visibly errored");
		assertAtLeastIso(updatedChild.lastActivityAt, "2026-05-27T00:10:00.000Z");
		assert.equal(updatedChild.derivedSessions[0].status, "running", "acknowledged active derived errors collapse to running");
		assertAtLeastIso(updatedChild.derivedSessions[0].lastActivityAt, "2026-05-27T00:11:00.000Z");

		const patch = {
			type: "signal_patch",
			rootPiboSessionId: "ps-root",
			fromVersion: 1,
			toVersion: 2,
			generatedAt: "2026-05-27T00:12:00.000Z",
			upserts: [signalNode({ id: "node-new" })],
			removes: ["node-old"],
			sessionSnapshots: [signalSession({ piboSessionId: "ps-child", aggregateStatus: "idle", updatedAt: "2026-05-27T00:13:00.000Z" })],
		};
		const withPatch = applySignalPatchToBootstrap(withSnapshot, patch);
		assert.equal(withPatch.sessions[0].children[0].status, "idle");
		assertAtLeastIso(withPatch.sessions[0].children[0].lastActivityAt, "2026-05-27T00:13:00.000Z");

		const currentSignal = {
			rootPiboSessionId: "ps-root",
			version: 1,
			generatedAt: "2026-05-27T00:00:00.000Z",
			nodes: { "node-old": signalNode({ id: "node-old" }) },
			sessions: { "ps-root": signalSession() },
		};
		const patchedSignal = applySignalPatch(currentSignal, patch);
		assert.equal(patchedSignal.version, 2);
		assert.equal(patchedSignal.generatedAt, "2026-05-27T00:12:00.000Z");
		assert.equal(patchedSignal.nodes["node-old"], undefined);
		assert.equal(patchedSignal.nodes["node-new"].id, "node-new");
		assert.equal(patchedSignal.sessions["ps-child"].piboSessionId, "ps-child");
		assert.equal(applySignalPatch(currentSignal, { ...patch, fromVersion: 99 }), currentSignal);
		assert.equal(applySignalPatch(null, patch), null);

		assert.equal(signalSnapshotIncludesSession(currentSignal, "ps-root"), true);
		assert.equal(signalSnapshotIncludesSession(currentSignal, "ps-other"), false);
		assert.equal(retainSelectedSignalSnapshot(currentSignal, "ps-root"), currentSignal, "same-tree selection changes keep an already valid snapshot");
		assert.equal(retainSelectedSignalSnapshot(currentSignal, "ps-other"), null, "an unrelated previous tree is discarded");
		assert.equal(shouldReconcileSelectedSignalTree(null, "ps-root", "idle"), true, "a missing initial snapshot is retried even when bootstrap looks idle");
		assert.equal(shouldReconcileSelectedSignalTree(currentSignal, "ps-root", "running"), true, "a running bootstrap fallback remains reconciled");
		assert.equal(shouldReconcileSelectedSignalTree(currentSignal, "ps-root", "idle"), false, "a settled selected snapshot does not poll indefinitely");
		assert.equal(shouldReconcileSelectedSignalTree({ ...currentSignal, sessions: { "ps-root": signalSession({ isTreeActive: true }) } }, "ps-root", "idle"), true, "an active selected snapshot remains reconciled");
		assert.equal(shouldCommitSelectedSignalSnapshot(null, currentSignal, "ps-root"), true);
		assert.equal(shouldCommitSelectedSignalSnapshot(currentSignal, { ...currentSignal, version: 0 }, "ps-root"), false, "a delayed REST snapshot cannot roll back a newer SSE version");
		assert.equal(shouldCommitSelectedSignalSnapshot(currentSignal, currentSignal, "ps-other"), false, "a previous session tree cannot replace the selected session tree");
		assert.deepEqual(
			applySelectedSignalPatch(currentSignal, patch, "ps-other"),
			{ snapshot: currentSignal, needsRefresh: true },
			"a stale tree from the previous selection cannot consume the new session's patch",
		);
		assert.deepEqual(
			applySelectedSignalPatch(null, patch, "ps-root"),
			{ snapshot: null, needsRefresh: true },
			"a patch received before the selected session snapshot triggers a full refresh",
		);
		const selectedPatch = applySelectedSignalPatch(currentSignal, patch, "ps-root");
		assert.equal(selectedPatch.needsRefresh, false);
		assert.equal(selectedPatch.snapshot.version, 2);

		const globalBase = bootstrap({
			sessions: [sessionNode({ piboSessionId: "ps-root" }), sessionNode({ piboSessionId: "ps-other", piSessionId: "pi-other" })],
		});
		const statusSnapshot = {
			type: "signal_status_snapshot",
			generatedAt: "2026-05-27T00:20:00.000Z",
			rootVersions: { "ps-root": 1, "ps-other": 3 },
			sessions: {
				"ps-root": signalStatus(),
				"ps-other": signalStatus({ piboSessionId: "ps-other", status: "running", isTreeActive: true }),
			},
		};
		const withGlobalStatuses = applySignalStatusSnapshotToBootstrap(globalBase, statusSnapshot);
		assert.equal(withGlobalStatuses.sessions[0].status, "idle");
		assert.equal(withGlobalStatuses.sessions[1].status, "running", "an unselected root receives canonical running status");
		const statusPatch = {
			type: "signal_status_patch",
			rootPiboSessionId: "ps-other",
			fromVersion: 3,
			toVersion: 4,
			generatedAt: "2026-05-27T00:21:00.000Z",
			sessionStatuses: [signalStatus({ piboSessionId: "ps-other", status: "idle" })],
		};
		const patchedStatuses = applySignalStatusPatch(statusSnapshot, statusPatch);
		assert.equal(patchedStatuses.needsRefresh, false);
		assert.equal(applySignalStatusPatchToBootstrap(withGlobalStatuses, statusPatch).sessions[1].status, "idle");
		assert.equal(patchedStatuses.snapshot.rootVersions["ps-other"], 4);
		assert.equal(patchedStatuses.snapshot.sessions["ps-other"].isTreeActive, false);
		assert.equal(applySignalStatusPatch(statusSnapshot, { ...statusPatch, fromVersion: 99 }).needsRefresh, true, "a missed global patch requests reconciliation");
		assert.equal(shouldCommitSignalStatusSnapshot(statusSnapshot, { ...statusSnapshot, generatedAt: "2026-05-27T00:19:00.000Z" }), false, "a delayed global snapshot cannot roll state back");
		assert.equal(shouldCommitSignalStatusSnapshot(statusSnapshot, { ...statusSnapshot, generatedAt: "2026-05-27T00:22:00.000Z", rootVersions: { "ps-root": 0, "ps-other": 0 } }), true, "a newer gateway snapshot can reset root versions after restart");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app signal status helpers preserve snapshot and patch semantics", async () => {
	await assert.doesNotReject(runAppSignalStatusScenario());
});

test("optimistic session status updates are not overwritten by the previous signal snapshot", () => {
	const source = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(source, /setBootstrap\(\(current\) => current \? updater\(current\) : current\)/);
	assert.doesNotMatch(source, /setBootstrap\(\(current\) => current \? overlayCurrentSignals\(updater\(current\)\) : current\)/);
});

test("the sidebar consumes one global signal feed independent of selection", () => {
	const source = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(source, /subscribeSignalStatuses\(signalStatusHandlers\)/);
	assert.match(source, /fetchSignalStatuses\(\{ signal: controller\.signal \}\)/);
	assert.match(source, /applySignalStatusSnapshotToBootstrap\(current, snapshot\)/);
	assert.match(source, /applySignalStatusPatchToBootstrap\(current, patch\)/);
	assert.match(source, /SIGNAL_STATUS_RECONCILE_INTERVAL_MS = 5_000/);
	assert.match(source, /sessionStatusSignalsRef\.current\?\.sessions\[targetPiboSessionId\]/, "room events defer to app-global canonical signals");
	assert.match(source, /overlayCurrentSignals\(\{ \.\.\.current, sessions: appendSessionRoots\(current\.sessions, page\.sessions\) \}\)/, "newly paged sessions receive cached global statuses immediately");
});

test("restored or newly visible pages reconnect and refresh the selected signal tree", () => {
	const source = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(source, /window\.addEventListener\("pageshow", reconnectSignalTree\)/);
	assert.match(source, /document\.addEventListener\("visibilitychange", refreshVisibleSignalTree\)/);
	assert.match(source, /unsubscribeSignalTree\(\)[\s\S]*subscribeSignalTree[\s\S]*refreshSignalSnapshot\(0\)/);
});

test("selected sessions recover missing snapshots and reconcile active turns", () => {
	const source = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(source, /SIGNAL_TREE_RECONCILE_INTERVAL_MS = 5_000/);
	assert.match(source, /retainSelectedSignalSnapshot\(sessionSignalsRef\.current, selectedPiboSessionId\)/);
	assert.match(source, /\.catch\(\(\) => \{[\s\S]*refreshSignalSnapshot\(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS\)/, "failed initial REST snapshots retry instead of being swallowed");
	assert.match(source, /shouldReconcileSelectedSignalTree\(sessionSignalsRef\.current, selectedPiboSessionId, selectedSession\?\.status\)/);
	assert.match(source, /window\.setInterval\([\s\S]*shouldReconcileSignalTree\(\)[\s\S]*refreshSignalSnapshot\(0\)[\s\S]*SIGNAL_TREE_RECONCILE_INTERVAL_MS/);
	assert.match(source, /window\.clearInterval\(signalReconcileTimer\)/);
});
