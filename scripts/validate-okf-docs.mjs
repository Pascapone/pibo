#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validatePiboLogContent } from "./check-okf-log.mjs";
import {
	parseFrontmatter,
	isSafeSingleLineString,
	validateCoreConceptContent,
	validateIndexContent,
	validateLogContent,
} from "./okf-core.mjs";
import { readRepositoryRegularFile, RepositoryPathError } from "./repository-path-safety.mjs";

const ALLOWED_AUTHORITIES = new Set([
	"normative",
	"directive",
	"supporting",
	"source",
	"evidentiary",
	"informative",
	"historical",
]);
const ALLOWED_STATUSES = new Set(["draft", "stable", "deprecated"]);
const ALLOWED_STATES = new Set(["pending", "conformant", "reserved", "host-exception"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const TAXONOMY = {
	project: {
		types: new Set(["Documentation Profile", "Architecture", "Design System", "Decision Record", "Guide", "Runbook", "Reference", "Status"]),
		authorities: new Set(["normative", "directive", "supporting", "source", "informative"]),
	},
	specs: { types: new Set(["Specification"]), authorities: new Set(["normative"]) },
	plans: {
		types: new Set(["Plan", "Change Proposal", "Technical Design", "Product Requirement", "Task Ledger"]),
		authorities: new Set(["directive", "supporting"]),
	},
	reports: {
		types: new Set(["Evidence Report", "Validation Report", "Investigation Report", "Incident Report", "Coverage Report", "Review Record", "Release Record", "Research", "Feedback", "Reference", "Status"]),
		authorities: new Set(["evidentiary", "informative", "source"]),
	},
	legacy: { types: new Set(["Historical Record"]), authorities: new Set(["historical"]) },
};
const TYPE_AUTHORITIES = {
	"Documentation Profile": new Set(["normative"]),
	Architecture: new Set(["normative", "supporting", "informative"]),
	"Design System": new Set(["normative", "supporting"]),
	Specification: new Set(["normative"]),
	Plan: new Set(["directive"]),
	"Change Proposal": new Set(["supporting"]),
	"Technical Design": new Set(["supporting"]),
	"Product Requirement": new Set(["directive"]),
	"Task Ledger": new Set(["directive"]),
	"Decision Record": new Set(["supporting"]),
	Guide: new Set(["directive"]),
	Runbook: new Set(["directive"]),
	Research: new Set(["informative"]),
	Status: new Set(["informative"]),
	Feedback: new Set(["source"]),
	"Evidence Report": new Set(["evidentiary"]),
	"Validation Report": new Set(["evidentiary"]),
	"Investigation Report": new Set(["evidentiary", "informative"]),
	"Incident Report": new Set(["evidentiary", "informative"]),
	"Coverage Report": new Set(["evidentiary"]),
	"Review Record": new Set(["evidentiary", "informative", "source"]),
	"Release Record": new Set(["evidentiary"]),
	"Historical Record": new Set(["historical"]),
	Reference: new Set(["source", "informative"]),
};
const REQUIRED_FIELDS = ["type", "title", "description", "tags", "status", "authority", "generated"];
const FILENAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const REQUIREMENT_ID_PATTERN = "[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)+-\\d{3,}";
const REQUIREMENT_ID_RE = new RegExp(`^${REQUIREMENT_ID_PATTERN}$`);
const ACTOR_RE = /^(?:human:[^\s]+|process:[^\s]+|[^\s/]+\/[^\s/]+)$/;
const PLAN_DECISIONS = new Map([
	["docs/plans/agent-management-tool-design.md", "fold-subagents-yielded-runs-then-close"],
	["docs/plans/codex-chatgpt-image-generation-tool-implementation-plan-2026-06-30.md", "fold-native-tools-then-archive"],
	["docs/plans/local-auth-gateway-implementation-plan-2026-06-14.md", "fold-web-auth-then-archive"],
	["docs/plans/multi-agent-runtime-adapter-implementation-plan-2026-08-14.md", "fold-runtime-specs-then-archive"],
	["docs/plans/pibo-fast-gateway-and-trace-roadmap.md", "split-shipped-and-pending"],
	["docs/plans/session-turn-lifecycle-signals-plan.md", "fold-signals-routing-then-archive"],
	["docs/plans/windows-better-auth-direct-validation.md", "retain-active-draft-plan"],
]);

function normalizePath(path) {
	return path.split(sep).join("/").replace(/^\.\//, "");
}

function walkFiles(root, directory = root, ignored = new Set([".git", "node_modules", "dist"])) {
	const result = [];
	for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (ignored.has(entry.name)) continue;
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) result.push(...walkFiles(root, absolute, ignored));
		else result.push(normalizePath(relative(root, absolute)));
	}
	return result;
}

function discoverMarkdown(projectRoot) {
	const git = spawnSync("git", ["-C", projectRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		encoding: "utf8",
	});
	const deleted = spawnSync("git", ["-C", projectRoot, "ls-files", "-z", "--deleted"], { encoding: "utf8" });
	if (git.status === 0 && deleted.status === 0) {
		const deletedPaths = new Set(deleted.stdout.split("\0").filter(Boolean));
		return {
			method: "git",
			paths: [...new Set(git.stdout.split("\0")
				.filter((path) => path.toLowerCase().endsWith(".md"))
				.filter((path) => !deletedPaths.has(path)))].sort(),
		};
	}
	return {
		method: "filesystem-fallback",
		paths: walkFiles(projectRoot).filter((path) => path.toLowerCase().endsWith(".md")).sort(),
	};
}

function validateRepositoryMarkdownPath({ projectRoot, path, reporter, layer }) {
	const prefix = layer === "okf-core" ? "OKF_PATH" : "MIGRATION_PATH";
	if (typeof path !== "string" || !path || path.includes("\\") || posix.isAbsolute(path)) {
		reporter.error(`${prefix}_INVALID`, String(path), "Markdown paths must be normalized repository-relative paths.", layer);
		return false;
	}
	const segments = path.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..") || posix.normalize(path) !== path) {
		reporter.error(`${prefix}_INVALID`, path, "Markdown paths must not contain empty, dot, or traversal segments.", layer);
		return false;
	}
	const root = resolve(projectRoot);
	const absolute = resolve(root, path);
	if (!isInside(root, absolute)) {
		reporter.error(`${prefix}_ESCAPE`, path, "Markdown path escapes the repository.", layer);
		return false;
	}
	let current = root;
	try {
		for (const [index, segment] of segments.entries()) {
			current = join(current, segment);
			const stat = lstatSync(current);
			if (stat.isSymbolicLink()) {
				reporter.error(`${prefix}_SYMLINK`, path, `Markdown path contains a symbolic link at ${normalizePath(relative(root, current))}.`, layer);
				return false;
			}
			if (index < segments.length - 1 && !stat.isDirectory()) {
				reporter.error(`${prefix}_PARENT`, path, `Markdown path parent is not a directory: ${normalizePath(relative(root, current))}.`, layer);
				return false;
			}
			if (index === segments.length - 1 && !stat.isFile()) {
				reporter.error(`${prefix}_NOT_FILE`, path, "Markdown path must be a regular file.", layer);
				return false;
			}
		}
	} catch (error) {
		reporter.error(`${prefix}_MISSING`, path, `Markdown path cannot be inspected: ${error.code ?? error.message}.`, layer);
		return false;
	}
	return true;
}

function validateRepositoryMarkdownPaths({ projectRoot, paths, reporter, layer }) {
	const result = new Map();
	for (const path of paths) result.set(path, validateRepositoryMarkdownPath({ projectRoot, path, reporter, layer }));
	return result;
}

