#!/usr/bin/env node
// Create a GitHub Pull Request for an existing branch via the Pibo GitHub App.
//
// This is the `gh`-free equivalent of `gh pr create --head X --base Y
// --title T --body B`. It uses the same JWT + installation-token pattern
// as scripts/create-github-release.mjs and the shared
// scripts/lib/github-app-auth.mjs helpers, so it works in environments
// where the `gh` CLI is unavailable (e.g. the pibo compute workers).
//
// IMPORTANT: the head branch MUST already exist on the remote. This script
// does not push. The operator is expected to push via SSH first:
//
//   git push -u origin <head-branch>
//
// Idempotency: if an open pull request for the same (head, base) already
// exists, the script returns it instead of failing. Closed/merged PRs do
// not count; the script will create a new one.
//
// Usage:
//   node scripts/create-github-pr.mjs \
//     --head feat/my-branch --base main \
//     --title "Add foo" --body-file pr-body.md
//
//   node scripts/create-github-pr.mjs --head fix/typo --draft \
//     --title "docs: fix typo" --body "Trivial."
//
// Library use:
//   import { createPullRequest } from "./scripts/create-github-pr.mjs";
//   await createPullRequest({ owner, repo, head, base, title, body, draft, appId, appKeyPath });

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	GITHUB_API_ROOT,
	getInstallationAccessToken,
	ghWithFetch,
	resolveAppCredentials,
} from "./lib/github-app-auth.mjs";

const USER_AGENT = "pibo-create-github-pr";
const DEFAULT_OWNER = "Pascapone";
const DEFAULT_REPO = "pibo";
const DEFAULT_BASE = "main";

/**
 * Find an existing open pull request for the given head+base pair.
 * @param {string} accessToken
 * @param {string} owner
 * @param {string} repo
 * @param {string} head
 * @param {string} base
 * @param {{ fetchImpl?: typeof fetch, userAgent?: string }} [options]
 * @returns {Promise<object | null>}
 */
export async function findOpenPullRequest(accessToken, owner, repo, head, base, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const userAgent = options.userAgent ?? USER_AGENT;
	// GitHub head filter is "owner:branch" for cross-repo, "branch" for same-repo.
	const headFilter = `${owner}:${head}`;
	const search = new URLSearchParams({
		state: "open",
		head: headFilter,
		base,
		per_page: "10",
	});
	const prs = await ghWithFetch(
		fetchImpl,
		"GET",
		`${GITHUB_API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${search.toString()}`,
		accessToken,
		undefined,
		{ userAgent },
	);
	if (!Array.isArray(prs) || prs.length === 0) return null;
	// Prefer exact head-ref match over cross-repo (defensive).
	return prs.find((pr) => pr.head && pr.head.ref === head && pr.base && pr.base.ref === base) ?? prs[0];
}

/**
 * Create a pull request via the GitHub App.
 * @param {{
 *   owner: string;
 *   repo: string;
 *   head: string;
 *   base: string;
 *   title: string;
 *   body?: string;
 *   draft?: boolean;
 *   appId: string;
 *   appKeyPath: string;
 *   fetchImpl?: typeof fetch;
 * }} options
 * @returns {Promise<{ pull: object, alreadyExisted: boolean }>}
 */
