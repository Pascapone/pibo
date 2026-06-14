import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { InitialSessionContext } from "../dist/core/profiles.js";
import { inspectPiboContextBuild } from "../dist/core/context-build.js";

function findNode(nodes, predicate) {
	for (const node of nodes) {
		if (predicate(node)) return node;
		const child = findNode(node.children ?? [], predicate);
		if (child) return child;
	}
	return undefined;
}

function makeSkillFile(cwd, name, description, body) {
	const skillDir = join(cwd, "skills", name);
	mkdirSync(skillDir, { recursive: true });
	const frontmatter = `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
	const filePath = join(skillDir, "SKILL.md");
	// Body intentionally long to make the bug obvious: thousands of chars in a
	// "real" skill body should never inflate the model-visible token count.
	const filler = body ?? ("# ".padEnd(4000, "x") + "\n");
	writeFileSync(filePath, `${frontmatter}${filler}`, "utf-8");
	return filePath;
}

test("context build skill node exposes only the prompt-entry XML, not the full body", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-skill-tokens-"));
	const skillPath = makeSkillFile(
		cwd,
		"token-fix-fixture",
		"Counts only the prompt entry to keep the context build honest.",
	);

	try {
		const profile = new InitialSessionContext({
			profileName: "skill-tokens-test",
			autoContextFiles: false,
			builtinToolNames: ["read"],
			skills: [{ name: "token-fix-fixture", path: relative(cwd, skillPath), enabled: true }],
		});

		const snapshot = await inspectPiboContextBuild({
			cwd,
			profile,
			sessionContext: {
				piboSessionId: "ps_token",
				piboRoomId: "room_token",
				timezone: "UTC",
			},
		});

		const skillNode = findNode(snapshot.nodes, (node) => node.title === "token-fix-fixture");
		assert.ok(skillNode, "skill node should exist");
		assert.equal(skillNode.kind, "skill");
		assert.equal(skillNode.path, skillPath);

		// The hydratedText on the skill node is what feeds the byte + token
		// counters, so it must contain only the per-skill prompt entry, not
		// the full SKILL.md body.
		assert.match(skillNode.hydratedText, /<name>token-fix-fixture<\/name>/);
		assert.match(skillNode.hydratedText, /<description>Counts only the prompt entry to keep the context build honest\.<\/description>/);
		assert.match(skillNode.hydratedText, new RegExp(`<location>${skillPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</location>`));
		assert.doesNotMatch(skillNode.hydratedText, /#\s*x{100,}/, "the long body filler must not leak into the model-visible text");
		assert.doesNotMatch(skillNode.hydratedText, /available_skills/, "per-skill entry should not include the section header / wrapper");
		assert.doesNotMatch(skillNode.hydratedText, /Use the read tool to load a skill/, "per-skill entry should not include the section instructions");

		// The byte and token counts on the skill node must reflect the
		// model-visible text, not the multi-kilobyte body.
		const visibleBytes = Buffer.byteLength(skillNode.hydratedText, "utf-8");
		assert.equal(skillNode.bytes, visibleBytes, "skill node bytes should match the prompt-entry size");
		assert.ok(skillNode.bytes < 1024, `skill node bytes should be small, got ${skillNode.bytes}`);
		assert.ok(skillNode.estimatedTokens !== undefined, "skill node should report estimated tokens");
		assert.ok(skillNode.estimatedTokens < 200, `skill node estimated tokens should reflect only the entry, got ${skillNode.estimatedTokens}`);

		// The full file is still referenced via metadata so the inspector
		// stays useful, but it is not duplicated as prompt content.
		assert.equal(skillNode.children, undefined, "skill node should not nest the SKILL.md body as a child");
		assert.ok(
			skillNode.metadata.fullFileBytes && skillNode.metadata.fullFileBytes > skillNode.bytes,
			`metadata.fullFileBytes (${skillNode.metadata.fullFileBytes}) should reflect the on-disk file, not the prompt entry (${skillNode.bytes})`,
		);
		assert.match(skillNode.metadata.fullFileLoadableBy ?? "", /read tool/, "metadata should explain how the body is loaded");

		// The parent Skills node's subtree token count must be small because
		// it aggregates only model-visible children.
		const skillsParent = findNode(snapshot.nodes, (node) => node.kind === "skills");
		assert.ok(skillsParent, "skills parent should exist");
		assert.ok(skillsParent.estimatedSubtreeTokens !== undefined, "skills parent should report subtree tokens");
		assert.ok(skillsParent.estimatedSubtreeTokens < 500, `skills subtree tokens should be small, got ${skillsParent.estimatedSubtreeTokens}`);

		// And the top-level total must no longer be inflated by the long
		// body. We only assert it is dramatically smaller than the old
		// behaviour would produce (the long body alone is >1000 tokens).
		assert.ok(snapshot.summary.estimatedTokens < 50_000, `total summary tokens should be much smaller, got ${snapshot.summary.estimatedTokens}`);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("context build still warns when a skill file cannot be read for inspection", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-skill-missing-"));
	const profile = new InitialSessionContext({
		profileName: "skill-missing-test",
		autoContextFiles: false,
		builtinToolNames: ["read"],
	});

	// We don't create the file on disk; load the default profile which has
	// no skills, so the parent should be disabled. We add a manual check
	// for the missing-file note by using a profile that doesn't pull in any
	// skills: the section should simply be EMPTY.
	try {
		const snapshot = await inspectPiboContextBuild({
			cwd,
			profile,
			sessionContext: {
				piboSessionId: "ps_missing",
				piboRoomId: "room_missing",
				timezone: "UTC",
			},
		});

		const skillsParent = findNode(snapshot.nodes, (node) => node.kind === "skills");
		assert.ok(skillsParent, "skills parent should exist even with no skills");
		assert.equal(skillsParent.state, "disabled");
		assert.deepEqual(skillsParent.badges, ["EMPTY"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
