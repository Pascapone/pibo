import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";

function createProject(service, root, name) {
	return service.createProject({
		name,
		projectFolder: join(root, name.toLowerCase().replaceAll(" ", "-")),
		createFolder: true,
	});
}

test("project session deletion repairs current sessions across projects and is idempotent", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-project-session-delete-"));
	const path = join(root, "web-projects.sqlite");
	const service = new ChatProjectService(path);
	try {
		const first = createProject(service, root, "First Project");
		const second = createProject(service, root, "Second Project");
		const control = createProject(service, root, "Control Project");
		service.addProjectSession({ projectId: first.id, piboSessionId: "ps_first_keep" });
		service.addProjectSession({ projectId: first.id, piboSessionId: "ps_first_delete" });
		service.addProjectSession({ projectId: second.id, piboSessionId: "ps_second_missing" });
		service.addProjectSession({ projectId: control.id, piboSessionId: "ps_control" });

		const fixture = new DatabaseSync(path);
		fixture.prepare("DELETE FROM project_sessions WHERE pibo_session_id = ?").run("ps_second_missing");
		fixture.close();

		assert.equal(service.deleteProjectSessions(["ps_first_delete", "ps_second_missing", "ps_unknown"]), 1);
		assert.deepEqual(service.listProjectSessions(first.id).map((session) => session.piboSessionId), ["ps_first_keep"]);
		assert.equal(service.requireProject(first.id).currentMainSessionId, "ps_first_keep");
		assert.deepEqual(service.listProjectSessions(second.id), []);
		assert.equal(service.requireProject(second.id).currentMainSessionId, undefined);
		assert.deepEqual(service.listProjectSessions(control.id).map((session) => session.piboSessionId), ["ps_control"]);
		assert.equal(service.requireProject(control.id).currentMainSessionId, "ps_control");
		assert.equal(service.deleteProjectSessions(["ps_first_delete", "ps_second_missing", "ps_unknown"]), 0);
	} finally {
		service.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("project session deletion coordinates Project cleanup with canonical deletion", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-project-session-delete-canonical-"));
	const path = join(root, "web-projects.sqlite");
	const service = new ChatProjectService(path);
	try {
		const project = createProject(service, root, "Canonical Project");
		service.addProjectSession({ projectId: project.id, piboSessionId: "ps_keep" });
		service.addProjectSession({ projectId: project.id, piboSessionId: "ps_delete" });

		await assert.rejects(
			service.deleteProjectSessionWithCanonicalDelete("ps_delete", async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				throw new Error("synthetic canonical deletion failure");
			}),
			/synthetic canonical deletion failure/,
		);
		assert.deepEqual(service.listProjectSessions(project.id).map((session) => session.piboSessionId), ["ps_keep", "ps_delete"]);
		assert.equal(service.requireProject(project.id).currentMainSessionId, "ps_delete");

		const result = await service.deleteProjectSessionWithCanonicalDelete("ps_delete", async () => "deleted");
		assert.equal(result, "deleted");
		assert.deepEqual(service.listProjectSessions(project.id).map((session) => session.piboSessionId), ["ps_keep"]);
		assert.equal(service.requireProject(project.id).currentMainSessionId, "ps_keep");
	} finally {
		service.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("project session deletion rolls back links and current-session repair on failure", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-project-session-delete-rollback-"));
	const path = join(root, "web-projects.sqlite");
	const service = new ChatProjectService(path);
	try {
		const project = createProject(service, root, "Rollback Project");
		service.addProjectSession({ projectId: project.id, piboSessionId: "ps_keep" });
		service.addProjectSession({ projectId: project.id, piboSessionId: "ps_delete" });
		const fixture = new DatabaseSync(path);
		fixture.exec(`CREATE TRIGGER fail_project_session_delete
			BEFORE DELETE ON project_sessions
			WHEN OLD.pibo_session_id = 'ps_delete'
			BEGIN
				SELECT RAISE(ABORT, 'synthetic project cleanup failure');
			END;`);
		fixture.close();

		assert.throws(
			() => service.deleteProjectSessions(["ps_delete"]),
			/synthetic project cleanup failure/,
		);
		assert.deepEqual(service.listProjectSessions(project.id).map((session) => session.piboSessionId), ["ps_keep", "ps_delete"]);
		assert.equal(service.requireProject(project.id).currentMainSessionId, "ps_delete");
	} finally {
		service.close();
		rmSync(root, { recursive: true, force: true });
	}
});
