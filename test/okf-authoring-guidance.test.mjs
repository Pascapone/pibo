import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("repository guidance preserves the five-root OKF topology", () => {
	const agents = read("AGENTS.md");
	assert.match(agents, /docs\/project\/documentation-profile\.md/);
	assert.match(agents, /maintain-okf-docs/);
	assert.match(agents, /five top-level roots/);
	assert.match(agents, /implemented behavior only/);
	assert.doesNotMatch(agents, /migration entries are pending|Update `docs\/project\/okf-migration-ledger\.json`/);
	for (const forbidden of ["decisions", "guides", "research", "status", "feedback", "evidence", "history", "references", "ops"]) {
		assert.equal(existsSync(`docs/${forbidden}`), false, `forbidden top-level docs/${forbidden} exists`);
	}
});

test("documentation profile pins verified OKF provenance without claiming byte identity", () => {
	const profile = read("docs/project/documentation-profile.md");
	assert.match(profile, /GoogleCloudPlatform\/knowledge-catalog\/blob\/3fcbb9f828c2f23d109c855ee403c3a4c81f3a96\/okf\/SPEC\.md/);
	assert.match(profile, /5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948/);
	assert.match(profile, /fadb0acfc0e7372eb39fb7ede62a1d45f2427a996660914c10ca3fef1fe1f93e/);
	assert.match(profile, /not byte-identical/);
	assert.doesNotMatch(profile, /GoogleCloudPlatform\/open-knowledge-format|ad30107c31c06aec8a7d5636e0d1058118604e6f/);
});

