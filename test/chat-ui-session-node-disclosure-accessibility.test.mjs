import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runSessionNodeDisclosureScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";

		globalThis.React = React;
		const { SessionNode } = await import("./src/apps/chat-ui/src/session-node.tsx");

		const rootId = "ps_11111111-1111-4111-8111-111111111111";
		const childId = "ps_22222222-2222-4222-8222-222222222222";
		const grandchildId = "ps_33333333-3333-4333-8333-333333333333";

		function session(piboSessionId, title, children = []) {
			return {
				piboSessionId,
				piSessionId: "pi-" + piboSessionId,
				profile: "pibo-agent",
				title,
				status: "idle",
				children,
				derivedSessions: [],
			};
		}

		const tree = session(rootId, "Rework Langgraph", [
			session(childId, "Research Notes", [
				session(grandchildId, "Implementation Draft"),
			]),
		]);
		const noop = () => {};

		function render(selectedPiboSessionId, selectedSessionPathIds) {
			return renderToStaticMarkup(React.createElement(SessionNode, {
				node: tree,
				signalNow: 0,
				selectedPiboSessionId,
				selectedSessionPathIds,
				onSelect: noop,
				onRename: noop,
				onArchive: noop,
				onDelete: noop,
				onViewContext: noop,
			}));
		}

		function attributes(tag) {
			return Object.fromEntries([...tag.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
		}

		function disclosures(html) {
			return [...html.matchAll(/<button\b[^>]*\baria-controls="[^"]+"[^>]*>/g)]
				.map((match) => attributes(match[0]))
				.filter((attrs) => attrs["aria-label"]?.startsWith("Subsessions for "));
		}

		function controlledTargetTags(html) {
			return [...html.matchAll(/<div\b[^>]*\bid="[^"]+"[^>]*>/g)].map((match) => attributes(match[0]));
		}

		const collapsedHtml = render(rootId, new Set([rootId]));
		const collapsedDisclosures = disclosures(collapsedHtml);
		assert.equal(collapsedDisclosures.length, 1);
		assert.equal(collapsedDisclosures[0]["aria-expanded"], "false");
		assert.equal(collapsedDisclosures[0].title, "Expand Subsessions");
		assert.equal(collapsedDisclosures[0]["aria-label"], "Subsessions for Rework Langgraph");
		assert.ok(collapsedDisclosures[0]["aria-controls"]);

		const collapsedTargets = controlledTargetTags(collapsedHtml);
		const collapsedTarget = collapsedTargets.find((target) => target.id === collapsedDisclosures[0]["aria-controls"]);
		assert.ok(collapsedTarget, "collapsed disclosure target remains mounted");
		assert.ok(Object.hasOwn(collapsedTarget, "hidden"), "collapsed disclosure target is hidden");
		assert.doesNotMatch(collapsedHtml, /Research Notes|Implementation Draft/);
		assert.doesNotMatch(collapsedHtml, new RegExp(childId + "|" + grandchildId));

		const expandedHtml = render(grandchildId, new Set([rootId, childId, grandchildId]));
		const expandedDisclosures = disclosures(expandedHtml);
		assert.equal(expandedDisclosures.length, 2);
		assert.deepEqual(expandedDisclosures.map((control) => control["aria-label"]), [
			"Subsessions for Rework Langgraph",
			"Subsessions for Research Notes",
		]);
		assert.ok(expandedDisclosures.every((control) => control["aria-expanded"] === "true"));
		assert.ok(expandedDisclosures.every((control) => control.title === "Collapse Subsessions"));
		assert.equal(collapsedDisclosures[0]["aria-label"], expandedDisclosures[0]["aria-label"]);
		assert.match(expandedHtml, /Research Notes/);
		assert.match(expandedHtml, /Implementation Draft/);

		const controlledIds = expandedDisclosures.map((control) => control["aria-controls"]);
		assert.equal(new Set(controlledIds).size, controlledIds.length, "each disclosure controls a unique target");
		const expandedTargets = controlledTargetTags(expandedHtml);
		for (const id of controlledIds) {
			assert.equal(expandedTargets.filter((target) => target.id === id).length, 1, "missing unique target for " + id);
			assert.ok(!Object.hasOwn(expandedTargets.find((target) => target.id === id), "hidden"));
		}

		for (const control of [...collapsedDisclosures, ...expandedDisclosures]) {
			assert.doesNotMatch(control["aria-label"], /ps_[0-9a-f-]{36}/i);
			assert.doesNotMatch(control["aria-label"], new RegExp(rootId + "|" + childId + "|" + grandchildId));
		}
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session Subsessions disclosures identify parents and retain lazy controlled regions", async () => {
	await assert.doesNotReject(runSessionNodeDisclosureScenario());
});