export async function createPullRequest(options) {
	if (!options || !options.owner || !options.repo) {
		throw new Error("createPullRequest: owner and repo are required");
	}
	if (!options.head || !options.base) {
		throw new Error("createPullRequest: head and base are required");
	}
	if (!options.title) {
		throw new Error("createPullRequest: title is required");
	}
	if (!options.appId || !options.appKeyPath) {
		throw new Error("createPullRequest: appId and appKeyPath are required");
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const privateKeyPem = readFileSync(options.appKeyPath, "utf8");
	const { token: accessToken } = await getInstallationAccessToken(
		options.appId,
		privateKeyPem,
		options.owner,
		{ fetchImpl, userAgent: USER_AGENT },
	);
	const apiOptions = { userAgent: USER_AGENT };

	// Idempotency: return an existing open PR for the same (head, base) pair.
	const existing = await findOpenPullRequest(
		accessToken,
		options.owner,
		options.repo,
		options.head,
		options.base,
		{ fetchImpl, userAgent: USER_AGENT },
	);
	if (existing) {
		return { pull: existing, alreadyExisted: true };
	}

	const pull = await ghWithFetch(
		fetchImpl,
		"POST",
		`${GITHUB_API_ROOT}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/pulls`,
		accessToken,
		{
			title: options.title,
			head: options.head,
			base: options.base,
			body: options.body ?? "",
			draft: options.draft ?? false,
		},
		apiOptions,
	);
	return { pull, alreadyExisted: false };
}

function parseArgs(argv) {
	const parsed = {
		head: undefined,
		base: undefined,
		title: undefined,
		body: undefined,
		bodyFile: undefined,
		draft: false,
		owner: undefined,
		repo: undefined,
		appId: undefined,
		appKey: undefined,
		appEnv: undefined,
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") parsed.help = true;
		else if (arg === "--head") parsed.head = requireValue(argv, ++i, arg);
		else if (arg === "--base") parsed.base = requireValue(argv, ++i, arg);
		else if (arg === "--title") parsed.title = requireValue(argv, ++i, arg);
		else if (arg === "--body") parsed.body = requireValue(argv, ++i, arg);
		else if (arg === "--body-file") parsed.bodyFile = requireValue(argv, ++i, arg);
		else if (arg === "--draft") parsed.draft = true;
		else if (arg === "--owner") parsed.owner = requireValue(argv, ++i, arg);
		else if (arg === "--repo") parsed.repo = requireValue(argv, ++i, arg);
		else if (arg === "--app-id") parsed.appId = requireValue(argv, ++i, arg);
		else if (arg === "--app-key") parsed.appKey = requireValue(argv, ++i, arg);
		else if (arg === "--app-env") parsed.appEnv = requireValue(argv, ++i, arg);
		else throw new Error(`Unknown option ${arg}`);
	}
	return parsed;
}

function requireValue(args, index, option) {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value`);
	}
	return value;
}

function printHelp() {
	console.log(`Usage: node scripts/create-github-pr.mjs --head <branch> --base <branch> --title <title> [options]

Create a GitHub Pull Request for an existing branch via the Pibo GitHub App.

The head branch MUST already exist on the remote. This script does not push.

Required:
  --head <branch>        Source branch (must exist on remote).
  --base <branch>        Target branch. Default: ${DEFAULT_BASE}
  --title <title>        PR title.

Options:
  --body <text>          PR description (inline). Mutually exclusive with --body-file.
  --body-file <path>     PR description from a file. Mutually exclusive with --body.
  --draft                Create as draft PR.
  --owner <owner>        Repository owner. Default: ${DEFAULT_OWNER}
  --repo <repo>          Repository name. Default: ${DEFAULT_REPO}

Authentication (first match wins):
  --app-id <id> --app-key <pem-path>
  PIBO_GITHUB_APP_ID and PIBO_GITHUB_APP_KEY env vars
  --app-env <path>       Path to a KEY=VALUE env file. (Default is platform-specific.)

Idempotency:
  If an open PR for the same (head, base) pair already exists, the script
  returns it instead of failing. The PR is not modified.

Other:
  --help, -h             Show this help.
`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}
	if (!args.head) throw new Error("--head is required (see --help)");
	if (!args.title) throw new Error("--title is required (see --help)");
	if (args.body !== undefined && args.bodyFile !== undefined) {
		throw new Error("--body and --body-file are mutually exclusive");
	}
	const body = args.bodyFile ? readFileSync(args.bodyFile, "utf8") : args.body;
	const creds = resolveAppCredentials(args);
	const owner = args.owner ?? creds.owner ?? DEFAULT_OWNER;
	const repo = args.repo ?? creds.repo ?? DEFAULT_REPO;
	const base = args.base ?? DEFAULT_BASE;

	const result = await createPullRequest({
		owner,
		repo,
		head: args.head,
		base,
		title: args.title,
		body,
		draft: args.draft,
		appId: creds.appId,
		appKeyPath: creds.appKeyPath,
	});

	if (result.alreadyExisted) {
		console.log(`[create-pr] PR for ${owner}:${args.head} -> ${base} already exists: ${result.pull.html_url}`);
	} else {
		console.log(`[create-pr] PR created: ${result.pull.html_url}`);
	}
	console.log(`[create-pr] number: #${result.pull.number}, draft: ${result.pull.draft}, state: ${result.pull.state}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	main().catch((err) => {
		console.error("[create-pr] error:", err && err.message ? err.message : err);
		process.exit(1);
	});
}
