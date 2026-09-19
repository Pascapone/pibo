import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runScenario(body) {
	const script = `
		import assert from "node:assert/strict";
		import { resolveOptimisticSessionCreateOutcome } from "./src/apps/chat-ui/src/app-bootstrap-mutations.ts";
		import {
			beginOptimisticSessionTitlePatch,
			cancelOptimisticSessionTitle,
			confirmOptimisticSessionTitle,
			createOptimisticSessionTitleIntent,
			failOptimisticSessionTitlePatch,
			handoffOptimisticSessionTitle,
			optimisticSessionTitleDisplay,
			ownsDeferredOptimisticSessionHydration,
			updateOptimisticSessionTitleDraft,
		} from "./src/apps/chat-ui/src/optimistic-session-title.ts";
		let intent = createOptimisticSessionTitleIntent({
			operationId: "create-1",
			originRoomId: "room-origin",
			tempId: "optimistic-session-create-1",
		});
		${body}
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--loader", "./test/helpers/css-stub-loader.mjs", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("pending creation opens a local empty title editor before any persisted ID exists", async () => {
	await runScenario(`
		assert.equal(intent.createStatus, "pending");
		assert.equal(intent.editorStatus, "editing");
		assert.equal(intent.piboSessionId, intent.tempId);
		assert.equal(intent.draftTitle, "");
		assert.equal(beginOptimisticSessionTitlePatch(intent), null);
	`);
});

test("an in-progress draft and editor survive the temporary-to-real ID handoff", async () => {
	await runScenario(`
		intent = updateOptimisticSessionTitleDraft(intent, "Still typing");
		const handedOff = handoffOptimisticSessionTitle(intent, "ps_created", "Untitled Session");
		assert.equal(handedOff.piboSessionId, "ps_created");
		assert.equal(handedOff.createStatus, "created");
		assert.equal(handedOff.editorStatus, "editing");
		assert.equal(handedOff.draftTitle, "Still typing");
		assert.equal(beginOptimisticSessionTitlePatch(handedOff), null);
	`);
});

test("a pending confirmation displays immediately and queues one real-ID PATCH", async () => {
	await runScenario(`
		intent = updateOptimisticSessionTitleDraft(intent, "  Confirmed locally  ");
		intent = confirmOptimisticSessionTitle(intent);
		assert.equal(intent.editorStatus, "confirmed");
		assert.equal(intent.confirmedTitle, "Confirmed locally");
		assert.equal(optimisticSessionTitleDisplay(intent), "Confirmed locally");
		assert.equal(beginOptimisticSessionTitlePatch(intent), null, "the temporary ID is never patched");

		intent = handoffOptimisticSessionTitle(intent, "ps_created", "Untitled Session");
		const first = beginOptimisticSessionTitlePatch(intent);
		assert.ok(first);
		assert.equal(first.request.piboSessionId, "ps_created");
		assert.equal(first.request.title, "Confirmed locally");
		assert.equal(beginOptimisticSessionTitlePatch(first.intent), null, "one confirmation starts at most one PATCH");
	`);
});

test("cancelling while creation is pending prevents post-create rename reopening or PATCH", async () => {
	await runScenario(`
		intent = updateOptimisticSessionTitleDraft(intent, "Discard me");
		intent = cancelOptimisticSessionTitle(intent);
		assert.equal(intent.editorStatus, "cancelled");
		intent = handoffOptimisticSessionTitle(intent, "ps_created", "Untitled Session");
		assert.equal(intent.editorStatus, "cancelled");
		assert.equal(optimisticSessionTitleDisplay(intent), "Untitled Session");
		assert.equal(beginOptimisticSessionTitlePatch(intent), null);
	`);
});

test("a newer user selection wins while a queued title still targets the created real ID", async () => {
	await runScenario(`
		intent = updateOptimisticSessionTitleDraft(intent, "Background title");
		intent = confirmOptimisticSessionTitle(intent);
		const outcome = resolveOptimisticSessionCreateOutcome({
			status: "success",
			currentSelectedPiboSessionId: "ps_user_selected",
			tempId: intent.tempId,
			previousSelectedPiboSessionId: "ps_previous",
			createdPiboSessionId: "ps_created",
		});
		assert.equal(outcome.selectedPiboSessionId, "ps_user_selected");
		assert.equal(outcome.navigateToCreatedSession, false);
		intent = handoffOptimisticSessionTitle(intent, "ps_created", "Untitled Session");
		const patch = beginOptimisticSessionTitlePatch(intent);
		assert.ok(patch);
		assert.equal(patch.request.piboSessionId, "ps_created");
		assert.equal(patch.request.title, "Background title");
	`);
});

test("delayed title persistence cannot launch hydration after a newer session or room selection", async () => {
	await runScenario(`
		const owner = {
			piboSessionId: "ps_created",
			bootstrapRequestId: 12,
			roomSwitchGeneration: 4,
			sessionSelectionGeneration: 7,
		};
		let selectedPiboSessionId = "ps_created";
		let bootstrapRequestId = 12;
		let roomSwitchGeneration = 4;
		let sessionSelectionGeneration = 7;
		let releasePatch;
		let hydrationStarted = false;
		const delayedPatch = new Promise((resolve) => { releasePatch = resolve; });
		const hydration = delayedPatch.then(() => {
			hydrationStarted = ownsDeferredOptimisticSessionHydration(owner, {
				selectedPiboSessionId,
				bootstrapRequestId,
				roomSwitchGeneration,
				sessionSelectionGeneration,
			});
		});

		selectedPiboSessionId = "ps_newer";
		bootstrapRequestId += 1;
		roomSwitchGeneration += 1;
		sessionSelectionGeneration += 1;
		releasePatch();
		await hydration;
		assert.equal(hydrationStarted, false);
	`);
});

test("a failed real-ID rename reopens the confirmed draft and a retry gets a new single request", async () => {
	await runScenario(`
		intent = updateOptimisticSessionTitleDraft(intent, "Recoverable title");
		intent = handoffOptimisticSessionTitle(intent, "ps_created", "Untitled Session");
		intent = confirmOptimisticSessionTitle(intent);
		const first = beginOptimisticSessionTitlePatch(intent);
		assert.ok(first);
		intent = failOptimisticSessionTitlePatch(first.intent, first.request.confirmationVersion);
		assert.equal(intent.editorStatus, "editing");
		assert.equal(intent.draftTitle, "Recoverable title");
		assert.equal(intent.patchStatus, "failed");

		intent = updateOptimisticSessionTitleDraft(intent, "Retry title");
		intent = confirmOptimisticSessionTitle(intent);
		const retry = beginOptimisticSessionTitlePatch(intent);
		assert.ok(retry);
		assert.equal(retry.request.piboSessionId, "ps_created");
		assert.equal(retry.request.title, "Retry title");
		assert.equal(retry.request.confirmationVersion, first.request.confirmationVersion + 1);
		assert.equal(beginOptimisticSessionTitlePatch(retry.intent), null);
	`);
});

test("App commits the focused temporary editor before starting POST and guards pending backend actions", async () => {
	const [app, sidebar, node, coreWorkspace] = await Promise.all([
		readFile("src/apps/chat-ui/src/App.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-sidebar.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-node.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/core-workspace-view.tsx", "utf8"),
	]);
	const create = app.slice(app.indexOf("const createSession = async"), app.indexOf("const toggleArchivedSessions = async"));
	assert.ok(create.indexOf("flushSync(() =>") < create.indexOf("createSessionMutation.mutateAsync"));
	assert.match(create, /createOptimisticSessionTitleIntent/);
	assert.match(create, /addSessionNodeToBootstrap/);
	assert.match(create, /ownsDeferredOptimisticSessionHydration/);
	assert.match(create, /hydrateBootstrapCacheQueryData/);
	assert.doesNotMatch(create, /loadBootstrap\(created\.session\.id/);
	assert.match(app, /let cancelled = false;[\s\S]*const canonicalizeSessionsRoute[\s\S]*if \(cancelled\) return;/);
	assert.match(sidebar, /key=\{optimisticTitleIntent\?\.operationId \?\? session\.piboSessionId\}/);
	assert.match(sidebar, /mutationsDisabled=\{pendingCreation\}/);
	assert.match(sidebar, /draggable=\{!selectedRoomArchived && !pendingCreation\}/);
	assert.match(node, /disabled=\{mutationsDisabled && !optimisticTitleIntent\}/);
	assert.match(app, /selectedSessionBackendId\(request\.piboSessionId\)/);
	assert.match(app, /onCreateSession=\{\(profile\) => createSession\(profile\)\}/);
	assert.match(coreWorkspace, /onCreateSession\(profile\)/);
	assert.doesNotMatch(create, /location\.(?:assign|replace|reload)|location\.href\s*=/);
});

test("create and rename failures retain explicit recovery text and no temporary title PATCH path", async () => {
	const app = await readFile("src/apps/chat-ui/src/App.tsx", "utf8");
	assert.match(app, /Session was not created:.*Your temporary title was not sent to the server\./s);
	assert.match(app, /Session was created, but its title was not saved:.*Edit the title and try again\./s);
	assert.match(app, /failOptimisticSessionTitlePatch/);
	assert.match(app, /selectedSessionBackendId\(request\.piboSessionId\)/);
});
