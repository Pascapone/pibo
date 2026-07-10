import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runProjectsBootstrapScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { getProjectsBootstrap } = await import("./src/apps/chat-ui/src/api-chat-sessions.ts");

		const project = {
			id: "project-shared",
			name: "Project Manager",
			projectFolder: "/tmp/project-shared",
			createdAt: "now",
			updatedAt: "now",
		};

		async function withPayload(payload, fn) {
			const previousFetch = globalThis.fetch;
			globalThis.fetch = async () => new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
			try {
				return await fn();
			} finally {
				globalThis.fetch = previousFetch;
			}
		}

		await withPayload(null, async () => {
			await assert.rejects(() => getProjectsBootstrap(), /missing bootstrap data/);
		});

		await withPayload({}, async () => {
			await assert.rejects(() => getProjectsBootstrap(), /missing shared default project/);
		});

		await withPayload({ sharedDefaultProject: null }, async () => {
			await assert.rejects(() => getProjectsBootstrap(), /missing shared default project/);
		});

		await withPayload({ sharedDefaultProject: project }, async () => {
			const bootstrap = await getProjectsBootstrap();
			assert.equal(bootstrap.sharedDefaultProject.id, "project-shared");
			assert.equal(bootstrap.project.id, "project-shared");
			assert.equal(bootstrap.selectedProjectId, "project-shared");
			assert.deepEqual(bootstrap.projects, []);
			assert.deepEqual(bootstrap.sessions, []);
			assert.deepEqual(bootstrap.capabilities.actions, []);
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Projects bootstrap rejects null or malformed data before sidebar rendering", async () => {
	await assert.doesNotReject(runProjectsBootstrapScenario());
});
