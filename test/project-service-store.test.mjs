import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("deleting Project files rejects a nested surviving Project without changing files or rows", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-delete-nested-"));
	const databasePath = join(tempRoot, "web-projects.sqlite");
	const parentFolder = join(tempRoot, "workspaces", "parent");
	const childFolder = join(parentFolder, "child");
	const siblingFolder = join(tempRoot, "workspaces", "sibling");
	let service = new ChatProjectService(databasePath);

	try {
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder, createFolder: true });
		const child = service.createProject({ name: "Child", projectFolder: childFolder, createFolder: true });
		const sibling = service.createProject({ name: "Sibling", projectFolder: siblingFolder, createFolder: true });
		service.addProjectSession({ projectId: parent.id, piboSessionId: "ps_parent" });
		service.addProjectSession({ projectId: child.id, piboSessionId: "ps_child" });
		writeFileSync(join(parentFolder, "parent.marker"), "parent");
		writeFileSync(join(childFolder, "child.marker"), "child");
		writeFileSync(join(siblingFolder, "sibling.marker"), "sibling");
		service.updateProject(parent.id, { archived: true });
		service.close();

		service = new ChatProjectService(databasePath);
		assert.throws(
			() => service.deleteProject(parent.id, { confirmName: parent.name, deleteFiles: true }),
			/Cannot delete project files because its folder overlaps Project "Child"/,
		);
		assert.equal(service.getProject(parent.id, { includeArchived: true })?.archivedAt !== undefined, true);
		assert.equal(service.getProject(child.id, { includeArchived: true })?.projectFolder, childFolder);
		assert.equal(service.getProject(sibling.id, { includeArchived: true })?.projectFolder, siblingFolder);
		assert.equal(service.getProjectSession("ps_parent")?.projectId, parent.id);
		assert.equal(service.getProjectSession("ps_child")?.projectId, child.id);
		assert.equal(existsSync(join(parentFolder, "parent.marker")), true);
		assert.equal(existsSync(join(childFolder, "child.marker")), true);
		assert.equal(existsSync(join(siblingFolder, "sibling.marker")), true);
		service.close();

		service = new ChatProjectService(databasePath);
		assert.deepEqual(
			service.listProjects({ includeArchived: true }).map((project) => project.name).sort(),
			["Child", "Parent", "Sibling"],
		);
		assert.equal(existsSync(childFolder), true);
		service.close();

		const database = new DatabaseSync(databasePath);
		assert.deepEqual(
			database.prepare("SELECT name FROM projects ORDER BY name").all().map((row) => row.name),
			["Child", "Parent", "Sibling"],
		);
		assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
		assert.deepEqual(
			database.prepare("SELECT pibo_session_id FROM project_sessions ORDER BY pibo_session_id").all().map((row) => row.pibo_session_id),
			["ps_child", "ps_parent"],
		);
		database.close();
	} finally {
		try { service.close(); } catch {}
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("deleting nested Project files rejects a surviving ancestor Project", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-delete-ancestor-"));
	const databasePath = join(tempRoot, "web-projects.sqlite");
	const parentFolder = join(tempRoot, "workspaces", "parent");
	const childFolder = join(parentFolder, "child");
	const service = new ChatProjectService(databasePath);

	try {
		const child = service.createProject({ name: "Child", projectFolder: childFolder, createFolder: true });
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder, createFolder: true });
		writeFileSync(join(childFolder, "child.marker"), "child");
		service.updateProject(child.id, { archived: true });

		assert.throws(
			() => service.deleteProject(child.id, { confirmName: child.name, deleteFiles: true }),
			/Cannot delete project files because its folder overlaps Project "Parent"/,
		);
		assert.equal(service.getProject(child.id, { includeArchived: true })?.projectFolder, childFolder);
		assert.equal(service.getProject(parent.id, { includeArchived: true })?.projectFolder, parentFolder);
		assert.equal(existsSync(join(childFolder, "child.marker")), true);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("Project deletion preserves non-overlapping and keep-files behavior", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-delete-controls-"));
	const databasePath = join(tempRoot, "web-projects.sqlite");
	const parentFolder = join(tempRoot, "workspaces", "parent");
	const childFolder = join(parentFolder, "child");
	const siblingFolder = join(tempRoot, "workspaces", "sibling");
	let service = new ChatProjectService(databasePath);

	try {
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder, createFolder: true });
		const child = service.createProject({ name: "Child", projectFolder: childFolder, createFolder: true });
		const sibling = service.createProject({ name: "Sibling", projectFolder: siblingFolder, createFolder: true });
		writeFileSync(join(childFolder, "child.marker"), "child");
		writeFileSync(join(siblingFolder, "sibling.marker"), "sibling");

		service.updateProject(sibling.id, { archived: true });
		assert.deepEqual(
			service.deleteProject(sibling.id, { confirmName: sibling.name, deleteFiles: true }),
			{ deletedProjectId: sibling.id },
		);
		assert.equal(service.getProject(sibling.id, { includeArchived: true }), undefined);
		assert.equal(existsSync(siblingFolder), false);
		assert.equal(existsSync(join(childFolder, "child.marker")), true);

		service.updateProject(parent.id, { archived: true });
		assert.deepEqual(
			service.deleteProject(parent.id, { confirmName: parent.name, deleteFiles: false }),
			{ deletedProjectId: parent.id },
		);
		assert.equal(service.getProject(parent.id, { includeArchived: true }), undefined);
		assert.equal(service.getProject(child.id, { includeArchived: true })?.projectFolder, childFolder);
		assert.equal(existsSync(join(childFolder, "child.marker")), true);
		service.close();

		service = new ChatProjectService(databasePath);
		assert.deepEqual(service.listProjects({ includeArchived: true }).map((project) => project.name), ["Child"]);
		assert.equal(existsSync(join(childFolder, "child.marker")), true);
	} finally {
		try { service.close(); } catch {}
		rmSync(tempRoot, { recursive: true, force: true });
	}
});

