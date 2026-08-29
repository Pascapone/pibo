import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, fstatSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkLog } from "../scripts/check-okf-log.mjs";
import { synchronizeIndexes } from "../scripts/generate-okf-indexes.mjs";
import { isSafeSingleLineString, parseFrontmatter, validateCoreConceptContent, validateIndexContent, validateLogContent } from "../scripts/okf-core.mjs";
import { validateRepository } from "../scripts/validate-okf-docs.mjs";

const GENERATED = 'generated: { by: "process:test-fixture", at: "2026-08-29T00:00:00Z" }';

function write(root, path, content) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

function replaceRegularFile(path, content) {
	const replacement = `${path}.replacement-${process.pid}-${Date.now()}`;
	writeFileSync(replacement, content);
	renameSync(replacement, path);
}

function replaceParentWithSymlink(parent, external) {
	const parked = `${parent}.parked-${process.pid}-${Date.now()}`;
	renameSync(parent, parked);
	symlinkSync(external, parent, "dir");
	return () => {
		unlinkSync(parent);
		renameSync(parked, parent);
	};
}

function concept({ type, title, authority, status = "draft", body = "", sources = "", description, tags = '["fixture"]' }) {
	return `---
type: "${type}"
title: "${title}"
description: "${description ?? `Describes ${title.toLowerCase()} for the validator fixture.`}"
tags: ${tags}
status: "${status}"
authority: "${authority}"
${GENERATED}
${sources}---

# ${title}

${body}
`;
}

const MARKDOWN_LINE_ENDINGS = ["lf", "crlf", "cr", "mixed"];

function withMarkdownLineEndings(content, form) {
	if (form === "lf") return content;
	if (form === "crlf") return content.replaceAll("\n", "\r\n");
	if (form === "cr") return content.replaceAll("\n", "\r");
	let boundary = 0;
	return content.replace(/\n/g, () => ["\n", "\r\n", "\r", "\r\n"][boundary++ % 4]);
}

function normalizeMarkdownLineEndings(content) {
	return content.replace(/\r\n|\r/g, "\n");
}

function git(root, ...args) {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout.trim();
}

function commitFixture(root) {
	git(root, "init", "--quiet");
	git(root, "config", "user.name", "OKF fixture");
	git(root, "config", "user.email", "okf-fixture@example.invalid");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "fixture evidence");
	return git(root, "rev-parse", "HEAD");
}

function specificationTrace({ commit, requirements }) {
	return `traceability:\n  commit: "${commit}"\n  requirements:\n${requirements}`;
}

function traceRequirement({
	id = "PIBO-FIXTURE-REQ-001",
	sourcePath = "src/example.ts",
	symbol = "publicSurface",
	testPath = "test/example.test.mjs",
	testName = "proves the behavior",
	publicValues = '["command: fixture"]',
	failures = '["Invalid input fails without mutation."]',
	confidence = "high",
	withoutTests = false,
	sourceInspected = false,
	followUp,
} = {}) {
	const tests = withoutTests ? "" : `      tests:\n        - path: "${testPath}"\n          name: "${testName}"\n`;
	const inspected = sourceInspected ? "      source_inspected: true\n" : "";
	const follow = followUp === undefined ? "" : `      follow_up: "${followUp}"\n`;
	return `    - id: "${id}"\n      status: "implemented"\n      sources:\n        - path: "${sourcePath}"\n          symbol: "${symbol}"\n${tests}${inspected}${follow}      public: ${publicValues}\n      failures: ${failures}\n      confidence: "${confidence}"\n`;
}

function createFixture() {
	const root = mkdtempSync(join(tmpdir(), "pibo-okf-validator-"));
	write(root, "AGENTS.md", "# Agent host contract\n");
	write(root, "docs/index.md", `---\nokf_version: "0.2"\n---\n\n# Fixture\n\n- [Project](project/)\n- [Specifications](specs/)\n- [Plans](plans/)\n- [Reports](reports/)\n- [Legacy](legacy/)\n`);
	write(root, "docs/log.md", "# Log\n\n## 2026-08-29\n\n- **Creation**: Created fixture.\n");
	write(root, "docs/project/index.md", "# Project\n\n- [Documentation profile](documentation-profile.md)\n");
	write(root, "docs/project/documentation-profile.md", concept({ type: "Documentation Profile", title: "Documentation profile", authority: "normative" }));
	write(root, "docs/specs/index.md", "# Specifications\n");
	write(root, "docs/plans/index.md", "# Plans\n\n- [Fixture plan](fixture-plan.md)\n");
	write(root, "docs/plans/fixture-plan.md", concept({ type: "Plan", title: "Fixture plan", authority: "directive" }));
	write(root, "docs/reports/index.md", "# Reports\n");
	write(root, "docs/legacy/index.md", "# Legacy\n");
	write(root, "docs/reports/artifacts/okf-migration/evidence-manifest.json", '{"schema_version":"pibo-okf-evidence-manifest/1","evidence":[]}\n');
	const records = [
		{ path: "AGENTS.md", state: "host-exception", reason: "Exact agent host contract loaded by repository tooling." },
		...[
			"docs/index.md",
			"docs/log.md",
			"docs/project/index.md",
			"docs/specs/index.md",
			"docs/plans/index.md",
			"docs/reports/index.md",
			"docs/legacy/index.md",
		].map((path) => ({ path, state: "reserved" })),
		{ path: "docs/project/documentation-profile.md", state: "conformant", type: "Documentation Profile", authority: "normative", status: "draft", navigation: { root_order: 1 } },
		{ path: "docs/plans/fixture-plan.md", state: "conformant", type: "Plan", authority: "directive", status: "draft", navigation: { root_order: 2 } },
	];
	writeLedger(root, records);
	return { root, records };
}

function writeLedger(root, records, { baseCommit } = {}) {
	write(root, "docs/project/okf-migration-ledger.json", `${JSON.stringify({
		schema_version: "pibo-okf-migration-ledger/1",
		taxonomy_roots: ["project", "specs", "plans", "reports", "legacy"],
		...(baseCommit ? { base_commit: baseCommit } : {}),
		records,
	}, null, 2)}\n`);
}

function withFixture(run) {
	const fixture = createFixture();
	try {
		run(fixture);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
}

function managedIndexBytes(root, records) {
	return new Map(records
		.filter((record) => record.state === "reserved" && record.path.endsWith("index.md"))
		.map((record) => [record.path, readFileSync(join(root, record.path))]));
}

function assertManagedIndexBytes(root, before, message) {
	for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${message}: ${path}`);
}

test("strict mode accepts a complete five-root Pibo profile fixture", () => withFixture(({ root }) => {
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
	assert.equal(result.states.pending, 0);
}));

test("core mode is ledger-independent and tolerates unknown metadata, missing reserved files, and broken links", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-okf-core-"));
	try {
		write(root, "docs/concept.md", "---\ntype: Unknown Project Type\nunknown_extension: true\n---\n\n# Concept\n\n[Broken](missing.md)\n");
		const result = validateRepository({ mode: "core", projectRoot: root });
		assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
		assert.equal(result.ledger_records, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("core mode reports only core concept and present-reserved structure failures", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-okf-core-errors-"));
	try {
		write(root, "docs/missing.md", "# Missing frontmatter\n");
		write(root, "docs/empty.md", "---\ntype: '   '\nextra: tolerated\n---\n");
		write(root, "docs/index.md", "---\nother: value\n---\n\nNo heading\n");
		write(root, "docs/nested/index.md", "---\nbroken: [\n");
		write(root, "docs/log.md", "# Log\n\n## August 29\n\n* Entry\n");
		const result = validateRepository({ mode: "core", projectRoot: root });
		assert.equal(result.ok, false);
		assert(result.errors.every((issue) => issue.layer === "okf-core"));
		assert.deepEqual(new Set(result.errors.map((issue) => issue.code)), new Set([
			"OKF_FRONTMATTER_MISSING",
			"OKF_TYPE",
			"OKF_INDEX_FRONTMATTER",
			"OKF_INDEX_HEADING",
			"OKF_LOG_DATE",
			"OKF_RESERVED_FRONTMATTER",
		]));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("core frontmatter parsing treats LF, CRLF, lone CR, and mixed line endings equivalently", () => {
	const canonical = "---\ntype: Reference\ntitle: Line ending fixture\n---\n\n# Line ending fixture\n\nBody.\n";
	const canonicalBody = parseFrontmatter(canonical).body;
	const root = mkdtempSync(join(tmpdir(), "pibo-okf-frontmatter-line-endings-"));
	try {
		for (const form of MARKDOWN_LINE_ENDINGS) {
			const content = withMarkdownLineEndings(canonical, form);
			assert.equal(normalizeMarkdownLineEndings(content), canonical, form);
			const parsed = parseFrontmatter(content);
			assert.equal(parsed.error, null, `${form}: ${parsed.error}`);
			assert.equal(parsed.data?.type, "Reference", form);
			assert.equal(normalizeMarkdownLineEndings(parsed.body), canonicalBody, form);
			assert.deepEqual(validateCoreConceptContent(content), [], form);
			write(root, "docs/concept.md", content);
			const result = validateRepository({ mode: "core", projectRoot: root });
			assert.equal(result.ok, true, `${form}: ${JSON.stringify(result.errors, null, 2)}`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("frontmatter splitting preserves exact body bytes and exact delimiter rules", () => {
	const body = "\r\n# Body\n\nfirst\rsecond\r\nthird\n";
	const content = "---\rtype: Reference\r\ntitle: Mixed envelope\n---\r\n" + body;
	const parsed = parseFrontmatter(content);
	assert.equal(parsed.error, null);
	assert.equal(parsed.data?.title, "Mixed envelope");
	assert.equal(parsed.body, body);
	assert.equal(content.slice(content.length - parsed.body.length), body);

	for (const form of MARKDOWN_LINE_ENDINGS) {
		for (const malformed of [
			"---\ntype: Reference\n# closing delimiter missing\n",
			"---\ntype: Reference\n--- \n# closing delimiter has trailing whitespace\n",
			"---\ntype: Reference\n ---\n# closing delimiter has leading whitespace\n",
		]) {
			const candidate = withMarkdownLineEndings(malformed, form);
			const result = parseFrontmatter(candidate);
			assert.equal(result.error, "frontmatter has no closing delimiter", `${form}: ${JSON.stringify(result)}`);
			assert.equal(result.body, candidate, form);
			assert(validateCoreConceptContent(candidate).some((issue) => issue.code === "OKF_FRONTMATTER_PARSE"), form);
		}
		const looseOpening = withMarkdownLineEndings("--- \ntype: Reference\n---\n# Not frontmatter\n", form);
		const result = parseFrontmatter(looseOpening);
		assert.equal(result.data, null, form);
		assert.equal(result.error, null, form);
		assert.equal(result.body, looseOpening, form);
	}
});

test("root and reserved indexes plus log helpers accept every Markdown line ending form", () => {
	const rootIndex = "---\nokf_version: \"0.2\"\n---\n\n# Documentation\n";
	const reservedIndex = "# Plans\n\n- [Plan](plan.md)\n";
	const log = "# Log\n\n## 2026-08-30\n\n- Entry.\n";
	const forbiddenLogFrontmatter = "---\nignored: true\n---\n# Log\n\n## 2026-08-30\n\n- Entry.\n";
	const root = mkdtempSync(join(tmpdir(), "pibo-okf-reserved-line-endings-"));
	try {
		for (const form of MARKDOWN_LINE_ENDINGS) {
			assert.deepEqual(validateIndexContent(withMarkdownLineEndings(rootIndex, form), { root: true }), [], `root ${form}`);
			assert.deepEqual(validateIndexContent(withMarkdownLineEndings(reservedIndex, form)), [], `reserved ${form}`);
			assert.deepEqual(validateLogContent(withMarkdownLineEndings(log, form)), [], `log ${form}`);
			const forbidden = validateLogContent(withMarkdownLineEndings(forbiddenLogFrontmatter, form));
			assert(forbidden.some((issue) => issue.code === "OKF_LOG_FRONTMATTER"), `${form}: ${JSON.stringify(forbidden)}`);
			write(root, "docs/log.md", withMarkdownLineEndings(log, form));
			assert.deepEqual(checkLog({ projectRoot: root }).issues, [], `Pibo log helper ${form}`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("strict validation and index generation load conformant metadata with every line ending form", () => {
	for (const form of MARKDOWN_LINE_ENDINGS) withFixture(({ root, records }) => {
		for (const path of ["docs/project/documentation-profile.md", "docs/plans/fixture-plan.md"]) {
			write(root, path, withMarkdownLineEndings(readFileSync(join(root, path), "utf8"), form));
		}
		for (const record of records.filter((entry) => entry.state === "reserved")) {
			write(root, record.path, withMarkdownLineEndings(readFileSync(join(root, record.path), "utf8"), form));
		}
		const strictBefore = validateRepository({ mode: "strict", projectRoot: root });
		assert.equal(strictBefore.ok, true, `${form}: ${JSON.stringify(strictBefore.errors, null, 2)}`);
		const generated = synchronizeIndexes({ projectRoot: root });
		assert.equal(generated.ok, true, form);
		assert.match(readFileSync(join(root, "docs/index.md"), "utf8"), /Documentation profile/, form);
		assert.match(readFileSync(join(root, "docs/plans/index.md"), "utf8"), /Fixture plan/, form);
		assert.equal(synchronizeIndexes({ projectRoot: root, check: true }).ok, true, form);
		const strictAfter = validateRepository({ mode: "strict", projectRoot: root });
		assert.equal(strictAfter.ok, true, `${form}: ${JSON.stringify(strictAfter.errors, null, 2)}`);
	});
});

test("index generation rejects missing exact closing delimiters in every line ending form without writes", () => {
	for (const form of MARKDOWN_LINE_ENDINGS) withFixture(({ root, records }) => {
		const path = "docs/plans/fixture-plan.md";
		write(root, path, withMarkdownLineEndings("---\ntype: Plan\ntitle: Broken fixture\n# no closing delimiter\n", form));
		const before = managedIndexBytes(root, records);
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /frontmatter has no closing delimiter/, form);
		assertManagedIndexBytes(root, before, `${form} malformed frontmatter changed indexes in check mode`);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /frontmatter has no closing delimiter/, form);
		assertManagedIndexBytes(root, before, `${form} malformed frontmatter changed indexes in write mode`);
	});
});

test("migration mode rejects an unlisted Markdown addition", () => withFixture(({ root }) => {
	write(root, "docs/plans/silent-addition.md", "# Missing ownership\n");
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, false);
	assert(result.errors.some((issue) => issue.code === "MIGRATION_UNLISTED" && issue.layer === "pibo-migration"));
}));

test("migration mode ignores indexed Markdown paths removed by a rename", () => withFixture(({ root }) => {
	write(root, "docs/project/obsolete.md", "# Obsolete path\n");
	assert.equal(spawnSync("git", ["init"], { cwd: root }).status, 0);
	assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
	rmSync(join(root, "docs/project/obsolete.md"));
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
	assert.equal(result.discovery, "git");
}));

test("migration mode rejects duplicate ownership", () => withFixture(({ root, records }) => {
	writeLedger(root, [...records, { ...records.at(-1) }]);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "MIGRATION_DUPLICATE"));
}));

test("migration mode rejects provisional authority values", () => withFixture(({ root, records }) => {
	const changed = records.map((record) => record.path === "docs/plans/fixture-plan.md" ? { ...record, authority: "operational" } : record);
	writeLedger(root, changed);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "MIGRATION_AUTHORITY"));
}));

test("migration mode validates source ownership, destinations, and truthful states", () => withFixture(({ root, records }) => {
	write(root, "docs/plans/first.md", "# First pending file\n");
	write(root, "docs/plans/second.md", "# Second pending file\n");
	const changed = records.map((record) => {
		if (record.path === "docs/plans/fixture-plan.md") return { ...record, status: "stable", source_path: "AGENTS.md" };
		if (record.path === "docs/plans/index.md") return { ...record, type: "Plan" };
		return record;
	});
	changed.push(
		{ path: "missing-host.md", state: "host-exception", reason: "Missing exact host path for fixture validation." },
		{ path: "skills/**/*.md", state: "host-exception", reason: "Broad host pattern for fixture validation only." },
		{ path: "docs/plans/first.md", state: "pending", action: "migrate-concept", target_paths: ["docs/project/decisions/shared.md"], type: "Plan", authority: "directive", status: "draft" },
		{ path: "docs/plans/second.md", state: "pending", action: "migrate-concept", target_paths: ["docs/project/decisions/shared.md"], type: "Plan", authority: "directive", status: "draft" },
	);
	writeLedger(root, changed);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	for (const code of ["MIGRATION_SOURCE_CURRENT_COLLISION", "MIGRATION_TARGET_DUPLICATE", "MIGRATION_TARGET_TYPE", "MIGRATION_CONFORMANT_METADATA", "MIGRATION_RESERVED_METADATA", "MIGRATION_EXCEPTION_MISSING", "MIGRATION_LEDGER_PATH"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}`);
	}
}));

