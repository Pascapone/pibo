#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter, validateLogContent } from "./okf-core.mjs";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
	if (!ISO_DATE_RE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validatePiboLogContent(content) {
	const body = parseFrontmatter(content).body;
	const headings = [...body.matchAll(/^##\s+(.+)$/gm)];
	const dated = headings.filter((match) => validDate(match[1].trim()));
	const issues = [];
	if (dated.length === 0) {
		issues.push({ code: "PIBO_LOG_SECTION_MISSING", message: "The Pibo log requires at least one valid YYYY-MM-DD section." });
		return issues;
	}
	for (const heading of dated) {
		const next = headings.find((candidate) => candidate.index > heading.index);
		const start = heading.index + heading[0].length;
		const section = body.slice(start, next?.index ?? body.length).replace(/<!--[\s\S]*?-->/g, "").trim();
		if (!section) issues.push({ code: "PIBO_LOG_ENTRY_MISSING", message: `Log section has no entry content: ${heading[1].trim()}` });
	}
	return issues;
}

export function checkLog(options = {}) {
	const projectRoot = resolve(options.projectRoot ?? ".");
	const logPath = resolve(projectRoot, options.logPath ?? "docs/log.md");
	if (!existsSync(logPath)) return { path: logPath, issues: [{ code: "PIBO_LOG_MISSING", message: "The Pibo profile requires docs/log.md.", layer: "pibo-profile" }] };
	const content = readFileSync(logPath, "utf8");
	return {
		path: logPath,
		issues: [
			...validateLogContent(content).map((issue) => ({ ...issue, layer: "okf-core" })),
			...validatePiboLogContent(content).map((issue) => ({ ...issue, layer: "pibo-profile" })),
		],
	};
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--root") options.projectRoot = argv[++index];
		else if (arg === "--log") options.logPath = argv[++index];
		else if (arg === "--json") options.json = true;
		else if (arg === "--help") options.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

export function runCli(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.help) {
		console.log("Usage: node scripts/check-okf-log.mjs [--root .] [--log docs/log.md] [--json]");
		console.log("Log writes stay explicit because entries are semantic change prose; this command checks reserved structure and the Pibo dated-entry minimum.");
		return 0;
	}
	const result = checkLog(options);
	if (options.json) console.log(JSON.stringify(result, null, 2));
	else {
		console.log(`OKF log check: ${result.issues.length === 0 ? "PASS" : "FAIL"}`);
		for (const issue of result.issues) console.error(`ERROR [${issue.layer}:${issue.code}] ${issue.message}`);
	}
	return result.issues.length === 0 ? 0 : 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = runCli();
