import { readFile } from "node:fs/promises";
import path from "node:path";
import type { StreamingFixtureMix, StreamingFixtureProfile } from "./web-streaming-browser-scripts.js";
import type { StreamingNegativeProfile } from "./web-streaming-types.js";

export const DEFAULT_WATCH_DURATION_MS = 5_000;
export const MAX_WATCH_DURATION_MS = 30_000;
export const DEFAULT_NODE_LIMIT = 250;
export const DEFAULT_DEPTH_LIMIT = 8;
export const DEFAULT_EVENT_LIMIT = 500;
export const DEFAULT_TEXT_LIMIT = 80;

const BATCH_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "DOM max jump", "SSE text events per chunk", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;
const OVERLAY_DROP_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "live pipeline flushed events/overlay expected", "live pipeline overlay events/input expected", "live pipeline current text/expected", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;

export type WebOptions = {
	positionals: string[];
	cdpUrl?: string;
	target?: string;
	scope?: string;
	preset?: string;
	duration?: string;
	runs?: string;
	fixtureProfile?: string;
	fixtureMix?: string;
	fixturePreludeMessages?: string;
	negativeProfile?: string;
	compareUrl?: string;
	providerRequestId?: string;
	providerSessionId?: string;
	providerTurnId?: string;
	providerSelectedSession: boolean;
	compareHosted: boolean;
	compareHostedIfConfigured: boolean;
	json: boolean;
	artifact: boolean;
	fixture: boolean;
	backendFixture: boolean;
	simulateReconnect: boolean;
	simulateTraceCatchup: boolean;
	simulateOverlayDrop: boolean;
	assertHealthy: boolean;
	expectedRegressionPatterns: string[];
	from?: string;
	act: boolean;
	manual: boolean;
	includeText: boolean;
	includeLayout: boolean;
	compact: boolean;
	output?: string;
	jsonOutput?: string;
};

export function parseOptions(args: string[]): WebOptions {
	const options: WebOptions = {
		positionals: [],
		json: false,
		artifact: false,
		fixture: false,
		backendFixture: false,
		simulateReconnect: false,
		simulateTraceCatchup: false,
		simulateOverlayDrop: false,
		assertHealthy: false,
		expectedRegressionPatterns: [],
		providerSelectedSession: false,
		compareHosted: false,
		compareHostedIfConfigured: false,
		act: false,
		manual: false,
		includeText: false,
		includeLayout: false,
		compact: false,
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") options.json = true;
		else if (arg === "--artifact") options.artifact = true;
		else if (arg === "--fixture") options.fixture = true;
		else if (arg === "--backend-fixture") options.backendFixture = true;
		else if (arg === "--simulate-reconnect") options.simulateReconnect = true;
		else if (arg === "--simulate-trace-catchup") options.simulateTraceCatchup = true;
		else if (arg === "--assert") options.assertHealthy = true;
		else if (arg === "--expect-regression") options.expectedRegressionPatterns.push(requireValue(args, ++index, arg));
		else if (arg.startsWith("--expect-regression=")) options.expectedRegressionPatterns.push(arg.slice("--expect-regression=".length));
		else if (arg === "--act") options.act = true;
		else if (arg === "--manual") options.manual = true;
		else if (arg === "--include-text") options.includeText = true;
		else if (arg === "--include-layout") options.includeLayout = true;
		else if (arg === "--compact") options.compact = true;
		else if (arg === "--output") options.output = requireValue(args, ++index, arg);
		else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
		else if (arg === "--json-output") options.jsonOutput = requireValue(args, ++index, arg);
		else if (arg.startsWith("--json-output=")) options.jsonOutput = arg.slice("--json-output=".length);
		else if (arg === "--cdp-url") options.cdpUrl = requireValue(args, ++index, arg);
		else if (arg.startsWith("--cdp-url=")) options.cdpUrl = arg.slice("--cdp-url=".length);
		else if (arg === "--target") options.target = requireValue(args, ++index, arg);
		else if (arg.startsWith("--target=")) options.target = arg.slice("--target=".length);
		else if (arg === "--scope") options.scope = requireValue(args, ++index, arg);
		else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length);
		else if (arg === "--preset") options.preset = requireValue(args, ++index, arg);
		else if (arg.startsWith("--preset=")) options.preset = arg.slice("--preset=".length);
		else if (arg === "--duration") options.duration = requireValue(args, ++index, arg);
		else if (arg.startsWith("--duration=")) options.duration = arg.slice("--duration=".length);
		else if (arg === "--runs") options.runs = requireValue(args, ++index, arg);
		else if (arg.startsWith("--runs=")) options.runs = arg.slice("--runs=".length);
		else if (arg === "--fixture-profile") options.fixtureProfile = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-profile=")) options.fixtureProfile = arg.slice("--fixture-profile=".length);
		else if (arg === "--fixture-mix") options.fixtureMix = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-mix=")) options.fixtureMix = arg.slice("--fixture-mix=".length);
		else if (arg === "--fixture-prelude-messages") options.fixturePreludeMessages = requireValue(args, ++index, arg);
		else if (arg.startsWith("--fixture-prelude-messages=")) options.fixturePreludeMessages = arg.slice("--fixture-prelude-messages=".length);
		else if (arg === "--negative-profile") options.negativeProfile = requireValue(args, ++index, arg);
		else if (arg.startsWith("--negative-profile=")) options.negativeProfile = arg.slice("--negative-profile=".length);
		else if (arg === "--compare-url") options.compareUrl = requireValue(args, ++index, arg);
		else if (arg.startsWith("--compare-url=")) options.compareUrl = arg.slice("--compare-url=".length);
		else if (arg === "--provider-request-id") options.providerRequestId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-request-id=")) options.providerRequestId = arg.slice("--provider-request-id=".length);
		else if (arg === "--provider-session-id") options.providerSessionId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-session-id=")) options.providerSessionId = arg.slice("--provider-session-id=".length);
		else if (arg === "--provider-turn-id") options.providerTurnId = requireValue(args, ++index, arg);
		else if (arg.startsWith("--provider-turn-id=")) options.providerTurnId = arg.slice("--provider-turn-id=".length);
		else if (arg === "--provider-selected-session") options.providerSelectedSession = true;
		else if (arg === "--compare-hosted") options.compareHosted = true;
		else if (arg === "--compare-hosted-if-configured") options.compareHostedIfConfigured = true;
		else if (arg === "--from") options.from = requireValue(args, ++index, arg);
		else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
		else options.positionals.push(arg);
	}
	return options;
}

