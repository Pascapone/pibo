import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runBootstrapMutationScenario() {
	const script = `
		import assert from "node:assert/strict";
		import { QueryClient } from "@tanstack/react-query";
		const {
			addRoomToBootstrap,
			addSessionNodeToBootstrap,
			createBootstrapMutationSnapshot,
			createOptimisticRoom,
			createOptimisticSessionNode,
			removeRoomsFromBootstrap,
			removeSessionsFromBootstrap,
			replaceOptimisticSessionNode,
			replaceRoomInBootstrap,
			roomSubtreeIds,
			roomWithArchivedState,
			sessionNodeFromSession,
			sessionSubtreeIds,
			updateRoomInBootstrap,
			updateSessionFromPiboSession,
			updateSessionNodeInBootstrap,
		} = await import("./src/apps/chat-ui/src/app-bootstrap-mutations.ts");

		function piboSession(overrides = {}) {
			return {
				id: overrides.id ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				channel: "web",
				kind: "chat",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? "Root",
				metadata: overrides.metadata ?? {},
				createdAt: overrides.createdAt ?? "2026-05-27T00:00:00.000Z",
				updatedAt: overrides.updatedAt ?? "2026-05-27T00:00:00.000Z",
				...overrides,
			};
		}

		function sessionNode(overrides = {}) {
			return {
				piboSessionId: overrides.piboSessionId ?? "ps-root",
				piSessionId: overrides.piSessionId ?? "pi-root",
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? "Root",
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
				name: overrides.name ?? "Root Room",
				type: overrides.type ?? "chat",
				createdAt: overrides.createdAt ?? "2026-05-27T00:00:00.000Z",
				updatedAt: overrides.updatedAt ?? "2026-05-27T00:00:00.000Z",
				metadata: overrides.metadata ?? {},
				children: overrides.children ?? [],
				...overrides,
			};
		}

		function bootstrap(overrides = {}) {
			const root = overrides.sessionRoot ?? sessionNode();
			const rootRoom = overrides.rootRoom ?? room();
			return {
				identity: { userId: "user-1" },
				session: overrides.session ?? piboSession({ id: root.piboSessionId, piSessionId: root.piSessionId, profile: root.profile, title: root.title }),
				selectedRoomId: rootRoom.id,
				selectedPiboSessionId: root.piboSessionId,
				room: rootRoom,
				rooms: [rootRoom],
				sessions: [root],
				agents: [{ name: "pibo-agent", aliases: [] }],
				customAgents: [],
				capabilities: { actions: [] },
				...overrides,
			};
		}

		const child = sessionNode({ piboSessionId: "ps-child", piSessionId: "pi-child", title: "Child" });
		const root = sessionNode({ children: [child] });
		const base = bootstrap({ sessionRoot: root });

		assert.deepEqual([...sessionSubtreeIds(root)].sort(), ["ps-child", "ps-root"]);
		const withoutChild = removeSessionsFromBootstrap(base, new Set(["ps-child"]));
		assert.equal(withoutChild.sessions[0].children.length, 0);
		assert.equal(withoutChild.selectedPiboSessionId, "ps-root");
		assert.equal(removeSessionsFromBootstrap(base, new Set(["ps-root"])).selectedPiboSessionId, "");

		const optimistic = createOptimisticSessionNode("ps-temp", "worker");
		assert.equal(optimistic.piSessionId, "pending");
		assert.equal(optimistic.profile, "worker");
		assert.equal(addSessionNodeToBootstrap(base, root), base);
		assert.equal(addSessionNodeToBootstrap(base, optimistic).sessions[0].piboSessionId, "ps-temp");

		const tempBase = bootstrap({
			sessionRoot: sessionNode({ piboSessionId: "ps-temp", piSessionId: "pending", title: "New Session" }),
			session: piboSession({ id: "ps-temp", piSessionId: "pending", title: "New Session" }),
		});
		const createdNode = sessionNodeFromSession(piboSession({ id: "ps-created", piSessionId: "pi-created", profile: "worker", title: "Created", updatedAt: "2026-05-27T01:00:00.000Z" }));
		const replaced = replaceOptimisticSessionNode(tempBase, "ps-temp", createdNode);
		assert.equal(replaced.selectedPiboSessionId, "ps-created");
		assert.equal(replaced.session.id, "ps-created");
		assert.equal(replaced.sessions[0].piboSessionId, "ps-created");

		const updatedNode = updateSessionNodeInBootstrap(base, "ps-root", (node) => ({ ...node, title: "Renamed", lastActivityAt: "2026-05-27T02:00:00.000Z" }));
		assert.equal(updatedNode.session.title, "Renamed");
		assert.equal(updatedNode.session.updatedAt, "2026-05-27T02:00:00.000Z");
		assert.equal(updatedNode.sessions[0].title, "Renamed");

		const archivedSession = updateSessionFromPiboSession(base, piboSession({ id: "ps-root", profile: "worker", title: "Archived", metadata: { chatWebArchivedAt: "2026-05-27T03:00:00.000Z" } }));
		assert.equal(archivedSession.session.title, "Archived");
		assert.equal(archivedSession.sessions[0].profile, "worker");
		assert.equal(archivedSession.sessions[0].archived, true);

		const nestedRoom = room({ id: "room-parent", name: "Parent", children: [room({ id: "room-child", name: "Child" })] });
		assert.deepEqual([...roomSubtreeIds(nestedRoom)].sort(), ["room-child", "room-parent"]);
		const optimisticRoom = createOptimisticRoom("room-temp", "New Chat");
		assert.equal("ownerScope" in optimisticRoom, false);
		const withRoom = addRoomToBootstrap(base, optimisticRoom);
		assert.equal(withRoom.selectedRoomId, "room-temp");
		assert.equal(withRoom.selectedPiboSessionId, "");
		assert.equal(addRoomToBootstrap(base, base.rooms[0]), base);

		const createdRoom = room({ id: "room-created", name: "Created Room" });
		const replacedRoom = replaceRoomInBootstrap(withRoom, "room-temp", createdRoom);
		assert.equal(replacedRoom.selectedRoomId, "room-created");
		assert.equal(replacedRoom.room.id, "room-created");
		const renamedRoom = updateRoomInBootstrap(replacedRoom, "room-created", (current) => ({ ...current, name: "Renamed Room" }));
		assert.equal(renamedRoom.room.name, "Renamed Room");
		const archivedRoom = roomWithArchivedState(createdRoom, true);
		assert.equal(typeof archivedRoom.metadata.chatRoomArchivedAt, "string");
		assert.equal(roomWithArchivedState(archivedRoom, false).metadata.chatRoomArchivedAt, undefined);
		const removedRoom = removeRoomsFromBootstrap(renamedRoom, new Set(["room-created"]));
		assert.equal(removedRoom.selectedRoomId, "");
		assert.equal(removedRoom.selectedPiboSessionId, "");

		const queryClient = new QueryClient();
		queryClient.setQueryData(["chat", "bootstrap"], base);
		queryClient.setQueryData(["chat", "bootstrap", "ps-root"], replaced);
		const snapshot = createBootstrapMutationSnapshot(queryClient, base);
		assert.equal(snapshot.localBootstrap, base);
		assert.equal(snapshot.queryData.length, 2);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("app bootstrap mutation helpers preserve optimistic session and room updates", async () => {
	await assert.doesNotReject(runBootstrapMutationScenario());
});
