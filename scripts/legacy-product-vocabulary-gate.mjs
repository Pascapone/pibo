#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ROOTS = ["src", "packages", "scripts", "skills", "test", "docs/project", "docs/specs", "docs/plans"];
const DEFAULT_EXTENSIONS = new Set([
	".cjs",
	".css",
	".html",
	".js",
	".json",
	".jsx",
	".md",
	".mjs",
	".mts",
	".sql",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);
const SKIP_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules", ".pibo"]);

const TERM_PARTS = [
	["owner", "Scope"],
	["owner", "_", "scope"],
	["Owner", "Scope"],
	["owner", " ", "scope"],
	["owner", "-", "scope"],
	["get", "Shared", "App", "Legacy", "Owner", "Scope"],
	["LEGACY", "_", "SHARED", "_", "APP", "_", "OWNER", "_", "SCOPE"],
	["shared", ":", "app"],
	["PIBO", "_", "OWNER", "_", "SCOPE"],
	["principal", "Id"],
	["principal", "_", "id"],
	["room", "_", "members"],
	["list", "Owned"],
	["get", "Owned"],
	["require", "Owned"],
	["Owned", "Session"],
	["Owned", "Project"],
	["active", " ", "owner"],
	["current", " ", "owner"],
	["list", "Owners"],
	["set", "Active", "Owner"],
	["get", "Active", "Owner"],
	["Owner", "Summary"],
	["owner", "Summaries"],
	["personal", " ", "target"],
	["Personal", " ", "Chat"],
	["Personal", " ", "Project"],
	["personal", " ", "room"],
	["web", "-", "user"],
	["auth", " ", "user", " ", "id"],
	["auth", "User", "Id"],
];

const FINAL_ALLOWED_PATHS = [
	/^docs\/legacy\//,
	/^src\/data\/final-app-space-cutover-migration\.ts$/,
	/^src\/data\/final-app-space-cutover-migration\//,
];

export const DEFAULT_TERMS = TERM_PARTS.map((parts) => parts.join(""));

function normalizePath(path) {
	return path.split(sep).join("/");
}

function normalizeRoot(path) {
	return normalizePath(path).replace(/^\.\//, "").replace(/\/$/, "");
}

function collectFiles(rootPath, extensions = DEFAULT_EXTENSIONS) {
	if (!existsSync(rootPath)) return [];
	const stat = statSync(rootPath);
	if (stat.isFile()) return extensions.has(extname(rootPath)) ? [rootPath] : [];
	if (!stat.isDirectory()) return [];
	return readdirSync(rootPath).flatMap((entry) => {
		if (SKIP_DIRECTORY_NAMES.has(entry)) return [];
		return collectFiles(join(rootPath, entry), extensions);
	});
}

function lineAndColumn(text, index) {
	const prefix = text.slice(0, index);
	const line = prefix.split("\n").length;
	const lastBreak = prefix.lastIndexOf("\n");
	const column = index - lastBreak;
	return { line, column };
}

function findAllLiteralMatches(text, term) {
	const matches = [];
	let index = text.indexOf(term);
	while (index !== -1) {
		matches.push(index);
		index = text.indexOf(term, index + Math.max(term.length, 1));
	}
	return matches;
}

function isAllowedPath(relativePath, allowedPaths) {
	return allowedPaths.some((pattern) => pattern.test(relativePath));
}

export function scanProductVocabulary(options = {}) {
	const root = resolve(options.root ?? process.cwd());
	const roots = (options.roots ?? DEFAULT_ROOTS).map(normalizeRoot);
	const terms = options.terms ?? DEFAULT_TERMS;
	const allowedPaths = options.allowedPaths ?? FINAL_ALLOWED_PATHS;
	const files = roots.flatMap((scanRoot) => collectFiles(resolve(root, scanRoot), options.extensions));
	const failures = [];
	const allowed = [];

	for (const file of files) {
		const relativePath = normalizePath(relative(root, file));
		const text = readFileSync(file, "utf8");
		const pathAllowed = isAllowedPath(relativePath, allowedPaths);
		for (const term of terms) {
			for (const index of findAllLiteralMatches(text, term)) {
				const match = { path: relativePath, term, ...lineAndColumn(text, index) };
				if (pathAllowed) allowed.push(match);
				else failures.push(match);
			}
		}
	}

	return { failures, allowed, scannedFiles: files.length, roots, terms };
}

function parseArgs(argv) {
	const options = { roots: undefined, root: process.cwd(), json: false, listTerms: false, showAllowed: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else if (arg === "--json") {
			options.json = true;
		} else if (arg === "--list-terms") {
			options.listTerms = true;
		} else if (arg === "--show-allowed") {
			options.showAllowed = true;
		} else if (arg === "--root") {
			options.root = argv[++index];
		} else if (arg === "--roots") {
			options.roots = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function printHelp() {
	console.log(`Usage: npm run check:product-vocab -- [options]

Scans active source, tests, scripts, skills, and current docs for legacy product-partition vocabulary.

Options:
  --root <path>        Repository root. Defaults to the current working directory.
  --roots <csv>        Comma-separated scan roots. Defaults to active product roots.
  --json               Print machine-readable results.
  --list-terms         Print the generated literal term list.
  --show-allowed       Include allowed matches in text output.
  -h, --help           Show this help.

Allowlist policy:
  Only docs/legacy and the isolated final app-space cutover migration path are allowed.
  After approved cutover, shrink FINAL_ALLOWED_PATHS in this script to an empty list.
`);
}

function formatMatches(label, matches) {
	if (matches.length === 0) return [];
	return [label, ...matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.term}`)];
}

export function runCli(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.help) {
		printHelp();
		return 0;
	}
	if (options.listTerms) {
		console.log(DEFAULT_TERMS.join("\n"));
		return 0;
	}

	const result = scanProductVocabulary(options);
	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Scanned ${result.scannedFiles} files across ${result.roots.join(", ")}`);
		for (const line of formatMatches("Failures:", result.failures)) console.log(line);
		if (options.showAllowed) {
			for (const line of formatMatches("Allowed:", result.allowed)) console.log(line);
		}
		if (result.failures.length === 0) {
			console.log("No disallowed legacy product-partition vocabulary found.");
		}
	}
	return result.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = runCli();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 2;
	}
}