function requireValue(args: string[], index: number, flag: string): string {
	const value = args[index];
	if (!value) throw new Error(`${flag} requires a value`);
	return value;
}

export function resolveScope(options: WebOptions): string {
	if (options.scope) return options.scope;
	if (options.preset) return presetScope(options.preset);
	throw new Error("Missing --scope or --preset. Try --preset session-list, chat-shell, composer, or app.");
}

export function presetScope(preset: string): string {
	switch (preset) {
		case "app": return "[data-pibo-debug=\"chat-app\"]";
		case "route-shell": return "[data-pibo-debug=\"route-shell\"]";
		case "sidebar": return "[data-pibo-debug=\"sidebar-shell\"]";
		case "session-list": return "[data-pibo-debug=\"session-list\"]";
		case "chat-shell": return "[data-pibo-debug=\"chat-shell\"]";
		case "composer": return "[data-pibo-debug=\"composer\"]";
		default: throw new Error(`Unknown web render preset "${preset}". Use app, route-shell, sidebar, session-list, chat-shell, or composer.`);
	}
}

export function parseDuration(value?: string): number {
	if (!value) return DEFAULT_WATCH_DURATION_MS;
	const duration = Number(value);
	if (!Number.isFinite(duration) || duration <= 0) throw new Error("--duration must be a positive number of milliseconds");
	if (duration > MAX_WATCH_DURATION_MS) throw new Error(`--duration must be <= ${MAX_WATCH_DURATION_MS}ms`);
	return Math.round(duration);
}

