import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/apps/chat-ui", "src/ralph", "src/cron", "src/data", "src/cli.ts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const USER_FACING_PATTERNS = [
	/Personal Chat/g,
	/personal target/g,
	/Owner\/principal/g,
	/Owner scope/g,
	/owner-scope/g,
	/selected owner/g,
	/selected-owner/g,
	/effective owner/g,
	/owner → room/g,
	/owner=/g,
	/owned resources/g,
];

const ALLOWLIST = [
	{ path: "src/cli.ts", pattern: /owner-scope/g, reason: "deprecated CLI compatibility flag, help says shared-app mode ignores ownership" },
	{ path: "src/apps/cli-ui/cliSessionsCommand.ts", pattern: /owner-scope/g, reason: "deprecated CLI compatibility flag, help says shared-app mode ignores ownership" },
	{ path: "src/apps/cli-ui/cliSessionsCommand.ts", pattern: /Personal Chat/g, reason: "debug fixture parser accepts historical room titles as legacy compatibility" },
	{ path: "src/data/cli.ts", pattern: /owner-scope/g, reason: "legacy unread-baseline repair option only, not a normal current workflow selector" },
	{ path: "src/cli-session/localSessionSource.ts", pattern: /Personal Chat/g, reason: "legacy fallback recognizes historical default room titles while displaying Shared Chat for new fallback rows" },
	{ path: "src/cron/cli.ts", pattern: /owner-scope/g, reason: "deprecated compatibility flag; CLI warns and ignores it" },
	{ path: "src/data/shared-app-migration.ts", pattern: /owner-scope/g, reason: "explicit migration action labels for legacy storage metadata" },
	{ path: "src/data/shared-app-migration.ts", pattern: /personal target/g, reason: "explicit migration warning for legacy Ralph/Cron target metadata" },
];

function walk(path) {
	const stat = statSync(path);
	if (stat.isFile()) return [path];
	return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function isSourceFile(path) {
	return [...EXTENSIONS].some((extension) => path.endsWith(extension));
}

function isAllowed(path, text, index) {
	return ALLOWLIST.some((entry) => {
		if (entry.path !== path || !entry.reason) return false;
		entry.pattern.lastIndex = 0;
		const lineStart = text.lastIndexOf("\n", index) + 1;
		const lineEnd = text.indexOf("\n", index);
		const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
		return entry.pattern.test(line);
	});
}

test("shared-app user-facing artifact search gate allows only documented legacy/debug copy", () => {
	const files = ROOTS.flatMap((root) => walk(root)).filter(isSourceFile);
	const failures = [];
	for (const file of files) {
		const path = relative(process.cwd(), file);
		const text = readFileSync(file, "utf8");
		for (const pattern of USER_FACING_PATTERNS) {
			pattern.lastIndex = 0;
			for (let match; (match = pattern.exec(text)); ) {
				if (isAllowed(path, text, match.index)) continue;
				const line = text.slice(0, match.index).split("\n").length;
				failures.push(`${path}:${line}: ${match[0]}`);
			}
		}
	}
	assert.deepEqual(failures, []);
});