test("migration mode rejects malformed relocated lineage without a real base commit", () => withFixture(({ root, records }) => {
	const path = "docs/project/relocated.md";
	write(root, path, "# Relocated pending body\n");
	writeLedger(root, [...records, {
		path,
		state: "pending",
		action: "relocated-pending-profile-conversion",
		target_paths: [path, "docs/project/second.md"],
		type: "Reference",
		authority: "informative",
		status: "draft",
		source_path: "docs/old/relocated.md",
		source_sha256: "0".repeat(64),
	}]);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	for (const code of ["MIGRATION_IN_PLACE_SPLIT", "MIGRATION_RELOCATION_TARGET", "MIGRATION_BASE_COMMIT"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}`);
	}
}));

test("migration mode binds every pending body to its Git base bytes", () => withFixture(({ root, records }) => {
	const path = "docs/plans/pending-lineage.md";
	const pending = {
		path,
		state: "pending",
		action: "migrate-concept",
		target_paths: [path],
		type: "Plan",
		authority: "directive",
		status: "draft",
	};
	write(root, path, "# Pending lineage\n\nOriginal bytes.\n");
	unlinkSync(join(root, "docs/project/okf-migration-ledger.json"));
	const baseCommit = commitFixture(root);
	writeLedger(root, [...records, pending], { baseCommit });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "introduce fixture migration ledger");
	let result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));

	write(root, "src/future-uncommitted.txt", "uncommitted future work\n");
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, `uncommitted future package: ${JSON.stringify(result.errors, null, 2)}`);
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "future package work");
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, `committed future package: ${JSON.stringify(result.errors, null, 2)}`);
	write(root, "src/future-uncommitted.txt", "amended future work\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "--amend", "--no-edit");
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, `amended future package: ${JSON.stringify(result.errors, null, 2)}`);
	write(root, "src/second-future-commit.txt", "multi-commit future work\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "second future package commit");
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, `multi-commit future package: ${JSON.stringify(result.errors, null, 2)}`);
	const mainBranch = git(root, "branch", "--show-current");
	git(root, "checkout", "--quiet", "-b", "ordinary-merge-side");
	write(root, "src/merge-side.txt", "ordinary side-branch work\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "ordinary side-branch package work");
	git(root, "checkout", "--quiet", mainBranch);
	write(root, "src/merge-main.txt", "ordinary mainline work\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "ordinary mainline package work");
	git(root, "merge", "--quiet", "--no-ff", "ordinary-merge-side", "-m", "ordinary future package merge");
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, `ordinary merged future package: ${JSON.stringify(result.errors, null, 2)}`);

	write(root, path, "# Pending lineage\n\nMutated bytes.\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "attack commit one mutates pending bytes");
	const selfBlessingBase = git(root, "rev-parse", "HEAD");
	writeLedger(root, [...records, pending], { baseCommit: selfBlessingBase });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "attack commit two rebinds mutable ledger field");
	result = validateRepository({ mode: "migration", projectRoot: root });
	for (const code of ["MIGRATION_BASE_COMMIT_ANCHOR", "MIGRATION_PENDING_BYTES"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}: ${JSON.stringify(result.errors, null, 2)}`);
	}
}));

test("complete reachable history rejects merged alternate ledger introductions hidden by path simplification", () => withFixture(({ root, records }) => {
	const path = "docs/plans/merged-history-pending.md";
	const original = "# Merged history pending\n\nCanonical bytes.\n";
	const pending = { path, state: "pending", action: "migrate-concept", target_paths: [path], type: "Plan", authority: "directive", status: "draft" };
	write(root, path, original);
	unlinkSync(join(root, "docs/project/okf-migration-ledger.json"));
	const canonicalBase = commitFixture(root);
	writeLedger(root, [...records, pending], { baseCommit: canonicalBase });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "canonical ledger introduction");
	const canonicalIntroduction = git(root, "rev-parse", "HEAD");
	git(root, "branch", "canonical-introduction", canonicalIntroduction);

	git(root, "checkout", "--quiet", "-b", "alternate-introduction", canonicalBase);
	write(root, path, "# Merged history pending\n\nUnauthorized alternate bytes.\n");
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "alternate corpus mutation");
	const alternateBase = git(root, "rev-parse", "HEAD");
	writeLedger(root, [...records, pending], { baseCommit: alternateBase });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "alternate ledger introduction");
	const alternateIntroduction = git(root, "rev-parse", "HEAD");
	git(root, "merge", "--quiet", "--no-ff", "-s", "ours", "canonical-introduction", "-m", "merge canonical ancestry into alternate package");

	const ledgerPath = "docs/project/okf-migration-ledger.json";
	const defaultIntroductions = git(root, "log", "--format=%H", "--diff-filter=A", "--", ledgerPath).split(/\r?\n/).filter(Boolean);
	const fullHistoryIntroductions = git(root, "log", "--full-history", "--format=%H", "--diff-filter=A", "--", ledgerPath).split(/\r?\n/).filter(Boolean);
	assert.deepEqual(defaultIntroductions, [alternateIntroduction]);
	assert.deepEqual(new Set(fullHistoryIntroductions), new Set([canonicalIntroduction, alternateIntroduction]));
	const result = validateRepository({ mode: "migration", projectRoot: root });
	const historyError = result.errors.find((issue) => issue.code === "MIGRATION_BASE_HISTORY");
	assert(historyError, JSON.stringify(result.errors, null, 2));
	assert.match(historyError.message, /complete reachable history, found 2/);
	assert.equal(result.ok, false);
}));

test("complete reachable history rejects zero committed ledger introductions", () => withFixture(({ root, records }) => {
	const path = "docs/plans/uncommitted-ledger.md";
	write(root, path, "# Pending file with an uncommitted ledger\n");
	unlinkSync(join(root, "docs/project/okf-migration-ledger.json"));
	const baseCommit = commitFixture(root);
	writeLedger(root, [...records, { path, state: "pending", action: "migrate-concept", target_paths: [path], type: "Plan", authority: "directive", status: "draft" }], { baseCommit });
	const result = validateRepository({ mode: "migration", projectRoot: root });
	const historyError = result.errors.find((issue) => issue.code === "MIGRATION_BASE_HISTORY");
	assert(historyError, JSON.stringify(result.errors, null, 2));
	assert.match(historyError.message, /complete reachable history, found 0/);
}));

test("ledger introduction history requires a regular Git blob", () => withFixture(({ root, records }) => {
	const pendingPath = "docs/plans/symlink-introduction.md";
	const ledgerPath = join(root, "docs/project/okf-migration-ledger.json");
	write(root, pendingPath, "# Pending bytes\n");
	unlinkSync(ledgerPath);
	const baseCommit = commitFixture(root);
	symlinkSync("outside-ledger.json", ledgerPath);
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "unsafe symlink ledger introduction");
	unlinkSync(ledgerPath);
	writeLedger(root, [...records, { path: pendingPath, state: "pending", action: "migrate-concept", target_paths: [pendingPath], type: "Plan", authority: "directive", status: "draft" }], { baseCommit });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "replace ledger symlink with regular file");
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "MIGRATION_BASE_HISTORY" && issue.message.includes("not a regular Git blob")), JSON.stringify(result.errors, null, 2));
}));