function stripCode(markdown) {
	return markdown.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "").replace(/`[^`\n]*`/g, "");
}

function markdownLinks(markdown) {
	const links = [];
	const source = stripCode(markdown);
	const re = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
	for (const match of source.matchAll(re)) links.push(match[1].replace(/^<|>$/g, ""));
	return links;
}

function isExternal(value) {
	return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("#");
}

function resolveLocalPath({ projectRoot, docsRoot, documentPath, value, bundleRelative = false }) {
	const clean = decodeURIComponent(value.split("#", 1)[0].split("?", 1)[0]);
	if (!clean || isExternal(clean)) return null;
	if (clean.startsWith("/")) return resolve(docsRoot, `.${clean}`);
	if (bundleRelative) return resolve(docsRoot, clean);
	return resolve(dirname(resolve(projectRoot, documentPath)), clean);
}

function isInside(parent, child) {
	const rel = relative(parent, child);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function isoDatetime(value) {
	if (value instanceof Date) return !Number.isNaN(value.valueOf());
	return typeof value === "string" && ISO_DATETIME_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function createReporter(mode) {
	const errors = [];
	const warnings = [];
	return {
		errors,
		warnings,
		error(code, path, message, layer) {
			const resolvedLayer = layer
				?? (code.startsWith("OKF_") ? "okf-core"
					: code.startsWith("MIGRATION_") || code === "STRICT_PENDING" ? "pibo-migration"
						: mode === "migration" ? "pibo-migration" : "pibo-profile");
			errors.push({ code, path, message, layer: resolvedLayer });
		},
		warn(code, path, message, layer = "pibo-migration") {
			warnings.push({ code, path, message, layer });
		},
	};
}

function validateReserved({ content, path, docsRoot, projectRoot, strictLinks, requirePiboVersion, requirePiboLog, reporter }) {
	const basename = posix.basename(path);
	const isRootIndex = basename === "index.md" && resolve(projectRoot, path) === join(docsRoot, "index.md");
	const issues = basename === "index.md"
		? validateIndexContent(content, { root: isRootIndex })
		: validateLogContent(content);
	for (const issue of issues) reporter.error(issue.code, path, issue.message, "okf-core");
	if (basename === "log.md" && requirePiboLog) for (const issue of validatePiboLogContent(content)) reporter.error(issue.code, path, issue.message, "pibo-profile");
	if (basename === "index.md") {
		const { data } = parseFrontmatter(content);
		if (requirePiboVersion && isRootIndex && data?.okf_version !== "0.2") {
			reporter.error("PIBO_OKF_VERSION", path, 'The bundle root must declare okf_version: "0.2".', "pibo-profile");
		}
	}
	if (strictLinks) validateLinks({ content, path, docsRoot, projectRoot, reporter });
}

function validateCoreConcept({ content, path, reporter }) {
	for (const issue of validateCoreConceptContent(content)) reporter.error(issue.code, path, issue.message, "okf-core");
}

function inspectLocalLinks({ content, path, docsRoot, projectRoot, reporter }) {
	const failures = [];
	for (const link of markdownLinks(content)) {
		let target;
		try {
			target = resolveLocalPath({ projectRoot, docsRoot, documentPath: path, value: link });
		} catch {
			reporter.error("PIBO_LINK_ENCODING", path, `Link has invalid encoding: ${link}`);
			continue;
		}
		if (!target) continue;
		if (!isInside(docsRoot, target)) {
			failures.push({ code: "PIBO_LINK_ESCAPE", target: link, message: `Internal link escapes the bundle: ${link}` });
			continue;
		}
		if (!existsSync(target)) failures.push({ code: "PIBO_LINK_MISSING", target: link, message: `Internal link target does not exist: ${link}` });
	}
	return failures;

}

function validatePreservedBodyLinks({ data, body, failures, path, reporter }) {
	const preserved = data.preserved_body;
	if (preserved === undefined) {
		for (const failure of failures) reporter.error(failure.code, path, failure.message);
		return;
	}
	let valid = true;
	if (!preserved || typeof preserved !== "object" || Array.isArray(preserved)) {
		reporter.error("PIBO_PRESERVED_BODY", path, "preserved_body must be a mapping.");
		valid = false;
	} else if (Object.keys(preserved).some((key) => !["source_path", "source_sha256", "unresolved_links"].includes(key))) {
		reporter.error("PIBO_PRESERVED_BODY_FIELD", path, "preserved_body contains an unsupported field.");
		valid = false;
	}
	if (data.status !== "deprecated" || !["historical", "evidentiary"].includes(data.authority)) {
		reporter.error("PIBO_PRESERVED_BODY_ELIGIBILITY", path, "Only deprecated historical or evidentiary concepts may declare preserved_body.");
		valid = false;
	}
	const sourcePath = preserved?.source_path;
	if (typeof sourcePath !== "string" || sourcePath !== sourcePath.trim() || !sourcePath || !sourcePath.endsWith(".md") || sourcePath.startsWith("/") || sourcePath.startsWith("./") || sourcePath.split("/").includes("..") || /[*?{}[\]]/.test(sourcePath)) {
		reporter.error("PIBO_PRESERVED_SOURCE_PATH", path, "preserved_body.source_path must be an exact non-empty repository-relative Markdown path.");
		valid = false;
	}
	if (!SHA256_RE.test(preserved?.source_sha256 ?? "")) {
		reporter.error("PIBO_PRESERVED_SOURCE_HASH", path, "preserved_body.source_sha256 must be a lowercase 64-hex SHA-256.");
		valid = false;
	} else {
		const currentHash = createHash("sha256").update(body).digest("hex");
		if (currentHash !== preserved.source_sha256) {
			reporter.error("PIBO_PRESERVED_BODY_HASH", path, `Preserved body SHA-256 changed: expected ${preserved.source_sha256}, found ${currentHash}.`);
			valid = false;
		}
	}
	const declared = new Map();
	if (!Array.isArray(preserved?.unresolved_links) || preserved.unresolved_links.length === 0) {
		reporter.error("PIBO_PRESERVED_LINKS", path, "preserved_body.unresolved_links must be a non-empty list.");
		valid = false;
	} else {
		for (const entry of preserved.unresolved_links) {
			const target = entry?.target;
			if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !["target", "reason"].includes(key))) {
				reporter.error("PIBO_PRESERVED_LINK_FIELD", path, "Each preserved unresolved link may contain only target and reason.");
				valid = false;
			}
			let decodedTarget = null;
			try {
				decodedTarget = typeof target === "string" ? decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]) : null;
			} catch {
				// Invalid encoding is reported by normal link validation and is never suppressible.
			}
			const targetSegments = decodedTarget?.replace(/^\//, "").split("/") ?? [];
			if (typeof target !== "string" || target !== target.trim() || !target || decodedTarget == null || isExternal(target) || isExternal(decodedTarget) || /[*?{}[\]]/.test(decodedTarget) || decodedTarget.endsWith("/") || targetSegments.some((segment) => segment === "." || segment === "..")) {
				reporter.error("PIBO_PRESERVED_LINK_TARGET", path, `Preserved unresolved-link target must name one exact local file: ${String(target)}`);
				valid = false;
				continue;
			}
			if (typeof entry.reason !== "string" || !entry.reason.trim()) {
				reporter.error("PIBO_PRESERVED_LINK_REASON", path, `Preserved unresolved-link target needs a reason: ${target}`);
				valid = false;
			}
			if (declared.has(target)) {
				reporter.error("PIBO_PRESERVED_LINK_DUPLICATE", path, `Preserved unresolved-link target is duplicated: ${target}`);
				valid = false;
			} else declared.set(target, entry);
		}
	}
	const failedTargets = new Set(failures.map((failure) => failure.target));
	for (const target of declared.keys()) {
		if (!failedTargets.has(target)) reporter.error("PIBO_PRESERVED_LINK_UNUSED", path, `Declared preserved link is not currently unresolved: ${target}`);
	}
	for (const failure of failures) {
		if (!valid || failure.code !== "PIBO_LINK_MISSING" || !declared.has(failure.target)) reporter.error(failure.code, path, failure.message);
	}
}

function validateLinks({ content, path, docsRoot, projectRoot, reporter, data, body }) {
	const failures = inspectLocalLinks({ content, path, docsRoot, projectRoot, reporter });
	if (data) validatePreservedBodyLinks({ data, body, failures, path, reporter });
	else for (const failure of failures) reporter.error(failure.code, path, failure.message);
}

function validateSourceResource({ resource, path, docsRoot, projectRoot, reporter }) {
	if (typeof resource !== "string" || !resource.trim()) {
		reporter.error("PIBO_SOURCE_RESOURCE", path, "Each sources entry requires a non-empty resource.");
		return;
	}
	if (resource.startsWith("scope:") || isExternal(resource)) return;
	const target = resolveLocalPath({ projectRoot, docsRoot, documentPath: path, value: resource });
	if (target && !existsSync(target)) reporter.error("PIBO_SOURCE_PATH", path, `Declared source path does not exist: ${resource}`);
}

function gitCommitExists(projectRoot, commit) {
	const result = spawnSync("git", ["-C", projectRoot, "cat-file", "-e", `${commit}^{commit}`], { encoding: "utf8" });
	return result.status === 0;
}

function deriveLedgerTrustAnchor(projectRoot, ledgerRepositoryPath) {
	const shallow = spawnSync("git", ["-C", projectRoot, "rev-parse", "--is-shallow-repository"], { encoding: "utf8" });
	if (shallow.status !== 0 || shallow.stdout.trim() !== "false") return { error: "Ledger introduction requires a complete, non-shallow reachable history." };
	const history = spawnSync("git", ["-C", projectRoot, "rev-list", "--parents", "HEAD"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (history.status !== 0) return { error: `Cannot enumerate complete reachable history: ${history.stderr.trim() || `git exited ${history.status}`}.` };
	const graph = new Map();
	for (const line of history.stdout.trim().split(/\r?\n/).filter(Boolean)) {
		const [commit, ...parents] = line.split(/\s+/);
		if (!GIT_SHA_RE.test(commit ?? "") || parents.some((parent) => !GIT_SHA_RE.test(parent))) return { error: "Complete reachable history contains an invalid commit identity." };
		graph.set(commit, parents);
	}
	if (graph.size === 0) return { error: "Complete reachable history contains no commits." };
	for (const parents of graph.values()) for (const parent of parents) {
		if (!graph.has(parent)) return { error: `Complete reachable history cannot resolve parent commit ${parent}.` };
	}
	const commits = [...graph.keys()];
	const objects = spawnSync("git", ["-C", projectRoot, "cat-file", "--batch-check=%(objecttype)"], {
		encoding: "utf8",
		input: `${commits.map((commit) => `${commit}:${ledgerRepositoryPath}`).join("\n")}\n`,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (objects.status !== 0) return { error: `Cannot inspect ledger objects across complete history: ${objects.stderr.trim() || `git exited ${objects.status}`}.` };
	const objectTypes = objects.stdout.trim().split(/\r?\n/);
	if (objectTypes.length !== commits.length) return { error: "Ledger object enumeration returned an incomplete result." };
	const typesByCommit = new Map(commits.map((commit, index) => [commit, objectTypes[index] === "blob" ? "blob" : objectTypes[index].endsWith(" missing") ? "missing" : objectTypes[index]]));
	const introductions = commits.filter((commit) => typesByCommit.get(commit) === "blob"
		&& graph.get(commit).every((parent) => typesByCommit.get(parent) === "missing"));
	introductions.sort();
	if (introductions.length !== 1) return { error: `Expected exactly one ledger introduction in complete reachable history, found ${introductions.length}${introductions.length ? `: ${introductions.join(", ")}` : ""}.` };
	const introduction = introductions[0];
	if (!gitFileAtCommit(projectRoot, introduction, ledgerRepositoryPath)) return { error: `Ledger introduction is not a regular Git blob at ${introduction}.` };
	const parents = graph.get(introduction);
	if (parents.length !== 1) {
		return { error: `Ledger introduction commit ${introduction} must have exactly one resolvable parent.` };
	}
	return { introduction, anchor: parents[0] };
}

function readRepositoryControlFile({ projectRoot, repositoryPath, reporter, codePrefix, hooks }) {
	try {
		return readRepositoryRegularFile({ projectRoot, repositoryPath, codePrefix, hooks });
	} catch (error) {
		if (error instanceof RepositoryPathError) reporter.error(error.code, repositoryPath, error.detail);
		else reporter.error(`${codePrefix}_READ`, repositoryPath, `Stable control-file read failed: ${error.code ?? error.message}`);
		return null;
	}
}

function normalizedEvidencePath(projectRoot, value) {
	if (typeof value !== "string" || value !== value.trim() || !value || value.includes("\\") || /\p{Cc}/u.test(value) || posix.isAbsolute(value) || /[*?{}[\]]/.test(value)) return null;
	const segments = value.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..") || posix.normalize(value) !== value) return null;
	const absolute = resolve(projectRoot, value);
	if (!isInside(projectRoot, absolute)) return null;
	if (existsSync(absolute) && !isInside(realpathSync(projectRoot), realpathSync(absolute))) return null;
	return value;
}

function gitFileAtCommit(projectRoot, commit, evidencePath) {
	const result = spawnSync("git", ["-C", projectRoot, "ls-tree", "-z", commit, "--", evidencePath], { encoding: "utf8" });
	if (result.status !== 0 || !result.stdout) return false;
	const entries = result.stdout.split("\0").filter(Boolean);
	if (entries.length !== 1) return false;
	const tab = entries[0].indexOf("\t");
	if (tab < 0 || entries[0].slice(tab + 1) !== evidencePath) return false;
	const [mode, type] = entries[0].slice(0, tab).split(" ", 3);
	return type === "blob" && ["100644", "100755"].includes(mode);
}

function gitRegularFilesAtCommit(projectRoot, commit) {
	const result = spawnSync("git", ["-C", projectRoot, "ls-tree", "-r", "-z", "--full-tree", commit], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) return null;
	const files = new Map();
	for (const entry of result.stdout.split("\0").filter(Boolean)) {
		const tab = entry.indexOf("\t");
		if (tab < 0) continue;
		const [mode, type, object] = entry.slice(0, tab).split(" ");
		if (type === "blob" && ["100644", "100755"].includes(mode)) files.set(entry.slice(tab + 1), object);
	}
	return files;
}

function gitBlobSha256(projectRoot, object, cache) {
	if (cache.has(object)) return cache.get(object);
	const result = spawnSync("git", ["-C", projectRoot, "cat-file", "blob", object], {
		encoding: null,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) return null;
	const hash = createHash("sha256").update(result.stdout).digest("hex");
	cache.set(object, hash);
	return hash;
}

function nonEmptyStrings(value) {
	return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry === entry.trim() && entry.length > 0 && !/\p{Cc}/u.test(entry));
}

function scanSpecificationBody(body) {
	const headings = [];
	const commentDelimiters = [];
	let fence = null;
	for (const [offset, line] of body.split(/\r\n|[\n\r]/).entries()) {
		if (fence) {
			const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
			if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
			continue;
		}
		const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
			fence = { character: opening[1][0], length: opening[1].length };
			continue;
		}
		for (const match of line.matchAll(/<!--|-->/g)) commentDelimiters.push({ delimiter: match[0], line: offset + 1 });
		const heading = line.match(/^ {0,3}#{1,6}(?:[ \t]+(.*)|[ \t]*)$/);
		if (!heading) continue;
		const content = (heading[1] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
		if (!content.startsWith("Requirement:")) continue;
		const remainder = content.slice("Requirement:".length).replace(/^[ \t]*/, "");
		const separator = remainder.search(/[ \t:]/);
		const token = separator < 0 ? remainder : remainder.slice(0, separator);
		headings.push({ token, line: offset + 1 });
	}
	return { headings, commentDelimiters };
}

function validateTraceEvidencePath({ value, commit, label, id, path, projectRoot, reporter }) {
	const normalized = normalizedEvidencePath(projectRoot, value);
	if (!normalized) {
		reporter.error(`PIBO_TRACE_${label}_PATH`, path, `Requirement ${id ?? "<unknown>"} has an invalid repository-relative ${label.toLowerCase()} path: ${String(value)}`);
		return;
	}
	if (!gitFileAtCommit(projectRoot, commit, normalized)) reporter.error(`PIBO_TRACE_${label}_PATH`, path, `Requirement ${id ?? "<unknown>"} ${label.toLowerCase()} path is not a regular file at traceability.commit: ${normalized}`);
}

function validateTraceability({ data, body, path, projectRoot, reporter, requirementIds }) {
	if (data.type !== "Specification") return;
	const bodySyntax = scanSpecificationBody(body);
	for (const occurrence of bodySyntax.commentDelimiters) {
		reporter.error("PIBO_SPEC_HTML_COMMENT", path, `Specification body contains prohibited raw HTML comment delimiter ${occurrence.delimiter} at body line ${occurrence.line}.`);
	}
	const trace = data.traceability;
	if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
		reporter.error("PIBO_TRACEABILITY", path, "A Specification requires a traceability mapping.");
		return;
	}
	const commit = trace.commit;
	const commitValid = GIT_SHA_RE.test(commit ?? "") && gitCommitExists(projectRoot, commit);
	if (!commitValid) reporter.error("PIBO_TRACE_COMMIT", path, "traceability.commit must identify a real commit in the current repository.");
	if (!Array.isArray(trace.requirements) || trace.requirements.length === 0) {
		reporter.error("PIBO_TRACE_REQUIREMENTS", path, "traceability.requirements must be a non-empty list.");
		return;
	}
	const frontmatterCounts = new Map();
	for (const requirement of trace.requirements) {
		const id = requirement?.id;
		if (typeof id === "string") frontmatterCounts.set(id, (frontmatterCounts.get(id) ?? 0) + 1);
		if (typeof id !== "string" || !REQUIREMENT_ID_RE.test(id)) {
			reporter.error("PIBO_REQUIREMENT_ID", path, `Requirement id needs at least two uppercase semantic components before its numeric suffix: ${String(id)}`);
		} else if (requirementIds.has(id)) {
			reporter.error("PIBO_REQUIREMENT_DUPLICATE", path, `Requirement id is already owned by ${requirementIds.get(id)}: ${id}`);
		} else requirementIds.set(id, path);
		if (requirement?.status !== "implemented") reporter.error("PIBO_REQUIREMENT_STATUS", path, `Requirement ${id ?? "<unknown>"} must be implemented in a current specification.`);
		const publicSurfacesValid = requirement?.public === undefined || nonEmptyStrings(requirement.public);
		if (!publicSurfacesValid) reporter.error("PIBO_TRACE_PUBLIC", path, `Requirement ${id ?? "<unknown>"} public surfaces must be a non-empty list of trimmed strings.`);
		if (!Array.isArray(requirement?.sources) || requirement.sources.length === 0) {
			reporter.error("PIBO_TRACE_SOURCES", path, `Requirement ${id ?? "<unknown>"} requires source paths.`);
		} else {
			for (const source of requirement.sources) {
				if (commitValid) validateTraceEvidencePath({ value: source?.path, commit, label: "SOURCE", id, path, projectRoot, reporter });
				else if (!normalizedEvidencePath(projectRoot, source?.path)) reporter.error("PIBO_TRACE_SOURCE_PATH", path, `Requirement ${id ?? "<unknown>"} has an invalid repository-relative source path: ${String(source?.path)}`);
				const symbolValid = typeof source?.symbol === "string" && source.symbol === source.symbol.trim() && source.symbol.length > 0 && !/\p{Cc}/u.test(source.symbol);
				if (!symbolValid && !(requirement?.public !== undefined && publicSurfacesValid)) reporter.error("PIBO_TRACE_SYMBOL", path, `Requirement ${id ?? "<unknown>"} needs a non-empty source symbol or approved public surface.`);
			}
		}
		if (Array.isArray(requirement?.tests) && requirement.tests.length > 0) {
			for (const test of requirement.tests) {
				if (commitValid) validateTraceEvidencePath({ value: test?.path, commit, label: "TEST", id, path, projectRoot, reporter });
				else if (!normalizedEvidencePath(projectRoot, test?.path)) reporter.error("PIBO_TRACE_TEST_PATH", path, `Requirement ${id ?? "<unknown>"} has an invalid repository-relative test path: ${String(test?.path)}`);
				if (typeof test?.name !== "string" || test.name !== test.name.trim() || !test.name || /\p{Cc}/u.test(test.name)) reporter.error("PIBO_TRACE_TEST_NAME", path, `Requirement ${id ?? "<unknown>"} test evidence requires a non-empty name.`);
			}
		} else if (requirement?.source_inspected !== true || typeof requirement?.follow_up !== "string" || !requirement.follow_up.trim()) {
			reporter.error("PIBO_TRACE_TEST", path, `Requirement ${id ?? "<unknown>"} needs tests or source_inspected with follow_up.`);
		}
		if (requirement?.tests !== undefined && !Array.isArray(requirement.tests)) reporter.error("PIBO_TRACE_TEST", path, `Requirement ${id ?? "<unknown>"} tests must be a list.`);
		if (requirement?.follow_up !== undefined && (typeof requirement.follow_up !== "string" || requirement.follow_up !== requirement.follow_up.trim() || !requirement.follow_up || /\p{Cc}/u.test(requirement.follow_up))) reporter.error("PIBO_TRACE_FOLLOW_UP", path, `Requirement ${id ?? "<unknown>"} follow_up must be a non-empty trimmed string.`);
		if (!nonEmptyStrings(requirement?.failures)) reporter.error("PIBO_TRACE_FAILURES", path, `Requirement ${id ?? "<unknown>"} failures must be a non-empty list of trimmed strings.`);
		if (!["high", "medium", "low"].includes(requirement?.confidence)) reporter.error("PIBO_TRACE_CONFIDENCE", path, `Requirement ${id ?? "<unknown>"} needs high, medium, or low confidence.`);
	}
	const headingCounts = new Map();
	for (const heading of bodySyntax.headings) {
		if (!REQUIREMENT_ID_RE.test(heading.token)) {
			reporter.error("PIBO_REQUIREMENT_HEADING_ID", path, `Explicit Requirement heading has an invalid raw ID token at body line ${heading.line}: ${JSON.stringify(heading.token || "<missing>")}`);
			continue;
		}
		headingCounts.set(heading.token, (headingCounts.get(heading.token) ?? 0) + 1);
		if (!frontmatterCounts.has(heading.token)) {
			reporter.error("PIBO_REQUIREMENT_BODY_UNBOUND", path, `Body requirement heading has no frontmatter traceability entry: ${heading.token}`);
		}
	}
	for (const id of frontmatterCounts.keys()) {
		if (!REQUIREMENT_ID_RE.test(id)) continue;
		const count = headingCounts.get(id) ?? 0;
		if (count === 0) reporter.error("PIBO_REQUIREMENT_BODY_MISSING", path, `Requirement id has no explicit body heading: ${id}`);
		else if (count > 1) reporter.error("PIBO_REQUIREMENT_BODY_DUPLICATE", path, `Requirement id has ${count} explicit body headings: ${id}`);
	}
}

function validateConcept({ content, path, docsRoot, projectRoot, reporter, requirementIds = new Map(), strictLinks = false }) {
	if (!FILENAME_RE.test(posix.basename(path))) reporter.error("PIBO_FILENAME", path, "Concept filenames must use lowercase kebab-case.");
	const parsed = parseFrontmatter(content);
	if (parsed.error) {
		reporter.error("OKF_FRONTMATTER_PARSE", path, parsed.error, "okf-core");
		return null;
	}
	if (!parsed.data) {
		reporter.error("OKF_FRONTMATTER_MISSING", path, "A concept requires YAML frontmatter.", "okf-core");
		return null;
	}
	const data = parsed.data;
	if (typeof data.type !== "string" || !data.type.trim()) {
		reporter.error("OKF_TYPE", path, "A concept requires a non-empty type.", "okf-core");
		return data;
	}
	for (const field of REQUIRED_FIELDS) if (!(field in data)) reporter.error("PIBO_REQUIRED_FIELD", path, `Missing required Pibo field: ${field}`);
	for (const field of ["type", "authority", "status"]) {
		if (typeof data[field] !== "string" || !data[field].trim()) reporter.error("PIBO_FIELD_VALUE", path, `${field} must be a non-empty string.`);
	}
	if (!isSafeSingleLineString(data.title)) reporter.error("PIBO_TITLE", path, "title must be a trimmed, visible single-line string without control, format, bidi, default-ignorable, or visually blank filler characters.");
	if (!isSafeSingleLineString(data.description)) reporter.error("PIBO_DESCRIPTION", path, "description must be a trimmed, visible single-line string without control, format, bidi, default-ignorable, or visually blank filler characters.");
	if (!Array.isArray(data.tags) || data.tags.length === 0 || data.tags.some((tag) => !isSafeSingleLineString(tag))) reporter.error("PIBO_TAGS", path, "tags must be a non-empty list of trimmed, visible single-line strings without control, format, bidi, default-ignorable, or visually blank filler characters.");
	if (!ALLOWED_STATUSES.has(data.status)) reporter.error("PIBO_STATUS", path, `Invalid status: ${String(data.status)}`);
	if (!ALLOWED_AUTHORITIES.has(data.authority)) reporter.error("PIBO_AUTHORITY", path, `Invalid authority: ${String(data.authority)}`);
	if (!data.generated || typeof data.generated !== "object" || Array.isArray(data.generated) || typeof data.generated.by !== "string" || !ACTOR_RE.test(data.generated.by) || !isoDatetime(data.generated.at)) reporter.error("PIBO_GENERATED", path, "generated requires an OKF actor in by and an ISO 8601 datetime in at.");
	if (data.verified) {
		const events = Array.isArray(data.verified) ? data.verified : [data.verified];
		for (const event of events) if (!event || typeof event.by !== "string" || !ACTOR_RE.test(event.by) || !isoDatetime(event.at)) reporter.error("PIBO_VERIFIED", path, "Each verified event requires an OKF actor in by and an ISO 8601 datetime in at.");
	}
	const relativeToDocs = normalizePath(relative(docsRoot, resolve(projectRoot, path)));
	const category = relativeToDocs.split("/", 1)[0];
	const policy = TAXONOMY[category];
	if (!policy) reporter.error("PIBO_TAXONOMY", path, `Unknown top-level documentation category: ${category}`);
	else {
		if (!policy.types.has(data.type)) reporter.error("PIBO_TYPE_TAXONOMY", path, `${data.type} is not allowed under docs/${category}/.`);
		if (!policy.authorities.has(data.authority)) reporter.error("PIBO_AUTHORITY_TAXONOMY", path, `${data.authority} is not allowed under docs/${category}/.`);
	}
	if (TYPE_AUTHORITIES[data.type] && !TYPE_AUTHORITIES[data.type].has(data.authority)) reporter.error("PIBO_TYPE_AUTHORITY", path, `${data.type} cannot use authority ${String(data.authority)}.`);
	if (Array.isArray(data.sources)) for (const source of data.sources) validateSourceResource({ resource: source?.resource, path, docsRoot, projectRoot, reporter });
	else if (data.sources !== undefined) reporter.error("PIBO_SOURCES", path, "sources must be a list.");
	validateTraceability({ data, body: parsed.body, path, projectRoot, reporter, requirementIds });
	if (strictLinks) validateLinks({ content, path, docsRoot, projectRoot, reporter, data, body: parsed.body });
	return data;
}

function hasBroadPathSyntax(path) {
	return /[*?{}[\]]/.test(path) || path.endsWith("/") || path.startsWith("/") || path.startsWith("./") || path.includes("../");
}

function docsCategory(path) {
	const match = path.match(/^docs\/(project|specs|plans|reports|legacy)\//);
	return match?.[1] ?? null;
}

function validatePendingDestination({ record, target, records, destinationOwners, reporter }) {
	if (typeof target !== "string" || !target.endsWith(".md") || hasBroadPathSyntax(target)) {
		reporter.error("MIGRATION_TARGET_PATH", record.path, `Invalid pending destination: ${String(target)}`);
		return;
	}
	const reservedReplacement = record.action === "replace-with-reserved-file";
	const basename = posix.basename(target);
	const category = docsCategory(target);
	if (target !== "docs/index.md" && !category) {
		reporter.error("MIGRATION_TARGET_TAXONOMY", record.path, `Pending destination is outside the five approved roots: ${target}`);
	}
	if (reservedReplacement) {
		if (!['index.md', 'log.md'].includes(basename)) reporter.error("MIGRATION_TARGET_RESERVED", record.path, `Reserved-file replacement must target index.md or log.md: ${target}`);
	} else {
		if (["index.md", "log.md", "README.md"].includes(basename) || !FILENAME_RE.test(basename)) reporter.error("MIGRATION_TARGET_FILENAME", record.path, `Concept destination must use lowercase kebab-case and cannot be reserved: ${target}`);
		if (!record.type || !record.authority || !record.status) reporter.error("MIGRATION_TARGET_METADATA", record.path, "A concept destination requires type, authority, and status.");
		const policy = category ? TAXONOMY[category] : null;
		if (policy && record.type && !policy.types.has(record.type)) reporter.error("MIGRATION_TARGET_TYPE", record.path, `${record.type} is not allowed at destination ${target}.`);
		if (policy && record.authority && !policy.authorities.has(record.authority)) reporter.error("MIGRATION_TARGET_AUTHORITY", record.path, `${record.authority} is not allowed at destination ${target}.`);
	}
	const previous = destinationOwners.get(target);
	if (previous && previous !== record.path) reporter.error("MIGRATION_TARGET_DUPLICATE", record.path, `Destination is also claimed by ${previous}: ${target}`);
	else destinationOwners.set(target, record.path);
	const currentOwner = records.get(target);
	if (currentOwner && target !== record.path && !(reservedReplacement && currentOwner.state === "reserved")) {
		reporter.error("MIGRATION_TARGET_COLLISION", record.path, `Destination collides with current owner ${currentOwner.path}: ${target}`);
	}
}

function validateLedger({ ledger, ledgerRepositoryPath, markdownPaths, projectRoot, docsRoot, mode, reporter, requirementIds, pathSafety }) {
	if (ledger.schema_version !== "pibo-okf-migration-ledger/1" || !Array.isArray(ledger.records)) {
		reporter.error("MIGRATION_LEDGER_SCHEMA", "docs/project/okf-migration-ledger.json", "Unsupported or malformed migration ledger.");
		return { records: new Map(), concepts: new Map() };
	}
	if (JSON.stringify(ledger.taxonomy_roots) !== JSON.stringify(["project", "specs", "plans", "reports", "legacy"])) reporter.error("MIGRATION_TAXONOMY", "docs/project/okf-migration-ledger.json", "Ledger taxonomy_roots must preserve the five project-approved roots.");
	const records = new Map();
	for (const record of ledger.records) {
		if (!record || typeof record.path !== "string" || !record.path.endsWith(".md") || hasBroadPathSyntax(record.path)) {
			reporter.error("MIGRATION_LEDGER_PATH", "docs/project/okf-migration-ledger.json", `Invalid ledger path: ${String(record?.path)}`);
			continue;
		}
		if (records.has(record.path)) reporter.error("MIGRATION_DUPLICATE", record.path, "Markdown path appears more than once in the migration ledger.");
		else records.set(record.path, record);
	}
	for (const path of records.keys()) {
		if (!pathSafety.has(path)) pathSafety.set(path, validateRepositoryMarkdownPath({ projectRoot, path, reporter, layer: "pibo-migration" }));
	}
	const actual = new Set(markdownPaths);
	const sourceOwners = new Map();
	const destinationOwners = new Map();
	const rootNavigationOwners = new Map();
	for (const record of records.values()) {
		if (!ALLOWED_STATES.has(record.state)) reporter.error("MIGRATION_STATE", record.path, `Invalid ledger state: ${String(record.state)}`);
		if (record.authority != null && !ALLOWED_AUTHORITIES.has(record.authority)) reporter.error("MIGRATION_AUTHORITY", record.path, `Invalid ledger authority: ${record.authority}`);
		if (record.status != null && !ALLOWED_STATUSES.has(record.status)) reporter.error("MIGRATION_STATUS", record.path, `Invalid ledger status: ${record.status}`);
		if (record.type != null && !TYPE_AUTHORITIES[record.type]) reporter.error("MIGRATION_TYPE", record.path, `Invalid target concept type: ${record.type}`);
		if (record.type != null && record.authority != null && TYPE_AUTHORITIES[record.type] && !TYPE_AUTHORITIES[record.type].has(record.authority)) reporter.error("MIGRATION_TYPE_AUTHORITY", record.path, `${record.type} cannot use target authority ${record.authority}.`);
		if (record.navigation != null) {
			const order = record.navigation?.root_order;
			if (record.state !== "conformant" || !Number.isInteger(order) || order < 1) reporter.error("MIGRATION_NAVIGATION", record.path, "Root navigation requires a conformant concept and a positive integer root_order.");
			else if (rootNavigationOwners.has(order)) reporter.error("MIGRATION_NAVIGATION_DUPLICATE", record.path, `Root navigation order is also owned by ${rootNavigationOwners.get(order)}: ${order}`);
			else rootNavigationOwners.set(order, record.path);
		}
		if (record.state === "pending") {
			if (typeof record.action !== "string" || !record.action) reporter.error("MIGRATION_ACTION", record.path, "A pending record requires an action.");
			if (!Array.isArray(record.target_paths) || record.target_paths.length === 0) reporter.error("MIGRATION_TARGETS", record.path, "A pending record requires at least one destination.");
			else for (const target of new Set(record.target_paths)) validatePendingDestination({ record, target, records, destinationOwners, reporter });
			if (Array.isArray(record.target_paths) && new Set(record.target_paths).size !== record.target_paths.length) reporter.error("MIGRATION_TARGET_DUPLICATE", record.path, "A pending record repeats a destination.");
			if (Array.isArray(record.target_paths) && record.target_paths.includes(record.path) && record.target_paths.length !== 1) reporter.error("MIGRATION_IN_PLACE_SPLIT", record.path, "An in-place migration must have exactly one destination: its current path.");
			if (record.action === "relocated-pending-profile-conversion") {
				if (!record.source_path || !record.source_sha256) reporter.error("MIGRATION_RELOCATION_LINEAGE", record.path, "A relocated pending body requires source_path and source_sha256 lineage.");
				if (!Array.isArray(record.target_paths) || record.target_paths.length !== 1 || record.target_paths[0] !== record.path) reporter.error("MIGRATION_RELOCATION_TARGET", record.path, "A relocated pending body must convert in place at its current path.");
			} else if (record.source_path != null && record.path === record.target_paths?.[0]) {
				reporter.error("MIGRATION_RELOCATION_ACTION", record.path, "An in-place pending record with a distinct source_path must use relocated-pending-profile-conversion.");
			}
		} else if (record.target_paths != null) {
			reporter.error("MIGRATION_TARGET_STATE", record.path, `${record.state} records must not declare pending destinations.`);
		}
		if (["conformant", "reserved"].includes(record.state) && !record.path.startsWith("docs/")) reporter.error("MIGRATION_BUNDLE_STATE", record.path, `${record.state} paths must live inside docs/.`);
		if (record.state === "conformant" && ["index.md", "log.md", "README.md"].includes(posix.basename(record.path))) reporter.error("MIGRATION_CONFORMANT_NAME", record.path, "Conformant state requires a non-reserved concept path.");
		if (record.state === "reserved") {
			if (!["index.md", "log.md"].includes(posix.basename(record.path))) reporter.error("MIGRATION_RESERVED_NAME", record.path, "Reserved state requires index.md or log.md.");
			if (record.type != null || record.authority != null || record.status != null) reporter.error("MIGRATION_RESERVED_METADATA", record.path, "Reserved records must not claim concept metadata.");
		}
		if (record.state === "host-exception") {
			if (record.path.startsWith("docs/")) reporter.error("MIGRATION_EXCEPTION_BUNDLE", record.path, "Host-owned exceptions cannot live inside the OKF bundle.");
			if (typeof record.reason !== "string" || record.reason.length < 20) reporter.error("MIGRATION_EXCEPTION_REASON", record.path, "A host-owned exception requires a specific reason.");
			if (record.type != null || record.authority != null || record.status != null || record.source_path != null || record.source_sha256 != null) reporter.error("MIGRATION_EXCEPTION_METADATA", record.path, "Host-owned exceptions cannot claim concept or migration-source metadata.");
			if (!actual.has(record.path)) reporter.error("MIGRATION_EXCEPTION_MISSING", record.path, "Host-owned exception path is missing from the current Markdown set.");
		}
		if (record.source_path != null) {
			if (typeof record.source_path !== "string" || !record.source_path.endsWith(".md") || hasBroadPathSyntax(record.source_path) || record.source_path === record.path) {
				reporter.error("MIGRATION_SOURCE_PATH", record.path, `Invalid migration source path: ${String(record.source_path)}`);
			} else {
				const previous = sourceOwners.get(record.source_path);
				if (previous) reporter.error("MIGRATION_SOURCE_DUPLICATE", record.path, `Migration source is also claimed by ${previous}: ${record.source_path}`);
				else sourceOwners.set(record.source_path, record.path);
				if (records.has(record.source_path)) reporter.error("MIGRATION_SOURCE_CURRENT_COLLISION", record.path, `Migration source is also a current ledger path: ${record.source_path}`);
				if (actual.has(record.source_path)) reporter.error("MIGRATION_SOURCE_STILL_PRESENT", record.path, `Relocated source still exists in the current Markdown set: ${record.source_path}`);
			}
		}
		if (record.source_sha256 != null) {
			if (record.source_path == null || !SHA256_RE.test(record.source_sha256)) {
				reporter.error("MIGRATION_SOURCE_HASH", record.path, "source_sha256 requires source_path and a lowercase 64-hex SHA-256.");
			}
		}
		const expectedDecision = PLAN_DECISIONS.get(record.path);
		if (expectedDecision && record.decision !== expectedDecision) reporter.error("MIGRATION_PLAN_DECISION", record.path, `Expected resolved decision: ${expectedDecision}`);
	}
	const pendingRecords = [...records.values()].filter((record) => record.state === "pending");
	const declaredBaseCommit = ledger.base_commit;
	const declaredBaseCommitValid = GIT_SHA_RE.test(declaredBaseCommit ?? "") && gitCommitExists(projectRoot, declaredBaseCommit);
	if (pendingRecords.length > 0 && !declaredBaseCommitValid) {
		reporter.error("MIGRATION_BASE_COMMIT", "docs/project/okf-migration-ledger.json", "A ledger with pending records requires a real 40-hex base_commit.");
	}
	const trust = pendingRecords.length > 0 ? deriveLedgerTrustAnchor(projectRoot, ledgerRepositoryPath) : null;
	if (trust?.error) {
		reporter.error("MIGRATION_BASE_HISTORY", ledgerRepositoryPath, trust.error);
	} else if (trust && declaredBaseCommit !== trust.anchor) {
		reporter.error("MIGRATION_BASE_COMMIT_ANCHOR", ledgerRepositoryPath, `base_commit must equal the immutable parent of ledger introduction ${trust.introduction}: ${trust.anchor}.`);
	}
	const baseCommit = trust?.anchor;
	const baseFiles = baseCommit ? gitRegularFilesAtCommit(projectRoot, baseCommit) : null;
	if (baseCommit && !baseFiles) {
		reporter.error("MIGRATION_BASE_COMMIT", ledgerRepositoryPath, `Cannot inspect the immutable base commit tree: ${baseCommit}`);
	}
	const baseHashCache = new Map();
	if (baseFiles) {
		for (const record of pendingRecords) {
			const currentExistedAtBase = baseFiles.has(record.path);
			const relocated = record.action === "relocated-pending-profile-conversion";
			if (currentExistedAtBase && relocated) {
				reporter.error("MIGRATION_LINEAGE_PATH", record.path, "A pending path that exists at base_commit cannot replace its lineage with source_path metadata.");
			}
			if (!currentExistedAtBase && !relocated) {
				reporter.error("MIGRATION_LINEAGE_PATH", record.path, "A pending path absent at base_commit requires controlled relocated lineage.");
			}
			const lineagePath = currentExistedAtBase ? record.path : record.source_path;
			const object = typeof lineagePath === "string" ? baseFiles.get(lineagePath) : null;
			if (!object) {
				reporter.error("MIGRATION_LINEAGE_MISSING", record.path, `Pending lineage is not a regular Markdown blob at base_commit: ${String(lineagePath)}`);
				continue;
			}
			const expectedHash = gitBlobSha256(projectRoot, object, baseHashCache);
			if (!expectedHash) {
				reporter.error("MIGRATION_LINEAGE_READ", record.path, `Cannot hash pending lineage blob at base_commit: ${lineagePath}`);
				continue;
			}
			if (record.source_sha256 != null && record.source_sha256 !== expectedHash) {
				reporter.error("MIGRATION_SOURCE_HASH_BASE_MISMATCH", record.path, `source_sha256 is not bound to ${baseCommit}:${lineagePath}; expected ${expectedHash}.`);
			}
			if (actual.has(record.path) && pathSafety.get(record.path)) {
				const currentHash = createHash("sha256").update(readFileSync(resolve(projectRoot, record.path))).digest("hex");
				if (currentHash !== expectedHash) {
					reporter.error("MIGRATION_PENDING_BYTES", record.path, `Pending bytes differ from ${baseCommit}:${lineagePath}; expected ${expectedHash}, found ${currentHash}.`);
				}
			}
		}
	}
	for (const path of actual) if (!records.has(path)) reporter.error("MIGRATION_UNLISTED", path, "Markdown path has no migration-ledger owner.");
	for (const path of records.keys()) if (!actual.has(path)) reporter.error("MIGRATION_MISSING", path, "Ledger path does not exist in the repository Markdown set.");
	const concepts = new Map();
	for (const [path, record] of records) {
		if (!actual.has(path) || !pathSafety.get(path)) continue;
		const absolute = resolve(projectRoot, path);
		const content = readFileSync(absolute, "utf8");
		if (record.state === "conformant") {
			const data = mode === "migration"
				? validateConcept({ content, path, docsRoot, projectRoot, reporter, requirementIds })
				: parseFrontmatter(content).data;
			if (data) concepts.set(path, data);
			for (const field of ["type", "authority", "status"]) if (data?.[field] !== record[field]) reporter.error("MIGRATION_CONFORMANT_METADATA", path, `Ledger ${field} does not match the concept: ${String(record[field])} != ${String(data?.[field])}`);
		}
		if (mode === "migration" && record.state === "reserved") validateReserved({ content, path, docsRoot, projectRoot, strictLinks: false, requirePiboVersion: true, requirePiboLog: true, reporter });
		if (mode === "strict" && record.state === "pending") reporter.error("STRICT_PENDING", path, "Strict mode rejects pending migration entries.");
	}
	return { records, concepts };
}

function validateIndexes({ docsRoot, projectRoot, docsMarkdown, reporter }) {
	const directories = new Set([docsRoot]);
	for (const path of docsMarkdown) {
		let directory = dirname(resolve(projectRoot, path));
		while (isInside(docsRoot, directory)) {
			directories.add(directory);
			if (directory === docsRoot) break;
			directory = dirname(directory);
		}
	}
	for (const directory of [...directories].sort()) {
		const indexPath = join(directory, "index.md");
		const display = normalizePath(relative(projectRoot, indexPath));
		if (!existsSync(indexPath)) {
			reporter.error("PIBO_INDEX_MISSING", display, "Every bundle directory containing Markdown or bundle subdirectories requires index.md.");
			continue;
		}
		const content = readFileSync(indexPath, "utf8");
		const indexLinks = markdownLinks(content).map((link) => link.split("#", 1)[0].replace(/^\.\//, ""));
		const links = new Set(indexLinks);
		for (const link of links) if (indexLinks.filter((candidate) => candidate === link).length > 1) reporter.error("PIBO_INDEX_DUPLICATE", display, `Index lists a target more than once: ${link}`);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isFile() && extname(entry.name).toLowerCase() === ".md" && !["index.md", "log.md"].includes(entry.name) && !links.has(entry.name)) reporter.error("PIBO_INDEX_ENTRY", display, `Index does not list direct concept: ${entry.name}`);
			if (entry.isDirectory() && directories.has(join(directory, entry.name)) && !links.has(`${entry.name}/`) && !links.has(entry.name)) reporter.error("PIBO_INDEX_DIRECTORY", display, `Index does not list direct bundle directory: ${entry.name}/`);
		}
	}
}

function validateConformantIndexCoverage({ concepts, records, projectRoot, pathSafety, reporter }) {
	const indexes = new Map();
	for (const path of concepts.keys()) {
		let directory = posix.dirname(path);
		let target = posix.basename(path);
		while (directory === "docs" || directory.startsWith("docs/")) {
			const indexPath = posix.join(directory, "index.md");
			const indexRecord = records.get(indexPath);
			if (!indexRecord || indexRecord.state !== "reserved") {
				reporter.error("PIBO_INDEX_MISSING", indexPath, `Conformant concept ${path} lacks a reserved ancestor index owner.`);
			} else if (pathSafety.get(indexPath)) {
				let links = indexes.get(indexPath);
				if (!links) {
					links = markdownLinks(readFileSync(resolve(projectRoot, indexPath), "utf8"))
						.map((link) => link.split("#", 1)[0].replace(/^\.\//, ""));
					indexes.set(indexPath, links);
				}
				const count = links.filter((link) => link === target).length;
				if (count === 0) reporter.error("PIBO_INDEX_ENTRY", indexPath, `Reserved index does not list conformant direct target: ${target}`);
				else if (count > 1) reporter.error("PIBO_INDEX_DUPLICATE", indexPath, `Reserved index lists conformant direct target more than once: ${target}`);
			}
			if (directory === "docs") break;
			target = `${posix.basename(directory)}/`;
			directory = posix.dirname(directory);
		}
	}
}

function validateEvidence({ docsRoot, projectRoot, concepts, reporter, controlReadHooks }) {
	const manifestPath = join(docsRoot, "reports", "artifacts", "okf-migration", "evidence-manifest.json");
	const manifestRepositoryPath = normalizePath(relative(projectRoot, manifestPath));
	const manifestBytes = readRepositoryControlFile({ projectRoot, repositoryPath: manifestRepositoryPath, reporter, codePrefix: "PIBO_EVIDENCE_MANIFEST_PATH", hooks: controlReadHooks });
	if (!manifestBytes) return;
	let manifest;
	try {
		manifest = JSON.parse(manifestBytes.toString("utf8"));
	} catch (error) {
		reporter.error("PIBO_EVIDENCE_MANIFEST", normalizePath(relative(projectRoot, manifestPath)), `Cannot parse evidence manifest: ${error.message}`);
		return;
	}
	if (manifest.schema_version !== "pibo-okf-evidence-manifest/1" || !Array.isArray(manifest.evidence)) {
		reporter.error("PIBO_EVIDENCE_MANIFEST", normalizePath(relative(projectRoot, manifestPath)), "Unsupported evidence manifest schema.");
		return;
	}
	const byPath = new Map();
	const byId = new Map();
	for (const entry of manifest.evidence) {
		if (!entry || typeof entry.path !== "string" || typeof entry.id !== "string" || !SHA256_RE.test(entry.sha256 ?? "")) {
			reporter.error("PIBO_EVIDENCE_MANIFEST_ENTRY", entry?.path ?? "<unknown>", "Evidence manifest entries require path, id, and lowercase SHA-256.");
			continue;
		}
		if (byPath.has(entry?.path)) reporter.error("PIBO_EVIDENCE_DUPLICATE", entry?.path ?? "<unknown>", "Evidence manifest path is duplicated.");
		if (byId.has(entry?.id)) reporter.error("PIBO_EVIDENCE_DUPLICATE", entry?.path ?? "<unknown>", "Evidence manifest id is duplicated.");
		byPath.set(entry?.path, entry);
		byId.set(entry?.id, entry);
	}
	for (const [path, data] of concepts) {
		if (data?.type !== "Evidence Report" || data.status !== "stable") continue;
		if (!data.evidence || typeof data.evidence.id !== "string" || !isoDatetime(data.evidence.published_at)) {
			reporter.error("PIBO_EVIDENCE_IDENTITY", path, "Stable evidence requires evidence.id and evidence.published_at.");
			continue;
		}
		const entry = byPath.get(path);
		const hash = createHash("sha256").update(readFileSync(resolve(projectRoot, path))).digest("hex");
		if (!entry || entry.id !== data.evidence.id || entry.sha256 !== hash) reporter.error("PIBO_EVIDENCE_HASH", path, "Stable evidence does not match its immutable manifest identity and SHA-256.");
		byPath.delete(path);
	}
	for (const path of byPath.keys()) reporter.error("PIBO_EVIDENCE_ORPHAN", path ?? "<unknown>", "Evidence manifest entry has no stable Evidence Report concept.");
}

export function validateRepository(options = {}) {
	const mode = options.mode ?? "migration";
	if (!["core", "migration", "strict"].includes(mode)) throw new Error(`Unknown validation mode: ${mode}`);
	const projectRoot = resolve(options.projectRoot ?? ".");
	const docsRoot = resolve(projectRoot, options.docsRoot ?? "docs");
	const ledgerPath = resolve(projectRoot, options.ledgerPath ?? "docs/project/okf-migration-ledger.json");
	const ledgerRepositoryPath = normalizePath(relative(projectRoot, ledgerPath));
	const reporter = createReporter(mode);
	const discovery = discoverMarkdown(projectRoot);
	const docsPrefix = `${normalizePath(relative(projectRoot, docsRoot))}/`;
	const docsMarkdown = discovery.paths.filter((path) => path.startsWith(docsPrefix));
	const pathSafety = validateRepositoryMarkdownPaths({
		projectRoot,
		paths: mode === "core" ? docsMarkdown : discovery.paths,
		reporter,
		layer: mode === "core" ? "okf-core" : "pibo-migration",
	});
	const requirementIds = new Map();
	let records = new Map();
	let migrationConcepts = new Map();
	if (mode === "core") {
		for (const path of docsMarkdown) {
			if (!pathSafety.get(path)) continue;
			const content = readFileSync(resolve(projectRoot, path), "utf8");
			if (["index.md", "log.md"].includes(posix.basename(path))) validateReserved({ content, path, docsRoot, projectRoot, strictLinks: false, requirePiboVersion: false, requirePiboLog: false, reporter });
			else validateCoreConcept({ content, path, reporter });
		}
	} else {
		let ledger;
		const ledgerBytes = readRepositoryControlFile({ projectRoot, repositoryPath: ledgerRepositoryPath, reporter, codePrefix: "MIGRATION_LEDGER_PATH", hooks: options.controlReadHooks?.ledger });
		if (!ledgerBytes) {
			ledger = { records: [] };
		} else {
			try {
				ledger = JSON.parse(ledgerBytes.toString("utf8"));
			} catch (error) {
				reporter.error("MIGRATION_LEDGER_READ", ledgerRepositoryPath, `Cannot read ledger: ${error.message}`);
				ledger = { records: [] };
			}
		}
		({ records, concepts: migrationConcepts } = validateLedger({ ledger, ledgerRepositoryPath, markdownPaths: discovery.paths, projectRoot, docsRoot, mode, reporter, requirementIds, pathSafety }));
		if (mode === "migration") {
			validateConformantIndexCoverage({ concepts: migrationConcepts, records, projectRoot, pathSafety, reporter });
			validateEvidence({ docsRoot, projectRoot, concepts: migrationConcepts, reporter, controlReadHooks: options.controlReadHooks?.manifest });
		}
	}
	const concepts = new Map();
	if (mode === "strict") {
		if (!existsSync(join(docsRoot, "index.md"))) reporter.error("PIBO_ROOT_INDEX", "docs/index.md", "The bundle requires a root index.");
		if (!existsSync(join(docsRoot, "log.md"))) reporter.error("PIBO_ROOT_LOG", "docs/log.md", "The bundle requires a root log.");
		if (!existsSync(join(docsRoot, "project", "documentation-profile.md"))) reporter.error("PIBO_PROFILE_MISSING", "docs/project/documentation-profile.md", "The bundle requires the normative Pibo documentation profile.");
		for (const category of Object.keys(TAXONOMY)) {
			if (!existsSync(join(docsRoot, category, "index.md"))) reporter.error("PIBO_TAXONOMY_INDEX", `docs/${category}/index.md`, "Each Pibo taxonomy directory requires a reserved index.");
		}
		for (const path of docsMarkdown) {
			if (!pathSafety.get(path)) continue;
			const content = readFileSync(resolve(projectRoot, path), "utf8");
			if (["index.md", "log.md"].includes(posix.basename(path))) validateReserved({ content, path, docsRoot, projectRoot, strictLinks: true, requirePiboVersion: true, requirePiboLog: true, reporter });
			else {
				const data = validateConcept({ content, path, docsRoot, projectRoot, reporter, requirementIds, strictLinks: true });
				if (data) concepts.set(path, data);
			}
		}
		validateIndexes({ docsRoot, projectRoot, docsMarkdown: docsMarkdown.filter((path) => pathSafety.get(path)), reporter });
		validateEvidence({ docsRoot, projectRoot, concepts, reporter, controlReadHooks: options.controlReadHooks?.manifest });
	}
	const states = { pending: 0, conformant: 0, reserved: 0, "host-exception": 0 };
	for (const record of records.values()) if (record.state in states) states[record.state] += 1;
	const errorCounts = {};
	for (const error of reporter.errors) errorCounts[error.code] = (errorCounts[error.code] ?? 0) + 1;
	return {
		ok: reporter.errors.length === 0,
		mode,
		projectRoot,
		discovery: discovery.method,
		markdown_paths: mode === "core" ? docsMarkdown.length : discovery.paths.length,
		ledger_records: records.size,
		states,
		errors: reporter.errors,
		warnings: reporter.warnings,
		error_counts: Object.fromEntries(Object.entries(errorCounts).sort(([a], [b]) => a.localeCompare(b))),
	};
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--mode") options.mode = argv[++index];
		else if (arg === "--root") options.projectRoot = argv[++index];
		else if (arg === "--docs") options.docsRoot = argv[++index];
		else if (arg === "--ledger") options.ledgerPath = argv[++index];
		else if (arg === "--json") options.json = true;
		else if (arg === "--help") options.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function printResult(result) {
	console.log(`OKF ${result.mode} validation: ${result.ok ? "PASS" : "FAIL"}`);
	console.log(`Markdown paths: ${result.markdown_paths} (${result.discovery})`);
	if (result.mode !== "core") {
		console.log(`Ledger records: ${result.ledger_records}`);
		console.log(`States: conformant=${result.states.conformant} reserved=${result.states.reserved} pending=${result.states.pending} host-exception=${result.states["host-exception"]}`);
	}
	console.log(`Errors: ${result.errors.length}; warnings: ${result.warnings.length}`);
	for (const [code, count] of Object.entries(result.error_counts)) console.log(`  ${code}: ${count}`);
	const limit = 50;
	for (const issue of result.errors.slice(0, limit)) console.error(`ERROR [${issue.layer}:${issue.code}] ${issue.path}: ${issue.message}`);
	if (result.errors.length > limit) console.error(`... ${result.errors.length - limit} additional errors omitted; use --json for full diagnostics.`);
}

export function runCli(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.help) {
		console.log("Usage: node scripts/validate-okf-docs.mjs [--mode core|migration|strict] [--root .] [--docs docs] [--ledger path] [--json]");
		return 0;
	}
	const result = validateRepository(options);
	if (options.json) console.log(JSON.stringify(result, null, 2));
	else printResult(result);
	return result.ok ? 0 : 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = runCli();
