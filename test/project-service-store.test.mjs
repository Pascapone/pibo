import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";

test("deleting Project files rejects a nested surviving Project without changing files or rows", () => {
	const tempRoot = mkdtempSync(join(tmpdir(), "pibo-project-delete-nested-"));
	const databasePath = join(tempRoot, "web-projects.sqlite");
	const parentFolder = join(tempRoot, "workspaces", "parent");
	const childFolder = join(parentFolder, "child");
	const siblingFolder = join(tempRoot, "workspaces", "sibling");
	let service = new ChatProjectService(databasePath);

	try {
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder });
		const child = service.createProject({ name: "Child", projectFolder: childFolder });
		const sibling = service.createProject({ name: "Sibling", projectFolder: siblingFolder });
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
		const child = service.createProject({ name: "Child", projectFolder: childFolder });
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder });
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
		const parent = service.createProject({ name: "Parent", projectFolder: parentFolder });
		const child = service.createProject({ name: "Child", projectFolder: childFolder });
		const sibling = service.createProject({ name: "Sibling", projectFolder: siblingFolder });
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
