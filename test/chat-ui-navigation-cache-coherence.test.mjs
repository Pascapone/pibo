import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runNavigationCacheScenario() {
	const script = `
		import assert from "node:assert/strict";
		import { QueryClient } from "@tanstack/react-query";
		const {
			chatSessionNavigationGeneration,
			chatSessionNavigationQueryKey,
			invalidateChatSessionNavigationCache,
			loadChatSessionNavigationQueryData,
		} = await import("./src/apps/chat-ui/src/cache.ts");

		function session(piboSessionId, title, archived = false) {
			return {
				piboSessionId,
				piSessionId: "pi-" + piboSessionId,
				profile: "pibo-agent",
				title,
				status: "idle",
				lastActivityAt: "2026-08-28T00:00:00.000Z",
				archived,
				derivedSessions: [],
				children: [],
			};
		}

		function navigation(sessions, selectedPiboSessionId = sessions[0]?.piboSessionId ?? "") {
			return {
				identity: { userId: "user-1" },
				selectedRoomId: "room-1",
				selectedPiboSessionId,
				latestRoomStreamId: 1,
				rooms: [],
				sessions,
			};
		}

		async function assertMutationBarrier({ includeArchived = false, stale, authoritative }) {
			const queryClient = new QueryClient();
			let releaseStale;
			const delayed = new Promise((resolve) => { releaseStale = resolve; });
			const input = { includeArchived, roomId: "room-1", piboSessionId: "ps-selected" };
			const queryKey = chatSessionNavigationQueryKey(includeArchived, "room-1", "ps-selected");
			const generationBefore = chatSessionNavigationGeneration(queryClient);
			const staleRequest = loadChatSessionNavigationQueryData(queryClient, input, () => delayed);

			await invalidateChatSessionNavigationCache(queryClient);
			assert.equal(chatSessionNavigationGeneration(queryClient), generationBefore + 1);
			assert.equal(queryClient.getQueryData(queryKey), undefined);

			releaseStale(stale);
			assert.deepEqual(await staleRequest, stale, "the original caller may finish, but its result must not repopulate the cache");
			assert.equal(queryClient.getQueryData(queryKey), undefined);

			let authoritativeFetches = 0;
			const fresh = await loadChatSessionNavigationQueryData(queryClient, input, async () => {
				authoritativeFetches += 1;
				return authoritative;
			});
			assert.deepEqual(fresh, authoritative);
			assert.deepEqual(queryClient.getQueryData(queryKey), authoritative);

			const cached = await loadChatSessionNavigationQueryData(queryClient, input, async () => {
				throw new Error("non-forced load should use the post-mutation cache");
			});
			assert.deepEqual(cached, authoritative);
			assert.equal(authoritativeFetches, 1);
			queryClient.clear();
		}

		await assertMutationBarrier({
			stale: navigation([]),
			authoritative: navigation([session("ps-new", "Immediate authoritative rename")], "ps-new"),
		});
		await assertMutationBarrier({
			stale: navigation([session("ps-existing", "Old title")], "ps-existing"),
			authoritative: navigation([session("ps-existing", "Authoritative title")], "ps-existing"),
		});
		await assertMutationBarrier({
			stale: navigation([session("ps-archive", "Archive me")], "ps-archive"),
			authoritative: navigation([], ""),
		});
		await assertMutationBarrier({
			includeArchived: true,
			stale: navigation([session("ps-restore", "Restore me", true)], "ps-restore"),
			authoritative: navigation([session("ps-restore", "Restore me", false)], "ps-restore"),
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session mutations reject delayed pre-mutation navigation cache writes", async () => {
	await assert.doesNotReject(runNavigationCacheScenario());
});

test("create, rename, archive, and restore all cross the navigation mutation barrier", async () => {
	const source = await readFile("src/apps/chat-ui/src/App.tsx", "utf8");
	const createMutation = source.slice(source.indexOf("const createSessionMutation"), source.indexOf("const renameSessionMutation"));
	const renameMutation = source.slice(source.indexOf("const renameSessionMutation"), source.indexOf("const archiveSessionMutation"));
	const archiveMutation = source.slice(source.indexOf("const archiveSessionMutation"), source.indexOf("const sendMessageMutation"));
	for (const mutation of [createMutation, renameMutation, archiveMutation]) {
		assert.match(mutation, /await prepareSessionNavigationMutation\(\)/);
	}
	assert.match(source, /navigationInFlightRef\.current\.clear\(\)/);
	assert.match(source, /bootstrapRequestId\.current \+= 1/);
});
