import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/apps/chat-ui", "src/ralph", "src/cron", "src/data", "src/cli.ts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredTitle = `${retiredWord[0].toUpperCase()}${retiredWord.slice(1)}`;
const literalPattern = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
const USER_FACING_PATTERNS = [
	literalPattern(["Personal", "Chat"].join(" ")),
	literalPattern(["personal", "target"].join(" ")),
	literalPattern(`${retiredTitle}/principal`),
	literalPattern(`${retiredTitle} scope`),
	literalPattern(`${retiredWord}-scope`),
	literalPattern(`selected ${retiredWord}`),
	literalPattern(`selected-${retiredWord}`),
	literalPattern(`effective ${retiredWord}`),
	literalPattern(`${retiredWord} → room`),
	literalPattern(`${retiredWord}=`),
	literalPattern(`${retiredWord}ed resources`),
];

function walk(path) {
	const stat = statSync(path);
	if (stat.isFile()) return [path];
	return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

function isSourceFile(path) {
	return [...EXTENSIONS].some((extension) => path.endsWith(extension));
}

test("app-context user-facing artifact search gate rejects retired partition copy", () => {
	const files = ROOTS.flatMap((root) => walk(root)).filter(isSourceFile);
	const failures = [];
	for (const file of files) {
		const path = relative(process.cwd(), file);
		const text = readFileSync(file, "utf8");
		for (const pattern of USER_FACING_PATTERNS) {
			pattern.lastIndex = 0;
			for (let match; (match = pattern.exec(text)); ) {
				const line = text.slice(0, match.index).split("\n").length;
				failures.push(`${path}:${line}: ${match[0]}`);
			}
		}
	}
	assert.deepEqual(failures, []);
});