test("specification skills preserve native frontmatter and emit current OKF contracts", () => {
	const piboSpec = read("skills/builtin/pibo-spec-writing/SKILL.md");
	assert.match(piboSpec, /^---\nname:/);
	assert.match(piboSpec, /type: \"Specification\"/);
	assert.match(piboSpec, /traceability:/);
	assert.match(piboSpec, /implemented/);
	assert.doesNotMatch(piboSpec, /id: "REQ-001"/);
	assert.doesNotMatch(piboSpec, /\[\/spec\/\]/);
	assert.doesNotMatch(piboSpec, /docs\/specs\/(changes|phases)\/<|Draft \| Approved \| Implementing \| Done/);
	assert.match(piboSpec, /docs\/specs\/<domain>\/<spec-name>\.md/);
	assert.match(piboSpec, /Do not create a broad `docs\/specs\/capabilities\/` catch-all/);
	for (const id of ["PROD-CTX-001", "WP02-DATA-STORE-001", "PIBO-ROUTING-REQ-001"]) assert.match(piboSpec, new RegExp(id));
	assert.match(piboSpec, /`REQ` component is optional/);
	assert.match(piboSpec, /starts exactly with the case-sensitive marker `Requirement:`/);
	assert.match(piboSpec, /Every frontmatter requirement ID needs exactly one explicit heading/);
	assert.match(piboSpec, /Plain headings such as `RFC-9110 semantics`, `ISO-8601 timestamps`, `HTTP-404 responses`/);
	assert.match(piboSpec, /Do not write raw `<!--` or `-->` anywhere outside fenced code/);
	assert.match(piboSpec, /parses requirements from unchanged non-fenced source lines/);
	assert.match(piboSpec, /backtick opener's info string cannot contain a backtick/);
	assert.match(piboSpec, /LF, CRLF, and lone CR are equivalent line endings/);
	assert.match(piboSpec, /U\+2800 BRAILLE PATTERN BLANK/);
	assert.match(piboSpec, /Normal visible Unicode and normalized accented text are valid/);
	assert.match(piboSpec, /### Requirement: PIBO-GATEWAY-001: Dev gateway status is discoverable/);
	assert.doesNotMatch(piboSpec, /### Requirement: Dev gateway status is discoverable|Requirement-like ATX headings are reserved/);
	assert.match(piboSpec, /confidence` is exactly `high`, `medium`, or `low`/);
	for (const evidence of ["source evidence", "test evidence", "build evidence", "browser evidence", "Pibo2 evidence"]) assert.match(piboSpec, new RegExp(evidence));
	assert.doesNotMatch(piboSpec, /\bV[1-5]\b|expected verification level|capability specs|phase specs/);
	for (const path of [".codex/skills/create-specification/SKILL.md", ".codex/skills/update-specification/SKILL.md"]) {
		const wrapper = read(path);
		assert.match(wrapper, /^---\nname:/);
		assert.match(wrapper, /skills\/builtin\/pibo-spec-writing\/SKILL\.md/);
		assert.match(wrapper, /full approved concept-type vocabulary/);
		assert.doesNotMatch(wrapper, /traceability:|type: \"Specification\"|id: "REQ-001"/);
		assert(wrapper.split("\n").length < 20, `${path} is not a thin wrapper`);
	}
});

test("profile, templates, and canonical skill expose every approved concept type", () => {
	const sources = [read("docs/project/documentation-profile.md"), read("docs/project/references/okf-concept-templates.md"), read("skills/builtin/pibo-spec-writing/SKILL.md")];
	const types = [
		"Documentation Profile", "Architecture", "Design System", "Decision Record", "Guide", "Runbook", "Reference", "Status",
		"Specification", "Plan", "Change Proposal", "Technical Design", "Product Requirement", "Task Ledger",
		"Evidence Report", "Validation Report", "Investigation Report", "Incident Report", "Coverage Report", "Review Record", "Release Record", "Research", "Feedback", "Historical Record",
	];
	for (const source of sources) for (const type of types) assert(source.includes(type), `missing type ${type}`);
	for (const source of sources) assert.doesNotMatch(source, /id: "REQ-001"/);
});

test("concept templates use canonical domain-owned specification paths", () => {
	const templates = read("docs/project/references/okf-concept-templates.md");
	assert.match(templates, /docs\/specs\/<domain>\/<spec-name>\.md/);
	assert.match(templates, /Do not place canonical specifications at `docs\/specs\/` root/);
	assert.match(templates, /broad `capabilities\/` catch-all/);
	assert.match(templates, /migration-input `specs\/changes\/` tree/);
	assert.match(templates, /<DOMAIN>-<TOPIC>-001/);
	assert.match(templates, /`REQ` component is optional/);
	assert.match(templates, /starts exactly with the case-sensitive marker `Requirement:`/);
	assert.match(templates, /Every frontmatter ID has exactly one explicit heading/);
	assert.match(templates, /Do not use raw `<!--` or `-->` anywhere outside fenced code/);
	assert.match(templates, /backtick opener's info string cannot contain a backtick/);
	assert.match(templates, /LF, CRLF, and lone CR as equivalent line endings/);
	assert.match(templates, /U\+2800 BRAILLE PATTERN BLANK/);
	assert.match(templates, /Visible Unicode and normalized accented text are allowed/);
	assert.match(templates, /## Requirement: <DOMAIN>-<TOPIC>-001: <Implemented behavior>/);
	assert.doesNotMatch(templates, /docs\/specs\/<kebab-name>\.md/);
});

test("profile documents the shared requirement-ID grammar without requiring REQ", () => {
	const profile = read("docs/project/documentation-profile.md");
	for (const id of ["PROD-CTX-001", "WP02-DATA-STORE-001", "PIBO-ROUTING-REQ-001"]) assert.match(profile, new RegExp(id));
	assert.match(profile, /`REQ` is an optional component/);
	assert.match(profile, /starts exactly with the case-sensitive marker `Requirement:`/);
	assert.match(profile, /Every frontmatter requirement ID has exactly one explicit heading/);
	assert.match(profile, /Plain headings—including `RFC-9110 semantics`, `ISO-8601 timestamps`, `HTTP-404 responses`/);
	assert.match(profile, /cannot contain raw `<!--` or `-->` delimiters outside fenced code/);
	assert.match(profile, /without removing, joining, or reinterpreting comment fragments/);
	assert.match(profile, /Fence recognition follows CommonMark 0\.31\.2/);
	assert.match(profile, /LF, CRLF, and lone CR are equivalent line endings/);
	assert.match(profile, /default-ignorable code points, U\+2800 BRAILLE PATTERN BLANK,.*are invalid anywhere/);
	assert.match(profile, /U\+2800 BRAILLE PATTERN BLANK/);
	for (const codePoint of ["U+115F", "U+1160", "U+17B4", "U+17B5", "U+3164", "U+FFA0"]) assert.match(profile, new RegExp(codePoint.replace("+", "\\+")));
	assert.match(profile, /recursively walks the real bundle/);
	assert.match(profile, /Only exact ordinary `pending` files are skipped/);
	assert.match(profile, /rejects symlinked or non-directory parents/);
	assert.match(profile, /HTML-encodes `&`, `<`, and `>` and entity-escapes Markdown punctuation/);
	assert.match(profile, /This exception is Pibo policy, not OKF core/);
	assert.match(profile, /exact raw target that link inspection reports as `PIBO_LINK_MISSING` after resolving it inside `docs\/`/);
	assert.match(profile, /literal `\.` or `\.\.` segments/);
	assert.match(profile, /percent-encoded dot traversal/);
	for (const invalid of ["Bare `REQ-001`", "one-component `CTX-001`", "lowercase", "malformed"]) assert.match(profile, new RegExp(invalid));
});

test("migration plan records bounded standing authority for trivial validator and profile corrections", () => {
	const plan = read("docs/plans/okf-migration.md");
	assert.match(plan, /Future agents may autonomously make similarly trivial, mechanically proven validator\/profile corrections/);
	for (const evidence of ["focused tests", "matching profile documentation", "exact-scope evidence", "fresh independent review"]) {
		assert.match(plan, new RegExp(evidence));
	}
	assert.match(plan, /Material authority, security, package-scope, or ownership changes still require explicit user approval/);
});

test("host exceptions use exact path-specific role reasons", () => {
	const ledger = JSON.parse(read("docs/project/okf-migration-ledger.json"));
	const exceptions = ledger.records.filter((record) => record.state === "host-exception");
	assert.equal(exceptions.length, 47);
	for (const record of exceptions) {
		assert(!/[*?{}[\]]/.test(record.path), record.path);
		assert.equal(record.path.endsWith("/"), false, record.path);
		assert(record.reason.length >= 20, record.path);
	}
	const genericReasons = [
		"Agent skill package or fixture kept in its host-owned native format outside the OKF bundle.",
		"Built-in skill package, reference, evaluation fixture, or source skill kept in its host-owned native format outside the OKF bundle.",
	];
	for (const reason of genericReasons) assert.equal(exceptions.some((record) => record.reason === reason), false, reason);
	assert.equal(new Set(exceptions.map((record) => record.reason)).size, 47, "each host-owned path needs its own role reason");
});

test("plan and evidence producers follow the corrected nested paths", () => {
	const prd = read("skills/builtin/prd/SKILL.md");
	assert.match(prd, /^---\nname:/);
	assert.match(prd, /type: \"Plan\"/);
	assert.match(prd, /docs\/plans\//);
	const adapter = read("skills/builtin/pibo-agent-runtime-adapter/references/testing-migration-and-validation.md");
	assert.match(adapter, /docs\/reports\/evidence\//);
	assert.match(adapter, /evidence-manifest\.json/);
});

test("documentation package scripts expose core, migration, strict, index, and log checks", () => {
	const pkg = JSON.parse(read("package.json"));
	assert.equal(pkg.scripts["docs:validate"], "npm run docs:validate:strict");
	assert.match(pkg.scripts["docs:validate:okf"], /--mode core/);
	assert.match(pkg.scripts["docs:validate:migration"], /--mode migration/);
	assert.match(pkg.scripts["docs:validate:strict"], /--mode strict/);
	assert.match(pkg.scripts["docs:indexes:check"], /--check/);
	assert(pkg.scripts["docs:indexes:write"]);
	assert(pkg.scripts["docs:log:check"]);
	assert(pkg.files.includes("docs/project/operations/**"));
	assert(!pkg.files.includes("docs/ops/**"));
});

test("closed foundation relocations preserve the six accepted source bodies byte for byte", () => {
	const expected = new Map([
		["docs/project/guides/pibo-on-windows-via-wsl.md", "132f00469edcfa8915525bff4d0c9d82573ae53868a74db81d5224d354ce1d25"],
		["docs/project/guides/pibo-vscode-ext-quickstart.md", "ff1b33edf70c89ce9b128382d05d5fa28735ede3fc3ba40429bece172fc2d716"],
		["docs/project/operations/install-developer-host.md", "8e6ae80f901852ab0d38c0eb887d83f300107ecbebc2418da5e19ca9238e2e70"],
		["docs/project/operations/install-user-host.md", "f3f6c51fe9f7b30fe8828cf844c82d8ef5ffebb715bab06d78348d5a9d547722"],
		["docs/project/operations/upgrade-user-to-developer-host.md", "a48141d6456800b5e05472dfa7464d44a3b1605ad25a3209145a4d5bfcef22f8"],
		["docs/project/operations/vscode-extension-release.md", "4d7588693a51389ebc3ea53eb088272743e707e3d81a5f436ab58578769f56c2"],
	]);
	const ledger = JSON.parse(read("docs/project/okf-migration-ledger.json"));
	for (const [path, hash] of expected) {
		const content = readFileSync(path);
		const envelope = /^---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?:\r\n|\n|\r)/.exec(content.toString("utf8"));
		assert(envelope, `${path} must have one frontmatter envelope`);
		const body = content.subarray(Buffer.byteLength(envelope[0]));
		assert.equal(createHash("sha256").update(body).digest("hex"), hash, path);
		const record = ledger.records.find((candidate) => candidate.path === path);
		assert.equal(record?.state, "conformant", `${path} ledger state`);
		assert.equal(record?.body_sha256, hash, `${path} ledger body hash`);
	}
});

test("accepted historical plan bodies remain byte-preserved after upstream refresh", () => {
	const expected = new Map([
		["docs/legacy/plans/local-auth-gateway-implementation-plan-2026-06-14.md", "a21786efd362574041768edf331c0981922bd6be59ebf65731c38d39a9867fa5"],
		["docs/legacy/plans/agent-management-tool-design.md", "ec1887fa28e2e52be8cb2308d1a5de03f5f9047ba10e1ef29fd53c58803d0813"],
	]);
	const ledger = JSON.parse(read("docs/project/okf-migration-ledger.json"));
	for (const [path, hash] of expected) {
		const content = readFileSync(path);
		const envelope = /^---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?:\r\n|\n|\r)/.exec(content.toString("utf8"));
		assert(envelope, `${path} must have exactly one frontmatter envelope`);
		const body = content.subarray(Buffer.byteLength(envelope[0]));
		assert.doesNotMatch(body.toString("utf8"), /^---(?:\r\n|\n|\r)/, `${path} has multiple frontmatter envelopes`);
		assert.equal(createHash("sha256").update(body).digest("hex"), hash, path);
		assert.equal(ledger.records.find((record) => record.path === path)?.body_sha256, hash, `${path} ledger body hash`);
	}
});

test("generated root navigation links the ledger-owned active migration plan", () => {
	const index = read("docs/index.md");
	assert.match(index, /\[OKF documentation(?:-|&#45;)system migration\]\(plans\/okf-migration\.md\)/);
	assert.doesNotMatch(index, /docs\/plans\/okf-migration\.md/);
});
