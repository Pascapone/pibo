#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isSafeSingleLineString, parseFrontmatter } from "./okf-core.mjs";
import { readRepositoryRegularFile } from "./repository-path-safety.mjs";

const ALLOWED_STATES = new Set(["pending", "conformant", "reserved", "host-exception"]);

function normalizePath(path) {
	return path.split(sep).join("/").replace(/^\.\//, "");
}

function isNormalizedRepositoryPath(path) {
	return typeof path === "string"
		&& path.length > 0
		&& !path.startsWith("/")
		&& !path.includes("\\")
		&& path.split("/").every((segment) => segment && segment !== "." && segment !== "..")
		&& normalizePath(path) === path;
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function titleCase(value) {
	return value
		.split(/[/-]+/)
		.filter(Boolean)
		.map((part, index) => index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
		.join(" ");
}

const PLAIN_TEXT_ENTITIES = new Map([
	["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"],
	["\\", "&#92;"], ["`", "&#96;"], ["*", "&#42;"], ["_", "&#95;"],
	["{", "&#123;"], ["}", "&#125;"], ["[", "&#91;"], ["]", "&#93;"],
	["(", "&#40;"], [")", "&#41;"], ["#", "&#35;"], ["+", "&#43;"],
	["-", "&#45;"], [".", "&#46;"], ["!", "&#33;"], ["|", "&#124;"], ["~", "&#126;"],
]);

function renderPlainText(value) {
	return [...value].map((character) => PLAIN_TEXT_ENTITIES.get(character) ?? character).join("");
}

function safeConceptMetadata(data, path, record) {
	if (!isSafeSingleLineString(data?.type)) throw new Error(`Unsafe index type metadata: ${path}`);
	if (!isSafeSingleLineString(data?.title)) throw new Error(`Unsafe index title metadata: ${path}`);
	if (!isSafeSingleLineString(data?.description)) throw new Error(`Unsafe index description metadata: ${path}`);
	if (!Array.isArray(data?.tags) || data.tags.length === 0 || data.tags.some((tag) => !isSafeSingleLineString(tag))) throw new Error(`Unsafe index tag metadata: ${path}`);
	if (record?.type !== data.type) throw new Error(`Concept type does not match its conformant ledger record: ${path}`);
	return {
		title: data.title,
		description: data.description,
	};
}

function lstatIfPresent(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

function isInside(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function assertDirectoryChain({ docsRoot, realDocsRoot, directory, label }) {
	if (!isInside(docsRoot, directory)) throw new Error(`${label} escapes docs root.`);
	const segments = relative(docsRoot, directory).split(sep).filter(Boolean);
	let current = docsRoot;
	for (const segment of segments) {
		current = join(current, segment);
		const stat = lstatIfPresent(current);
		if (!stat) throw new Error(`${label} parent does not exist: ${normalizePath(relative(docsRoot, current))}`);
		if (stat.isSymbolicLink()) throw new Error(`${label} parent must not be a symlink: ${normalizePath(relative(docsRoot, current))}`);
		if (!stat.isDirectory()) throw new Error(`${label} parent must be a directory: ${normalizePath(relative(docsRoot, current))}`);
		if (!isInside(realDocsRoot, realpathSync(current))) throw new Error(`${label} parent resolves outside docs root: ${normalizePath(relative(docsRoot, current))}`);
	}
}

function assertManagedIndexTarget({ absolute, path, docsRoot, realDocsRoot }) {
	if (!isInside(docsRoot, absolute)) throw new Error(`Managed index escapes docs root: ${path}`);
	assertDirectoryChain({ docsRoot, realDocsRoot, directory: dirname(absolute), label: `Managed index ${path}` });
	const stat = lstatIfPresent(absolute);
	if (!stat) return;
	if (stat.isSymbolicLink()) throw new Error(`Managed index must not be a symlink: ${path}`);
	if (!stat.isFile()) throw new Error(`Managed index must be a regular file: ${path}`);
	if (!isInside(realDocsRoot, realpathSync(absolute))) throw new Error(`Managed index resolves outside docs root: ${path}`);
}

function assertConceptFile({ absolute, path, docsRoot, realDocsRoot }) {
	if (!isInside(docsRoot, absolute)) throw new Error(`Index concept escapes docs root: ${path}`);
	assertDirectoryChain({ docsRoot, realDocsRoot, directory: dirname(absolute), label: `Index concept ${path}` });
	const stat = lstatIfPresent(absolute);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Index concept must be a regular file: ${path}`);
	if (!isInside(realDocsRoot, realpathSync(absolute))) throw new Error(`Index concept resolves outside docs root: ${path}`);
}

function readLedgerRecords({ projectRoot, ledgerRepositoryPath, controlReadHooks }) {
	const ledgerBytes = readRepositoryRegularFile({ projectRoot, repositoryPath: ledgerRepositoryPath, codePrefix: "MIGRATION_LEDGER_PATH", hooks: controlReadHooks });
	const ledger = JSON.parse(ledgerBytes.toString("utf8"));
	if (!Array.isArray(ledger.records)) throw new Error("Migration ledger has no records array.");
	const recordsByPath = new Map();
	for (const record of ledger.records) {
		if (!isNormalizedRepositoryPath(record?.path)) throw new Error(`Migration ledger has an invalid path: ${String(record?.path)}`);
		if (recordsByPath.has(record.path)) throw new Error(`Migration ledger owns a path more than once: ${record.path}`);
		if (!ALLOWED_STATES.has(record.state)) throw new Error(`Migration ledger has an invalid state at ${record.path}: ${String(record.state)}`);
		recordsByPath.set(record.path, record);
	}
	return recordsByPath;
}

function readConformantConcept({ absolute, path, record, docsRoot, realDocsRoot }) {
	assertConceptFile({ absolute, path, docsRoot, realDocsRoot });
	const parsed = parseFrontmatter(readFileSync(absolute, "utf8"));
	if (parsed.error) throw new Error(`Index concept frontmatter is invalid at ${path}: ${parsed.error}`);
	if (!parsed.data) throw new Error(`Index concept is missing frontmatter: ${path}`);
	return safeConceptMetadata(parsed.data, path, record);
}

function walkBundleMarkdown({ directory, projectRoot, realDocsRoot, markdownPaths = [] }) {
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
		const absolute = join(directory, entry.name);
		const path = normalizePath(relative(projectRoot, absolute));
		const stat = lstatIfPresent(absolute);
		if (!stat) throw new Error(`Bundle path disappeared during index preflight: ${path}`);
		if (stat.isSymbolicLink()) throw new Error(`Bundle path must not be a symlink: ${path}`);
		if (!isInside(realDocsRoot, realpathSync(absolute))) throw new Error(`Bundle path resolves outside docs root: ${path}`);
		if (entry.name.toLowerCase().endsWith(".md")) {
			if (!stat.isFile()) throw new Error(`Bundle Markdown path must be a regular file: ${path}`);
			markdownPaths.push(path);
			continue;
		}
		if (stat.isDirectory()) walkBundleMarkdown({ directory: absolute, projectRoot, realDocsRoot, markdownPaths });
	}
	return markdownPaths;
}

function preflightBundle({ projectRoot, docsRoot, realDocsRoot, ledgerPath, controlReadHooks }) {
	const ledgerRepositoryPath = normalizePath(relative(projectRoot, ledgerPath));
	const recordsByPath = readLedgerRecords({ projectRoot, ledgerRepositoryPath, controlReadHooks });
	const markdownPaths = walkBundleMarkdown({ directory: docsRoot, projectRoot, realDocsRoot });
	const markdownSet = new Set(markdownPaths);
	for (const path of markdownPaths) if (!recordsByPath.has(path)) throw new Error(`Bundle Markdown path has no migration ledger ownership: ${path}`);
	const docsRecords = [...recordsByPath.values()].filter((record) => record.path === "docs/index.md" || record.path.startsWith("docs/"));
	for (const record of docsRecords) {
		if (!markdownSet.has(record.path)) throw new Error(`Bundle ledger path does not exist as Markdown: ${record.path}`);
		const reservedName = ["index.md", "log.md"].includes(basename(record.path));
		if (reservedName && record.state !== "reserved") throw new Error(`Reserved Markdown path must stay reserved: ${record.path}`);
		if (record.state === "reserved" && !reservedName) throw new Error(`Reserved ledger state requires index.md or log.md: ${record.path}`);
		if (record.state === "host-exception") throw new Error(`Host-exception state is invalid inside docs: ${record.path}`);
		if (record.state === "pending" && reservedName) throw new Error(`Only ordinary Markdown may be pending: ${record.path}`);
		if (record.state === "conformant" && reservedName) throw new Error(`A conformant concept cannot use a reserved filename: ${record.path}`);
	}
	const conceptMetadata = new Map();
	for (const record of docsRecords) if (record.state === "conformant") {
		const metadata = readConformantConcept({ absolute: resolve(projectRoot, record.path), path: record.path, record, docsRoot, realDocsRoot });
		conceptMetadata.set(record.path, metadata);
	}
	for (const record of docsRecords) if (record.state === "conformant") {
		let directory = dirname(record.path);
		while (directory === "docs" || directory.startsWith("docs/")) {
			const indexPath = normalizePath(join(directory, "index.md"));
			const indexRecord = recordsByPath.get(indexPath);
			if (!indexRecord || indexRecord.state !== "reserved") {
				throw new Error(`PIBO_INDEX_MISSING: conformant concept ${record.path} lacks reserved ancestor index ${indexPath}.`);
			}
			if (directory === "docs") break;
			directory = dirname(directory);
		}
	}
	const managedIndexes = docsRecords
		.filter((record) => record.state === "reserved" && basename(record.path) === "index.md")
		.map((record) => record.path)
		.sort(compareText);
	const navigationRecords = docsRecords
		.filter((record) => Number.isInteger(record.navigation?.root_order))
		.sort((left, right) => left.navigation.root_order - right.navigation.root_order || compareText(left.path, right.path));
	if (navigationRecords.some((record) => record.state !== "conformant")) throw new Error("Every root navigation target must be conformant.");
	if (new Set(navigationRecords.map((record) => record.navigation.root_order)).size !== navigationRecords.length) throw new Error("Root navigation orders must be unique.");
	return { managedIndexes, navigationRecords, conceptMetadata };
}

function directConcepts({ directory, projectRoot, conceptMetadata }) {
	const concepts = [];
	for (const [path, metadata] of conceptMetadata) {
		if (dirname(resolve(projectRoot, path)) !== directory) continue;
		concepts.push({ path: basename(path), title: metadata.title, description: metadata.description });
	}
	return concepts.sort((left, right) => compareText(left.title, right.title) || compareText(left.path, right.path));
}

function renderIndex({ indexPath, projectRoot, docsRoot, managedIndexes, rootNavigation, conceptMetadata }) {
	const directory = dirname(indexPath);
	const relativeDirectory = normalizePath(relative(docsRoot, directory));
	const root = directory === docsRoot;
	const heading = root ? "Pibo documentation" : titleCase(relativeDirectory);
	const childDirectories = managedIndexes
		.map((path) => dirname(resolve(projectRoot, path)))
		.filter((child) => dirname(child) === directory)
		.map((child) => basename(child))
		.sort(compareText);
	const concepts = directConcepts({ directory, projectRoot, conceptMetadata });
	const lines = [];
	if (root) lines.push("---", 'okf_version: "0.2"', "---", "");
	lines.push(`# ${heading}`, "", "<!-- Generated by npm run docs:indexes:write. -->");
	if (rootNavigation.length > 0 && root) {
		lines.push("", "## Start here", "");
		for (const entry of rootNavigation) {
			const description = entry.description ? ` - ${renderPlainText(entry.description)}` : "";
			lines.push(`* [${renderPlainText(entry.title)}](${entry.path})${description}`);
		}
	}
	if (concepts.length > 0) {
		lines.push("", "## Concepts", "");
		for (const concept of concepts) {
			const description = concept.description ? ` - ${renderPlainText(concept.description)}` : "";
			lines.push(`* [${renderPlainText(concept.title)}](${concept.path})${description}`);
		}
	}
	if (childDirectories.length > 0) {
		lines.push("", "## Directories", "");
		for (const child of childDirectories) lines.push(`* [${renderPlainText(titleCase(child))}](${child}/) - Documentation under \`${renderPlainText(child)}/\`.`);
	}
	return `${lines.join("\n")}\n`;
}

export function synchronizeIndexes(options = {}) {
	const projectRoot = resolve(options.projectRoot ?? ".");
	const docsRoot = resolve(projectRoot, options.docsRoot ?? "docs");
	const ledgerPath = resolve(projectRoot, options.ledgerPath ?? "docs/project/okf-migration-ledger.json");
	const check = options.check === true;
	const docsStat = lstatIfPresent(docsRoot);
	if (!docsStat || docsStat.isSymbolicLink() || !docsStat.isDirectory()) throw new Error("Docs root must be a real directory, not a symlink.");
	const realDocsRoot = realpathSync(docsRoot);
	const { managedIndexes, navigationRecords, conceptMetadata } = preflightBundle({ projectRoot, docsRoot, realDocsRoot, ledgerPath, controlReadHooks: options.controlReadHooks?.ledger });
	const rootNavigation = navigationRecords.map((record) => {
		const metadata = conceptMetadata.get(record.path);
		if (!metadata) throw new Error(`Root navigation target lacks preflighted concept metadata: ${record.path}`);
		return {
			order: record.navigation.root_order,
			path: record.path.replace(/^docs\//, ""),
			title: metadata.title,
			description: metadata.description,
		};
	});
	const rendered = managedIndexes.map((path) => {
		const absolute = resolve(projectRoot, path);
		assertManagedIndexTarget({ absolute, path, docsRoot, realDocsRoot });
		const expected = renderIndex({ indexPath: absolute, projectRoot, docsRoot, managedIndexes, rootNavigation, conceptMetadata });
		const current = lstatIfPresent(absolute) ? readFileSync(absolute, "utf8") : null;
		return { path, absolute, expected, changed: current !== expected, missing: current == null };
	});
	if (!check) for (const entry of rendered) if (entry.changed) {
		assertManagedIndexTarget({ absolute: entry.absolute, path: entry.path, docsRoot, realDocsRoot });
		writeFileSync(entry.absolute, entry.expected);
	}
	const results = rendered.map(({ path, changed, missing }) => ({ path, changed, missing }));
	return { ok: !check || results.every((result) => !result.changed), check, results };
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--check") options.check = true;
		else if (arg === "--root") options.projectRoot = argv[++index];
		else if (arg === "--docs") options.docsRoot = argv[++index];
		else if (arg === "--ledger") options.ledgerPath = argv[++index];
		else if (arg === "--json") options.json = true;
		else if (arg === "--help") options.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

export function runCli(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.help) {
		console.log("Usage: node scripts/generate-okf-indexes.mjs [--check] [--root .] [--docs docs] [--ledger path] [--json]");
		return 0;
	}
	const result = synchronizeIndexes(options);
	if (options.json) console.log(JSON.stringify(result, null, 2));
	else {
		const changed = result.results.filter((entry) => entry.changed);
		console.log(`OKF index ${result.check ? "check" : "generation"}: ${result.ok ? "PASS" : "FAIL"}`);
		console.log(`Managed indexes: ${result.results.length}; drift: ${changed.length}`);
		for (const entry of changed) console.log(`  ${entry.missing ? "missing" : "stale"}: ${entry.path}`);
	}
	return result.ok ? 0 : 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = runCli();