export function parseRuns(value?: string): number {
	if (!value) return 1;
	const runs = Number(value);
	if (!Number.isInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");
	if (runs > 10) throw new Error("--runs must be <= 10");
	return runs;
}

export function parseFixtureProfile(value?: string): StreamingFixtureProfile {
	if (!value) return "steady";
	if (value === "steady" || value === "jitter" || value === "burst" || value === "batch") return value;
	throw new Error("--fixture-profile must be steady, jitter, burst, or batch");
}

export function parseFixtureMix(value?: string): StreamingFixtureMix {
	if (!value) return "text";
	if (value === "text" || value === "reasoning-text" || value === "markdown" || value === "gfm-markdown" || value === "gfm-task-markdown" || value === "gfm-full-markdown") return value;
	throw new Error("--fixture-mix must be text, reasoning-text, markdown, gfm-markdown, gfm-task-markdown, or gfm-full-markdown");
}

export function parseFixturePreludeMessages(value?: string): number {
	if (!value) return 0;
	const count = Number(value);
	if (!Number.isInteger(count) || count < 0) throw new Error("--fixture-prelude-messages must be a non-negative integer");
	if (count > 2000) throw new Error("--fixture-prelude-messages must be <= 2000");
	return count;
}

export function parseNegativeProfile(value?: string): StreamingNegativeProfile | undefined {
	if (!value) return undefined;
	if (value === "batch" || value === "overlay-drop") return value;
	throw new Error("--negative-profile must be batch or overlay-drop");
}

export function applyNegativeStreamingProfile(options: WebOptions, profile: StreamingNegativeProfile): WebOptions {
	const conflictingFlags: string[] = [];
	if (options.fixture) conflictingFlags.push("--fixture");
	if (options.backendFixture) conflictingFlags.push("--backend-fixture");
	if (options.fixtureProfile) conflictingFlags.push("--fixture-profile");
	if (options.fixtureMix) conflictingFlags.push("--fixture-mix");
	if (options.fixturePreludeMessages) conflictingFlags.push("--fixture-prelude-messages");
	if (options.simulateReconnect) conflictingFlags.push("--simulate-reconnect");
	if (options.simulateTraceCatchup) conflictingFlags.push("--simulate-trace-catchup");
	if (options.simulateOverlayDrop) conflictingFlags.push("--simulate-overlay-drop");
	if (options.expectedRegressionPatterns.length > 0) conflictingFlags.push("--expect-regression");
	if (conflictingFlags.length > 0) throw new Error(`--negative-profile ${profile} already selects fixture settings and expected regressions; remove ${conflictingFlags.join(", ")}`);
	return {
		...options,
		backendFixture: true,
		fixtureProfile: profile === "batch" ? "batch" : "steady",
		fixtureMix: "reasoning-text",
		simulateOverlayDrop: profile === "overlay-drop",
		assertHealthy: true,
		expectedRegressionPatterns: profile === "batch" ? [...BATCH_NEGATIVE_EXPECTED_REGRESSIONS] : [...OVERLAY_DROP_NEGATIVE_EXPECTED_REGRESSIONS],
	};
}

export function resolveStreamingBenchmarkCompareUrl(rawCompareUrl: string, primaryUrl: string): string {
	const primary = new URL(primaryUrl);
	const compare = new URL(rawCompareUrl, primary);
	const comparePath = compare.pathname.replace(/\/+$/, "");
	const primaryPath = primary.pathname.replace(/\/+$/, "");
	if ((comparePath === "" || comparePath === "/apps/chat") && primaryPath.startsWith("/apps/chat/")) {
		compare.pathname = primary.pathname;
		compare.search = primary.search;
	}
	compare.searchParams.set("debugStreaming", "1");
	return compare.toString();
}

export async function resolveStreamingBenchmarkHostedCompareUrl(options: { optional?: boolean } = {}): Promise<string | undefined> {
	const hostedUrl = resolveStreamingBenchmarkHostedCompareUrlFromValues(process.env, await readDeveloperHostEnvFile());
	if (hostedUrl || options.optional) return hostedUrl;
	throw new Error("--compare-hosted requires PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL in the environment or .env.developer-host");
}

export function resolveStreamingBenchmarkHostedCompareUrlFromValues(env: Record<string, string | undefined>, envFile: Record<string, string | undefined>): string | undefined {
	const directUrl = env.PIBO_DEV_PUBLIC_URL?.trim();
	if (directUrl) return directUrl;
	const baseUrl = env.PIBO_DEV_BASE_URL?.trim();
	if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}/apps/chat`;
	const fileDirectUrl = envFile.PIBO_DEV_PUBLIC_URL?.trim();
	if (fileDirectUrl) return fileDirectUrl;
	const fileBaseUrl = envFile.PIBO_DEV_BASE_URL?.trim();
	if (fileBaseUrl) return `${fileBaseUrl.replace(/\/+$/, "")}/apps/chat`;
	return undefined;
}

async function readDeveloperHostEnvFile(): Promise<Record<string, string>> {
	try {
		return parseSimpleEnvFile(await readFile(path.resolve(process.cwd(), ".env.developer-host"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

function parseSimpleEnvFile(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
		const equals = assignment.indexOf("=");
		if (equals <= 0) continue;
		const key = assignment.slice(0, equals).trim();
		if (key !== "PIBO_DEV_PUBLIC_URL" && key !== "PIBO_DEV_BASE_URL") continue;
		values[key] = stripEnvQuotes(assignment.slice(equals + 1).trim());
	}
	return values;
}

function stripEnvQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}
