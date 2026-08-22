import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillPath = fileURLToPath(new URL("../skills/builtin/pibo-agent-runtime-adapter/SKILL.md", import.meta.url));
const skillDir = dirname(skillPath);
const normalizeLineEndings = (text) => text.replaceAll("\r\n", "\n");
const skillMarkdown = normalizeLineEndings(readFileSync(skillPath, "utf8"));
const referenceNames = [
	"interfaces-and-registration.md",
	"capabilities-and-designer.md",
	"lifecycle-bindings-and-events.md",
	"portable-delivery-and-native-behavior.md",
	"history-debug-and-security.md",
	"testing-migration-and-validation.md",
];
const references = referenceNames.map((name) => ({
	name,
	path: resolve(skillDir, "references", name),
	markdown: normalizeLineEndings(readFileSync(resolve(skillDir, "references", name), "utf8")),
}));
const allGuidance = [skillMarkdown, ...references.map((reference) => reference.markdown)].join("\n");

function assertMatchesAll(text, patterns) {
	for (const pattern of patterns) assert.match(text, pattern);
}

test("runtime adapter skill is progressively disclosed and has valid bundled links", () => {
	assert.match(skillMarkdown, /^---\nname: pibo-agent-runtime-adapter\n/m);
	assert.match(skillMarkdown, /description: .*adding or replacing a harness/i);
	assert.ok(skillMarkdown.split("\n").length < 500, "SKILL.md should stay below the progressive-disclosure line budget");

	for (const reference of references) {
		assert.ok(existsSync(reference.path), `${reference.name} should exist`);
		assert.match(reference.markdown, /^# /);
		assert.match(skillMarkdown, new RegExp(`references/${reference.name.replaceAll(".", "\\.")}`));
	}

	for (const match of skillMarkdown.matchAll(/\]\(([^)]+)\)/g)) {
		const target = match[1];
		if (target.startsWith("http") || target.startsWith("#")) continue;
		assert.ok(existsSync(resolve(skillDir, target)), `skill link should resolve: ${target}`);
	}
});

test("runtime adapter skill covers the complete architecture and evidence boundary", () => {
	assertMatchesAll(allGuidance, [
		/AgentRuntimeDriver/,
		/AgentRuntimeAdapter/,
		/AgentRuntimeSession/,
		/registerAgentRuntimeDriver/,
		/registerAgentRuntimeInstance/,
		/PiboSession\.id/,
		/unbound[\s\S]*bound[\s\S]*missing[\s\S]*error/i,
		/revisioned|CAS/i,
		/semantic event/i,
		/Agent Designer/,
		/PiboToolDefinition/,
		/session-scoped MCP/i,
		/external MCP/i,
		/skills/i,
		/context/i,
		/subagents/i,
		/models/i,
		/getAuthStatus\(\)/,
		/startAuth\(\)/,
		/completeAuth\(\)/,
		/cancelAuth\(\)/,
		/logoutAuth\(\)/,
		/runtime-instance.*adapter-shared/is,
		/Pibo flow id/i,
		/reasoning/i,
		/approvals/i,
		/structured user input/i,
		/product history/i,
		/inspectHistory\(\)/,
		/readHistory\(\)/,
		/debug/i,
		/telemetry/i,
		/payload_ref/,
		/redact/i,
		/import-boundary/i,
		/migration/i,
		/exact[- ]candidate Pibo2/i,
	]);
	assert.match(skillMarkdown, /Preserve the harness's native model loop, base prompt, standard tools/i);
	assert.match(skillMarkdown, /unknown behavior as unsupported or pending evidence/i);
	assert.match(skillMarkdown, /A partial adapter is valid\. A dishonest full adapter is not\./);
	assert.doesNotMatch(skillMarkdown, /use terminal scraping to emulate|write credentials to global config/i);
});

test("runtime adapter evals cover truthful full and partial harness assessments", () => {
	const evalPath = resolve(skillDir, "evals", "evals.json");
	const evals = JSON.parse(readFileSync(evalPath, "utf8"));
	assert.equal(evals.skill_name, "pibo-agent-runtime-adapter");
	assert.deepEqual(evals.evals.map((entry) => entry.id), [1, 2]);

	const [full, partial] = evals.evals;
	for (const entry of evals.evals) {
		assert.ok(entry.prompt.length > 100);
		assert.ok(entry.expected_output.length > 100);
		assert.ok(entry.expectations.length >= 10);
		for (const file of entry.files) assert.ok(existsSync(resolve(skillDir, file)), `eval fixture should exist: ${file}`);
	}

	assert.match(full.prompt, /full Pibo Agent Runtime Adapter/);
	assert.match(full.expected_output, /preserves Orion's native prompt\/tools/i);
	assert.match(full.expectations.join("\n"), /does not claim clone, native tree navigation, audio input, or structured output/i);
	assert.match(full.expectations.join("\n"), /session-scoped MCP bridge/i);
	assert.match(full.expectations.join("\n"), /exact Pibo2 restart\/resume/i);

	const partialChecks = partial.expectations.join("\n");
	assert.match(partial.expected_output, /explicitly partial adapter/i);
	assertMatchesAll(partialChecks, [
		/classifies Relay as partial/i,
		/rejects debug-log history scraping/i,
		/user-global Relay config/i,
		/replacing Relay's native prompt/i,
		/does not treat invocationId as a native session id/i,
		/unbound Pibo binding/i,
		/Pibo-managed tools, external MCP, skills, context, and Pibo subagents unsupported/i,
		/visible Agent Designer disabled reasons/i,
		/refuses to fabricate native history/i,
		/negative capability tests/i,
	]);
});

test("partial harness fixture cannot be upgraded by the prohibited shortcuts", () => {
	const fixture = readFileSync(resolve(skillDir, "evals", "fixtures", "relay-partial-harness.md"), "utf8");
	assertMatchesAll(fixture, [
		/no thread\/session create, bind, resume, attach, list, fork, clone, tree, read, or delete API/i,
		/no MCP client\/config API/i,
		/no skill-root/i,
		/user-global config/i,
		/format unstable and not an API/i,
		/--system-prompt.*replaces the built-in prompt/i,
	]);
	assertMatchesAll(skillMarkdown, [
		/Do not scrape terminal output/i,
		/Never mutate user-global harness configuration/i,
		/Do not place Pibo's Pi base prompt over another harness/i,
		/keep the Designer control visible but disabled/i,
	]);
});
