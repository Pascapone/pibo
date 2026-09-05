import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanProductVocabulary } from "../scripts/legacy-product-vocabulary-gate.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const retired = "project";
const title = "Project";
const terms = [
	`Pibo${title}`,
	`Chat${title}`,
	`${title}Workflow`,
	`${title}Session`,
	`${title}sBootstrap`,
	`${retired}Id`,
	`${retired}_id`,
	`${retired}StorePath`,
	`${retired}Service`,
	`${retired}Session`,
	`/apps/chat/${retired}s`,
	`/api/chat/${retired}s`,
	`"/${retired}s`,
	`area: "${retired}s"`,
	`web-${retired}s.sqlite`,
	`${retired}_session`,
	`${retired}_workflow`,
	`create_${retired}_session`,
	`before_${retired}_session`,
	`${title}s area`,
	`${title} Manager`,
	`${title} workflow`,
	`${title} session`,
];

// Only upgrade readers, schema upgrade checks, and negative regression fixtures
// may name retired storage. These files cannot install the removed product.
const migrationEvidence = [
	/^src\/apps\/chat\/data\/legacy-project-migration\.ts$/,
	/^src\/previews\/migrations\/session-ownership\.ts$/,
	/^packages\/workflows\/src\/store\/schema\.ts$/,
	/^packages\/workflows\/src\/testing\/workflow-sqlite-schema\.test\.ts$/,
	/^test\/legacy-project-migration\.test\.mjs$/,
	/^test\/fixtures\/legacy-project-migration\.mjs$/,
	// Unmodified upstream native protocol vocabulary is not Pibo ownership.
	/^src\/agent-runtimes\/codex-native\/generated\/codex_app_server_protocol(\.v2)?\.schemas\.json$/,
	/^test\/preview-session-ownership-migration\.test\.mjs$/,
	/^test\/preview-store\.test\.mjs$/,
	/^test\/app-context-fresh-(schema|runtime-regression)\.test\.mjs$/,
];

test("active product code, tests and current documentation use session-native workflow ownership", () => {
	const result = scanProductVocabulary({
		root,
		roots: ["src", "packages", "scripts", "skills", "test", "docs/project", "docs/specs", "docs/plans", "GLOSSARY.md", "README.md", "DESIGN.md"],
		terms,
		allowedPaths: migrationEvidence,
	});
	const failures = result.failures.filter((match) => {
		const negativeSourceTests = ["test/workflow-v2-release-coverage.test.mjs", "test/workflow-v2-run-inspection-human-actions.test.mjs"];
		if (!["test/web-channel.test.mjs", "test/chat-ui-app-routes.test.mjs", ...negativeSourceTests].includes(match.path)) return true;
		const line = readFileSync(resolve(root, match.path), "utf8").split("\n")[match.line - 1].trim();
		if (negativeSourceTests.includes(match.path)) return !line.startsWith("assert.doesNotMatch(");
		if (match.path === "test/chat-ui-app-routes.test.mjs") return line !== `chatRouteFromLocation("/${retired}s/${retired}-a/sessions/ps_2", { view: "terminal" }),`;
		// Exact negative route/field assertions; the rest of the API suite is scanned.
		return ![
			`"/api/chat/${retired}s",`,
			`"/api/chat/${retired}s/bootstrap",`,
			`"/api/chat/${retired}s/legacy/workflow-sessions",`,
			`assert.equal("${retired}Id" in created.snapshot, false);`,
		].includes(line);
	});
	assert.deepEqual(failures, [], failures.map((match) => `${match.path}:${match.line}: ${match.term}`).join("\n"));
});

test("retired container modules are absent rather than disabled or left unreferenced", () => {
	for (const path of [
		`src/apps/chat/data/${retired}-service.ts`,
		`src/apps/chat/types/${retired}s.ts`,
		`src/apps/chat/${retired}-workflow-sessions.ts`,
		`src/apps/chat/${retired}-workflow-human-actions.ts`,
		`src/apps/chat-ui/src/${retired}s`,
	]) {
		assert.equal(existsSync(resolve(root, path)), false, path);
	}
});
