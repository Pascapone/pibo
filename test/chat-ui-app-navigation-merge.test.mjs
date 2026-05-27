import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runNavigationMergeScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			appendSessionRoots,
			mergeNavigationIntoBootstrap,
		} = await import("./src/apps/chat-ui/src/app-navigation-merge.ts");

		function piboSession(overrides = {}) {
			return {
				id: overrides.id ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				channel: "web",
				kind: "chat",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? "Root",
				metadata: {},
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? overrides.piboSessionId ?? "Root",
				status: overrides.status ?? "idle",
				lastActivityAt: overrides.lastActivityAt ?? "2026-05-27T00:00:00.000Z",
				derivedSessions: overrides.derivedSessions ?? [],
				children: overrides.children ?? [],
				...overrides,
			};
		}

		function room(overrides = {}) {
			return {
				id: overrides.id ?? "room-root",
				ownerScope: "user:user-1",
				name: overrides.name ?? overrides.id ?? "Room",
				type: "chat",
				createdAt: "2026-05-27T00:00:00.000Z",
				updatedAt: "2026-05-27T00:00:00.000Z",
				metadata: {},
				children: overrides.children ?? [],
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			const root = overrides.sessionRoot ?? sessionNode();
			const rootRoom = overrides.rootRoom ?? room({ id: "room-root" });
			return {
				identity: { userId: "user-1" },
				session: piboSession({ id: root.piboSessionId, piSessionId: root.piSessionId, profile: root.profile, title: root.title }),
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

		const grandchild = sessionNode({ piboSessionId: "ps-grandchild", piSessionId: "pi-grandchild", unreadCount: 3 });
		const child = sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child", unreadCount: 2, children: [grandchild] });
		const root = sessionNode({ unreadCount: 4, children: [child] });
		const childRoom = room({ id: "room-child", unreadCount: 5 });
		const rootRoom = room({ id: "room-root", unreadCount: 7, children: [childRoom] });
		const current = bootstrap({ sessionRoot: root, rootRoom });
		const navigation = {
			identity: { userId: "user-2", email: "user@example.test" },
			session: piboSession({ id: "ps-child", piSessionId: "pi-child", title: "Selected" }),
			selectedRoomId: "room-child",
			selectedPiboSessionId: "ps-child",
			latestRoomStreamId: 42,
			room: room({ id: "room-child", name: "Selected Room" }),
			rooms: [room({ id: "room-root", children: [room({ id: "room-child" })] })],
			sessions: [sessionNode({ children: [sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child", children: [sessionNode({ piboSessionId: "ps-grandchild", piSessionId: "pi-grandchild" })] })] })],
		};

		const merged = mergeNavigationIntoBootstrap(current, navigation, { readSessionId: "ps-child" });
		assert.equal(merged.identity.userId, "user-2");
		assert.equal(merged.selectedPiboSessionId, "ps-child");
		assert.equal(merged.latestRoomStreamId, 42);
		assert.equal(merged.agents, current.agents, "bootstrap-only fields survive navigation refresh");
		assert.equal(merged.sessions[0].unreadCount, 4, "unread root outside the read subtree is preserved when navigation omits it");
		assert.equal(merged.sessions[0].children[0].unreadCount, undefined, "read session unread count is cleared");
		assert.equal(merged.sessions[0].children[0].children[0].unreadCount, undefined, "read descendant unread count is cleared");
		assert.equal(merged.rooms[0].unreadCount, 2, "selected room ancestors subtract the cleared session unread count");
		assert.equal(merged.rooms[0].children[0].unreadCount, undefined, "selected room unread count clears when all selected unread was read");

		const navigationWithFreshUnread = {
			...navigation,
			selectedPiboSessionId: "ps-root",
			sessions: [sessionNode({ unreadCount: 9, children: [sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child" })] })],
		};
		const mergedWithoutRead = mergeNavigationIntoBootstrap(current, navigationWithFreshUnread);
		assert.equal(mergedWithoutRead.sessions[0].unreadCount, 9, "navigation unread counts win over preserved counts when supplied");
		assert.equal(mergedWithoutRead.sessions[0].children[0].unreadCount, 2, "omitted nested unread count falls back to previous bootstrap state");

		const existingRoot = sessionNode({ piboSessionId: "ps-existing" });
		const newRoot = sessionNode({ piboSessionId: "ps-new" });
		const currentRoots = [existingRoot];
		assert.equal(appendSessionRoots(currentRoots, []), currentRoots, "empty append keeps current array identity");
		assert.equal(appendSessionRoots(currentRoots, [existingRoot]), currentRoots, "duplicate append keeps current array identity");
		assert.deepEqual(appendSessionRoots(currentRoots, [existingRoot, newRoot]).map((session) => session.piboSessionId), ["ps-existing", "ps-new"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app navigation merge helpers preserve unread and append semantics", async () => {
	await assert.doesNotReject(runNavigationMergeScenario());
});