test("editing relocated lineage hashes cannot bless bytes absent from the declared base", () => withFixture(({ root, records }) => {
	const sourcePath = "docs/old/relocated-lineage.md";
	const path = "docs/project/relocated-lineage.md";
	const original = "# Relocated lineage\n\nOriginal bytes.\n";
	write(root, sourcePath, original);
	unlinkSync(join(root, "docs/project/okf-migration-ledger.json"));
	const baseCommit = commitFixture(root);
	rmSync(join(root, sourcePath));
	write(root, path, original);
	const record = {
		path,
		state: "pending",
		action: "relocated-pending-profile-conversion",
		target_paths: [path],
		type: "Reference",
		authority: "informative",
		status: "draft",
		source_path: sourcePath,
		source_sha256: createHash("sha256").update(original).digest("hex"),
	};
	writeLedger(root, [...records, record], { baseCommit });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "introduce relocated fixture migration ledger");
	let result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));

	const mutated = "# Relocated lineage\n\nMutated bytes.\n";
	write(root, path, mutated);
	writeLedger(root, [...records, { ...record, source_sha256: createHash("sha256").update(mutated).digest("hex") }], { baseCommit });
	result = validateRepository({ mode: "migration", projectRoot: root });
	for (const code of ["MIGRATION_SOURCE_HASH_BASE_MISMATCH", "MIGRATION_PENDING_BYTES"]) {
		assert(result.errors.some((issue) => issue.code === code && issue.path === path), `missing ${code}: ${JSON.stringify(result.errors, null, 2)}`);
	}
}));

test("pending validation fails deterministically when ledger introduction has no parent", () => withFixture(({ root, records }) => {
	const path = "docs/plans/root-introduction.md";
	write(root, path, "# Root-introduced pending bytes\n");
	const pending = { path, state: "pending", action: "migrate-concept", target_paths: [path], type: "Plan", authority: "directive", status: "draft" };
	writeLedger(root, [...records, pending]);
	const rootCommit = commitFixture(root);
	writeLedger(root, [...records, pending], { baseCommit: rootCommit });
	git(root, "add", ".");
	git(root, "commit", "--quiet", "-m", "declare unusable root anchor");
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "MIGRATION_BASE_HISTORY" && issue.message.includes("exactly one resolvable parent")), JSON.stringify(result.errors, null, 2));
}));

test("strict mode rejects pending entries without weakening concept checks", () => withFixture(({ root, records }) => {
	const changed = records.map((record) => record.path === "docs/plans/fixture-plan.md" ? { ...record, state: "pending", action: "migrate-concept" } : record);
	writeLedger(root, changed);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "STRICT_PENDING"));
}));

test("strict mode rejects missing internal links and declared source paths", () => withFixture(({ root }) => {
	const path = join(root, "docs/plans/fixture-plan.md");
	const current = readFileSync(path, "utf8");
	writeFileSync(path, current.replace(`${GENERATED}\n`, `${GENERATED}\nsources:\n  - resource: "missing-source.md"\n`).replace("# Fixture plan", "# Fixture plan\n\nSee [missing](/project/missing.md)."));
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_LINK_MISSING" && issue.layer === "pibo-profile"));
	assert(result.errors.some((issue) => issue.code === "PIBO_SOURCE_PATH"));
}));

test("strict mode permits only exact immutable deprecated historical link exceptions", () => withFixture(({ root, records }) => {
	const path = "docs/legacy/preserved-record.md";
	const body = "\n# Preserved record\n\n[Removed source](/removed-source.md)\n";
	const sourceSha256 = createHash("sha256").update(body).digest("hex");
	const metadata = `preserved_body:\n  source_path: "docs/old/preserved-record.md"\n  source_sha256: "${sourceSha256}"\n  unresolved_links:\n    - target: "../removed-source.md"\n      reason: "The baseline source target was not retained in the bundle."\n`;
	const correctedMetadata = metadata.replaceAll("../removed-source.md", "/removed-source.md");
	write(root, path, concept({ type: "Historical Record", title: "Preserved record", authority: "historical", status: "deprecated", sources: correctedMetadata, body: "[Removed source](/removed-source.md)" }));
	write(root, "docs/legacy/index.md", "# Legacy\n\n- [Preserved record](preserved-record.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Historical Record", authority: "historical", status: "deprecated" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
}));

test("preserved-body declarations cannot suppress escapes, invalid encoding, external, broad, directory, or traversal targets", () => withFixture(({ root, records }) => {
	const path = "docs/legacy/adversarial-record.md";
	const body = "\n# Adversarial record\n\n[Escape](../../outside.md)\n[Encoding](%E0%A4%A)\n[External](https://example.invalid/missing.md)\n[Missing](missing.md)\n";
	const sourceSha256 = createHash("sha256").update(body).digest("hex");
	const metadata = `preserved_body:\n  source_path: "docs/old/adversarial-record.md"\n  source_sha256: "${sourceSha256}"\n  unresolved_links:\n    - target: "../../outside.md"\n      reason: "Traversal must not suppress an escape."\n    - target: "%2e%2e/%2e%2e/outside.md"\n      reason: "Encoded traversal must also be rejected."\n    - target: "%E0%A4%A"\n      reason: "Invalid encoding must not be suppressible."\n    - target: "https://example.invalid/missing.md"\n      reason: "External links are outside the exception."\n    - target: "missing*"\n      reason: "Patterns are broad."\n    - target: "missing/"\n      reason: "Directories are broad."\n    - target: "missing.md"\n      reason: "This exact missing file would otherwise be eligible."\n`;
	write(root, path, concept({ type: "Historical Record", title: "Adversarial record", authority: "historical", status: "deprecated", sources: metadata, body: body.trimStart().split("\n").slice(2).join("\n") }));
	write(root, "docs/legacy/index.md", "# Legacy\n\n- [Adversarial record](adversarial-record.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Historical Record", authority: "historical", status: "deprecated" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_LINK_ESCAPE"), JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_LINK_ENCODING"));
	assert(result.errors.some((issue) => issue.code === "PIBO_LINK_MISSING" && issue.message.includes("missing.md")));
	assert(result.errors.filter((issue) => issue.code === "PIBO_PRESERVED_LINK_TARGET").length >= 6);
}));