test("Project file deletion detects directory-symlink aliases in both containment directions", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-delete-symlink-alias-"));
	const databasePath = join(tempRoot, "web-projects.sqlite");
	const realParentFolder = join(tempRoot, "real-parent");
	const realChildFolder = join(realParentFolder, "child");
	const aliasParentFolder = join(tempRoot, "alias-parent");
	const aliasChildFolder = join(aliasParentFolder, "child");
	const service = new ChatProjectService(databasePath);

	try {
		const parent = service.createProject({ name: "Real Parent", projectFolder: realParentFolder, createFolder: true });
		symlinkSync(realParentFolder, aliasParentFolder, "dir");
		const child = service.createProject({ name: "Alias Child", projectFolder: aliasChildFolder, createFolder: true });
		writeFileSync(join(realParentFolder, "parent.marker"), "parent");
		writeFileSync(join(realChildFolder, "child.marker"), "child");

		service.updateProject(parent.id, { archived: true });
		assert.throws(
			() => service.deleteProject(parent.id, { confirmName: parent.name, deleteFiles: true }),
			/Cannot delete project files because its folder overlaps Project "Alias Child"/,
		);
		assert.equal(existsSync(join(realParentFolder, "parent.marker")), true);
		assert.equal(existsSync(join(realChildFolder, "child.marker")), true);

		service.updateProject(parent.id, { archived: false });
		service.updateProject(child.id, { archived: true });
		assert.throws(
			() => service.deleteProject(child.id, { confirmName: child.name, deleteFiles: true }),
			/Cannot delete project files because its folder overlaps Project "Real Parent"/,
		);
		assert.equal(existsSync(join(realParentFolder, "parent.marker")), true);
		assert.equal(existsSync(join(realChildFolder, "child.marker")), true);
	} finally {
		service.close();
		rmSync(tempRoot, { recursive: true, force: true });
	}
});
