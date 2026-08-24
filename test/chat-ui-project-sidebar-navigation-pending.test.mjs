import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runProjectsSidebarPendingScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { ProjectsSidebar } = await import("./src/apps/chat-ui/src/projects/ProjectsSidebar.tsx");

		const project = (id, name, archivedAt) => ({
			id,
			name,
			projectFolder: "/workspace/" + id,
			configurationStatus: "configured",
			metadata: {},
			createdAt: "2026-08-24T00:00:00.000Z",
			updatedAt: "2026-08-24T00:00:00.000Z",
			...(archivedAt ? { archivedAt } : {}),
		});
		const session = (piboSessionId, title, archived = false) => ({
			piboSessionId,
			piSessionId: "pi-" + piboSessionId,
			profile: "pibo-agent",
			title,
			archived,
			status: "idle",
			derivedSessions: [],
			children: [],
		});
		const shared = {
			...project("project-shared", "Project Manager"),
			metadata: { default: true },
		};
		const alpha = project("project-alpha", "Alpha");
		const archived = project("project-archived", "Archived", "2026-08-23T00:00:00.000Z");
		const alphaSession = session("ps-alpha", "Alpha Session");
		const archivedSession = session("ps-archived", "Archived Session", true);
		const noop = () => {};
		const props = {
			data: { sharedDefaultProject: shared, sessions: [alphaSession, archivedSession] },
			selectedProject: alpha,
			selectedPiboSessionId: alphaSession.piboSessionId,
			activeProjects: [shared, alpha],
			archivedProjects: [archived],
			sessionGroups: { active: [alphaSession], archived: [archivedSession] },
			selectedSessionPathIds: new Set([alphaSession.piboSessionId]),
			autoRenameSessionId: null,
			creatingSession: false,
			showArchivedProjects: true,
			showArchivedSessions: true,
			mobileSidebarOpen: true,
			onRefresh: noop,
			onCloseMobileSidebar: noop,
			onCreateProject: noop,
			onToggleArchivedProjects: noop,
			onSelectProject: noop,
			onRenameProject: noop,
			onSetProjectArchived: noop,
			onDeleteArchivedProject: noop,
			onCreateProjectSession: noop,
			onToggleArchivedSessions: noop,
			onSelectSession: noop,
			onRenameSession: noop,
			onArchiveSession: noop,
			onDeleteSession: noop,
			onViewContext: noop,
			onAutoRenameConsumed: noop,
		};

		const buttonTags = (html) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		const buttonByLabel = (html, label) => {
			const tag = buttonTags(html).find((candidate) => candidate.includes('aria-label="' + label + '"'));
			assert.ok(tag, "missing button: " + label);
			return tag;
		};
		const hasDisabled = (tag) => /\sdisabled(?:=""|(?=[\s>]))/.test(tag);

		const pendingHtml = renderToStaticMarkup(React.createElement(ProjectsSidebar, {
			...props,
			navigationPending: true,
		}));
		assert.match(pendingHtml, /data-pibo-navigation-pending="true"/);
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "New Project")), true);
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "New Project Session")), true);
		const pendingProjectActions = buttonTags(pendingHtml).filter((tag) => tag.includes('aria-label="Project actions"'));
		assert.equal(pendingProjectActions.length, 2);
		assert.ok(pendingProjectActions.every(hasDisabled));
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "Actions for session Alpha Session")), true);
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "Actions for session Archived Session")), true);
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "Refresh")), false);
		assert.equal(hasDisabled(buttonByLabel(pendingHtml, "Open session Alpha Session")), false);

		const settledHtml = renderToStaticMarkup(React.createElement(ProjectsSidebar, {
			...props,
			navigationPending: false,
		}));
		assert.match(settledHtml, /data-pibo-navigation-pending="false"/);
		assert.equal(hasDisabled(buttonByLabel(settledHtml, "New Project")), false);
		assert.equal(hasDisabled(buttonByLabel(settledHtml, "New Project Session")), false);
		assert.ok(buttonTags(settledHtml)
			.filter((tag) => tag.includes('aria-label="Project actions"'))
			.every((tag) => !hasDisabled(tag)));
		assert.equal(hasDisabled(buttonByLabel(settledHtml, "Actions for session Alpha Session")), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Projects sidebar locks mutation controls while route navigation is pending", async () => {
	await assert.doesNotReject(runProjectsSidebarPendingScenario());
});