test("strict mode rejects mutable, current, undeclared, broad, and stale preserved-link exceptions", () => withFixture(({ root, records }) => {
	const path = "docs/plans/preserved-plan.md";
	const body = "\n# Preserved plan\n\n[Missing](missing.md)\n[Undeclared](other.md)\n";
	const sourceSha256 = createHash("sha256").update(body).digest("hex");
	const metadata = `preserved_body:\n  source_path: "docs/plans/original.md"\n  source_sha256: "${sourceSha256}"\n  unresolved_links:\n    - target: "missing.md"\n      reason: "Legacy target is absent."\n    - target: "missing/"\n      reason: "Broad directory entry is forbidden."\n    - target: "/plans/fixture-plan.md"\n      reason: "This target exists, so the declaration is stale."\n`;
	write(root, path, concept({ type: "Plan", title: "Preserved plan", authority: "directive", sources: metadata, body: "[Missing](missing.md)\n[Undeclared](other.md)" }));
	write(root, "docs/plans/index.md", "# Plans\n\n- [Fixture plan](fixture-plan.md)\n- [Preserved plan](preserved-plan.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
	let result = validateRepository({ mode: "strict", projectRoot: root });
	for (const code of ["PIBO_PRESERVED_BODY_ELIGIBILITY", "PIBO_PRESERVED_LINK_TARGET", "PIBO_PRESERVED_LINK_UNUSED", "PIBO_LINK_MISSING"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}`);
	}
	const current = readFileSync(join(root, path), "utf8");
	writeFileSync(join(root, path), current.replace("[Missing]", "Changed [Missing]"));
	result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_PRESERVED_BODY_HASH"));
}));

test("strict mode enforces filenames, actors, and Specification traceability", () => withFixture(({ root, records }) => {
	const badPlan = "docs/plans/Bad_Name.md";
	const specification = "docs/specs/implemented.md";
	write(root, badPlan, concept({ type: "Plan", title: "Bad plan", authority: "directive" }).replace("process:test-fixture", "invalid-actor"));
	write(root, specification, concept({ type: "Specification", title: "Implemented contract", authority: "normative" }));
	writeLedger(root, [
		...records,
		{ path: badPlan, state: "conformant", type: "Plan", authority: "directive", status: "draft" },
		{ path: specification, state: "conformant", type: "Specification", authority: "normative", status: "draft" },
	]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_FILENAME"));
	assert(result.errors.some((issue) => issue.code === "PIBO_GENERATED"));
	assert(result.errors.some((issue) => issue.code === "PIBO_TRACEABILITY"));
}));

test("strict mode accepts approved requirement-ID forms with tests or an inspected-source follow-up", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const index = "docs/specs/fixture/index.md";
	const path = "docs/specs/fixture/traceable-contract.md";
	const requirements = [
		traceRequirement({ id: "PROD-CTX-001" }),
		traceRequirement({ id: "WP02-DATA-STORE-001", withoutTests: true, sourceInspected: true, followUp: "Add a regression test when the public surface changes." }),
		traceRequirement({ id: "PIBO-ROUTING-REQ-001" }),
		traceRequirement({ id: "PIBO-GATEWAY-001" }),
	].join("");
	const canonicalSkillHeading = "### Requirement: PIBO-GATEWAY-001: Dev gateway status is discoverable";
	assert(readFileSync(join(process.cwd(), "skills/builtin/pibo-spec-writing/SKILL.md"), "utf8").includes(canonicalSkillHeading));
	const body = `## Requirement: PROD-CTX-001: Package behavior

The behavior is implemented.

## Requirement: WP02-DATA-STORE-001 Inspected behavior

The source establishes this behavior.

## Requirement: PIBO-ROUTING-REQ-001: Explicit REQ component

The optional REQ form is implemented.

${canonicalSkillHeading}

The CLI behavior is implemented.`;
	write(root, index, "# Fixture specifications\n\n- [Traceable contract](traceable-contract.md)\n");
	write(root, path, concept({ type: "Specification", title: "Traceable contract", authority: "normative", sources: specificationTrace({ commit, requirements }), body }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Fixture](fixture/)\n");
	writeLedger(root, [
		...records,
		{ path: index, state: "reserved" },
		{ path, state: "conformant", type: "Specification", authority: "normative", status: "draft" },
	]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
}));

test("strict mode rejects malformed explicit Requirement heading IDs", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const path = "docs/specs/body-heading-grammar.md";
	const validIds = ["PROD-CTX-001", "WP02-DATA-STORE-001", "PIBO-ROUTING-REQ-001"];
	const invalidTokens = [
		"REQ-001",
		"CTX-001",
		"prod-CTX-001",
		"PROD--CTX-001",
		"PROD-CTX-01",
		"PROD-CTX-001-EXTRA",
		"not-an-id",
		"**PIBO-EXTRA-001**",
		"`PIBO-EXTRA-002`",
		"<span>PIBO-EXTRA-003</span>",
		"[PIBO-EXTRA-004](target)",
		"PIBO-EXTRA-005.",
		"PIBO-EXTRA-006,",
		"PIBO-EXTRA-007—Trailing",
		"PIBO-EXTRA-008\\",
		"PIBO-\u200bEXTRA-009",
		"PIBO-EXTRA-\u0007010",
		"PIBO‑EXTRA‑011",
		"PIBO‐EXTRA‐012",
		"PIBO−EXTRA−013",
		"PIBO-EXTRA-014\u200d",
		"PIBO-EXTRA-015\u2060",
		"PIBO-EXTRA-016-",
		"PIBO-EXTRA-017\u200b",
		"PIBO-EXTRA-018\u0007",
		"",
	];
	const requirements = validIds.map((id) => traceRequirement({ id })).join("");
	const validHeadings = validIds.map((id) => `## Requirement: ${id}: Bound requirement`).join("\n\n");
	const invalidHeadings = invalidTokens.map((token) => token === ""
		? "## Requirement:"
		: `## Requirement: ${token}: Invalid explicit requirement`).join("\n\n");
	write(root, path, concept({ type: "Specification", title: "Body heading grammar", authority: "normative", sources: specificationTrace({ commit, requirements }), body: `${validHeadings}\n\n${invalidHeadings}` }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Body heading grammar](body-heading-grammar.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	const headingErrors = result.errors.filter((issue) => issue.code === "PIBO_REQUIREMENT_HEADING_ID");
	assert.equal(headingErrors.length, invalidTokens.length, JSON.stringify(result.errors, null, 2));
	assert.equal(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND"), false, JSON.stringify(result.errors, null, 2));
	assert.equal(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_MISSING"), false, JSON.stringify(result.errors, null, 2));
}));

test("strict mode treats only explicit Requirement headings as formal requirements", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const path = "docs/specs/non-requirement-headings.md";
	const id = "PROD-CTX-001";
	const body = `## Requirement: ${id}: Bound requirement

Implemented.

## 2026-08-29
## Release notes
## Version 2026-08-29
## RFC-9110 semantics
## ISO-8601 timestamps
## HTTP-404 responses
## PROD-CTX-999 plain ID-looking prose
## **PIBO-EXTRA-001**
## \`PIBO-EXTRA-002\`
## <span>PIBO-EXTRA-003</span>
## [PIBO-EXTRA-004](non-requirement-headings.md)
## PIBO-EXTRA-005.
## PIBO-EXTRA-006,
## PIBO-EXTRA-007—Trailing
## PIBO-EXTRA-008\\:
## PIBO-\u200bEXTRA-009
## PIBO-EXTRA-\u0007010
## PIBO‑EXTRA‑011
## PIBO-EXTRA-017\u200b
## PIBO-EXTRA-018\u0007
## requirement: REQ-001

\`\`\`markdown
## Requirement: REQ-001: Fenced example only
\`\`\`

~~~markdown
## Requirement: **PIBO-EXTRA-012**: Fenced formatted example
<!-- Raw comment delimiters are allowed only inside fences. -->
~~~
`;
	write(root, path, concept({ type: "Specification", title: "Non-requirement headings", authority: "normative", sources: specificationTrace({ commit, requirements: traceRequirement({ id }) }), body }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Non-requirement headings](non-requirement-headings.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
}));

test("strict mode rejects every raw HTML comment delimiter outside Specification fences", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const path = "docs/specs/comment-boundary.md";
	const requirements = traceRequirement({ id: "PIBO-BASE-001" }) + traceRequirement({ id: "PIBO-COMMENT-001" });
	const body = `## Requirement: PIBO-BASE-001: Bound

## Requirement: PIBO-<!-- hidden -->COMMENT-001: Fragmented raw ID

The inline-code literal \`<!--\` is prohibited.

## Requirement: PIBO-UNBOUND-001: Must still be parsed

The escaped literal \\<!-- is also prohibited.

<!--
## Requirement: PIBO-RAW-COMMENT-001: Raw lines are never hidden from parsing
example --> ## Requirement: PIBO-FABRICATED-001: Must not be synthesized from fragments`;
	write(root, path, concept({ type: "Specification", title: "Comment boundary", authority: "normative", sources: specificationTrace({ commit, requirements }), body }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Comment boundary](comment-boundary.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.errors.filter((issue) => issue.code === "PIBO_SPEC_HTML_COMMENT").length, 6, JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_HEADING_ID"), JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND" && issue.message.includes("PIBO-UNBOUND-001")), JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND" && issue.message.includes("PIBO-RAW-COMMENT-001")), JSON.stringify(result.errors, null, 2));
	assert.equal(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND" && issue.message.includes("PIBO-FABRICATED-001")), false, JSON.stringify(result.errors, null, 2));
}));

test("Specification scanning follows CommonMark fenced-code opener and closer rules", () => {
	const cases = [
		{
			name: "invalid backtick info bypass",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n```lang`not-a-fence\n<!-- outside -->\n## Requirement: PIBO-UNBOUND-001: Parsed",
			comments: 2,
			unbound: ["PIBO-UNBOUND-001"],
		},
		{
			name: "valid backtick info",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n```lang options\n<!-- fenced -->\n## Requirement: PIBO-FENCED-001: Ignored\n```",
			comments: 0,
			unbound: [],
		},
		{
			name: "tilde info permits backticks and a longer closer",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n~~~lang`option\n<!-- fenced -->\n## Requirement: PIBO-FENCED-001: Ignored\n~~~~",
			comments: 0,
			unbound: [],
		},
		{
			name: "short and mismatched closers remain fenced",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n````lang\n<!-- fenced -->\n```\n~~~\n## Requirement: PIBO-FENCED-001: Ignored\n````\n<!-- outside -->",
			comments: 2,
			unbound: [],
		},
		{
			name: "CRLF invalid info is ordinary text",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n````lang`invalid\n<!-- outside -->\n## Requirement: PIBO-CRLF-UNBOUND-001: Parsed",
			comments: 2,
			unbound: ["PIBO-CRLF-UNBOUND-001"],
			crlf: true,
		},
		{
			name: "CRLF valid four-backtick fence and equal closer",
			body: "## Requirement: PIBO-BASE-001: Bound\n\n````lang\n<!-- fenced -->\n## Requirement: PIBO-FENCED-001: Ignored\n````",
			comments: 0,
			unbound: [],
			crlf: true,
		},
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		write(root, "src/example.ts", "export const publicSurface = true;\n");
		write(root, "test/example.test.mjs", "// fixture evidence\n");
		const commit = commitFixture(root);
		const path = "docs/specs/commonmark-fence.md";
		let content = concept({
			type: "Specification",
			title: "CommonMark fence",
			authority: "normative",
			sources: specificationTrace({ commit, requirements: traceRequirement({ id: "PIBO-BASE-001" }) }),
			body: fixtureCase.body,
		});
		if (fixtureCase.crlf) content = content.replaceAll("\n", "\r\n");
		write(root, path, content);
		write(root, "docs/specs/index.md", "# Specifications\n\n- [CommonMark fence](commonmark-fence.md)\n");
		writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
		const result = validateRepository({ mode: "strict", projectRoot: root });
		assert.equal(result.errors.filter((issue) => issue.code === "PIBO_SPEC_HTML_COMMENT").length, fixtureCase.comments, `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
		const unbound = result.errors.filter((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND").map((issue) => fixtureCase.unbound.find((id) => issue.message.includes(id))).filter(Boolean);
		assert.deepEqual(unbound, fixtureCase.unbound, `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
	});
});

test("Specification scanning treats lone CR and mixed CommonMark line endings identically", () => {
	const cases = [
		{
			name: "lone CR valid fence ignores comments and requirements",
			body: "## Requirement: PIBO-BASE-001: Bound\r\r```markdown\r<!-- fenced -->\r## Requirement: PIBO-FENCED-001: Ignored\r```",
			expected: [],
		},
		{
			name: "lone CR invalid backtick info exposes comments and unbound requirement",
			body: "## Requirement: PIBO-BASE-001: Bound\r\r```lang`not-a-fence\r<!-- outside -->\r## Requirement: PIBO-UNBOUND-001: Parsed",
			expected: ["PIBO_SPEC_HTML_COMMENT", "PIBO_REQUIREMENT_BODY_UNBOUND"],
		},
		{
			name: "lone CR raw comment delimiters are rejected",
			body: "## Requirement: PIBO-BASE-001: Bound\r\r<!-- outside -->",
			expected: ["PIBO_SPEC_HTML_COMMENT"],
		},
		{
			name: "lone CR malformed requirement ID is rejected",
			body: "## Requirement: PIBO-BASE-001: Bound\r## Requirement: REQ-001: Malformed",
			expected: ["PIBO_REQUIREMENT_HEADING_ID"],
		},
		{
			name: "lone CR bound and unbound requirements remain distinct",
			body: "## Requirement: PIBO-BASE-001: Bound\r## Requirement: PIBO-UNBOUND-001: Unbound",
			expected: ["PIBO_REQUIREMENT_BODY_UNBOUND"],
		},
		{
			name: "lone CR duplicate requirement is rejected",
			body: "## Requirement: PIBO-BASE-001: First\r## Requirement: PIBO-BASE-001: Duplicate",
			expected: ["PIBO_REQUIREMENT_BODY_DUPLICATE"],
		},
		{
			name: "mixed line endings preserve fence and raw-line boundaries",
			body: "## Requirement: PIBO-BASE-001: Bound\r\n\r~~~markdown\n<!-- fenced -->\r## Requirement: PIBO-FENCED-001: Ignored\r\n~~~~\r<!-- outside -->\n## Requirement: PIBO-MIXED-UNBOUND-001: Parsed",
			expected: ["PIBO_SPEC_HTML_COMMENT", "PIBO_REQUIREMENT_BODY_UNBOUND"],
		},
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		write(root, "src/example.ts", "export const publicSurface = true;\n");
		write(root, "test/example.test.mjs", "// fixture evidence\n");
		const commit = commitFixture(root);
		const path = "docs/specs/commonmark-line-endings.md";
		write(root, path, concept({
			type: "Specification",
			title: "CommonMark line endings",
			authority: "normative",
			sources: specificationTrace({ commit, requirements: traceRequirement({ id: "PIBO-BASE-001" }) }),
			body: fixtureCase.body,
		}));
		write(root, "docs/specs/index.md", "# Specifications\n\n- [CommonMark line endings](commonmark-line-endings.md)\n");
		writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
		const result = validateRepository({ mode: "strict", projectRoot: root });
		for (const code of fixtureCase.expected) assert(result.errors.some((issue) => issue.code === code), `${fixtureCase.name}: missing ${code}: ${JSON.stringify(result.errors, null, 2)}`);
		assert.equal(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_MISSING"), false, `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
		if (fixtureCase.expected.length === 0) assert.equal(result.ok, true, `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
	});
});

test("strict mode requires exactly one explicit body heading for each traced requirement", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const path = "docs/specs/requirement-heading-cardinality.md";
	const duplicate = "PIBO-DUPLICATE-001";
	const missing = "PIBO-MISSING-001";
	const unbound = "PIBO-UNBOUND-001";
	const requirements = traceRequirement({ id: duplicate }) + traceRequirement({ id: missing });
	const body = `## Requirement: ${duplicate}: First owner

Implemented.

## Requirement: ${duplicate}: Duplicate owner

Still implemented.

The token ${missing} outside an explicit heading does not bind it.

## Requirement: ${unbound}: No frontmatter owner

Unbound.`;
	write(root, path, concept({ type: "Specification", title: "Requirement heading cardinality", authority: "normative", sources: specificationTrace({ commit, requirements }), body }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Requirement heading cardinality](requirement-heading-cardinality.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_DUPLICATE" && issue.message.includes(duplicate)), JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_MISSING" && issue.message.includes(missing)), JSON.stringify(result.errors, null, 2));
	assert(result.errors.some((issue) => issue.code === "PIBO_REQUIREMENT_BODY_UNBOUND" && issue.message.includes(unbound)), JSON.stringify(result.errors, null, 2));
}));

test("strict mode rejects a fake traceability commit", () => withFixture(({ root, records }) => {
	const path = "docs/specs/fake-commit.md";
	const id = "PIBO-FAKE-COMMIT-REQ-001";
	write(root, path, concept({
		type: "Specification",
		title: "Fake commit",
		authority: "normative",
		sources: specificationTrace({ commit: "f".repeat(40), requirements: traceRequirement({ id, sourcePath: "AGENTS.md", testPath: "AGENTS.md" }) }),
		body: `## Requirement: ${id}: Rejected evidence\n\nThe commit must exist.`,
	}));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Fake commit](fake-commit.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_TRACE_COMMIT"));
}));

test("strict mode rejects escaped, absolute, dotted, globbed, and post-commit evidence paths", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	write(root, "src/after-commit.ts", "export const tooLate = true;\n");
	const path = "docs/specs/evidence-paths.md";
	const cases = ["../outside.ts", "/tmp/outside.ts", "./src/example.ts", "src/../src/example.ts", "src/*.ts", "src/after-commit.ts"];
	const requirements = cases.map((sourcePath, index) => traceRequirement({ id: `PIBO-PATHS-REQ-${String(index + 1).padStart(3, "0")}`, sourcePath })).join("");
	const body = cases.map((_, index) => `## Requirement: PIBO-PATHS-REQ-${String(index + 1).padStart(3, "0")}: Invalid evidence`).join("\n\n");
	write(root, path, concept({ type: "Specification", title: "Evidence paths", authority: "normative", sources: specificationTrace({ commit, requirements }), body }));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Evidence paths](evidence-paths.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.errors.filter((issue) => issue.code === "PIBO_TRACE_SOURCE_PATH").length, cases.length, JSON.stringify(result.errors, null, 2));
}));

test("strict mode rejects directory and symlink evidence at the checked commit", () => withFixture(({ root, records }) => {
	const outside = `${root}-outside.ts`;
	writeFileSync(outside, "export const outside = true;\n");
	try {
		write(root, "src/evidence/file.ts", "export const inside = true;\n");
		write(root, "test/example.test.mjs", "// fixture evidence\n");
		mkdirSync(join(root, "src"), { recursive: true });
		symlinkSync(outside, join(root, "src/external.ts"));
		const commit = commitFixture(root);
		const path = "docs/specs/non-files.md";
		const requirements = [
			traceRequirement({ id: "PIBO-NONFILES-REQ-001", sourcePath: "src/evidence" }),
			traceRequirement({ id: "PIBO-NONFILES-REQ-002", sourcePath: "src/external.ts" }),
		].join("");
		const body = "## Requirement: PIBO-NONFILES-REQ-001: Directory evidence\n\nRejected.\n\n## Requirement: PIBO-NONFILES-REQ-002: Symlink evidence\n\nRejected.";
		write(root, path, concept({ type: "Specification", title: "Non-file evidence", authority: "normative", sources: specificationTrace({ commit, requirements }), body }));
		write(root, "docs/specs/index.md", "# Specifications\n\n- [Non-file evidence](non-files.md)\n");
		writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
		const result = validateRepository({ mode: "strict", projectRoot: root });
		assert.equal(result.errors.filter((issue) => issue.code === "PIBO_TRACE_SOURCE_PATH").length, 2, JSON.stringify(result.errors, null, 2));
	} finally {
		rmSync(outside, { force: true });
	}
}));

test("strict mode rejects unnamed tests, empty trace strings, missing body IDs, and unbound body requirements", () => withFixture(({ root, records }) => {
	write(root, "src/example.ts", "export const publicSurface = true;\n");
	write(root, "test/example.test.mjs", "// fixture evidence\n");
	const commit = commitFixture(root);
	const path = "docs/specs/malformed-trace.md";
	const id = "PIBO-MALFORMED-REQ-001";
	const requirements = traceRequirement({ id, symbol: " ", testName: " ", publicValues: '[""]', failures: '[""]', followUp: " " });
	write(root, path, concept({
		type: "Specification",
		title: "Malformed trace",
		authority: "normative",
		sources: specificationTrace({ commit, requirements }),
		body: "## Requirement: PIBO-UNBOUND-REQ-001: No metadata owner\n\nThe declared requirement ID is absent.",
	}));
	write(root, "docs/specs/index.md", "# Specifications\n\n- [Malformed trace](malformed-trace.md)\n");
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	for (const code of ["PIBO_TRACE_SYMBOL", "PIBO_TRACE_TEST_NAME", "PIBO_TRACE_PUBLIC", "PIBO_TRACE_FAILURES", "PIBO_TRACE_FOLLOW_UP", "PIBO_REQUIREMENT_BODY_MISSING", "PIBO_REQUIREMENT_BODY_UNBOUND"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}: ${JSON.stringify(result.errors, null, 2)}`);
	}
}));

test("strict mode rejects bare, lowercase, unprefixed, and malformed requirement IDs", () => withFixture(({ root, records }) => {
	const path = "docs/specs/ambiguous-id.md";
	const invalidIds = ["REQ-001", "CTX-001", "001", "prod-CTX-001", "PROD-ctx-001", "PROD_CTX-001", "PROD--CTX-001", "PROD-CTX-01", "PROD-CTX-001-EXTRA"];
	const requirements = invalidIds.map((id) => traceRequirement({ id, sourcePath: "AGENTS.md", testPath: "AGENTS.md" })).join("");
	const body = invalidIds.map((id) => `## Requirement: ${id}: Invalid form`).join("\n\n");
	write(root, path, concept({ type: "Specification", title: "Ambiguous id", authority: "normative", sources: specificationTrace({ commit: "a".repeat(40), requirements }), body }));
	writeLedger(root, [...records, { path, state: "conformant", type: "Specification", authority: "normative", status: "draft" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(result.errors.filter((issue) => issue.code === "PIBO_REQUIREMENT_ID").length, invalidIds.length, JSON.stringify(result.errors, null, 2));
}));

test("strict mode requires immutable manifest registration for stable evidence", () => withFixture(({ root, records }) => {
	const path = "docs/reports/evidence/run.md";
	const evidence = concept({ type: "Evidence Report", title: "Fixture evidence", authority: "evidentiary" })
		.replace('status: "draft"', 'status: "stable"')
		.replace(`${GENERATED}\n`, `${GENERATED}\nevidence: { id: "fixture-run", published_at: "2026-08-29T00:00:00Z" }\n`);
	write(root, path, evidence);
	writeLedger(root, [...records, { path, state: "conformant", type: "Evidence Report", authority: "evidentiary", status: "stable" }]);
	const result = validateRepository({ mode: "strict", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_HASH"));
}));

test("migration mode requires conformant evidence index coverage and immutable registration", () => withFixture(({ root, records }) => {
	const path = "docs/reports/evidence/migration-run.md";
	const indexPath = "docs/reports/evidence/index.md";
	const evidence = concept({ type: "Evidence Report", title: "Migration evidence", authority: "evidentiary" })
		.replace('status: "draft"', 'status: "stable"')
		.replace(`${GENERATED}\n`, `${GENERATED}\nevidence: { id: "migration-run", published_at: "2026-08-29T00:00:00Z" }\n`);
	const evidenceRecord = { path, state: "conformant", type: "Evidence Report", authority: "evidentiary", status: "stable" };
	write(root, path, evidence);
	writeLedger(root, [...records, evidenceRecord]);
	let result = validateRepository({ mode: "migration", projectRoot: root });
	for (const code of ["PIBO_INDEX_MISSING", "PIBO_EVIDENCE_HASH"]) {
		assert(result.errors.some((issue) => issue.code === code), `missing ${code}: ${JSON.stringify(result.errors, null, 2)}`);
	}

	write(root, indexPath, "# Evidence\n");
	const indexedRecords = [...records, { path: indexPath, state: "reserved" }, evidenceRecord];
	writeLedger(root, indexedRecords);
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_INDEX_ENTRY" && issue.path === indexPath));
	assert(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_HASH" && issue.path === path));

	write(root, indexPath, "# Evidence\n\n- [Migration evidence](migration-run.md)\n");
	write(root, "docs/reports/index.md", "# Reports\n\n- [Evidence](evidence/)\n");
	write(root, "docs/reports/artifacts/okf-migration/evidence-manifest.json", `${JSON.stringify({
		schema_version: "pibo-okf-evidence-manifest/1",
		evidence: [{ path, id: "migration-run", sha256: createHash("sha256").update(evidence).digest("hex") }],
	}, null, 2)}\n`);
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));

	write(root, path, evidence.replace("# Migration evidence", "# Mutated migration evidence"));
	result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_HASH" && issue.path === path));
}));

test("migration and index generation require every ancestor index for a deep conformant concept", () => withFixture(({ root, records }) => {
	const path = "docs/reports/evidence/deep/nested-report.md";
	const leafIndex = "docs/reports/evidence/deep/index.md";
	write(root, path, concept({ type: "Investigation Report", title: "Nested report", authority: "informative" }));
	write(root, leafIndex, "# Deep evidence\n\n- [Nested report](nested-report.md)\n");
	writeLedger(root, [
		...records,
		{ path: leafIndex, state: "reserved" },
		{ path, state: "conformant", type: "Investigation Report", authority: "informative", status: "draft" },
	]);
	const before = managedIndexBytes(root, [...records, { path: leafIndex, state: "reserved" }]);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "PIBO_INDEX_MISSING" && issue.path === "docs/reports/evidence/index.md"), JSON.stringify(result.errors, null, 2));
	assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /PIBO_INDEX_MISSING.*docs\/reports\/evidence\/index\.md/);
	assertManagedIndexBytes(root, before, "missing ancestor changed indexes in check mode");
	assert.throws(() => synchronizeIndexes({ projectRoot: root }), /PIBO_INDEX_MISSING.*docs\/reports\/evidence\/index\.md/);
	assertManagedIndexBytes(root, before, "missing ancestor changed indexes in write mode");
}));

test("ledger leaf and parent symlinks fail structurally before validator or generator reads", () => {
	for (const shape of ["leaf", "parent"]) withFixture(({ root, records }) => {
		const outside = mkdtempSync(join(tmpdir(), `pibo-okf-ledger-${shape}-`));
		try {
			writeFileSync(join(outside, "ledger.json"), "external bytes that are not JSON\n");
			let ledgerPath = "docs/project/okf-migration-ledger.json";
			if (shape === "leaf") {
				unlinkSync(join(root, ledgerPath));
				symlinkSync(join(outside, "ledger.json"), join(root, ledgerPath));
			} else {
				ledgerPath = "linked-control/ledger.json";
				symlinkSync(outside, join(root, "linked-control"), "dir");
			}
			const before = managedIndexBytes(root, records);
			const result = validateRepository({ mode: "migration", projectRoot: root, ledgerPath });
			assert(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_PATH_SYMLINK" && issue.path === ledgerPath), JSON.stringify(result.errors, null, 2));
			assert.equal(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_READ"), false, JSON.stringify(result.errors, null, 2));
			assert.throws(() => synchronizeIndexes({ projectRoot: root, ledgerPath, check: true }), /MIGRATION_LEDGER_PATH_SYMLINK/);
			assertManagedIndexBytes(root, before, `${shape} ledger symlink changed indexes in check mode`);
			assert.throws(() => synchronizeIndexes({ projectRoot: root, ledgerPath }), /MIGRATION_LEDGER_PATH_SYMLINK/);
			assertManagedIndexBytes(root, before, `${shape} ledger symlink changed indexes in write mode`);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

test("ledger control reads reject unsafe parents, non-regular leaves, and escapes without parsing", () => {
	const cases = [
		{
			name: "non-directory parent",
			ledgerPath: "control/ledger.json",
			code: "MIGRATION_LEDGER_PATH_PARENT",
			mutate(root) { writeFileSync(join(root, "control"), "not a directory\n"); },
		},
		{
			name: "directory leaf",
			ledgerPath: "control/ledger.json",
			code: "MIGRATION_LEDGER_PATH_NOT_FILE",
			mutate(root) { mkdirSync(join(root, "control/ledger.json"), { recursive: true }); },
		},
		{
			name: "repository escape",
			code: "MIGRATION_LEDGER_PATH_INVALID",
			mutate(root) {
				const external = `${root}-external-ledger.json`;
				writeFileSync(external, "EXTERNAL_BYTES_MUST_NOT_BE_PARSED\n");
				return { ledgerPath: external, cleanup: () => rmSync(external, { force: true }) };
			},
		},
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		const mutation = fixtureCase.mutate(root) ?? {};
		const ledgerPath = mutation.ledgerPath ?? fixtureCase.ledgerPath;
		const before = managedIndexBytes(root, records);
		try {
			const result = validateRepository({ mode: "migration", projectRoot: root, ledgerPath });
			assert(result.errors.some((issue) => issue.code === fixtureCase.code), `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
			assert.equal(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_READ"), false, `${fixtureCase.name}: ${JSON.stringify(result.errors, null, 2)}`);
			assert.throws(() => synchronizeIndexes({ projectRoot: root, ledgerPath, check: true }), new RegExp(fixtureCase.code));
			assertManagedIndexBytes(root, before, `${fixtureCase.name} changed indexes`);
		} finally {
			mutation.cleanup?.();
		}
	});
});

test("evidence-manifest leaf and parent symlinks fail structurally before reads", () => {
	for (const shape of ["leaf", "parent"]) withFixture(({ root }) => {
		const outside = mkdtempSync(join(tmpdir(), `pibo-okf-manifest-${shape}-`));
		try {
			writeFileSync(join(outside, "evidence-manifest.json"), "external bytes that are not JSON\n");
			const manifestPath = join(root, "docs/reports/artifacts/okf-migration/evidence-manifest.json");
			if (shape === "leaf") {
				unlinkSync(manifestPath);
				symlinkSync(join(outside, "evidence-manifest.json"), manifestPath);
			} else {
				rmSync(dirname(manifestPath), { recursive: true, force: true });
				symlinkSync(outside, dirname(manifestPath), "dir");
			}
			const result = validateRepository({ mode: "migration", projectRoot: root });
			assert(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_MANIFEST_PATH_SYMLINK"), JSON.stringify(result.errors, null, 2));
			assert.equal(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_MANIFEST"), false, JSON.stringify(result.errors, null, 2));
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

test("ledger stable reads reject deterministic leaf changes at inspect, open, and read phases", () => {
	for (const phase of ["afterInspect", "afterOpen", "afterRead"]) withFixture(({ root, records }) => {
		const ledgerPath = "control/ledger.json";
		const absolute = join(root, ledgerPath);
		const original = readFileSync(join(root, "docs/project/okf-migration-ledger.json"));
		write(root, ledgerPath, original);
		const alternate = "EXTERNAL_REPLACEMENT_BYTES_MUST_NOT_BE_PARSED\n";
		const mutate = () => phase === "afterOpen" ? writeFileSync(absolute, alternate) : replaceRegularFile(absolute, alternate);
		const result = validateRepository({
			mode: "migration",
			projectRoot: root,
			ledgerPath,
			controlReadHooks: { ledger: { [phase]: mutate } },
		});
		assert(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_PATH_CHANGED" && issue.path === ledgerPath), `${phase}: ${JSON.stringify(result.errors, null, 2)}`);
		assert.equal(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_READ"), false, `${phase}: ${JSON.stringify(result.errors, null, 2)}`);

		writeFileSync(absolute, original);
		const before = managedIndexBytes(root, records);
		assert.throws(
			() => synchronizeIndexes({ projectRoot: root, ledgerPath, check: true, controlReadHooks: { ledger: { [phase]: mutate } } }),
			/MIGRATION_LEDGER_PATH_CHANGED/,
		);
		assertManagedIndexBytes(root, before, `${phase} ledger leaf change wrote an index`);
	});
});

test("ledger stable reads reject deterministic parent changes at inspect, open, and read phases", () => {
	for (const phase of ["afterInspect", "afterOpen", "afterRead"]) withFixture(({ root, records }) => {
		const ledgerPath = "control/ledger.json";
		const parent = join(root, "control");
		write(root, ledgerPath, readFileSync(join(root, "docs/project/okf-migration-ledger.json")));
		const external = mkdtempSync(join(tmpdir(), `pibo-okf-stable-parent-${phase}-`));
		writeFileSync(join(external, "ledger.json"), "EXTERNAL_PARENT_BYTES_MUST_NOT_BE_PARSED\n");
		let restore;
		const mutate = () => { restore = replaceParentWithSymlink(parent, external); };
		try {
			const result = validateRepository({
				mode: "migration",
				projectRoot: root,
				ledgerPath,
				controlReadHooks: { ledger: { [phase]: mutate } },
			});
			restore?.();
			restore = null;
			assert(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_PATH_CHANGED" && issue.path === ledgerPath), `${phase}: ${JSON.stringify(result.errors, null, 2)}`);
			assert.equal(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_READ"), false, `${phase}: ${JSON.stringify(result.errors, null, 2)}`);

			const before = managedIndexBytes(root, records);
			assert.throws(
				() => synchronizeIndexes({ projectRoot: root, ledgerPath, check: true, controlReadHooks: { ledger: { [phase]: mutate } } }),
				/MIGRATION_LEDGER_PATH_CHANGED/,
			);
			restore?.();
			restore = null;
			assertManagedIndexBytes(root, before, `${phase} ledger parent change wrote an index`);
		} finally {
			restore?.();
			rmSync(external, { recursive: true, force: true });
		}
	});
});

test("evidence-manifest stable reads reject alternate leaf objects at every phase without parsing them", () => {
	for (const phase of ["afterInspect", "afterOpen", "afterRead"]) withFixture(({ root }) => {
		const manifestPath = join(root, "docs/reports/artifacts/okf-migration/evidence-manifest.json");
		const result = validateRepository({
			mode: "migration",
			projectRoot: root,
			controlReadHooks: {
				manifest: { [phase]: () => replaceRegularFile(manifestPath, "EXTERNAL_MANIFEST_BYTES_MUST_NOT_BE_PARSED\n") },
			},
		});
		assert(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_MANIFEST_PATH_CHANGED"), `${phase}: ${JSON.stringify(result.errors, null, 2)}`);
		assert.equal(result.errors.some((issue) => issue.code === "PIBO_EVIDENCE_MANIFEST"), false, `${phase}: ${JSON.stringify(result.errors, null, 2)}`);
	});
});

test("stable control reads preserve ordinary uncommitted ledger and manifest authoring", () => withFixture(({ root }) => {
	synchronizeIndexes({ projectRoot: root });
	const ledgerPath = join(root, "docs/project/okf-migration-ledger.json");
	const manifestPath = join(root, "docs/reports/artifacts/okf-migration/evidence-manifest.json");
	writeFileSync(ledgerPath, `${JSON.stringify(JSON.parse(readFileSync(ledgerPath, "utf8")), null, "\t")}\n`);
	writeFileSync(manifestPath, `${JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8")), null, "\t")}\n`);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
	assert.equal(synchronizeIndexes({ projectRoot: root, check: true }).ok, true);
}));

test("stable control reads close opened descriptors after an injected operation failure", () => withFixture(({ root }) => {
	let descriptor;
	const result = validateRepository({
		mode: "migration",
		projectRoot: root,
		controlReadHooks: {
			ledger: {
				afterOpen(context) {
					descriptor = context.descriptor;
					throw new Error("deterministic injected operation failure");
				},
			},
		},
	});
	assert(result.errors.some((issue) => issue.code === "MIGRATION_LEDGER_PATH_READ"), JSON.stringify(result.errors, null, 2));
	assert.throws(() => fstatSync(descriptor), (error) => error.code === "EBADF");
}));

test("migration mode rejects host Markdown symlinks and non-files before reads", () => withFixture(({ root, records }) => {
	const outside = mkdtempSync(join(tmpdir(), "pibo-okf-external-"));
	try {
		writeFileSync(join(outside, "regular.md"), "---\ntype: [\n");
		mkdirSync(join(outside, "directory"));
		symlinkSync(join(outside, "regular.md"), join(root, "external-regular.md"));
		symlinkSync(join(outside, "directory"), join(root, "external-directory.md"));
		symlinkSync(join(outside, "directory"), join(root, "linked-parent"), "dir");
		mkdirSync(join(root, "host-directory.md"));
		const unsafe = [
			{ path: "external-regular.md", state: "host-exception", reason: "Exact external regular symlink used to prove pre-read rejection." },
			{ path: "external-directory.md", state: "host-exception", reason: "Exact external directory symlink used to prove structured rejection." },
			{ path: "linked-parent/child.md", state: "host-exception", reason: "Exact path below an external symlinked parent used to prove rejection." },
			{ path: "host-directory.md", state: "host-exception", reason: "Exact non-regular Markdown-shaped host path used to prove rejection." },
		];
		writeLedger(root, [...records, ...unsafe]);
		commitFixture(root);
		const result = validateRepository({ mode: "migration", projectRoot: root });
		for (const path of ["external-regular.md", "external-directory.md", "linked-parent/child.md"]) {
			assert(result.errors.some((issue) => issue.code === "MIGRATION_PATH_SYMLINK" && issue.path === path), `${path}: ${JSON.stringify(result.errors, null, 2)}`);
		}
		assert(result.errors.some((issue) => issue.code === "MIGRATION_PATH_NOT_FILE" && issue.path === "host-directory.md"));
		assert.equal(result.errors.some((issue) => issue.path === "external-regular.md" && issue.code.startsWith("OKF_")), false, JSON.stringify(result.errors, null, 2));
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
}));

test("migration mode checks reserved log structure", () => withFixture(({ root }) => {
	write(root, "docs/log.md", "# Log\n\n## August 29\n\n- Changed.\n");
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "OKF_LOG_DATE"));
}));

test("migration mode enforces the seven resolved-plan decision keys", () => withFixture(({ root, records }) => {
	const path = "docs/plans/windows-better-auth-direct-validation.md";
	write(root, path, "# Pending Windows validation\n");
	writeLedger(root, [...records, { path, state: "pending", action: "retain-plan", decision: "wrong" }]);
	const result = validateRepository({ mode: "migration", projectRoot: root });
	assert(result.errors.some((issue) => issue.code === "MIGRATION_PLAN_DECISION"));
}));

test("index generation is sorted, removes stale entries, is byte-stable, and never recreates README", () => withFixture(({ root, records }) => {
	const alpha = "docs/plans/alpha.md";
	const zulu = "docs/plans/zulu.md";
	write(root, alpha, concept({ type: "Plan", title: "Alpha plan", authority: "directive", body: "Alpha." }));
	write(root, zulu, concept({ type: "Plan", title: "Zulu plan", authority: "directive", body: "Zulu." }));
	write(root, "docs/plans/index.md", "# Stale\n\n* [Removed](removed.md)\n");
	write(root, "docs/plans/README.md", "# Legacy navigation\n");
	const ledgerRecords = [
		...records,
		{ path: "docs/plans/README.md", state: "pending", action: "retain-pending" },
		{ path: alpha, state: "conformant", type: "Plan", authority: "directive", status: "draft" },
		{ path: zulu, state: "conformant", type: "Plan", authority: "directive", status: "draft" },
	];
	writeLedger(root, ledgerRecords);
	const first = synchronizeIndexes({ projectRoot: root });
	assert(first.results.some((entry) => entry.path === "docs/plans/index.md" && entry.changed));
	const generated = readFileSync(join(root, "docs/plans/index.md"), "utf8");
	assert(!generated.includes("Removed"));
	assert(generated.indexOf("Alpha plan") < generated.indexOf("Zulu plan"));
	assert.match(readFileSync(join(root, "docs/index.md"), "utf8"), /\[Fixture plan\]\(plans\/fixture-plan\.md\)/);
	const second = synchronizeIndexes({ projectRoot: root });
	assert(second.results.every((entry) => !entry.changed));
	assert.equal(readFileSync(join(root, "docs/plans/index.md"), "utf8"), generated);
	rmSync(join(root, "docs/plans/README.md"));
	writeLedger(root, ledgerRecords.filter((record) => record.path !== "docs/plans/README.md"));
	synchronizeIndexes({ projectRoot: root });
	assert.equal(existsSync(join(root, "docs/plans/README.md")), false);
	write(root, "docs/plans/index.md", `${generated}\nmanual drift\n`);
	const beforeCheck = readFileSync(join(root, "docs/plans/index.md"), "utf8");
	const check = synchronizeIndexes({ projectRoot: root, check: true });
	assert.equal(check.ok, false);
	assert.equal(readFileSync(join(root, "docs/plans/index.md"), "utf8"), beforeCheck);
}));

test("profile validation and standalone index generation reject metadata structure injection without writing", () => {
	const cases = [
		{ field: "title", replacement: 'title: "Unsafe\\n## Injected heading"', code: "PIBO_TITLE", generator: /Unsafe index title metadata/ },
		{ field: "description", replacement: 'description: "Unsafe\\n* forged entry"', code: "PIBO_DESCRIPTION", generator: /Unsafe index description metadata/ },
		{ field: "tags", replacement: 'tags: ["fixture", "unsafe\\n## injected tag"]', code: "PIBO_TAGS", generator: /Unsafe index tag metadata/ },
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		const path = `docs/plans/unsafe-${fixtureCase.field}.md`;
		let content = concept({ type: "Plan", title: `Unsafe ${fixtureCase.field}`, authority: "directive" });
		const fieldPattern = fixtureCase.field === "tags" ? /^tags: .*$/m : new RegExp(`^${fixtureCase.field}: .*`, "m");
		content = content.replace(fieldPattern, fixtureCase.replacement);
		write(root, path, content);
		writeLedger(root, [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
		const strict = validateRepository({ mode: "strict", projectRoot: root });
		assert(strict.errors.some((issue) => issue.code === fixtureCase.code), JSON.stringify(strict.errors, null, 2));
		const indexPath = join(root, "docs/plans/index.md");
		const before = readFileSync(indexPath, "utf8");
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), fixtureCase.generator);
		assert.equal(readFileSync(indexPath, "utf8"), before);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), fixtureCase.generator);
		assert.equal(readFileSync(indexPath, "utf8"), before);
	});
});

test("index generation preflights every managed index before any write", () => withFixture(({ root, records }) => {
	const unsafe = "docs/plans/unsafe-late-render.md";
	write(root, unsafe, concept({ type: "Plan", title: "Unsafe late render", authority: "directive" })
		.replace(/^description: .*$/m, 'description: "Unsafe\\n* forged entry"'));
	write(root, "docs/index.md", "# Stale root index\n");
	write(root, "docs/legacy/index.md", "# Stale legacy index\n");
	writeLedger(root, [...records, { path: unsafe, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
	const managed = records.filter((record) => record.state === "reserved" && record.path.endsWith("index.md")).map((record) => record.path);
	const before = new Map(managed.map((path) => [path, readFileSync(join(root, path))]));
	assert.throws(() => synchronizeIndexes({ projectRoot: root }), /Unsafe index description metadata/);
	for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} changed before preflight completed`);
	assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /Unsafe index description metadata/);
	for (const [path, bytes] of before) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} changed during check-only preflight`);
}));

test("index preflight rejects malformed, mistyped, and unowned direct Markdown globally", () => {
	const cases = [
		{ name: "malformed YAML", content: "---\ntype: [\n---\n\n# Broken\n", owned: true },
		{ name: "missing frontmatter", content: "# Missing frontmatter\n", owned: true },
		{ name: "numeric title", content: concept({ type: "Plan", title: "Numeric title", authority: "directive" }).replace(/^title: .*$/m, "title: 42"), owned: true },
		{ name: "mapping type", content: concept({ type: "Plan", title: "Mapping type", authority: "directive" }).replace(/^type: .*$/m, "type: { unsafe: true }"), owned: true },
		{ name: "unledgered Markdown", content: concept({ type: "Plan", title: "Unledgered", authority: "directive" }), owned: false },
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		const path = `docs/plans/preflight-${fixtureCase.name.toLowerCase().replaceAll(" ", "-")}.md`;
		write(root, path, fixtureCase.content);
		write(root, "docs/index.md", "# Stale root\n");
		write(root, "docs/legacy/index.md", "# Stale legacy\n");
		writeLedger(root, fixtureCase.owned
			? [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]
			: records);
		const before = managedIndexBytes(root, records);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), undefined, fixtureCase.name);
		assertManagedIndexBytes(root, before, `${fixtureCase.name} changed an index in write mode`);
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), undefined, fixtureCase.name);
		assertManagedIndexBytes(root, before, `${fixtureCase.name} changed an index in check mode`);
	});
});

test("index preflight rejects every reserved-file state mutation before any write", () => {
	for (const path of ["docs/index.md", "docs/plans/index.md", "docs/log.md"]) {
		for (const state of ["conformant", "pending", "host-exception", "unexpected-state"]) withFixture(({ root, records }) => {
			write(root, "docs/index.md", "# Stale root\n");
			write(root, "docs/legacy/index.md", "# Stale legacy\n");
			const before = managedIndexBytes(root, records);
			const changed = structuredClone(records);
			const record = changed.find((entry) => entry.path === path);
			record.state = state;
			if (state === "conformant") Object.assign(record, { type: "Plan", authority: "directive", status: "draft" });
			if (state === "host-exception") record.reason = "Invalid in-bundle host exception fixture.";
			writeLedger(root, changed);
			assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), undefined, `${path} ${state} check`);
			assertManagedIndexBytes(root, before, `${path} ${state} changed an index in check mode`);
			assert.throws(() => synchronizeIndexes({ projectRoot: root }), undefined, `${path} ${state} write`);
			assertManagedIndexBytes(root, before, `${path} ${state} changed an index in write mode`);
		});
	}
});

test("index preflight rejects global ownership, existence, file-type, and nested metadata failures without writing", () => {
	const cases = [
		{
			name: "nested unowned Markdown",
			mutate({ root, records }) {
				write(root, "docs/plans/unmanaged/nested.md", concept({ type: "Plan", title: "Nested unowned", authority: "directive" }));
				return records;
			},
		},
		{
			name: "duplicate ledger ownership",
			mutate({ records }) { return [...records, structuredClone(records.find((record) => record.path === "docs/plans/fixture-plan.md"))]; },
		},
		{
			name: "missing docs ledger path",
			mutate({ records }) { return [...records, { path: "docs/plans/missing-current.md", state: "pending", action: "migrate-concept" }]; },
		},
		{
			name: "Markdown symlink",
			mutate({ root, records }) {
				const outside = `${root}-pending-symlink.md`;
				writeFileSync(outside, "outside sentinel\n");
				symlinkSync(outside, join(root, "docs/plans/pending-symlink.md"));
				return { records: [...records, { path: "docs/plans/pending-symlink.md", state: "pending", action: "migrate-concept" }], cleanup: () => rmSync(outside, { force: true }) };
			},
		},
		{
			name: "non-regular Markdown path",
			mutate({ root, records }) {
				mkdirSync(join(root, "docs/plans/not-a-file.md"));
				return [...records, { path: "docs/plans/not-a-file.md", state: "pending", action: "migrate-concept" }];
			},
		},
		{
			name: "unsafe nested conformant metadata",
			mutate({ root, records }) {
				const path = "docs/plans/unmanaged/unsafe-nested.md";
				write(root, path, concept({ type: "Plan", title: "Unsafe nested", authority: "directive" }).replace(/^description: .*$/m, 'description: "Unsafe\\n* forged"'));
				return [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }];
			},
		},
	];
	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		write(root, "docs/index.md", "# Stale root\n");
		write(root, "docs/legacy/index.md", "# Stale legacy\n");
		const before = managedIndexBytes(root, records);
		const mutation = fixtureCase.mutate({ root, records: structuredClone(records) });
		const changedRecords = Array.isArray(mutation) ? mutation : mutation.records ?? mutation;
		writeLedger(root, changedRecords);
		try {
			assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), undefined, `${fixtureCase.name} check`);
			assertManagedIndexBytes(root, before, `${fixtureCase.name} changed an index in check mode`);
			assert.throws(() => synchronizeIndexes({ projectRoot: root }), undefined, `${fixtureCase.name} write`);
			assertManagedIndexBytes(root, before, `${fixtureCase.name} changed an index in write mode`);
		} finally {
			mutation?.cleanup?.();
		}
	});
});

test("index generation omits only exact pending Markdown records", () => withFixture(({ root, records }) => {
	const path = "docs/plans/pending-invalid.md";
	write(root, path, "# Pending source intentionally lacks frontmatter\n");
	writeLedger(root, [...records, { path, state: "pending", action: "migrate-concept" }]);
	const first = synchronizeIndexes({ projectRoot: root });
	assert.equal(first.ok, true);
	assert.equal(readFileSync(join(root, "docs/plans/index.md"), "utf8").includes("pending-invalid"), false);
	assert.equal(synchronizeIndexes({ projectRoot: root, check: true }).ok, true);
}));

test("managed index targets reject symlinks and non-regular files without external writes", () => withFixture(({ root }) => {
	const outside = `${root}-outside-index.md`;
	writeFileSync(outside, "outside sentinel\n");
	try {
		const target = join(root, "docs/plans/index.md");
		unlinkSync(target);
		symlinkSync(outside, target);
		const sentinel = readFileSync(outside);
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /must not be a symlink/);
		assert.deepEqual(readFileSync(outside), sentinel);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /must not be a symlink/);
		assert.deepEqual(readFileSync(outside), sentinel);
		unlinkSync(target);
		mkdirSync(target);
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /must be a regular file/);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /must be a regular file/);
	} finally {
		rmSync(outside, { force: true });
	}
}));

