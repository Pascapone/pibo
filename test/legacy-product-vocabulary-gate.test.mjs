import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_TERMS, scanProductVocabulary } from "../scripts/legacy-product-vocabulary-gate.mjs";

const term = {
	camel: ["owner", "Scope"].join(""),
	storage: ["owner", "_", "scope"].join(""),
	sharedValue: ["shared", ":", "app"].join(""),
	principal: ["principal", "Id"].join(""),
	memberTable: ["room", "_", "members"].join(""),
	getter: ["get", "Owned"].join(""),
};

function fixtureRoot() {
	return mkdtempSync(join(tmpdir(), "pibo-product-vocab-gate-"));
}

function writeFixture(root, path, content) {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, "utf8");
}

function scan(root, roots = ["src", "docs/legacy"]) {
	return scanProductVocabulary({ root, roots });
}

test("generated term list covers required legacy spellings", () => {
	for (const value of Object.values(term)) {
		assert.ok(DEFAULT_TERMS.includes(value));
	}
});

test("clean active files pass", () => {
	const root = fixtureRoot();
	writeFixture(root, "src/app.ts", "export const appContext = { kind: 'shared-app' };\n");
	const result = scan(root, ["src"]);
	assert.equal(result.failures.length, 0);
	assert.equal(result.allowed.length, 0);
});

test("active files fail on legacy vocabulary", () => {
	const root = fixtureRoot();
	writeFixture(root, "src/app.ts", `export const value = "${term.camel}";\n`);
	const result = scan(root, ["src"]);
	assert.deepEqual(
		result.failures.map((match) => `${match.path}:${match.line}:${match.term}`),
		[`src/app.ts:1:${term.camel}`],
	);
});

test("multiple required spellings are reported", () => {
	const root = fixtureRoot();
	writeFixture(
		root,
		"src/app.ts",
		[
			term.storage,
			term.sharedValue,
			term.principal,
			term.memberTable,
			term.getter,
		].join("\n"),
	);
	const result = scan(root, ["src"]);
	assert.deepEqual(
		result.failures.map((match) => match.term).sort(),
		[term.getter, term.memberTable, term.principal, term.sharedValue, term.storage].sort(),
	);
});

test("historical docs are allowed", () => {
	const root = fixtureRoot();
	writeFixture(root, "docs/legacy/note.md", `${term.camel}\n`);
	const result = scan(root, ["docs/legacy"]);
	assert.equal(result.failures.length, 0);
	assert.equal(result.allowed.length, 1);
	assert.equal(result.allowed[0].path, "docs/legacy/note.md");
});

test("current docs are not allowed", () => {
	const root = fixtureRoot();
	writeFixture(root, "docs/project/current.md", `${term.camel}\n`);
	const result = scan(root, ["docs/project"]);
	assert.equal(result.allowed.length, 0);
	assert.equal(result.failures.length, 1);
});

test("isolated cutover migration path is allowed", () => {
	const root = fixtureRoot();
	writeFixture(root, "src/data/final-app-space-cutover-migration.ts", `${term.sharedValue}\n`);
	const result = scan(root, ["src"]);
	assert.equal(result.failures.length, 0);
	assert.equal(result.allowed.length, 1);
});
