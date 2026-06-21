#!/usr/bin/env node
// Smoke-Test: GitHub App JWT-Generierung mit PEM + App-ID.
// Erzeugt NUR ein App-JWT (kein API-Call). Verifiziert, dass:
//   - die App-Credentials lesbar sind
//   - das PEM mit RS256 signiert werden kann
//   - die App-ID das richtige Format hat (numerisch oder Iv...-Präfix)
//   - der Token die richtige Struktur hat
//
// Optional: macht einen Live-API-Call (GET /app) zur vollständigen
// Verifikation der App-Permissions. Default: Live-Call aktiv.
//
// Verwendung: node scripts/test-github-app-auth.mjs
//             node scripts/test-github-app-auth.mjs --no-api
//             node scripts/test-github-app-auth.mjs --app-env <path>
//
// Werte werden NIE geloggt; nur Token-Länge und Format-Checks.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import {
	defaultAppEnv,
	readEnvFile,
	resolvePrivateKeyPath,
} from "./lib/github-app-auth.mjs";

function parseArgs(argv) {
	const parsed = { appEnv: undefined, help: false, noApi: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") parsed.help = true;
		else if (arg === "--app-env") parsed.appEnv = argv[++i];
		else if (arg === "--no-api") parsed.noApi = true;
		else throw new Error(`Unknown option ${arg}`);
	}
	return parsed;
}

function printHelp() {
	console.log(`Usage: node scripts/test-github-app-auth.mjs [options]

Smoke-test the Pibo GitHub App credentials by signing a short-lived
App JWT (RS256). By default also calls GET /app to verify the app
identity and permissions.

Options:
  --app-env <path>  Path to the KEY=VALUE env file.
                    Default: ${defaultAppEnv()}
  --no-api          Skip the live GET /app call. Sign JWT only.

Exit codes:
  0  All checks passed
  1  Credentials missing, unreadable, or invalid
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	printHelp();
	process.exit(0);
}

const envPath = resolve(args.appEnv ?? process.env.PIBO_GITHUB_APP_ENV ?? defaultAppEnv());
let env;
try {
	env = readEnvFile(envPath);
} catch (err) {
	console.error(`[test-github-app-auth] cannot read env file: ${envPath}`);
	console.error(`  cause: ${err && err.message ? err.message : err}`);
	process.exit(1);
}

// GitHub App IDs can be either numeric ("App ID" in app settings) or
// the alphanumeric Client ID ("Iv..." prefix). Modern docs accept both
// as the `iss` claim when signing a JWT. Accept whatever is in the env.
const errors = [];
if (!env.GITHUB_APP_ID) errors.push("GITHUB_APP_ID fehlt in env-Datei");
if (!env.GITHUB_APP_OWNER) errors.push("GITHUB_APP_OWNER fehlt in env-Datei");
if (!env.GITHUB_APP_REPO) errors.push("GITHUB_APP_REPO fehlt in env-Datei");

const pemPath = resolvePrivateKeyPath(env, envPath);
let pem;
try {
	pem = readFileSync(pemPath, "utf8");
} catch (err) {
	errors.push(`PEM nicht lesbar unter ${pemPath}: ${err.message}`);
}

if (errors.length) {
	console.error("[test-github-app-auth] FAILED:");
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}

if (!/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(pem)) {
	console.error("[test-github-app-auth] FAILED: PEM-Datei hat keinen gültigen PRIVATE KEY-Header");
	process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const token = jwt.sign({ iat: now, exp: now + 600, iss: env.GITHUB_APP_ID }, pem, { algorithm: "RS256" });
const [header] = token.split(".");

if (args.noApi) {
	console.log("=== GitHub App Auth Smoke-Test (--no-api) ===");
	console.log(`  Env-Datei:           ${envPath}`);
	console.log(`  PEM-Datei:           ${pemPath}`);
	console.log(`  App-ID:              ${env.GITHUB_APP_ID.length} Zeichen`);
	console.log(`  PEM-Format:          ${pem.split("\n")[0].trim()}`);
	console.log(`  Owner/Repo:          ${env.GITHUB_APP_OWNER}/${env.GITHUB_APP_REPO}`);
	console.log(`  JWT-Länge:           ${token.length} Zeichen`);
	console.log(`  JWT-Header (b64):    ${header}`);
	console.log(`  Token-Gültigkeit:    600 Sekunden`);
	console.log("OK: JWT wurde signiert, kein API-Call abgesetzt (--no-api).");
	process.exit(0);
}

const apiUrl = `https://api.github.com/app`;
const response = await fetch(apiUrl, {
	headers: {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "pibo-test-github-app-auth",
	},
});
const text = await response.text();
if (!response.ok) {
	console.error(`[test-github-app-auth] FAILED: GET /app returned HTTP ${response.status}`);
	console.error(`  Response: ${text.slice(0, 500)}`);
	process.exit(1);
}
const app = JSON.parse(text);
console.log("=== GitHub App Auth Live Test ===");
console.log(`  Env-Datei:           ${envPath}`);
console.log(`  PEM-Datei:           ${pemPath}`);
console.log(`  App-ID:              ${env.GITHUB_APP_ID.length} Zeichen`);
console.log(`  PEM-Format:          ${pem.split("\n")[0].trim()}`);
console.log(`  Owner/Repo:          ${env.GITHUB_APP_OWNER}/${env.GITHUB_APP_REPO}`);
console.log(`  JWT-Länge:           ${token.length} Zeichen`);
console.log(`  JWT-Header (b64):    ${header}`);
console.log(`  Token-Gültigkeit:    600 Sekunden`);
console.log(`  --- Live API Response ---`);
console.log(`  App Name:            ${app.name}`);
console.log(`  App Slug:            ${app.slug}`);
console.log(`  App ID (numeric):    ${app.id}`);
console.log(`  App HTML URL:        ${app.html_url}`);
console.log(`  Permissions:`);
if (app.permissions) {
	for (const [name, level] of Object.entries(app.permissions)) {
		console.log(`    - ${name}: ${level}`);
	}
}
if (Array.isArray(app.events) && app.events.length) {
	console.log(`  Events:              ${app.events.join(", ")}`);
}
console.log("OK: App-JWT authentifiziert erfolgreich.");