test("managed index targets reject symlinked parents without external writes", () => withFixture(({ root, records }) => {
	const outside = mkdtempSync(join(tmpdir(), "pibo-okf-index-parent-"));
	try {
		writeFileSync(join(outside, "index.md"), "outside parent sentinel\n");
		const linkedParent = join(root, "docs/reports/linked");
		symlinkSync(outside, linkedParent, "dir");
		writeLedger(root, [...records, { path: "docs/reports/linked/index.md", state: "reserved" }]);
		const sentinel = readFileSync(join(outside, "index.md"));
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /must not be a symlink/);
		assert.deepEqual(readFileSync(join(outside, "index.md")), sentinel);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /must not be a symlink/);
		assert.deepEqual(readFileSync(join(outside, "index.md")), sentinel);
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
}));

test("index preflight rejects a missing managed ledger target before writing", () => withFixture(({ root, records }) => {
	const target = join(root, "docs/plans/index.md");
	unlinkSync(target);
	const before = managedIndexBytes(root, records.filter((record) => record.path !== "docs/plans/index.md"));
	assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /does not exist as Markdown/);
	assert.equal(existsSync(target), false);
	assertManagedIndexBytes(root, before, "missing managed target changed another index in check mode");
	assert.throws(() => synchronizeIndexes({ projectRoot: root }), /does not exist as Markdown/);
	assert.equal(existsSync(target), false);
	assertManagedIndexBytes(root, before, "missing managed target changed another index in write mode");
}));

