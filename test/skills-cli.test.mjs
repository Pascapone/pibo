import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const piboBin = new URL("../dist/bin/pibo.js", import.meta.url);

function tempHome() {
	return mkdtempSync(join(tmpdir(), "pibo-skills-cli-"));
}

function runSkills(args, home = tempHome()) {
	return spawnSync(process.execPath, [piboBin.pathname, "skills", ...args], {
		cwd: home,
		env: { ...process.env, HOME: home },
		encoding: "utf-8",
	});
}

test("skills help exits successfully without a subcommand", () => {
	const result = runSkills([]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Manage Pibo user skills/);
	assert.match(result.stdout, /not built-in or plugin skills/);
	assert.equal(result.stderr, "");
});

test("skills list supports JSON output", () => {
	const result = runSkills(["list", "--json"]);
	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), []);
});

test("skills list removes YAML scalar quotes from descriptions", () => {
	const home = tempHome();
	const skillPath = join(home, ".pibo", "user-skills", "quoted-skill", "SKILL.md");
	mkdirSync(dirname(skillPath), { recursive: true });
	writeFileSync(skillPath, "---\nname: quoted-skill\ndescription: 'Quoted description.'\n---\n\nUse this skill.\n", "utf-8");
	writeFileSync(join(home, ".pibo", "user-skills.json"), JSON.stringify({
		version: 1,
		skills: [{
			id: "quoted-skill-id",
			name: "quoted-skill",
			path: skillPath,
			enabled: true,
			source: "user-created",
			createdAt: "2026-05-16T00:00:00.000Z",
			updatedAt: "2026-05-16T00:00:00.000Z",
		}],
	}, null, 2), "utf-8");

	const result = runSkills(["list"], home);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Quoted description\./);
	assert.doesNotMatch(result.stdout, /'Quoted description\.'/);
});
