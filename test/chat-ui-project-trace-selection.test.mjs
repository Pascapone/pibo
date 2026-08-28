import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runProjectTraceSelectionScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const {
			resolveProjectsCanonicalRoute,
			resolveProjectsTraceSelection,
		} = await import("./src/apps/chat-ui/src/projects/ProjectsAreaModel.ts");

		const project = (id, name) => ({
			id,
			name,
			projectFolder: "/workspace/" + id,
			configurationStatus: "configured",
			metadata: {},
			createdAt: "2026-08-24T00:00:00.000Z",
			updatedAt: "2026-08-24T00:00:00.000Z",
		});
		const session = (piboSessionId, title) => ({
			piboSessionId,
			piSessionId: "pi-" + piboSessionId,
			profile: "pibo-agent",
			title,
			status: "idle",
			derivedSessions: [],
			children: [],
		});
		const alpha = project("project-alpha", "Alpha");
		const beta = project("project-beta", "Beta");
		const alphaSession = session("ps-alpha", "Alpha Session");
		const alphaNextSession = session("ps-alpha-next", "Alpha Next Session");
		const betaSession = session("ps-beta", "Beta Session");
		const alphaData = {
			project: alpha,
			projects: [alpha, beta],
			selectedProjectId: alpha.id,
			selectedPiboSessionId: alphaSession.piboSessionId,
			sessions: [alphaSession, alphaNextSession],
		};

		assert.deepEqual(resolveProjectsCanonicalRoute(alphaData, alpha.id, alphaSession.piboSessionId), null);
		assert.deepEqual(resolveProjectsCanonicalRoute(alphaData, alpha.id), {
			projectId: alpha.id,
			piboSessionId: alphaSession.piboSessionId,
		});
		assert.deepEqual(resolveProjectsTraceSelection(alphaData, alpha.id, alphaSession.piboSessionId), {
			project: alpha,
			selectedPiboSessionId: alphaSession.piboSessionId,
			navigationPending: false,
		});
		assert.deepEqual(resolveProjectsTraceSelection(alphaData, alpha.id, alphaNextSession.piboSessionId), {
			project: alpha,
			selectedPiboSessionId: alphaNextSession.piboSessionId,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(alphaData, alpha.id, betaSession.piboSessionId), {
			project: alpha,
			selectedPiboSessionId: null,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(alphaData, beta.id), {
			project: beta,
			selectedPiboSessionId: null,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(alphaData, beta.id, alphaSession.piboSessionId), {
			project: beta,
			selectedPiboSessionId: null,
			navigationPending: true,
		});

		const betaData = {
			project: beta,
			projects: [alpha, beta],
			selectedProjectId: beta.id,
			selectedPiboSessionId: betaSession.piboSessionId,
			sessions: [betaSession],
		};
		assert.deepEqual(resolveProjectsTraceSelection(betaData, beta.id, alphaSession.piboSessionId), {
			project: beta,
			selectedPiboSessionId: null,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(betaData, beta.id, betaSession.piboSessionId), {
			project: beta,
			selectedPiboSessionId: betaSession.piboSessionId,
			navigationPending: false,
		});

		const emptyAlphaData = {
			...alphaData,
			selectedPiboSessionId: undefined,
			sessions: [],
		};
		assert.deepEqual(resolveProjectsCanonicalRoute(emptyAlphaData, alpha.id, betaSession.piboSessionId), {
			projectId: alpha.id,
		});
		assert.deepEqual(resolveProjectsTraceSelection(emptyAlphaData, alpha.id, betaSession.piboSessionId), {
			project: alpha,
			selectedPiboSessionId: null,
			navigationPending: true,
		});
		assert.deepEqual(resolveProjectsTraceSelection(emptyAlphaData, alpha.id), {
			project: alpha,
			selectedPiboSessionId: null,
			navigationPending: false,
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Project trace selection only uses route sessions confirmed inside the requested Project", async () => {
	await assert.doesNotReject(runProjectTraceSelectionScenarios());
});