test("generated index metadata is rendered as visible plain text", () => withFixture(({ root, records }) => {
	const concepts = [
		{ path: "docs/plans/a-comment.md", title: "A <!-- comment -->", description: "Visible <!-- description -->" },
		{ path: "docs/plans/b-html.md", title: "B <strong>tag</strong>", description: "Visible <em>description</em>" },
		{ path: "docs/plans/c-markdown.md", title: "C [link](d-entity.md) **bold** `code`", description: "_emphasis_ and ![image](d-entity.md)" },
		{ path: "docs/plans/d-entity.md", title: "D &lt;!-- entity", description: "Entity &#60; and &amp;" },
		{ path: "docs/plans/z-visible.md", title: "Zulu visible", description: "This following entry stays visible." },
	];
	for (const [index, entry] of concepts.entries()) {
		const content = concept({ type: "Plan", title: entry.title, description: entry.description, authority: "directive" })
			.replace(`# ${entry.title}`, `# Safe metadata fixture ${index + 1}`);
		write(root, entry.path, content);
	}
	writeLedger(root, [
		...records,
		...concepts.map((entry) => ({ path: entry.path, state: "conformant", type: "Plan", authority: "directive", status: "draft" })),
	]);
	const strictBefore = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(strictBefore.ok, false, "stale indexes must fail before generation");
	const first = synchronizeIndexes({ projectRoot: root });
	assert.equal(first.ok, true);
	const generated = readFileSync(join(root, "docs/plans/index.md"), "utf8");
	assert.equal((generated.match(/<!--/g) ?? []).length, 1, generated);
	for (const unsafe of ["<strong>", "<em>", "[link](d-entity.md)", "**bold**", "`code`", "![image](d-entity.md)", "&lt;!-- entity"]) assert.equal(generated.includes(unsafe), false, unsafe);
	for (const safe of ["&lt;&#33;&#45;&#45; comment &#45;&#45;&gt;", "&lt;strong&gt;tag&lt;/strong&gt;", "&#91;link&#93;&#40;d&#45;entity&#46;md&#41;", "&#42;&#42;bold&#42;&#42;", "&#96;code&#96;", "&amp;lt;&#33;&#45;&#45; entity", "Zulu visible"]) assert(generated.includes(safe), safe);
	assert(generated.indexOf("Zulu visible") > generated.indexOf("&amp;lt;&#33;&#45;&#45; entity"));
	assert.equal(generated.split("\n").filter((line) => line.startsWith("* [")).length, concepts.length + 1);
	assert.equal(synchronizeIndexes({ projectRoot: root, check: true }).ok, true);
	const strictAfter = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(strictAfter.ok, true, JSON.stringify(strictAfter.errors, null, 2));
}));

