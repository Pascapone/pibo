import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createUserSkill,
	deleteUserSkill,
	findUserSkill,
	listUserSkills,
	loadUserSkillStore,
	parseSkillMd,
	setUserSkillEnabled,
	updateUserSkill,
} from "../dist/user-skills/store.js";

function tempWorkspace() {
	return mkdtempSync(join(tmpdir(), "pibo-user-skills-"));
}

test("user skill descriptions are stored in SKILL.md frontmatter", () => {
	const cwd = tempWorkspace();
	const created = createUserSkill(
		{
			name: "review-helper",
			description: "Review code changes.",
			markdown: "Use a concise review format.",
		},
		cwd,
	);

	const store = loadUserSkillStore(cwd);
	assert.equal(store.skills.length, 1);
	assert.equal(store.skills[0].description, "");
	assert.match(readFileSync(created.path, "utf-8"), /description: Review code changes\./);

	assert.equal(listUserSkills(cwd)[0].description, "Review code changes.");
	assert.equal(findUserSkill("review-helper", cwd)?.description, "Review code changes.");
});

test("create and update skill metadata can read frontmatter from markdown input", () => {
	const cwd = tempWorkspace();
	const created = createUserSkill(
		{
			name: "frontend-helper",
			description: "",
			markdown: "---\nname: frontend-helper\ndescription: Frontend review helper.\n---\n\nCheck layout regressions.",
		},
		cwd,
	);

	assert.equal(created.description, "Frontend review helper.");
	assert.equal(listUserSkills(cwd)[0].description, "Frontend review helper.");

	const updated = updateUserSkill(
		created.id,
		{
			markdown: "---\nname: frontend-helper\ndescription: Updated helper.\n---\n\nCheck spacing.",
		},
		cwd,
	);

	assert.equal(updated.path, created.path);
	assert.equal(updated.description, "Updated helper.");
	assert.equal(findUserSkill(created.id, cwd)?.description, "Updated helper.");
	assert.equal(parseSkillMd(readFileSync(updated.path, "utf-8")).body, "Check spacing.");
	assert.doesNotMatch(readFileSync(updated.path, "utf-8"), /---[\s\S]*---[\s\S]*---[\s\S]*---/);
});

test("user skills can be renamed, toggled, sorted, and deleted", () => {
	const cwd = tempWorkspace();
	const zeta = createUserSkill(
		{
			name: "zeta-helper",
			description: "Zeta helper with durable metadata.",
			markdown: "# Zeta instructions\n\n- Keep the checklist.\n- Preserve `mode: strict`.\n\n```json\n{\"verify\": true}\n```",
		},
		cwd,
	);
	const alpha = createUserSkill(
		{
			name: "alpha-helper",
			description: "Alpha helper.",
			markdown: "Alpha body.",
		},
		cwd,
	);

	assert.deepEqual(
		listUserSkills(cwd).map((skill) => skill.name),
		["alpha-helper", "zeta-helper"],
	);

	const beforeRenameMarkdown = readFileSync(zeta.path, "utf-8");
	const renamed = updateUserSkill(zeta.id, { name: "beta-helper" }, cwd);
	assert.equal(renamed.name, "beta-helper");
	assert.equal(renamed.id, zeta.id);
	assert.equal(renamed.createdAt, zeta.createdAt);
	assert.equal(findUserSkill("zeta-helper", cwd), undefined);
	assert.equal(findUserSkill("beta-helper", cwd)?.description, "Zeta helper with durable metadata.");
	assert.equal(existsSync(zeta.path), false);
	assert.equal(existsSync(renamed.path), true);
	assert.equal(loadUserSkillStore(cwd).skills.find((skill) => skill.id === zeta.id)?.path, renamed.path);
	assert.equal(
		parseSkillMd(readFileSync(renamed.path, "utf-8")).body,
		parseSkillMd(beforeRenameMarkdown).body,
	);

	const disabled = setUserSkillEnabled(alpha.id, false, cwd);
	assert.equal(disabled.enabled, false);
	assert.equal(findUserSkill(alpha.id, cwd)?.enabled, false);

	const removed = deleteUserSkill(alpha.id, cwd);
	assert.equal(removed?.id, alpha.id);
	assert.equal(findUserSkill(alpha.id, cwd), undefined);
	assert.equal(existsSync(alpha.path), false);
	assert.deepEqual(
		listUserSkills(cwd).map((skill) => skill.name),
		["beta-helper"],
	);
});

test("user skill names reject duplicates and invalid values", () => {
	const cwd = tempWorkspace();
	const valid = createUserSkill(
		{
			name: "valid-helper",
			description: "Valid helper.",
			markdown: "Valid body.",
		},
		cwd,
	);

	assert.throws(
		() =>
			createUserSkill(
				{
					name: "valid-helper",
					description: "Duplicate helper.",
					markdown: "Duplicate body.",
				},
				cwd,
			),
		/Skill name "valid-helper" already exists/,
	);
	assert.throws(
		() =>
			createUserSkill(
				{
					name: "UpperCase",
					description: "Invalid helper.",
					markdown: "Invalid body.",
				},
				cwd,
			),
		/lowercase kebab-case/,
	);
	assert.throws(
		() => updateUserSkill(findUserSkill("valid-helper", cwd).id, { name: "UpperCase" }, cwd),
		/lowercase kebab-case/,
	);
	assert.equal(findUserSkill(valid.id, cwd)?.name, "valid-helper");
	assert.equal(readFileSync(valid.path, "utf-8"), "---\nname: valid-helper\ndescription: Valid helper.\n---\n\nValid body.");
});

test("missing user skill markdown falls back to an empty description and can be recreated", () => {
	const cwd = tempWorkspace();
	const created = createUserSkill(
		{
			name: "missing-markdown-helper",
			description: "Original description.",
			markdown: "Original body.",
		},
		cwd,
	);

	rmSync(created.path);
	assert.equal(listUserSkills(cwd)[0].description, "");
	assert.equal(findUserSkill(created.id, cwd)?.description, "");

	const updated = updateUserSkill(created.id, { description: "Restored description." }, cwd);
	assert.equal(updated.description, "Restored description.");
	assert.match(readFileSync(updated.path, "utf-8"), /description: Restored description\./);
});

test("invalid user skill stores fail before returning sanitized entries", () => {
	const cwd = tempWorkspace();
	createUserSkill(
		{
			name: "store-seed-helper",
			description: "Seed helper.",
			markdown: "Seed body.",
		},
		cwd,
	);
	writeFileSync(join(cwd, ".pibo", "user-skills.json"), JSON.stringify({ version: 1, skills: [{}] }), "utf-8");

	assert.throws(() => loadUserSkillStore(cwd), /Invalid user skill entry/);
});

test("parseSkillMd handles plain, colon, broken, and body delimiter cases", () => {
	assert.deepEqual(parseSkillMd("plain body"), {
		name: "",
		description: "",
		body: "plain body",
	});

	assert.deepEqual(parseSkillMd("---\nname: colon-helper\ndescription: Text: with colon\n---\n\nUse it."), {
		name: "colon-helper",
		description: "Text: with colon",
		body: "Use it.",
	});

	assert.deepEqual(parseSkillMd("---\nname: broken\ndescription: Missing end"), {
		name: "",
		description: "",
		body: "---\nname: broken\ndescription: Missing end",
	});

	assert.deepEqual(parseSkillMd("---\nname: body-helper\ndescription: Body delimiter\n---\n\nKeep --- in body."), {
		name: "body-helper",
		description: "Body delimiter",
		body: "Keep --- in body.",
	});
});
