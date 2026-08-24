import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runLatestRequestScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const {
			LatestProjectsRequestGate,
			projectsBootstrapRequestKey,
		} = await import("./src/apps/chat-ui/src/projects/projects-request-gate.ts");

		const deferred = () => {
			let resolve;
			const promise = new Promise((next) => { resolve = next; });
			return { promise, resolve };
		};
		const gate = new LatestProjectsRequestGate();
		let currentRequestKey = projectsBootstrapRequestKey("project-alpha", "ps-alpha", false);
		let data = "initial";
		let loading = false;

		const begin = (requestKey, response) => {
			const token = gate.begin(requestKey);
			loading = true;
			return response.promise.then((next) => {
				if (!gate.isCurrent(token, currentRequestKey)) return;
				data = next;
				loading = false;
			});
		};

		const alphaResponse = deferred();
		const alphaRun = begin(currentRequestKey, alphaResponse);
		const betaRequestKey = projectsBootstrapRequestKey("project-beta", "ps-beta", false);
		currentRequestKey = betaRequestKey;
		const betaResponse = deferred();
		const betaRun = begin(betaRequestKey, betaResponse);

		alphaResponse.resolve("stale-alpha");
		await alphaRun;
		assert.equal(data, "initial", "an out-of-order response must not replace current data");
		assert.equal(loading, true, "an out-of-order response must not clear the current loading state");

		betaResponse.resolve("current-beta");
		await betaRun;
		assert.equal(data, "current-beta");
		assert.equal(loading, false);

		const betaRefresh = deferred();
		const betaRefreshRun = begin(betaRequestKey, betaRefresh);
		const gammaRequestKey = projectsBootstrapRequestKey("project-gamma", "ps-gamma", true);
		currentRequestKey = gammaRequestKey;
		betaRefresh.resolve("stale-beta-refresh");
		await betaRefreshRun;
		assert.equal(data, "current-beta", "a response for a superseded route must not replace data");
		assert.equal(loading, true, "the newly requested route must remain loading after a stale response");

		const gammaResponse = deferred();
		const gammaRun = begin(gammaRequestKey, gammaResponse);
		gammaResponse.resolve("current-gamma");
		await gammaRun;
		assert.equal(data, "current-gamma");
		assert.equal(loading, false);

		gate.abort();
		assert.equal(gate.isCurrent(gate.begin(gammaRequestKey), gammaRequestKey), true);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

async function runNavigationGenerationScenarios() {
	const script = `
		import assert from "node:assert/strict";
		const {
			LatestProjectsNavigationGate,
			projectsNavigationRouteKey,
		} = await import("./src/apps/chat-ui/src/projects/projects-request-gate.ts");

		const deferred = () => {
			let resolve;
			const promise = new Promise((next) => { resolve = next; });
			return { promise, resolve };
		};
		const alphaKey = projectsNavigationRouteKey("project-alpha", "ps-alpha");
		const betaKey = projectsNavigationRouteKey("project-beta", "ps-beta");
		const gate = new LatestProjectsNavigationGate(alphaKey);
		const navigations = [];
		let autoRenameSessionId = null;

		const delayedCreate = deferred();
		const startedGeneration = gate.capture();
		const staleRun = delayedCreate.promise.then((created) => {
			if (!gate.isCurrent(startedGeneration)) return false;
			autoRenameSessionId = created.session.id;
			navigations.push(["project-alpha", created.session.id]);
			return true;
		});
		gate.sync(betaKey);
		delayedCreate.resolve({ session: { id: "ps-created-stale" } });
		assert.equal(await staleRun, false);
		assert.equal(autoRenameSessionId, null);
		assert.deepEqual(navigations, []);

		const currentCreate = deferred();
		const currentGeneration = gate.capture();
		const currentRun = currentCreate.promise.then((created) => {
			if (!gate.isCurrent(currentGeneration)) return false;
			autoRenameSessionId = created.session.id;
			navigations.push(["project-beta", created.session.id]);
			return true;
		});
		currentCreate.resolve({ session: { id: "ps-created-current" } });
		assert.equal(await currentRun, true);
		assert.equal(autoRenameSessionId, "ps-created-current");
		assert.deepEqual(navigations, [["project-beta", "ps-created-current"]]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Projects bootstrap is last-request-wins for both data and loading state", async () => {
	await assert.doesNotReject(runLatestRequestScenarios());
});

test("stale Project session creation cannot overwrite a newer navigation", async () => {
	await assert.doesNotReject(runNavigationGenerationScenarios());
	const source = fs.readFileSync("src/apps/chat-ui/src/projects/ProjectsArea.tsx", "utf8");
	assert.match(source, /const navigationGeneration = projectsNavigationGateRef\.current!\.capture\(\);/);
	assert.match(source, /await postProjectSession\(projectId,[\s\S]*?isCurrent\(navigationGeneration\)[\s\S]*?setAutoRenameSessionId/);
});