test("profile and index preflight reject invisible or direction-spoofing Unicode metadata", () => {
	const cases = [
		{ field: "title", value: "\u200b", code: "PIBO_TITLE" },
		{ field: "description", value: "A\u202eB", code: "PIBO_DESCRIPTION" },
		{ field: "tags", value: "\ufe0f", code: "PIBO_TAGS" },
		{ field: "title", value: "\u0301", code: "PIBO_TITLE" },
	];
	for (const [index, fixtureCase] of cases.entries()) withFixture(({ root, records }) => {
		const path = `docs/plans/unsafe-unicode-${index}.md`;
		let content = concept({ type: "Plan", title: "Visible source title", description: "Visible source description", authority: "directive" });
		if (fixtureCase.field === "tags") content = content.replace(/^tags: .*$/m, `tags: [${JSON.stringify(fixtureCase.value)}]`);
		else content = content.replace(new RegExp(`^${fixtureCase.field}: .*`, "m"), `${fixtureCase.field}: ${JSON.stringify(fixtureCase.value)}`);
		write(root, path, content);
		writeLedger(root, [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
		const strict = validateRepository({ mode: "strict", projectRoot: root });
		assert(strict.errors.some((issue) => issue.code === fixtureCase.code), JSON.stringify(strict.errors, null, 2));
		const before = managedIndexBytes(root, records);
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /Unsafe index/);
		assertManagedIndexBytes(root, before, `${fixtureCase.field} Unicode changed indexes in check mode`);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /Unsafe index/);
		assertManagedIndexBytes(root, before, `${fixtureCase.field} Unicode changed indexes in write mode`);
	});

	for (const fixtureCase of cases) withFixture(({ root, records }) => {
		const profilePath = "docs/project/documentation-profile.md";
		let profile = readFileSync(join(root, profilePath), "utf8");
		if (fixtureCase.field === "tags") profile = profile.replace(/^tags: .*$/m, `tags: [${JSON.stringify(fixtureCase.value)}]`);
		else profile = profile.replace(new RegExp(`^${fixtureCase.field}: .*`, "m"), `${fixtureCase.field}: ${JSON.stringify(fixtureCase.value)}`);
		write(root, profilePath, profile);
		const before = managedIndexBytes(root, records);
		const strict = validateRepository({ mode: "strict", projectRoot: root });
		assert(strict.errors.some((issue) => issue.code === fixtureCase.code), JSON.stringify(strict.errors, null, 2));
		assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /Unsafe index/);
		assertManagedIndexBytes(root, before, `${fixtureCase.field} root navigation changed indexes in check mode`);
		assert.throws(() => synchronizeIndexes({ projectRoot: root }), /Unsafe index/);
		assertManagedIndexBytes(root, before, `${fixtureCase.field} root navigation changed indexes in write mode`);
	});
});

test("profile and index preflight reject every visually blank filler in root and direct metadata", () => {
	const fillers = ["\u115f", "\u1160", "\u17b4", "\u17b5", "\u2800", "\u3164", "\uffa0"];
	for (const filler of fillers) {
		assert.equal(isSafeSingleLineString(filler), false, `invisible-only ${filler.codePointAt(0).toString(16)}`);
		assert.equal(isSafeSingleLineString(`Visible${filler}spoof`), false, `mixed ${filler.codePointAt(0).toString(16)}`);
		withFixture(({ root, records }) => {
			const profilePath = "docs/project/documentation-profile.md";
			const profile = readFileSync(join(root, profilePath), "utf8")
				.replace(/^title: .*$/m, `title: ${JSON.stringify(filler)}`)
				.replace(/^description: .*$/m, `description: ${JSON.stringify(`Visible${filler}spoof`)}`)
				.replace(/^tags: .*$/m, `tags: [${JSON.stringify(filler)}]`);
			write(root, profilePath, profile);
			const path = "docs/plans/blank-filler.md";
			const direct = concept({ type: "Plan", title: "Visible source", description: "Visible source", authority: "directive" })
				.replace(/^title: .*$/m, `title: ${JSON.stringify(`Visible${filler}spoof`)}`)
				.replace(/^description: .*$/m, `description: ${JSON.stringify(filler)}`)
				.replace(/^tags: .*$/m, `tags: [${JSON.stringify(`Visible${filler}spoof`)}]`);
			write(root, path, direct);
			writeLedger(root, [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
			const strict = validateRepository({ mode: "strict", projectRoot: root });
			for (const ownedPath of [profilePath, path]) {
				const codes = new Set(strict.errors.filter((issue) => issue.path === ownedPath).map((issue) => issue.code));
				for (const code of ["PIBO_TITLE", "PIBO_DESCRIPTION", "PIBO_TAGS"]) assert(codes.has(code), `${ownedPath} U+${filler.codePointAt(0).toString(16).toUpperCase()} missing ${code}: ${JSON.stringify(strict.errors, null, 2)}`);
			}
			write(root, profilePath, profile
				.replace(/^title: .*$/m, `title: ${JSON.stringify(`Visible${filler}spoof`)}`)
				.replace(/^description: .*$/m, `description: ${JSON.stringify(filler)}`)
				.replace(/^tags: .*$/m, `tags: [${JSON.stringify(`Visible${filler}spoof`)}]`));
			write(root, path, direct
				.replace(/^title: .*$/m, `title: ${JSON.stringify(filler)}`)
				.replace(/^description: .*$/m, `description: ${JSON.stringify(`Visible${filler}spoof`)}`)
				.replace(/^tags: .*$/m, `tags: [${JSON.stringify(filler)}]`));
			const swapped = validateRepository({ mode: "strict", projectRoot: root });
			for (const ownedPath of [profilePath, path]) {
				const codes = new Set(swapped.errors.filter((issue) => issue.path === ownedPath).map((issue) => issue.code));
				for (const code of ["PIBO_TITLE", "PIBO_DESCRIPTION", "PIBO_TAGS"]) assert(codes.has(code), `${ownedPath} swapped U+${filler.codePointAt(0).toString(16).toUpperCase()} missing ${code}: ${JSON.stringify(swapped.errors, null, 2)}`);
			}
			const before = managedIndexBytes(root, records);
			assert.throws(() => synchronizeIndexes({ projectRoot: root, check: true }), /Unsafe index/);
			assertManagedIndexBytes(root, before, "blank filler changed indexes in check mode");
			assert.throws(() => synchronizeIndexes({ projectRoot: root }), /Unsafe index/);
			assertManagedIndexBytes(root, before, "blank filler changed indexes in write mode");
		});
	}
});

test("visible Unicode metadata remains valid in root navigation and direct concepts", () => withFixture(({ root, records }) => {
	const profilePath = "docs/project/documentation-profile.md";
	const profile = readFileSync(join(root, profilePath), "utf8")
		.replace(/^title: .*$/m, `title: ${JSON.stringify("Pibo 文書 café")}`)
		.replace(/^description: .*$/m, `description: ${JSON.stringify("Re\u0301sume\u0301 日本語 guidance")}`);
	write(root, profilePath, profile);
	const path = "docs/plans/visible-unicode.md";
	write(root, path, concept({ type: "Plan", title: "Éclair 東京", description: "Plan re\u0301sume\u0301 😀", authority: "directive", tags: JSON.stringify(["café", "文書", "e\u0301vidence"]) }));
	writeLedger(root, [...records, { path, state: "conformant", type: "Plan", authority: "directive", status: "draft" }]);
	const first = synchronizeIndexes({ projectRoot: root });
	assert.equal(first.ok, true);
	assert(readFileSync(join(root, "docs/index.md"), "utf8").includes("Pibo 文書 café"));
	assert(readFileSync(join(root, "docs/plans/index.md"), "utf8").includes("Éclair 東京"));
	assert.equal(synchronizeIndexes({ projectRoot: root, check: true }).ok, true);
	const strict = validateRepository({ mode: "strict", projectRoot: root });
	assert.equal(strict.ok, true, JSON.stringify(strict.errors, null, 2));
}));

test("log checker validates deterministic reserved structure without writing prose", () => withFixture(({ root }) => {
	assert.deepEqual(checkLog({ projectRoot: root }).issues, []);
	write(root, "docs/log.md", "# Log\n\n## 2026-08-28\n\n* Older.\n\n## 2026-08-29\n\n* Newer.\n");
	const before = readFileSync(join(root, "docs/log.md"), "utf8");
	const result = checkLog({ projectRoot: root });
	assert(result.issues.some((issue) => issue.code === "OKF_LOG_ORDER"));
	assert.equal(readFileSync(join(root, "docs/log.md"), "utf8"), before);
	rmSync(join(root, "docs/log.md"));
	assert(checkLog({ projectRoot: root }).issues.some((issue) => issue.code === "PIBO_LOG_MISSING"));
}));

test("OKF core requires normative date-grouped log entries without profile-only fields", () => withFixture(({ root }) => {
	write(root, "docs/log.md", "# Log\n");
	const core = validateRepository({ mode: "core", projectRoot: root });
	assert(core.errors.some((issue) => issue.code === "OKF_LOG_SECTION_MISSING" && issue.layer === "okf-core"), JSON.stringify(core.errors, null, 2));
	const checked = checkLog({ projectRoot: root });
	assert(checked.issues.some((issue) => issue.code === "OKF_LOG_SECTION_MISSING" && issue.layer === "okf-core"));
	assert(checked.issues.some((issue) => issue.code === "PIBO_LOG_SECTION_MISSING" && issue.layer === "pibo-profile"));
	const strict = validateRepository({ mode: "strict", projectRoot: root });
	assert(strict.errors.some((issue) => issue.code === "OKF_LOG_SECTION_MISSING" && issue.layer === "okf-core"));
	assert(strict.errors.some((issue) => issue.code === "PIBO_LOG_SECTION_MISSING" && issue.layer === "pibo-profile"));
	write(root, "docs/log.md", "# Log\n\n## 2026-08-29\n\n<!-- no semantic entry -->\n");
	const emptyCore = validateRepository({ mode: "core", projectRoot: root });
	assert(emptyCore.errors.some((issue) => issue.code === "OKF_LOG_ENTRY_MISSING" && issue.layer === "okf-core"));
	assert(checkLog({ projectRoot: root }).issues.some((issue) => issue.code === "PIBO_LOG_ENTRY_MISSING"));
	write(root, "docs/log.md", "# Log\n\n## 2026-08-29\n\nParagraph only.\n");
	assert(validateRepository({ mode: "core", projectRoot: root }).errors.some((issue) => issue.code === "OKF_LOG_ENTRY_MISSING"));
	write(root, "docs/log.md", "# Log\n\n## 2026-08-29\n\n* Core entry without Pibo-specific metadata.\n");
	assert.equal(validateRepository({ mode: "core", projectRoot: root }).errors.some((issue) => issue.path === "docs/log.md"), false);
}));

test("OKF core ignores fenced pseudo-entries using CommonMark fence rules", () => {
	for (const fenced of [
		"```md\n- pseudo entry\n```",
		"~~~~ example\n* pseudo entry\n~~~~",
		"````md\n+ pseudo entry\n```\n````",
		"~~~ example\n- pseudo entry\n```\n~~~",
	]) {
		const issues = validateLogContent(`# Log\n\n## 2026-08-29\n\n${fenced}\n`);
		assert(issues.some((issue) => issue.code === "OKF_LOG_ENTRY_MISSING"), JSON.stringify(issues, null, 2));
	}
	const invalidBacktickOpener = validateLogContent("# Log\n\n## 2026-08-29\n\n```bad`info\n- real list entry because the fence opener is invalid\n```\n");
	assert.equal(invalidBacktickOpener.some((issue) => issue.code === "OKF_LOG_ENTRY_MISSING"), false, JSON.stringify(invalidBacktickOpener, null, 2));
});

test("OKF core accepts valid log entries with LF, CRLF, lone CR, and mixed line endings", () => {
	const logicalLines = ["# Log", "", "## 2026-08-29", "", "```md", "- fenced pseudo-entry", "```", "", "- Real entry.", ""];
	for (const content of [
		logicalLines.join("\n"),
		logicalLines.join("\r\n"),
		logicalLines.join("\r"),
		logicalLines.map((line, index) => `${line}${["\n", "\r\n", "\r"][index % 3]}`).join(""),
	]) assert.deepEqual(validateLogContent(content), []);
});
