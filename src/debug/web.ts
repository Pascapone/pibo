import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPiboHome } from "../core/pibo-home.js";
import { listBrowserUseCdpTargets, selectBestChatTarget, formatBrowserUseTargets, type BrowserUseCdpTarget } from "../tools/browser-use-cdp.js";
import { CdpClient } from "../tools/cdp-client.js";
import { diffSnapshots, formatSnapshot, formatSnapshotDiff, formatWatch, inferWatchFlickers, type SnapshotNode, type WebSnapshot, type WatchEvent, type WebWatch } from "./web-render-analysis.js";
import type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkCadence,
	StreamingBenchmarkComparison,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkLivePipeline,
	StreamingBenchmarkProviderPreservation,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkSseProbe,
	StreamingBenchmarkSummary,
	StreamingBenchmarkTraceProbe,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
	StreamingNegativeProfile,
	StreamingSmoothnessScore,
} from "./web-streaming-types.js";
export type {
	NumberStats,
	StreamingBenchmark,
	StreamingBenchmarkAssertion,
	StreamingBenchmarkCadence,
	StreamingBenchmarkComparison,
	StreamingBenchmarkEventSourceProbe,
	StreamingBenchmarkEventSourceStreamProbe,
	StreamingBenchmarkGroup,
	StreamingBenchmarkLivePipeline,
	StreamingBenchmarkProviderPreservation,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkSseProbe,
	StreamingBenchmarkSummary,
	StreamingBenchmarkTraceProbe,
	StreamingBenchmarkUrlComparison,
	StreamingDebugCounters,
	StreamingNegativeProfile,
	StreamingSmoothnessScore,
} from "./web-streaming-types.js";
import {
	formatStreamingBenchmarkAssertionError,
	formatStreamingBenchmarkCompactReport,
	formatStreamingBenchmarkResult,
	streamingBenchmarkReportRows,
	summarizeStreamingSelectedLiveEventSource,
} from "./web-streaming-report.js";
import {
	collectStreamingProviderTelemetry,
	collectStreamingProviderTelemetryFromSelectedBrowserSession,
	collectStreamingProviderTelemetryFromSession,
	collectStreamingProviderTelemetryFromTurn,
} from "./web-streaming-provider-telemetry.js";
export { formatStreamingBenchmarkAssertionSummary, formatStreamingBenchmarkUrlComparison, summarizeStreamingSelectedLiveEventSource } from "./web-streaming-report.js";
export { collectStreamingProviderTelemetryFromSelectedBrowserSession, collectStreamingProviderTelemetryFromSession, collectStreamingProviderTelemetryFromTurn, summarizeStreamingProviderTelemetry } from "./web-streaming-provider-telemetry.js";
export { formatWatch, inferWatchFlickers } from "./web-render-analysis.js";

const DEFAULT_WATCH_DURATION_MS = 5_000;
const MAX_WATCH_DURATION_MS = 30_000;
const DEFAULT_NODE_LIMIT = 250;
const DEFAULT_DEPTH_LIMIT = 8;
const DEFAULT_EVENT_LIMIT = 500;
const DEFAULT_TEXT_LIMIT = 80;
const STDOUT_BUDGET = 12_000;
const BATCH_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "DOM max jump", "SSE text events per chunk", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;
const OVERLAY_DROP_NEGATIVE_EXPECTED_REGRESSIONS = ["positive DOM updates", "live pipeline flushed events/overlay expected", "live pipeline overlay events/input expected", "live pipeline current text/expected", "live pipeline flush/enqueue", "live pipeline overlay updates/flushed"] as const;
const LIVE_PIPELINE_MIN_PRESERVATION_RATIO = 0.95;
const LIVE_PIPELINE_MIN_FLUSH_RATIO = 0.75;
const URL_COMPARISON_MAX_SMOOTHNESS_DROP = 15;
const URL_COMPARISON_MAX_DOM_LAG_DELTA_MS = 150;
const URL_COMPARISON_MAX_SSE_LAG_DELTA_MS = 100;
const URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS = 100;
const URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS = 250;
const URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS = 300;
const PROVIDER_MIN_TEXT_PRESERVATION_RATIO = 0.95;
const PROVIDER_MIN_REASONING_PRESERVATION_RATIO = 0.95;

type WebOptions = {
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

export async function runDebugWeb(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printWebDiscovery();
		return;
	}

	const command = args[0];
	const options = parseOptions(args.slice(1));
	if (command === "targets") {
		await runTargets(options);
		return;
	}
	if (command === "attach-chat") {
		await runAttachChat(options);
		return;
	}
	if (command === "snapshot") {
		await runSnapshot(options);
		return;
	}
	if (command === "diff") {
		await runDiff(options);
		return;
	}
	if (command === "watch") {
		await runWatch(options);
		return;
	}
	if (command === "scenario") {
		await runScenario(options);
		return;
	}
	if (command === "report") {
		await runReport(options);
		return;
	}
	throw new Error(`Unknown pibo debug web command "${command}". Run pibo debug web --help.`);
}

function printWebDiscovery(): void {
	console.log(`pibo debug web - inspect browser render state via CDP

Commands:
  targets      List Chrome CDP targets with Chat auth hints
  attach-chat  Show the best authenticated Chat Web target
  snapshot     Capture a scoped compact DOM snapshot
  diff         Compare current scoped snapshot against previous or artifact
  watch        Record a bounded scoped DOM/focus/route timeline
  scenario     Run guided Chat Web debug workflows
  report       Render saved debug artifacts as reviewer-friendly Markdown

Next:
  pibo debug web targets
  pibo debug web snapshot --preset session-list
  pibo debug web watch --preset chat-shell --duration 5000
  pibo debug web report streaming-benchmark --from artifact.json
`);
}

function printSnapshotHelp(): void {
	console.log(`pibo debug web snapshot - capture a scoped compact DOM snapshot

Usage:
  pibo debug web snapshot --scope <selector> [--target id|ws] [--json] [--artifact]
  pibo debug web snapshot --preset session-list

Presets:
  app | route-shell | sidebar | session-list | chat-shell | composer

Next:
  pibo debug web diff --preset session-list
  pibo debug web watch --preset chat-shell --duration 5000
`);
}

function printWatchHelp(): void {
	console.log(`pibo debug web watch - record compact render-state changes

Usage:
  pibo debug web watch --scope <selector> [--duration ms] [--target id|ws] [--json] [--artifact]
  pibo debug web watch --preset chat-shell --duration 5000

Defaults:
  duration=5000ms, max=30000ms, event budget=500

Next:
  pibo debug web diff --preset chat-shell
  pibo debug web scenario new-session --manual
`);
}

function printScenarioHelp(): void {
	console.log(`pibo debug web scenario - guided Chat Web debug workflows

Usage:
  pibo debug web scenario new-session [--manual|--act] [--duration ms] [--json] [--artifact]
  pibo debug web scenario streaming-benchmark [--fixture|--backend-fixture] [--fixture-profile steady|jitter|burst|batch] [--fixture-mix text|reasoning-text|markdown|gfm-markdown|gfm-task-markdown|gfm-full-markdown] [--fixture-prelude-messages n] [--simulate-reconnect|--simulate-trace-catchup] [--duration ms] [--runs n] [--from artifact.json] [--provider-request-id pr_...|--provider-session-id ps_...|--provider-turn-id turn_...|--provider-selected-session] [--compare-url url|--compare-hosted|--compare-hosted-if-configured] [--assert] [--expect-regression text] [--negative-profile batch|overlay-drop] [--json] [--artifact]

Defaults:
  new-session --manual waits while you click New Session yourself.
  new-session --act clicks the discovered New Session button after the watcher starts.
  streaming-benchmark enables debugStreaming for future events, observes assistant DOM increments, and snapshots window.__piboStreamingDebug.
  streaming-benchmark --fixture navigates the target to a deterministic in-browser stream fixture before measuring.
  streaming-benchmark --backend-fixture posts to /api/chat/debug/streaming-fixture and records EventSource metrics while the real app consumes deterministic /api/chat/events frames.
  streaming-benchmark --fixture-profile selects steady cadence, deterministic jitter, bursty timing, or intentional batch stress.
  streaming-benchmark --fixture-mix includes text-only, mixed reasoning/text, CommonMark Markdown, simple GFM Markdown, or full-parser GFM Markdown assistant deltas.
  streaming-benchmark --fixture-prelude-messages seeds completed live assistant messages before counters reset so large live overlays can be measured without changing fixture preservation denominators.
  streaming-benchmark --simulate-reconnect reloads the app with an EventSource probe, forces one live stream close, and verifies reconnect/transient ids.
  streaming-benchmark --simulate-trace-catchup suppresses backend live text deltas and verifies trace snapshot recovery.
  streaming-benchmark --runs repeats the same scenario and reports medians; --from compares against a prior benchmark artifact.
  streaming-benchmark --compare-url runs the same backend fixture at another Chat URL, for direct-vs-hosted SSE comparison.
  streaming-benchmark --compare-hosted uses PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL from the environment or .env.developer-host as the compare URL.
  streaming-benchmark --compare-hosted-if-configured runs the hosted comparison when a dev URL is configured; otherwise it records a warning and keeps the primary benchmark.
  streaming-benchmark --provider-request-id attaches provider/Pi telemetry delta counts, byte stats, gap stats, parse errors, first-text latency, and provider-to-transport preservation ratios from pibo debug telemetry.
  streaming-benchmark --provider-session-id, --provider-turn-id, or --provider-selected-session discovers the latest provider request from telemetry session/turn metadata after the benchmark window before attaching provider metrics.
  streaming-benchmark --assert exits non-zero when fixture/debug/DOM/provider preservation gates fail.
  streaming-benchmark --expect-regression marks a required regression substring for controlled negative benchmarks; unexpected or missing expected regressions still fail with --assert.
  streaming-benchmark --negative-profile batch expands to the backend batch reasoning/text fixture with required controlled regression assertions.
  streaming-benchmark --negative-profile overlay-drop preserves SSE/EventSource input but drops live-overlay text/reasoning enqueue for a controlled pipeline-preservation failure.
`);
}

function printReportHelp(): void {
	console.log(`pibo debug web report - render saved debug artifacts

Usage:
  pibo debug web report streaming-benchmark --from artifact.json [--compact] [--output report.md] [--json-output report.json] [--json] [--artifact]

Reports:
  streaming-benchmark  Summarize saved pibo debug web scenario streaming-benchmark JSON as Markdown.
  --compact            Render reviewer-friendly Markdown tables instead of the detailed line report.
  --output             Write the Markdown report to a specific file path.
  --json-output        Write the normalized JSON report payload and compact rows to a specific file path.

Next:
  pibo debug web scenario streaming-benchmark --backend-fixture --assert --artifact
`);
}

async function runTargets(options: WebOptions): Promise<void> {
	const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: true });
	if (options.json) {
		console.log(JSON.stringify({ targets }, null, 2));
		return;
	}
	console.log(formatBrowserUseTargets(targets));
	if (targets.length === 0) {
		console.log("\nNext: eval \"$(pibo tools env browser-use)\" or pass --cdp-url http://127.0.0.1:<port>");
	}
}

async function runAttachChat(options: WebOptions): Promise<void> {
	const targets = await listBrowserUseCdpTargets({ cdpUrl: options.cdpUrl, probe: true });
	const target = resolveTargetFromList(targets, options.target) ?? selectBestChatTarget(targets);
	if (!target) {
		throw new Error("No authenticated Chat Web target with a composer textarea was found. Next: pibo tools browser-use targets or acquire a Browser Use lease.");
	}
	if (options.json) {
		console.log(JSON.stringify({ target }, null, 2));
		return;
	}
	console.log(`target\t${target.id}`);
	console.log(`url\t${target.url}`);
	console.log(`auth\t${target.auth}`);
	console.log(`composer\t${target.composer ? "yes" : "no"}`);
	console.log(`ws\t${target.webSocketDebuggerUrl ?? ""}`);
	console.log("\nNext:");
	console.log(`  pibo debug web snapshot --target ${shellQuote(target.id)} --preset session-list`);
	console.log(`  pibo debug web watch --target ${shellQuote(target.id)} --preset chat-shell --duration 5000`);
}

async function runSnapshot(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		printSnapshotHelp();
		return;
	}
	const scope = resolveScope(options);
	const { client, target } = await connectTarget(options);
	try {
		const snapshot = await captureSnapshot(client, scope, options);
		if (options.json) {
			console.log(JSON.stringify({ target: compactTarget(target), snapshot }, null, 2));
		} else {
			console.log(limitStdout(formatSnapshot(snapshot, target)));
		}
		await writeLastSnapshot(snapshot);
		if (options.artifact) {
			const artifact = await writeArtifact("snapshot", snapshot);
			if (!options.json) console.log(`Artifact: ${artifact}`);
		}
	} finally {
		client.close();
	}
}

async function runDiff(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		console.log(`pibo debug web diff - compare scoped render snapshots

Usage:
  pibo debug web diff --scope <selector> [--from artifact.json]
  pibo debug web diff --preset session-list

Default --from is the last snapshot captured by pibo debug web snapshot.
`);
		return;
	}
	const scope = resolveScope(options);
	const baseline = await readBaselineSnapshot(options.from);
	const { client, target } = await connectTarget(options);
	try {
		const current = await captureSnapshot(client, scope, options);
		if (baseline.scope !== current.scope) {
			if (options.json) console.log(JSON.stringify({ target: compactTarget(target), baseline, current, error: "scope_mismatch" }, null, 2));
			else console.log(`Scope mismatch: baseline=${baseline.scope} current=${current.scope}\nTake a new baseline with: pibo debug web snapshot --scope ${shellQuote(current.scope)}`);
			await writeLastSnapshot(current);
			return;
		}
		const diff = diffSnapshots(baseline, current);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), baseline, current, diff }, null, 2));
		else console.log(limitStdout(formatSnapshotDiff(diff, baseline, current, target)));
		await writeLastSnapshot(current);
		if (options.artifact) {
			const artifact = await writeArtifact("diff", { baseline, current, diff });
			if (!options.json) console.log(`Artifact: ${artifact}`);
		}
	} finally {
		client.close();
	}
}

async function runWatch(options: WebOptions): Promise<void> {
	if (options.positionals[0] === "--help" || options.positionals[0] === "-h") {
		printWatchHelp();
		return;
	}
	if (options.act || options.manual) {
		throw new Error("Action flags are only supported by scenarios. Next: pibo debug web scenario new-session --act");
	}
	if (options.positionals.length) {
		throw new Error(`Unexpected pibo debug web watch argument "${options.positionals[0]}". Run pibo debug web watch --help.`);
	}
	const scope = resolveScope(options);
	const durationMs = parseDuration(options.duration);
	const { client, target } = await connectTarget(options);
	try {
		const watch = await runBrowserWatch(client, scope, durationMs, options);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), watch }, null, 2));
		else console.log(limitStdout(formatWatch(watch, target)));
		await writeLastSnapshot(watch.after ?? watch.before);
		const artifact = await writeArtifact("watch", watch);
		if (options.artifact && !options.json) console.log(`Artifact: ${artifact}`);
	} finally {
		client.close();
	}
}

async function runScenario(options: WebOptions): Promise<void> {
	const scenario = options.positionals[0];
	if (!scenario || scenario === "--help" || scenario === "-h") {
		printScenarioHelp();
		return;
	}
	if (options.positionals.length > 1) {
		throw new Error(`Unexpected pibo debug web scenario argument "${options.positionals[1]}". Run pibo debug web scenario --help.`);
	}
	if (options.act && options.manual) throw new Error("Use either --manual or --act, not both.");
	if (scenario !== "new-session" && scenario !== "streaming-benchmark") throw new Error(`Unknown pibo debug web scenario "${scenario}". Run pibo debug web scenario --help.`);
	if (scenario === "streaming-benchmark" && (options.act || options.manual)) throw new Error("streaming-benchmark does not support --act or --manual. Start or observe the stream separately, then run the scenario.");
	const negativeProfile = scenario === "streaming-benchmark" ? parseNegativeProfile(options.negativeProfile) : undefined;
	const streamingOptions = negativeProfile ? applyNegativeStreamingProfile(options, negativeProfile) : options;
	if (scenario === "streaming-benchmark" && streamingOptions.fixture && streamingOptions.backendFixture) throw new Error("Use either --fixture or --backend-fixture, not both.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixtureProfile && !streamingOptions.fixture && !streamingOptions.backendFixture) throw new Error("--fixture-profile requires --fixture or --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixtureMix && !streamingOptions.fixture && !streamingOptions.backendFixture) throw new Error("--fixture-mix requires --fixture or --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.fixturePreludeMessages && !streamingOptions.backendFixture) throw new Error("--fixture-prelude-messages requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateReconnect && !streamingOptions.backendFixture) throw new Error("--simulate-reconnect requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateTraceCatchup && !streamingOptions.backendFixture) throw new Error("--simulate-trace-catchup requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateOverlayDrop && !streamingOptions.backendFixture) throw new Error("overlay-drop simulation requires --backend-fixture.");
	if (scenario === "streaming-benchmark" && streamingOptions.simulateReconnect && streamingOptions.simulateTraceCatchup) throw new Error("Use either --simulate-reconnect or --simulate-trace-catchup, not both.");
	if (scenario === "streaming-benchmark" && [streamingOptions.simulateReconnect, streamingOptions.simulateTraceCatchup, streamingOptions.simulateOverlayDrop].filter(Boolean).length > 1) throw new Error("Use only one streaming simulation mode.");
	const providerTelemetryModes = [streamingOptions.providerRequestId ? "--provider-request-id" : undefined, streamingOptions.providerSessionId ? "--provider-session-id" : undefined, streamingOptions.providerTurnId ? "--provider-turn-id" : undefined, streamingOptions.providerSelectedSession ? "--provider-selected-session" : undefined].filter(Boolean);
	if (scenario === "streaming-benchmark" && providerTelemetryModes.length > 1) throw new Error(`Use only one provider telemetry source flag: ${providerTelemetryModes.join(", ")}.`);
	const hostedCompareModes = [streamingOptions.compareUrl ? "--compare-url" : undefined, streamingOptions.compareHosted ? "--compare-hosted" : undefined, streamingOptions.compareHostedIfConfigured ? "--compare-hosted-if-configured" : undefined].filter(Boolean);
	if (scenario === "streaming-benchmark" && hostedCompareModes.length > 1) throw new Error(`Use only one compare target flag: ${hostedCompareModes.join(", ")}.`);
	if (scenario === "streaming-benchmark" && streamingOptions.compareUrl && !streamingOptions.backendFixture) throw new Error("--compare-url requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	if (scenario === "streaming-benchmark" && streamingOptions.compareHosted && !streamingOptions.backendFixture) throw new Error("--compare-hosted requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	if (scenario === "streaming-benchmark" && streamingOptions.compareHostedIfConfigured && !streamingOptions.backendFixture) throw new Error("--compare-hosted-if-configured requires --backend-fixture so the benchmark can replay a deterministic stream at both URLs.");
	const hostedCompareUrl = scenario === "streaming-benchmark" && (streamingOptions.compareHosted || streamingOptions.compareHostedIfConfigured) ? await resolveStreamingBenchmarkHostedCompareUrl({ optional: streamingOptions.compareHostedIfConfigured }) : undefined;
	const hostedCompareWarning = scenario === "streaming-benchmark" && streamingOptions.compareHostedIfConfigured && !hostedCompareUrl ? "--compare-hosted-if-configured skipped: PIBO_DEV_PUBLIC_URL or PIBO_DEV_BASE_URL is not configured" : undefined;
	const fixtureProfile = parseFixtureProfile(streamingOptions.fixtureProfile);
	const fixtureMix = parseFixtureMix(streamingOptions.fixtureMix);
	const fixturePreludeMessages = parseFixturePreludeMessages(streamingOptions.fixturePreludeMessages);
	const durationMs = parseDuration(streamingOptions.duration);
	const runs = parseRuns(streamingOptions.runs);
	const { client, target } = await connectTarget({ ...options, preset: "app" });
	try {
		if (scenario === "streaming-benchmark") {
			const baseline = streamingOptions.from ? await readStreamingBenchmarkRuns(streamingOptions.from) : undefined;
			const providerTelemetryRequested = providerTelemetryModes.length > 0;
			const runOptions = { startFixture: streamingOptions.fixture, startBackendFixture: streamingOptions.backendFixture, fixtureProfile, fixtureMix, fixturePreludeMessages, simulateReconnect: streamingOptions.simulateReconnect, simulateTraceCatchup: streamingOptions.simulateTraceCatchup, simulateOverlayDrop: streamingOptions.simulateOverlayDrop, negativeProfile };
			const primaryUrl = await currentBrowserUrl(client);
			const rawBenchmarks = await runStreamingBenchmarkSeries(client, runs, durationMs, runOptions);
			const primaryProviderTelemetry = providerTelemetryRequested ? await collectStreamingProviderTelemetryForOptions(streamingOptions, client) : undefined;
			const benchmarks = attachStreamingProviderTelemetryToBenchmarks(rawBenchmarks, primaryProviderTelemetry);
			let benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison = runs === 1
				? benchmarks[0]
				: summarizeStreamingBenchmarkGroup(benchmarks, baseline);
			const rawCompareUrl = streamingOptions.compareUrl ?? hostedCompareUrl;
			if (!rawCompareUrl && hostedCompareWarning) benchmark.warnings.push(hostedCompareWarning);
			if (rawCompareUrl) {
				const compareUrl = resolveStreamingBenchmarkCompareUrl(rawCompareUrl, primaryUrl);
				await navigateStreamingBenchmarkTarget(client, compareUrl);
				const rawCompareRuns = await runStreamingBenchmarkSeries(client, runs, durationMs, runOptions);
				const compareProviderTelemetry = providerTelemetryRequested ? await collectStreamingProviderTelemetryForOptions(streamingOptions, client) : undefined;
				const compareRuns = attachStreamingProviderTelemetryToBenchmarks(rawCompareRuns, compareProviderTelemetry);
				const primaryGroup = summarizeStreamingBenchmarkGroup(benchmarks, baseline);
				const compareGroup = summarizeStreamingBenchmarkGroup(compareRuns, benchmarks);
				benchmark = summarizeStreamingBenchmarkUrlComparison(primaryUrl, compareUrl, primaryGroup, compareGroup);
			}
			const assertion = applyExpectedStreamingRegressions(benchmark, streamingOptions.expectedRegressionPatterns);
			if (streamingOptions.json) console.log(JSON.stringify({ target: compactTarget(target), scenario, benchmark }, null, 2));
			else console.log(limitStdout(formatStreamingBenchmarkResult(benchmark, target)));
			const artifact = await writeArtifact(`scenario-${scenario}`, benchmark);
			if (!streamingOptions.json) console.log(`Artifact: ${artifact}`);
			if (streamingOptions.assertHealthy && !assertion.passed) throw new Error(formatStreamingBenchmarkAssertionError(assertion));
			return;
		}

		const watch = await runBrowserWatch(client, presetScope("app"), durationMs, {
			...options,
			act: options.act,
			manual: !options.act,
		}, options.act ? "new-session" : undefined);
		if (options.json) console.log(JSON.stringify({ target: compactTarget(target), scenario, watch }, null, 2));
		else console.log(limitStdout(formatWatch(watch, target, `scenario ${scenario}`)));
		const artifact = await writeArtifact(`scenario-${scenario}`, watch);
		if (!options.json) console.log(`Artifact: ${artifact}`);
	} finally {
		client.close();
	}
}

async function runReport(options: WebOptions): Promise<void> {
	const report = options.positionals[0];
	if (!report || report === "--help" || report === "-h") {
		printReportHelp();
		return;
	}
	if (options.positionals.length > 1) {
		throw new Error(`Unexpected pibo debug web report argument "${options.positionals[1]}". Run pibo debug web report --help.`);
	}
	if (report !== "streaming-benchmark") {
		throw new Error(`Unknown pibo debug web report "${report}". Run pibo debug web report --help.`);
	}
	if (!options.from) throw new Error("pibo debug web report streaming-benchmark requires --from artifact.json");
	const benchmark = await readStreamingBenchmarkArtifact(options.from);
	const target = streamingBenchmarkReportTarget(benchmark);
	const markdown = options.compact ? formatStreamingBenchmarkCompactReport(benchmark, target) : formatStreamingBenchmarkResult(benchmark, target);
	const format = options.compact ? "compact" : "detailed";
	const output = options.output ? await writeReportOutput(options.output, markdown) : undefined;
	const artifact = options.artifact ? await writeTextArtifact(options.compact ? "report-streaming-benchmark-compact" : "report-streaming-benchmark", "md", markdown) : undefined;
	const jsonOutput = options.jsonOutput ? path.resolve(options.jsonOutput) : undefined;
	const rows = streamingBenchmarkReportRows(benchmark, options.compact);
	const jsonPayload = { report, source: options.from, format, target, output, artifact, jsonOutput, markdown, rows, benchmark };
	if (options.jsonOutput) await writeReportOutput(options.jsonOutput, JSON.stringify(jsonPayload, null, 2));
	if (options.json) console.log(JSON.stringify(jsonPayload, null, 2));
	else {
		if (output) console.log(`Wrote report: ${output}`);
		else console.log(markdown);
		if (artifact) console.log(`Artifact: ${artifact}`);
		if (jsonOutput) console.log(`Wrote report JSON: ${jsonOutput}`);
	}
}

async function connectTarget(options: WebOptions): Promise<{ client: CdpClient; target: BrowserUseCdpTarget | { id: string; url: string; title: string; webSocketDebuggerUrl: string } }> {
	const envWs = process.env.PIBO_CDP_TARGET_WS;
	if (isWebSocketUrl(options.target)) {
		const client = new CdpClient(options.target!);
		await client.connect();
		return { client, target: { id: "direct", url: "", title: "direct", webSocketDebuggerUrl: options.target! } };
	}
	if (!options.target && envWs) {
		const client = new CdpClient(envWs);
		await client.connect();
		return { client, target: { id: process.env.PIBO_CDP_TARGET_ID ?? "env", url: process.env.PIBO_CHAT_URL ?? "", title: "env", webSocketDebuggerUrl: envWs } };
	}

	const cdpUrl = options.cdpUrl ?? process.env.PIBO_CDP_URL;
	const targets = await listBrowserUseCdpTargets({ cdpUrl, probe: !options.target });
	const target = resolveTargetFromList(targets, options.target) ?? selectBestChatTarget(targets) ?? targets.find((item) => item.webSocketDebuggerUrl);
	if (!target?.webSocketDebuggerUrl) {
		throw new Error("No attachable CDP target found. Next: pibo debug web targets or pass --cdp-url/--target.");
	}
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	return { client, target };
}

function resolveTargetFromList(targets: readonly BrowserUseCdpTarget[], target?: string): BrowserUseCdpTarget | undefined {
	if (!target) return undefined;
	return targets.find((item) => item.id === target || item.url === target || item.title === target || item.webSocketDebuggerUrl === target);
}

async function captureSnapshot(client: CdpClient, scope: string, options: WebOptions): Promise<WebSnapshot> {
	const expression = buildSnapshotExpression({
		scope,
		maxNodes: DEFAULT_NODE_LIMIT,
		maxDepth: DEFAULT_DEPTH_LIMIT,
		textLimit: DEFAULT_TEXT_LIMIT,
		includeText: options.includeText,
		includeLayout: options.includeLayout,
	});
	return client.evaluate<WebSnapshot>(expression, 10_000);
}

async function runBrowserWatch(client: CdpClient, scope: string, durationMs: number, options: WebOptions, action?: "new-session"): Promise<WebWatch> {
	const expression = buildWatchExpression({
		scope,
		durationMs,
		maxNodes: DEFAULT_NODE_LIMIT,
		maxDepth: DEFAULT_DEPTH_LIMIT,
		maxEvents: DEFAULT_EVENT_LIMIT,
		textLimit: DEFAULT_TEXT_LIMIT,
		includeText: options.includeText,
		includeLayout: options.includeLayout,
		action,
	});
	return client.evaluate<WebWatch>(expression, durationMs + 10_000);
}

type RunStreamingBenchmarkOptions = { startFixture?: boolean; startBackendFixture?: boolean; fixtureProfile?: StreamingFixtureProfile; fixtureMix?: StreamingFixtureMix; fixturePreludeMessages?: number; simulateReconnect?: boolean; simulateTraceCatchup?: boolean; simulateOverlayDrop?: boolean; negativeProfile?: StreamingNegativeProfile; providerTelemetry?: StreamingBenchmarkProviderTelemetry };

async function runStreamingBenchmarkSeries(client: CdpClient, runs: number, durationMs: number, options: RunStreamingBenchmarkOptions): Promise<StreamingBenchmark[]> {
	if (options.startFixture) await navigateStreamingBenchmarkFixture(client, options.fixtureProfile ?? "steady", options.fixtureMix ?? "text");
	if (options.startBackendFixture) await prepareStreamingBenchmarkEventSourceProbe(client);
	const benchmarks: StreamingBenchmark[] = [];
	for (let run = 0; run < runs; run++) benchmarks.push(await runStreamingBenchmark(client, durationMs, options));
	return benchmarks;
}

async function runStreamingBenchmark(client: CdpClient, durationMs: number, options: RunStreamingBenchmarkOptions = {}): Promise<StreamingBenchmark> {
	await client.send("Page.bringToFront").catch(() => undefined);
	const benchmarkTimeoutMs = durationMs + (options.startBackendFixture ? 20_000 : 10_000);
	const benchmark = await client.evaluate<Omit<StreamingBenchmark, "score">>(buildStreamingBenchmarkExpression(durationMs, options), benchmarkTimeoutMs);
	const withProvider = { ...benchmark, provider: options.providerTelemetry };
	const scored = { ...withProvider, score: scoreStreamingBenchmark(withProvider), providerPreservation: summarizeStreamingProviderPreservation(withProvider) };
	const withLivePipeline = { ...scored, livePipeline: summarizeStreamingLivePipeline(scored) };
	const withCadence = { ...withLivePipeline, cadence: summarizeStreamingCadence(withLivePipeline), negativeProfile: options.negativeProfile };
	return { ...withCadence, regressions: [...withCadence.regressions, ...evaluateStreamingLivePipelineRegressions(withCadence), ...evaluateStreamingProviderRegressions(withCadence)] };
}

export function attachStreamingProviderTelemetryToBenchmark(benchmark: StreamingBenchmark, providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark {
	if (!providerTelemetry) return benchmark;
	const baseRegressions = benchmark.regressions.filter((regression) => !regression.startsWith("provider ") && !regression.startsWith("live pipeline "));
	const withProvider = { ...benchmark, provider: providerTelemetry };
	const providerPreservation = summarizeStreamingProviderPreservation(withProvider);
	const withProviderMetrics = { ...withProvider, providerPreservation, livePipeline: summarizeStreamingLivePipeline(withProvider) };
	return {
		...withProviderMetrics,
		regressions: [...baseRegressions, ...evaluateStreamingLivePipelineRegressions(withProviderMetrics), ...evaluateStreamingProviderRegressions(withProviderMetrics)],
	};
}

function attachStreamingProviderTelemetryToBenchmarks(benchmarks: StreamingBenchmark[], providerTelemetry: StreamingBenchmarkProviderTelemetry | undefined): StreamingBenchmark[] {
	return providerTelemetry ? benchmarks.map((benchmark) => attachStreamingProviderTelemetryToBenchmark(benchmark, providerTelemetry)) : benchmarks;
}

async function currentBrowserUrl(client: CdpClient): Promise<string> {
	const state = await client.evaluate<{ href: string }>(`(() => ({ href: location.href }))()`, 5_000);
	return state.href;
}

async function collectStreamingProviderTelemetryForOptions(options: WebOptions, client: Pick<CdpClient, "evaluate">): Promise<StreamingBenchmarkProviderTelemetry | undefined> {
	if (options.providerRequestId) return collectStreamingProviderTelemetry(options.providerRequestId);
	if (options.providerSessionId) return collectStreamingProviderTelemetryFromSession(options.providerSessionId);
	if (options.providerTurnId) return collectStreamingProviderTelemetryFromTurn(options.providerTurnId);
	if (options.providerSelectedSession) return collectStreamingProviderTelemetryFromSelectedBrowserSession(client);
	return undefined;
}

async function prepareStreamingBenchmarkEventSourceProbe(client: CdpClient, targetUrl?: string): Promise<void> {
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.addScriptToEvaluateOnNewDocument", { source: streamingBenchmarkEventSourceProbeScript() }, 5_000);
	if (targetUrl) await navigateStreamingBenchmarkTarget(client, targetUrl);
	const state = await client.evaluate<{ href: string }>(`(() => {
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch {}
  return { href: location.href };
})()`, 5_000);
	const url = new URL(state.href);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("stream simulation requires an HTTP Chat Web target");
	url.searchParams.set("debugStreaming", "1");
	await navigateStreamingBenchmarkTarget(client, url.toString());
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
	await client.evaluate("new Promise((resolve) => setTimeout(resolve, 800))", 2_000);
}

async function navigateStreamingBenchmarkTarget(client: CdpClient, url: string): Promise<void> {
	try {
		await client.send("Page.navigate", { url }, 5_000);
		return;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("Timed out waiting for CDP method Page.navigate")) throw error;
	}
	await client.evaluate(`(() => { if (location.href !== ${JSON.stringify(url)}) location.assign(${JSON.stringify(url)}); return true; })()`, 5_000).catch(() => undefined);
}

async function navigateStreamingBenchmarkFixture(client: CdpClient, fixtureProfile: StreamingFixtureProfile, fixtureMix: StreamingFixtureMix): Promise<void> {
	const url = `data:text/html;charset=utf-8,${encodeURIComponent(streamingBenchmarkFixtureHtml(fixtureProfile, fixtureMix))}`;
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.navigate", { url }, 5_000);
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
}

async function enableStreamingDebugForCurrentApp(client: CdpClient): Promise<void> {
	const state = await client.evaluate<{ href: string; hasReset: boolean }>(`(() => {
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch {}
  return { href: location.href, hasReset: typeof window.__piboStreamingDebugReset === 'function' };
})()`, 5_000);
	if (state.hasReset) return;
	const url = new URL(state.href);
	if (url.protocol !== "http:" && url.protocol !== "https:") return;
	url.searchParams.set("debugStreaming", "1");
	await client.send("Page.enable").catch(() => undefined);
	await client.send("Page.navigate", { url: url.toString() }, 5_000);
	await client.send("Page.bringToFront").catch(() => undefined);
	await client.evaluate("new Promise((resolve) => { if (document.readyState === 'complete') resolve(true); else addEventListener('load', () => resolve(true), { once: true }); })", 5_000);
	await client.evaluate("new Promise((resolve) => setTimeout(resolve, 500))", 2_000);
}

type StreamingFixtureProfile = "steady" | "jitter" | "burst" | "batch";
type StreamingFixtureMix = "text" | "reasoning-text" | "markdown" | "gfm-markdown" | "gfm-task-markdown" | "gfm-full-markdown";

function streamingBenchmarkEventSourceProbeScript(): string {
	return String.raw`
(() => {
  if (window.__piboStreamingBenchmarkEventSourceProbeInstalled || typeof window.EventSource !== 'function') return;
  const OriginalEventSource = window.EventSource;
  const probe = {
    createdAt: new Date().toISOString(),
    openCount: 0,
    errorCount: 0,
    closeCount: 0,
    forcedCloseCount: 0,
    textDropRequested: false,
    textDropDurationMs: undefined,
    textDropUntil: 0,
    textDropCount: 0,
    textDropTextEventCount: 0,
    events: [],
    connections: [],
  };
  Object.defineProperty(probe, '_instances', { value: [], enumerable: false, configurable: false });
  function at() { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
  function isChatEventsUrl(url) { return String(url || '').includes('/api/chat/events'); }
  function pushConnection(kind, info, extra) {
    probe.connections.push({ t: at(), kind, url: info.url, ...(extra || {}) });
    if (probe.connections.length > 200) probe.connections.splice(0, probe.connections.length - 200);
  }
  function WrappedEventSource(url, init) {
    const events = new OriginalEventSource(url, init);
    const info = { url: String(url), createdAt: at(), closed: false, forcedClosing: false };
    probe._instances.push({ events, info });
    events.addEventListener('open', () => {
      probe.openCount += 1;
      pushConnection('open', info, { readyState: events.readyState });
    });
    events.addEventListener('error', () => {
      probe.errorCount += 1;
      pushConnection('error', info, { readyState: events.readyState });
    });
    events.addEventListener('pibo', (message) => {
      let payload;
      try { payload = JSON.parse(message.data); } catch {}
      const type = payload && typeof payload.type === 'string' ? payload.type : undefined;
      const record = {
        t: at(),
        url: info.url,
        lastEventId: message.lastEventId || '',
        type: typeof type === 'string' ? type : undefined,
        liveReplayId: payload && typeof payload.liveReplayId === 'number' && Number.isFinite(payload.liveReplayId) ? payload.liveReplayId : undefined,
        liveReplayReplayed: payload && payload.liveReplay && typeof payload.liveReplay.replayed === 'number' && Number.isFinite(payload.liveReplay.replayed) ? payload.liveReplay.replayed : undefined,
        liveReplayMissed: Boolean(payload && payload.liveReplay && payload.liveReplay.missed === true),
        liveReplayEvictedBefore: payload && payload.liveReplay && typeof payload.liveReplay.evictedBefore === 'number' && Number.isFinite(payload.liveReplay.evictedBefore) ? payload.liveReplay.evictedBefore : undefined,
        liveReplayRequestedAfter: payload && payload.liveReplay && typeof payload.liveReplay.requestedAfter === 'number' && Number.isFinite(payload.liveReplay.requestedAfter) ? payload.liveReplay.requestedAfter : undefined,
        liveReplayNewestAvailable: payload && payload.liveReplay && typeof payload.liveReplay.newestAvailable === 'number' && Number.isFinite(payload.liveReplay.newestAvailable) ? payload.liveReplay.newestAvailable : undefined,
      };
      probe.events.push(record);
      if (probe.events.length > 1000) probe.events.splice(0, probe.events.length - 1000);
    });
    const originalClose = events.close.bind(events);
    events.close = () => {
      if (!info.closed) {
        info.closed = true;
        probe.closeCount += 1;
        pushConnection('close', info, { forced: Boolean(info.forcedClosing), readyState: events.readyState });
      }
      return originalClose();
    };
    return events;
  }
  WrappedEventSource.prototype = OriginalEventSource.prototype;
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource);
  window.EventSource = WrappedEventSource;
  window.__piboStreamingBenchmarkMarkTextDropRequested = (durationMs) => {
    const duration = Math.max(0, Number(durationMs || 0));
    probe.textDropRequested = true;
    probe.textDropDurationMs = duration;
    probe.textDropUntil = at() + duration;
    probe.textDropCount = 0;
    probe.textDropTextEventCount = 0;
    return { durationMs: duration };
  };
  window.__piboStreamingBenchmarkForceReconnect = () => {
    let closed = 0;
    for (const entry of probe._instances) {
      if (!entry || !entry.events || !isChatEventsUrl(entry.info && entry.info.url)) continue;
      if (entry.events.readyState === 2) continue;
      entry.info.forcedClosing = true;
      probe.forcedCloseCount += 1;
      entry.events.close();
      closed += 1;
    }
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    return closed;
  };
  window.__piboStreamingBenchmarkEventSourceProbe = probe;
  window.__piboStreamingBenchmarkEventSourceProbeInstalled = true;
})();
`;
}

function streamingBenchmarkFixtureHtml(fixtureProfile: StreamingFixtureProfile, fixtureMix: StreamingFixtureMix): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Streaming Benchmark Fixture</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.4} [data-pibo-component]{white-space:pre-wrap}</style>
</head>
<body data-pibo-debug="chat-app">
<h1>Streaming Benchmark Fixture</h1>
<div data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="assistant-message">hello</div>
<script>
(() => {
  function nowIso() { return new Date().toISOString(); }
  const target = document.querySelector('[data-pibo-component="MarkdownRendererHost"]');
  const textDeltas = [' a', ' b', ' c', ' d', ' e', ' f', ' g', ' h', ' i', ' j', ' k', ' l'];
  const markdownDeltas = [' **a**', ' **b**', ' **c**', ' **d**', ' **e**', ' **f**', ' **g**', ' **h**', ' **i**', ' **j**', ' **k**', ' **l**'];
  const gfmMarkdownDeltas = [' ~~a~~', ' ~~b~~', ' ~~c~~', ' ~~d~~', ' ~~e~~', ' ~~f~~', ' ~~g~~', ' ~~h~~', ' ~~i~~', ' ~~j~~', ' ~~k~~', ' ~~l~~'];
  const gfmTaskMarkdownDeltas = ['- [ ] [_**a**_](https://e.co/a)', ' [_**b**_](https://e.co/b)', ' [_**c**_](https://e.co/c)', ' [_**d**_](https://e.co/d)', ' [_**e**_](https://e.co/e)', ' [_**f**_](https://e.co/f)', ' [_**g**_](https://e.co/g)', ' [_**h**_](https://e.co/h)', ' [_**i**_](https://e.co/i)', ' [_**j**_](https://e.co/j)', ' [_**k**_](https://e.co/k)', ' [_**l**_](https://e.co/l)'];
  const gfmFullMarkdownDeltas = ['- [ ] [_~~a~~_](https://e.co/a)', ' [_~~b~~_](https://e.co/b)', ' [_~~c~~_](https://e.co/c)', ' [_~~d~~_](https://e.co/d)', ' [_~~e~~_](https://e.co/e)', ' [_~~f~~_](https://e.co/f)', ' [_~~g~~_](https://e.co/g)', ' [_~~h~~_](https://e.co/h)', ' [_~~i~~_](https://e.co/i)', ' [_~~j~~_](https://e.co/j)', ' [_~~k~~_](https://e.co/k)', ' [_~~l~~_](https://e.co/l)'];
  const cadenceMs = 100;
  const profile = ${JSON.stringify(fixtureProfile)};
  const mix = ${JSON.stringify(fixtureMix)};
  const deltas = mix === 'markdown' ? markdownDeltas : (mix === 'gfm-markdown' ? gfmMarkdownDeltas : (mix === 'gfm-task-markdown' ? gfmTaskMarkdownDeltas : (mix === 'gfm-full-markdown' ? gfmFullMarkdownDeltas : textDeltas)));
  const reasoningDeltas = mix === 'reasoning-text' ? [' think', ' plan', ' check', ' answer'] : [];
  const scheduleMs = buildSchedule(deltas.length, cadenceMs, profile);
  const reasoningScheduleMs = reasoningDeltas.map((_, index) => Math.max(10, Math.round((index + 1) * cadenceMs / 2)));
  let timers = [];
  function buildSchedule(count, cadence, timingProfile) {
    const delays = [];
    let elapsed = 0;
    for (let index = 0; index < count; index += 1) {
      let gap = cadence;
      if (timingProfile === 'jitter') {
        const jitter = [-30, 50, -20, 30, -40, 60, -10, 40, -50, 70, -20, 30][index % 12];
        gap = Math.max(10, cadence + jitter);
      } else if (timingProfile === 'burst') {
        gap = index > 0 && index % 3 !== 0 ? Math.max(10, Math.round(cadence / 5)) : Math.max(cadence, Math.round(cadence * 2.5));
      } else if (timingProfile === 'batch') {
        gap = index % 4 === 0 ? Math.max(cadence, Math.round(cadence * 3)) : 0;
      }
      elapsed += gap;
      delays.push(elapsed);
    }
    return delays;
  }
  function snapshot() {
    const now = nowIso();
    return {
      startedAt: now,
      updatedAt: now,
      eventCount: 0,
      textDeltaCount: 0,
      textDeltaBytes: 0,
      reasoningDeltaCount: 0,
      reasoningDeltaBytes: 0,
      enqueueCount: 0,
      flushCount: 0,
      flushedEventCount: 0,
      overlayUpdateCount: 0,
      overlayEventCount: 0,
      traceRefreshStartedCount: 0,
      traceRefreshCompletedCount: 0,
      traceRefreshFailedCount: 0,
      traceBaseUpdateCount: 0,
      traceBaseOutputLength: 0,
      currentOutputLength: target.textContent.length,
      lastDurableCursor: undefined,
      lastTransientLiveId: 'live:-1',
    };
  }
  window.__piboStreamingDebugReset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    target.textContent = 'hello';
    window.__piboStreamingDebug = snapshot();
    return window.__piboStreamingDebug;
  };
  window.__piboStreamingFixtureConfig = { deltaCount: deltas.length, reasoningDeltaCount: reasoningDeltas.length, cadenceMs, profile, mix, scheduleMs, reasoningScheduleMs, textBytes: deltas.join('').length, reasoningBytes: reasoningDeltas.join('').length };
  window.__piboStreamingFixtureStart = () => {
    window.__piboStreamingDebugReset();
    reasoningDeltas.forEach((delta, index) => {
      timers.push(setTimeout(() => {
        const debug = window.__piboStreamingDebug;
        const at = nowIso();
        debug.eventCount += 1;
        debug.firstEventAt ??= at;
        debug.firstReasoningDeltaAt ??= at;
        debug.reasoningDeltaCount += 1;
        debug.reasoningDeltaBytes += delta.length;
        debug.firstEnqueueAt ??= at;
        debug.enqueueCount += 1;
        debug.firstFlushAt ??= at;
        debug.flushCount += 1;
        debug.flushedEventCount += 1;
        debug.firstOverlayUpdateAt ??= at;
        debug.overlayUpdateCount += 1;
        debug.overlayEventCount += 1;
        debug.lastEventAt = at;
        debug.updatedAt = at;
        debug.lastTransientLiveId = 'live:reasoning-' + index;
      }, reasoningScheduleMs[index]));
    });
    deltas.forEach((delta, index) => {
      timers.push(setTimeout(() => {
        target.textContent += delta;
        const debug = window.__piboStreamingDebug;
        const at = nowIso();
        debug.eventCount += 1;
        debug.firstEventAt ??= at;
        debug.firstTextDeltaAt ??= at;
        debug.textDeltaCount += 1;
        debug.textDeltaBytes += delta.length;
        debug.firstEnqueueAt ??= at;
        debug.enqueueCount += 1;
        debug.firstFlushAt ??= at;
        debug.flushCount += 1;
        debug.flushedEventCount += 1;
        debug.firstOverlayUpdateAt ??= at;
        debug.overlayUpdateCount += 1;
        debug.overlayEventCount += 1;
        debug.currentOutputLength = target.textContent.length;
        debug.lastEventAt = at;
        debug.updatedAt = at;
        debug.lastTransientLiveId = 'live:' + index;
      }, scheduleMs[index]));
    });
    return window.__piboStreamingFixtureConfig;
  };
  window.__piboStreamingDebugReset();
})();
</script>
</body>
</html>`;
}

function buildSnapshotExpression(options: { scope: string; maxNodes: number; maxDepth: number; textLimit: number; includeText: boolean; includeLayout: boolean }): string {
	return `(() => {
  const options = ${JSON.stringify(options)};
  ${browserSnapshotLibrary()}
  return captureSnapshot(options);
})()`;
}

function buildWatchExpression(options: { scope: string; durationMs: number; maxNodes: number; maxDepth: number; maxEvents: number; textLimit: number; includeText: boolean; includeLayout: boolean; action?: "new-session" }): string {
	return `(async () => {
  const options = ${JSON.stringify(options)};
  ${browserSnapshotLibrary()}
  return await runWatch(options);
})()`;
}

function buildStreamingBenchmarkExpression(durationMs: number, input: { startFixture?: boolean; startBackendFixture?: boolean; fixtureProfile?: StreamingFixtureProfile; fixtureMix?: StreamingFixtureMix; fixturePreludeMessages?: number; simulateReconnect?: boolean; simulateTraceCatchup?: boolean; simulateOverlayDrop?: boolean } = {}): string {
	return `(async () => {
  const options = ${JSON.stringify({ durationMs, startFixture: Boolean(input.startFixture), startBackendFixture: Boolean(input.startBackendFixture), fixtureProfile: input.fixtureProfile ?? "steady", fixtureMix: input.fixtureMix ?? "text", fixturePreludeMessages: input.fixturePreludeMessages ?? 0, simulateReconnect: Boolean(input.simulateReconnect), simulateTraceCatchup: Boolean(input.simulateTraceCatchup), simulateOverlayDrop: Boolean(input.simulateOverlayDrop), reconnectAtMs: input.simulateReconnect ? 325 : undefined, traceCatchupDropMs: input.simulateTraceCatchup ? 1300 : undefined })};
  ${browserStreamingBenchmarkLibrary()}
  return await runStreamingBenchmark(options);
})()`;
}

function browserStreamingBenchmarkLibrary(): string {
	return String.raw`
const ASSISTANT_SELECTOR = '[data-pibo-component="MarkdownRendererHost"][data-pibo-markdown-kind="assistant-message"]';
function nowIso() { return new Date().toISOString(); }
function cloneDebugSnapshot(value) {
  if (!value || typeof value !== 'object') return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return undefined; }
}
function numericDelta(before, after, keys) {
  const delta = {};
  for (const key of keys) {
    const left = before && typeof before[key] === 'number' ? before[key] : 0;
    const right = after && typeof after[key] === 'number' ? after[key] : 0;
    delta[key] = right - left;
  }
  return delta;
}
function stats(values) {
  const nums = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!nums.length) return { count: 0 };
  const pick = (q) => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return {
    count: nums.length,
    min: Math.round(nums[0] * 1000) / 1000,
    p50: Math.round(pick(0.50) * 1000) / 1000,
    p90: Math.round(pick(0.90) * 1000) / 1000,
    p99: Math.round(pick(0.99) * 1000) / 1000,
    max: Math.round(nums[nums.length - 1] * 1000) / 1000,
    avg: Math.round(avg * 1000) / 1000,
  };
}
function fetchWithTimeout(url, init, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function installOverlayDropSimulation(enabled) {
  if (!enabled) {
    delete window.__piboStreamingBenchmarkShouldDropOverlayEvent;
    delete window.__piboStreamingBenchmarkOverlayDrop;
    return undefined;
  }
  const state = {
    requested: true,
    installed: true,
    dropTypes: ['TEXT_MESSAGE_CONTENT', 'REASONING_MESSAGE_CONTENT'],
    droppedCount: 0,
    passedCount: 0,
  };
  window.__piboStreamingBenchmarkOverlayDrop = state;
  window.__piboStreamingBenchmarkShouldDropOverlayEvent = (event) => {
    const type = event && typeof event.type === 'string' ? event.type : '';
    if (state.dropTypes.includes(type)) {
      state.droppedCount += 1;
      state.lastDroppedType = type;
      return true;
    }
    state.passedCount += 1;
    return false;
  };
  return state;
}
function numberArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'number' && Number.isFinite(item)) : [];
}
function scheduleGaps(scheduleMs) {
  const gaps = [];
  let previous = 0;
  for (const delay of scheduleMs) {
    gaps.push(delay - previous);
    previous = delay;
  }
  return gaps;
}
function createSseProbe(piboSessionId, startedAt) {
  const result = {
    requested: true,
    installed: false,
    url: '/api/chat/events?piboSessionId=' + encodeURIComponent(piboSessionId) + '&mode=live&probe=streaming-benchmark-' + Date.now(),
    headers: {},
    aborted: false,
    errors: [],
    chunkCount: 0,
    chunkBytes: { count: 0 },
    chunkGapsMs: { count: 0 },
    textEventsPerChunk: { count: 0 },
    eventCount: 0,
    textEventCount: 0,
    reasoningEventCount: 0,
    textDeltaBytes: { count: 0 },
    textEventGapsMs: { count: 0 },
    idCount: 0,
    transientIdCount: 0,
    durableIdCount: 0,
    otherIdCount: 0,
  };
  const chunkBytes = [];
  const chunkGaps = [];
  const textEventsPerChunk = [];
  const textDeltaBytes = [];
  const textEventGaps = [];
  const ids = [];
  let lastChunkAt;
  let lastTextAt;
  let buffer = '';
  let stopped = false;
  let finished = false;
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const decoder = typeof TextDecoder === 'undefined' ? undefined : new TextDecoder();
  const encoder = typeof TextEncoder === 'undefined' ? undefined : new TextEncoder();
  const byteLength = (text) => encoder ? encoder.encode(text).length : String(text || '').length;
  const finalize = () => {
    result.chunkCount = chunkBytes.length;
    result.chunkBytes = stats(chunkBytes);
    result.chunkGapsMs = stats(chunkGaps);
    result.textEventsPerChunk = stats(textEventsPerChunk);
    result.textDeltaBytes = stats(textDeltaBytes);
    result.textEventGapsMs = stats(textEventGaps);
    result.idCount = ids.length;
    result.transientIdCount = ids.filter((id) => /^live:\d+$/.test(id)).length;
    result.durableIdCount = ids.filter((id) => /^\d+:\d+$/.test(id)).length;
    result.otherIdCount = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id)).length;
    result.lastEventId = ids.at(-1);
    return result;
  };
  const elapsed = (t) => Math.round((t - startedAt) * 1000) / 1000;
  const consumeBlock = (block, t) => {
    if (!block.trim()) return 0;
    let eventName = '';
    let id = '';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (id) ids.push(id);
    if (eventName && eventName !== 'pibo') return 0;
    result.eventCount += 1;
    result.firstEventMs ??= elapsed(t);
    let payload;
    try { payload = data.length ? JSON.parse(data.join('\n')) : undefined; } catch (error) { result.errors.push('parse: ' + String(error && error.message ? error.message : error)); }
    if (!payload || typeof payload.type !== 'string') return 0;
    if (payload.type === 'TEXT_MESSAGE_CONTENT') {
      result.textEventCount += 1;
      result.firstTextEventMs ??= elapsed(t);
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      textDeltaBytes.push(byteLength(delta));
      if (lastTextAt !== undefined) textEventGaps.push(t - lastTextAt);
      lastTextAt = t;
      return 1;
    }
    if (payload.type === 'REASONING_MESSAGE_CONTENT') {
      result.reasoningEventCount += 1;
      result.firstReasoningEventMs ??= elapsed(t);
    }
    return 0;
  };
  if (typeof fetch !== 'function' || !decoder) {
    result.errors.push('fetch streaming unavailable');
    return { result: finalize(), stop: async () => finalize() };
  }
  const done = (async () => {
    try {
      const response = await fetch(result.url, { headers: { accept: 'text/event-stream' }, signal: controller && controller.signal });
      result.status = response.status;
      response.headers.forEach((value, key) => { result.headers[key] = value; });
      if (!response.body || typeof response.body.getReader !== 'function') throw new Error('ReadableStream unavailable');
      result.installed = true;
      const reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const t = performance.now();
        result.firstChunkMs ??= elapsed(t);
        if (lastChunkAt !== undefined) chunkGaps.push(t - lastChunkAt);
        lastChunkAt = t;
        const value = next.value || new Uint8Array();
        chunkBytes.push(value.byteLength || value.length || 0);
        buffer += decoder.decode(value, { stream: true });
        let chunkTextEvents = 0;
        while (true) {
          const index = buffer.search(/\r?\n\r?\n/);
          if (index < 0) break;
          const separatorLength = buffer[index] === '\r' ? 4 : 2;
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + separatorLength);
          chunkTextEvents += consumeBlock(block, t);
        }
        textEventsPerChunk.push(chunkTextEvents);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeBlock(buffer, performance.now());
    } catch (error) {
      if (stopped || (error && error.name === 'AbortError')) result.aborted = true;
      else result.errors.push(String(error && error.message ? error.message : error));
    } finally {
      finished = true;
      finalize();
    }
  })();
  return {
    result,
    stop: async () => {
      stopped = true;
      if (controller) controller.abort();
      await Promise.race([done.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2500))]);
      if (!finished) {
        result.aborted = true;
        result.errors.push('stop timeout after abort');
      }
      return finalize();
    },
  };
}
async function waitForSseProbeReady(probe, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (!probe || probe.installed || probe.status || (probe.errors && probe.errors.length)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function createTraceProbe(piboSessionId, startedAt, intervalMs) {
  const result = {
    requested: true,
    installed: true,
    piboSessionId,
    intervalMs,
    sampleCount: 0,
    fetchCount: 0,
    failedFetchCount: 0,
    liveVersionCount: 0,
    maxAssistantOutputLength: 0,
    samples: [],
  };
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const t = Math.round(performance.now() - startedAt);
      const response = await fetchWithTimeout('/api/chat/trace?piboSessionId=' + encodeURIComponent(piboSessionId) + '&includeRawEvents=true&rawEventsLimit=80', {}, 2500);
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
      const trace = await response.json();
      result.fetchCount += 1;
      const version = typeof trace.version === 'string' ? trace.version : undefined;
      const rawEvents = Array.isArray(trace.rawEvents) ? trace.rawEvents : [];
      const assistantOutputLength = maxTraceAssistantOutputLength(trace);
      const liveVersion = Boolean(version && version.includes(':live:'));
      const sampleResult = {
        t,
        version,
        eventCount: typeof trace.eventCount === 'number' ? trace.eventCount : undefined,
        rawEventCount: rawEvents.length,
        assistantOutputLength,
        liveVersion,
        rawEventTypes: countRawTraceEventTypes(rawEvents),
      };
      result.samples.push(sampleResult);
      if (result.samples.length > 80) result.samples.shift();
      result.sampleCount = result.samples.length;
      result.maxAssistantOutputLength = Math.max(result.maxAssistantOutputLength, assistantOutputLength);
      result.finalAssistantOutputLength = assistantOutputLength;
      if (typeof sampleResult.eventCount === 'number') {
        result.durableEventCountStart ??= sampleResult.eventCount;
        result.durableEventCountEnd = sampleResult.eventCount;
      }
      if (liveVersion) {
        result.liveVersionCount += 1;
        result.firstLiveVersionMs ??= t;
      }
    } catch {
      result.failedFetchCount += 1;
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => { sample().catch(() => {}); }, intervalMs);
  return { result, sample, stop: () => clearInterval(timer) };
}
function countRawTraceEventTypes(rawEvents) {
  const counts = {};
  for (const event of rawEvents) {
    const type = typeof event?.type === 'string' ? event.type : (typeof event?.payload?.type === 'string' ? event.payload.type : 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
function maxTraceAssistantOutputLength(trace) {
  let max = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'assistant.message' && typeof node.output === 'string') max = Math.max(max, node.output.length);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  if (Array.isArray(trace?.nodes)) trace.nodes.forEach(visit);
  return max;
}
function summarizeEventSourceProbe(startedAt, requested, forcedReconnectAtMs, textDropRequested, textDropDurationMs) {
  const probe = window.__piboStreamingBenchmarkEventSourceProbe;
  if (!requested) return undefined;
  if (!probe) {
    return {
      requested,
      installed: false,
      forcedReconnectAtMs,
      openCount: 0,
      openCountAfterStart: 0,
      errorCount: 0,
      errorCountAfterStart: 0,
      closeCount: 0,
      forcedCloseCount: 0,
      forcedCloseCountAfterStart: 0,
      eventCount: 0,
      eventCountAfterStart: 0,
      textEventCount: 0,
      textEventCountAfterStart: 0,
      reasoningEventCount: 0,
      reasoningEventCountAfterStart: 0,
      transientIdCount: 0,
      uniqueTransientIdCount: 0,
      transientIdCountAfterStart: 0,
      uniqueTransientIdCountAfterStart: 0,
      durableIdCount: 0,
      otherIdCount: 0,
      transientIdResetObserved: false,
      reconnectObserved: false,
      textDropRequested: Boolean(textDropRequested),
      textDropDurationMs,
      textDropCount: 0,
      textDropTextEventCount: 0,
      streams: [],
    };
  }
  const streamEvents = (Array.isArray(probe.events) ? probe.events : []).filter((event) => String(event.url || '').includes('/api/chat/events'));
  const afterStartStreamEvents = streamEvents.filter((event) => typeof event.t === 'number' && event.t >= startedAt);
  const afterStartConnections = (Array.isArray(probe.connections) ? probe.connections : []).filter((event) => typeof event.t === 'number' && event.t >= startedAt && String(event.url || '').includes('/api/chat/events'));
  const ids = streamEvents.map((event) => event.lastEventId).filter(Boolean);
  const afterStartIds = afterStartStreamEvents.map((event) => event.lastEventId).filter(Boolean);
  const transientIds = ids.filter((id) => /^live:\d+$/.test(id));
  const afterStartTransientIds = afterStartIds.filter((id) => /^live:\d+$/.test(id));
  const durableIds = ids.filter((id) => /^\d+:\d+$/.test(id));
  const otherIds = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id));
  const firstEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt);
  const firstTextEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt, 'TEXT_MESSAGE_CONTENT');
  const firstReasoningEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt, 'REASONING_MESSAGE_CONTENT');
  const forcedCloseCountAfterStart = afterStartConnections.filter((event) => event.kind === 'close' && event.forced).length;
  const openCountAfterStart = afterStartConnections.filter((event) => event.kind === 'open').length;
  const streams = summarizeEventSourceStreams(streamEvents, afterStartConnections, startedAt);
  return {
    requested,
    installed: true,
    forcedReconnectAtMs,
    openCount: Number(probe.openCount || 0),
    openCountAfterStart,
    errorCount: Number(probe.errorCount || 0),
    errorCountAfterStart: afterStartConnections.filter((event) => event.kind === 'error').length,
    closeCount: Number(probe.closeCount || 0),
    forcedCloseCount: Number(probe.forcedCloseCount || 0),
    forcedCloseCountAfterStart,
    eventCount: streamEvents.length,
    eventCountAfterStart: afterStartStreamEvents.length,
    textEventCount: streamEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
    textEventCountAfterStart: afterStartStreamEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
    reasoningEventCount: streamEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
    reasoningEventCountAfterStart: afterStartStreamEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
    transientIdCount: transientIds.length,
    uniqueTransientIdCount: new Set(transientIds).size,
    transientIdCountAfterStart: afterStartTransientIds.length,
    uniqueTransientIdCountAfterStart: new Set(afterStartTransientIds).size,
    durableIdCount: durableIds.length,
    otherIdCount: otherIds.length,
    lastEventId: ids.at(-1),
    firstTransientId: transientIds[0],
    firstEventMsAfterStart,
    firstTextEventMsAfterStart,
    firstReasoningEventMsAfterStart,
    lastTransientId: transientIds.at(-1),
    transientIdResetObserved: new Set(transientIds).size < transientIds.length,
    reconnectObserved: forcedCloseCountAfterStart > 0 && openCountAfterStart > 0,
    textDropRequested: Boolean(textDropRequested),
    textDropDurationMs: textDropRequested ? Number(probe.textDropDurationMs || textDropDurationMs || 0) || undefined : undefined,
    textDropCount: textDropRequested ? Number(probe.textDropCount || 0) : 0,
    textDropTextEventCount: textDropRequested ? Number(probe.textDropTextEventCount || 0) : 0,
    streams,
  };
}
function firstProbeEventMs(events, startedAt, type) {
  const event = events.find((item) => typeof item.t === 'number' && (type === undefined || item.type === type));
  return event ? Math.round((event.t - startedAt) * 1000) / 1000 : undefined;
}
function summarizeEventSourceStreams(streamEvents, afterStartConnections, startedAt) {
  const groups = new Map();
  const ensureGroup = (rawUrl) => {
    const parsed = parseChatEventsProbeUrl(rawUrl);
    const key = [parsed.role, parsed.piboSessionId || '', parsed.roomId || '', parsed.mode || '', parsed.url].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        url: parsed.url,
        mode: parsed.mode,
        role: parsed.role,
        piboSessionId: parsed.piboSessionId,
        roomId: parsed.roomId,
        sinceValues: [],
        liveSinceValues: [],
        openCountAfterStart: 0,
        errorCountAfterStart: 0,
        closeCountAfterStart: 0,
        forcedCloseCountAfterStart: 0,
        events: [],
      };
      groups.set(key, group);
    }
    if (parsed.since && !group.sinceValues.includes(parsed.since)) group.sinceValues.push(parsed.since);
    if (parsed.liveSince && !group.liveSinceValues.includes(parsed.liveSince)) group.liveSinceValues.push(parsed.liveSince);
    return group;
  };
  for (const event of streamEvents) ensureGroup(event.url).events.push(event);
  for (const connection of afterStartConnections) {
    const group = ensureGroup(connection.url);
    if (connection.kind === 'open') group.openCountAfterStart += 1;
    else if (connection.kind === 'error') group.errorCountAfterStart += 1;
    else if (connection.kind === 'close') {
      group.closeCountAfterStart += 1;
      if (connection.forced) group.forcedCloseCountAfterStart += 1;
    }
  }
  return Array.from(groups.values()).map((group) => {
    const events = group.events;
    const afterStartEvents = events.filter((event) => typeof event.t === 'number' && event.t >= startedAt);
    const ids = events.map((event) => event.lastEventId).filter(Boolean);
    const afterStartIds = afterStartEvents.map((event) => event.lastEventId).filter(Boolean);
    const transientIds = ids.filter((id) => /^live:\d+$/.test(id));
    const afterStartTransientIds = afterStartIds.filter((id) => /^live:\d+$/.test(id));
    const liveReplayReplayedCount = events.reduce((total, event) => total + (typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0), 0);
    const liveReplayReplayedCountAfterStart = afterStartEvents.reduce((total, event) => total + (typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0), 0);
    const liveReplayMisses = events.filter((event) => event.liveReplayMissed === true);
    const afterStartLiveReplayMisses = afterStartEvents.filter((event) => event.liveReplayMissed === true);
    const liveReplayDuplicateCount = countLiveReplayDuplicateIds(events);
    const liveReplayDuplicateCountAfterStart = countLiveReplayDuplicateIds(events, startedAt);
    const liveReplayEvictedBeforeValues = events.map((event) => event.liveReplayEvictedBefore).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const liveReplayCursorLagValues = events.map((event) => typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) && typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? Math.max(0, event.liveReplayNewestAvailable - event.liveReplayRequestedAfter) : undefined).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const afterStartLiveReplayCursorLagValues = afterStartEvents.map((event) => typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) && typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? Math.max(0, event.liveReplayNewestAvailable - event.liveReplayRequestedAfter) : undefined).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const firstEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt);
    const firstTextEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt, 'TEXT_MESSAGE_CONTENT');
    const firstReasoningEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt, 'REASONING_MESSAGE_CONTENT');
    const durableIds = ids.filter((id) => /^\d+:\d+$/.test(id));
    const otherIds = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id));
    return {
      url: group.url,
      mode: group.mode,
      role: group.role,
      piboSessionId: group.piboSessionId,
      roomId: group.roomId,
      sinceValues: group.sinceValues,
      liveSinceValues: group.liveSinceValues,
      openCountAfterStart: group.openCountAfterStart,
      errorCountAfterStart: group.errorCountAfterStart,
      closeCountAfterStart: group.closeCountAfterStart,
      forcedCloseCountAfterStart: group.forcedCloseCountAfterStart,
      eventCount: events.length,
      eventCountAfterStart: afterStartEvents.length,
      textEventCount: events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
      textEventCountAfterStart: afterStartEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
      reasoningEventCount: events.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
      reasoningEventCountAfterStart: afterStartEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
      transientIdCount: transientIds.length,
      uniqueTransientIdCount: new Set(transientIds).size,
      transientIdCountAfterStart: afterStartTransientIds.length,
      uniqueTransientIdCountAfterStart: new Set(afterStartTransientIds).size,
      durableIdCount: durableIds.length,
      otherIdCount: otherIds.length,
      liveReplayEventCount: liveReplayReplayedCount,
      liveReplayEventCountAfterStart: liveReplayReplayedCountAfterStart,
      liveReplayMissedCount: liveReplayMisses.length,
      liveReplayMissedCountAfterStart: afterStartLiveReplayMisses.length,
      liveReplayDuplicateCount,
      liveReplayDuplicateCountAfterStart,
      liveReplayEvictedBeforeMax: liveReplayEvictedBeforeValues.length ? Math.max(...liveReplayEvictedBeforeValues) : undefined,
      liveReplayCursorLagMax: liveReplayCursorLagValues.length ? Math.max(...liveReplayCursorLagValues) : undefined,
      liveReplayCursorLagMaxAfterStart: afterStartLiveReplayCursorLagValues.length ? Math.max(...afterStartLiveReplayCursorLagValues) : undefined,
      lastEventId: ids.at(-1),
      firstEventMsAfterStart,
      firstTextEventMsAfterStart,
      firstReasoningEventMsAfterStart,
    };
  }).sort((left, right) => roleSort(left.role) - roleSort(right.role) || left.url.localeCompare(right.url));
}
function countLiveReplayDuplicateIds(events, startedAt) {
  const seen = new Set();
  let duplicateCount = 0;
  const ordered = events.slice().sort((left, right) => Number(left.t || 0) - Number(right.t || 0));
  for (const event of ordered) {
    const requestedAfter = typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) ? event.liveReplayRequestedAfter : undefined;
    const newestAvailable = typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? event.liveReplayNewestAvailable : undefined;
    const replayed = typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0;
    const countThisStatus = startedAt === undefined || (typeof event.t === 'number' && event.t >= startedAt);
    if (countThisStatus && replayed > 0 && requestedAfter !== undefined && newestAvailable !== undefined) {
      for (const replayId of seen) {
        if (replayId > requestedAfter && replayId <= newestAvailable) duplicateCount += 1;
      }
    }
    if (typeof event.liveReplayId === 'number' && Number.isFinite(event.liveReplayId)) seen.add(event.liveReplayId);
  }
  return duplicateCount;
}
function parseChatEventsProbeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || ''), location.href); } catch { parsed = new URL('/api/chat/events', location.href); }
  const params = parsed.searchParams;
  const mode = params.get('mode') || undefined;
  const piboSessionId = params.get('piboSessionId') || undefined;
  const roomId = params.get('roomId') || undefined;
  const role = mode === 'summary' || (roomId && !piboSessionId) ? 'room-summary' : (mode === 'live' || piboSessionId ? 'selected-live' : 'chat-events');
  const withoutResume = new URL(parsed.href);
  withoutResume.searchParams.delete('since');
  withoutResume.searchParams.delete('liveSince');
  return {
    url: withoutResume.pathname + (withoutResume.search ? withoutResume.search : ''),
    mode,
    role,
    piboSessionId,
    roomId,
    since: params.get('since') || undefined,
    liveSince: params.get('liveSince') || undefined,
  };
}
function roleSort(role) {
  if (role === 'selected-live') return 0;
  if (role === 'room-summary') return 1;
  return 2;
}
function streamingBenchmarkRegressions(result) {
  const failures = [];
  const fixture = result.fixture;
  const expectedDeltas = fixture && typeof fixture.deltaCount === 'number' ? fixture.deltaCount : undefined;
  const expectedReasoningDeltas = fixture && typeof fixture.reasoningDeltaCount === 'number' ? fixture.reasoningDeltaCount : undefined;
  const cadenceMs = fixture && typeof fixture.cadenceMs === 'number' ? fixture.cadenceMs : 100;
  const textDeltas = result.debugDelta && typeof result.debugDelta.textDeltaCount === 'number' ? result.debugDelta.textDeltaCount : 0;
  const reasoningDeltas = result.debugDelta && typeof result.debugDelta.reasoningDeltaCount === 'number' ? result.debugDelta.reasoningDeltaCount : 0;
  const domPositive = result.dom.positiveUpdateCount || 0;
  const domGapP90 = result.dom.gapsMs && typeof result.dom.gapsMs.p90 === 'number' ? result.dom.gapsMs.p90 : undefined;
  const domJumpMax = result.dom.positiveCharJumps && typeof result.dom.positiveCharJumps.max === 'number' ? result.dom.positiveCharJumps.max : undefined;
  const firstPositiveMs = typeof result.dom.firstPositiveUpdateMs === 'number' ? result.dom.firstPositiveUpdateMs : undefined;
  const longTaskMax = result.longTasks.length ? Math.max(...result.longTasks) : 0;
  const traceCatchupRequested = Boolean(result.eventSource && result.eventSource.textDropRequested);
  const reconnectRequested = Boolean(result.eventSource && typeof result.eventSource.forcedReconnectAtMs === 'number');
  if (!result.debugAfter) failures.push('debug counters unavailable');
  if (fixture) {
    if (!fixture.available) failures.push('fixture unavailable');
    if (!fixture.started) failures.push('fixture did not start');
    if (fixture.error) failures.push('fixture error: ' + fixture.error);
    if (!traceCatchupRequested && expectedDeltas !== undefined && textDeltas < expectedDeltas) failures.push('text deltas ' + textDeltas + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && expectedReasoningDeltas !== undefined && reasoningDeltas < expectedReasoningDeltas) failures.push('reasoning deltas ' + reasoningDeltas + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (!traceCatchupRequested && expectedDeltas !== undefined && domPositive < Math.max(1, expectedDeltas - 2)) failures.push('positive DOM updates ' + domPositive + ' < ' + Math.max(1, expectedDeltas - 2));
    if (!traceCatchupRequested && domGapP90 !== undefined && domGapP90 > Math.max(300, cadenceMs * 3)) failures.push('DOM p90 gap ' + domGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && domJumpMax !== undefined && domJumpMax > 4) failures.push('DOM max jump ' + domJumpMax + ' chars exceeds gate');
    if (!traceCatchupRequested && firstPositiveMs !== undefined && firstPositiveMs > 500) failures.push('first visible update ' + firstPositiveMs + 'ms exceeds gate');
    if (traceCatchupRequested) {
      const traceRefreshes = result.debugDelta && typeof result.debugDelta.traceRefreshCompletedCount === 'number' ? result.debugDelta.traceRefreshCompletedCount : 0;
      if (traceRefreshes < 1) failures.push('trace catch-up did not complete a trace refresh');
      const maxVisibleLength = result.dom && typeof result.dom.lengthMax === 'number' ? result.dom.lengthMax : result.dom && result.dom.lengthEnd;
      if (!result.dom || !(maxVisibleLength > result.dom.lengthStart)) failures.push('trace catch-up did not advance visible DOM output');
      if (expectedDeltas !== undefined && textDeltas > Math.max(1, expectedDeltas - 2)) failures.push('trace catch-up did not suppress live text deltas before recovery');
      if (!result.trace) failures.push('trace catch-up trace probe unavailable');
      else {
        if (result.trace.sampleCount < 1 || result.trace.fetchCount < 1) failures.push('trace catch-up trace probe did not fetch samples');
        if (result.trace.liveVersionCount < 1) failures.push('trace catch-up trace probe did not observe live snapshot version');
        if (result.trace.maxAssistantOutputLength < 1) failures.push('trace catch-up trace probe did not observe assistant output');
      }
    }
  }
  if (result.eventSource && result.eventSource.requested) {
    if (!result.eventSource.installed) failures.push('EventSource probe unavailable');
    const selectedLiveStreams = Array.isArray(result.eventSource.streams) ? result.eventSource.streams.filter((stream) => stream.role === 'selected-live') : [];
    const selectedLive = selectedLiveStreams.length > 1
      ? selectedLiveStreams.reduce((total, stream) => ({
          textEventCountAfterStart: total.textEventCountAfterStart + (stream.textEventCountAfterStart || 0),
          reasoningEventCountAfterStart: total.reasoningEventCountAfterStart + (stream.reasoningEventCountAfterStart || 0),
          liveReplayEventCountAfterStart: total.liveReplayEventCountAfterStart + (stream.liveReplayEventCountAfterStart || 0),
          liveReplayMissedCountAfterStart: total.liveReplayMissedCountAfterStart + (stream.liveReplayMissedCountAfterStart || 0),
          liveReplayDuplicateCountAfterStart: total.liveReplayDuplicateCountAfterStart + (stream.liveReplayDuplicateCountAfterStart || 0),
          liveSinceValues: Array.from(new Set(total.liveSinceValues.concat(stream.liveSinceValues || []))),
        }), { textEventCountAfterStart: 0, reasoningEventCountAfterStart: 0, liveReplayEventCountAfterStart: 0, liveReplayMissedCountAfterStart: 0, liveReplayDuplicateCountAfterStart: 0, liveSinceValues: [] })
      : selectedLiveStreams[0];
    if (!selectedLive) failures.push('EventSource selected-live stream was not observed');
    if (!traceCatchupRequested && selectedLive && expectedDeltas !== undefined && selectedLive.textEventCountAfterStart < expectedDeltas) failures.push('selected-live text events after start ' + selectedLive.textEventCountAfterStart + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && selectedLive && expectedReasoningDeltas !== undefined && selectedLive.reasoningEventCountAfterStart < expectedReasoningDeltas) failures.push('selected-live reasoning events after start ' + selectedLive.reasoningEventCountAfterStart + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (traceCatchupRequested) {
      if (selectedLive && selectedLive.textEventCountAfterStart > Math.max(1, (expectedDeltas || 0) - 2)) failures.push('trace catch-up selected-live text was not suppressed');
    } else {
      if (reconnectRequested && result.eventSource.forcedCloseCountAfterStart < 1) failures.push('EventSource forced close was not observed');
      if (reconnectRequested && result.eventSource.openCountAfterStart < 1) failures.push('EventSource reconnect open was not observed');
      if (reconnectRequested && selectedLive && (selectedLive.liveReplayMissedCountAfterStart || 0) > 0) failures.push('selected-live transient replay missed buffered events');
      if (reconnectRequested && selectedLive && (selectedLive.liveReplayDuplicateCountAfterStart || 0) > 0) failures.push('selected-live transient replay duplicated already observed frames');
      if (reconnectRequested && selectedLive && (selectedLive.liveSinceValues || []).length > 0 && (selectedLive.liveReplayEventCountAfterStart || 0) < 1) failures.push('selected-live transient replay cursor did not replay buffered events');
      if (result.eventSource.transientIdCountAfterStart < 1) failures.push('EventSource transient live ids were not observed');
    }
  }
  if (result.sse && result.sse.requested) {
    if (!result.sse.installed) failures.push('SSE fetch probe unavailable');
    if (result.sse.status && result.sse.status !== 200) failures.push('SSE fetch status ' + result.sse.status);
    if (result.sse.headers && String(result.sse.headers['x-accel-buffering'] || '').toLowerCase() !== 'no') failures.push('SSE X-Accel-Buffering header is not no');
    if (result.sse.errors && result.sse.errors.length) failures.push('SSE fetch errors: ' + result.sse.errors.slice(0, 2).join('; '));
    if (!traceCatchupRequested && expectedDeltas !== undefined && result.sse.textEventCount < expectedDeltas) failures.push('SSE text events ' + result.sse.textEventCount + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && expectedReasoningDeltas !== undefined && result.sse.reasoningEventCount < expectedReasoningDeltas) failures.push('SSE reasoning events ' + result.sse.reasoningEventCount + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (!traceCatchupRequested && expectedDeltas !== undefined && result.sse.transientIdCount < expectedDeltas) failures.push('SSE transient live ids ' + result.sse.transientIdCount + ' < fixture deltas ' + expectedDeltas);
    const sseGapGate = Math.max(300, cadenceMs * 3);
    const sseChunkGapP90 = result.sse.chunkGapsMs && typeof result.sse.chunkGapsMs.p90 === 'number' ? result.sse.chunkGapsMs.p90 : undefined;
    const sseTextGapP90 = result.sse.textEventGapsMs && typeof result.sse.textEventGapsMs.p90 === 'number' ? result.sse.textEventGapsMs.p90 : undefined;
    const sseTextPerChunkP90 = result.sse.textEventsPerChunk && typeof result.sse.textEventsPerChunk.p90 === 'number' ? result.sse.textEventsPerChunk.p90 : undefined;
    if (!traceCatchupRequested && sseChunkGapP90 !== undefined && sseChunkGapP90 > sseGapGate) failures.push('SSE chunk p90 gap ' + sseChunkGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && sseTextGapP90 !== undefined && sseTextGapP90 > sseGapGate) failures.push('SSE text p90 gap ' + sseTextGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && sseTextPerChunkP90 !== undefined && sseTextPerChunkP90 > 2) failures.push('SSE text events per chunk p90 ' + sseTextPerChunkP90 + ' exceeds gate');
  }
  if (longTaskMax > 50) failures.push('long task max ' + Math.round(longTaskMax * 1000) / 1000 + 'ms exceeds 50ms');
  return failures;
}
function assistantTargets() {
  return Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
}
function selectedAssistantText(initialTargets, ignorePreludeTargets) {
  const targets = assistantTargets();
  const texts = [];
  for (const target of targets) {
    if (initialTargets && initialTargets.has(target)) continue;
    const text = target.innerText || target.textContent || '';
    if (ignorePreludeTargets && /\bprelude\b/i.test(text)) continue;
    texts.push(text);
  }
  return texts.join('\n');
}
async function waitForAssistantDomSettle(timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastText = selectedAssistantText();
  let stableSamples = 0;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = selectedAssistantText();
    if (text === lastText) {
      stableSamples += 1;
      if (stableSamples >= 5) return;
    } else {
      stableSamples = 0;
      lastText = text;
    }
  }
}
async function runStreamingBenchmark(options) {
  const warnings = [];
  const selectedSessionId = () => document.querySelector('[data-pibo-debug="chat-shell"]')?.getAttribute('data-pibo-session-id')
    || document.querySelector('[data-pibo-selected-session-id]')?.getAttribute('data-pibo-selected-session-id')
    || undefined;
  let reset = false;
  let backendPreludeError;
  let backendPreludeConfig;
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch (error) { warnings.push('failed to set debugStreaming localStorage: ' + String(error)); }
  if (options.startBackendFixture && options.fixturePreludeMessages > 0) {
    const piboSessionId = selectedSessionId();
    if (!piboSessionId) {
      backendPreludeError = 'selected Chat session not found in DOM';
      warnings.push('backend streaming fixture prelude was requested but selected Chat session was not found');
    } else {
      try {
        const response = await fetchWithTimeout('/api/chat/debug/streaming-fixture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ piboSessionId, preludeOnly: true, preludeMessages: options.fixturePreludeMessages }),
        }, 10000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : response.status + ' ' + response.statusText);
        backendPreludeConfig = payload.fixture || payload;
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, Math.max(1000, options.fixturePreludeMessages * 5))));
        await waitForAssistantDomSettle(Math.min(8000, Math.max(1000, options.fixturePreludeMessages * 5)));
      } catch (error) {
        backendPreludeError = String(error && error.message ? error.message : error);
        warnings.push('failed to start backend streaming fixture prelude: ' + backendPreludeError);
      }
    }
  }
  const fixtureDomInitialTargets = options.startBackendFixture ? new WeakSet(assistantTargets()) : undefined;
  const ignorePreludeDomTargets = Boolean(options.startBackendFixture && options.fixturePreludeMessages > 0);
  const startedAt = performance.now();
  const debugStateBeforeReset = cloneDebugSnapshot(window.__piboStreamingDebug);
  if (typeof window.__piboStreamingDebugReset === 'function') {
    try { window.__piboStreamingDebugReset(); reset = true; } catch (error) { warnings.push('failed to reset __piboStreamingDebug: ' + String(error)); }
  }
  const overlayDrop = installOverlayDropSimulation(Boolean(options.simulateOverlayDrop));

  const debugBefore = cloneDebugSnapshot(window.__piboStreamingDebug);
  const initialText = selectedAssistantText(fixtureDomInitialTargets, ignorePreludeDomTargets);
  const targetCountStart = assistantTargets().length;
  const updates = [];
  const positiveJumps = [];
  let currentLength = initialText.length;
  let maxLength = initialText.length;
  let lastPositiveAt;
  let firstPositiveUpdateMs;
  const sample = () => {
    const text = selectedAssistantText(fixtureDomInitialTargets, ignorePreludeDomTargets);
    const length = text.length;
    if (length === currentLength) return;
    maxLength = Math.max(maxLength, length);
    const t = performance.now() - startedAt;
    const delta = length - currentLength;
    updates.push({ t, length, delta });
    if (delta > 0) {
      positiveJumps.push(delta);
      firstPositiveUpdateMs ??= t;
      lastPositiveAt = t;
    }
    currentLength = length;
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  const rafGaps = [];
  let rafCount = 0;
  let lastRaf;
  let rafHandle;
  const onRaf = (t) => {
    rafCount += 1;
    if (lastRaf !== undefined) rafGaps.push(t - lastRaf);
    lastRaf = t;
    rafHandle = requestAnimationFrame(onRaf);
  };
  rafHandle = requestAnimationFrame(onRaf);

  const longTasks = [];
  let perfObserver;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration || 0);
      });
      perfObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      warnings.push('longtask PerformanceObserver unavailable');
    }
  } else {
    warnings.push('PerformanceObserver unavailable');
  }

  let fixtureStarted = false;
  let fixtureConfig;
  let backendFixtureError;
  let traceProbe;
  let sseProbe;
  if (options.startFixture) {
    if (typeof window.__piboStreamingFixtureStart === 'function') {
      try { fixtureConfig = window.__piboStreamingFixtureStart(); fixtureStarted = true; } catch (error) { warnings.push('failed to start streaming fixture: ' + String(error)); }
    } else {
      warnings.push('streaming fixture was requested but window.__piboStreamingFixtureStart is unavailable');
    }
  } else if (options.startBackendFixture) {
    if (options.simulateReconnect && typeof window.__piboStreamingBenchmarkForceReconnect === 'function') {
      setTimeout(() => {
        try { window.__piboStreamingBenchmarkForceReconnect(); } catch (error) { warnings.push('failed to force EventSource reconnect: ' + String(error)); }
      }, options.reconnectAtMs || 325);
    } else if (options.simulateReconnect) {
      warnings.push('EventSource reconnect simulation was requested but the probe is unavailable');
    }
    if (options.simulateTraceCatchup && typeof window.__piboStreamingBenchmarkMarkTextDropRequested === 'function') {
      try { window.__piboStreamingBenchmarkMarkTextDropRequested(options.traceCatchupDropMs || 1300); } catch (error) { warnings.push('failed to mark EventSource text drop request: ' + String(error)); }
    } else if (options.simulateTraceCatchup) {
      warnings.push('trace catch-up simulation was requested but the EventSource probe is unavailable');
    }
    const piboSessionId = selectedSessionId();
    if (options.simulateTraceCatchup && piboSessionId) {
      traceProbe = createTraceProbe(piboSessionId, startedAt, 250);
      await traceProbe.sample();
    }
    if (!piboSessionId) {
      backendFixtureError = 'selected Chat session not found in DOM';
      warnings.push('backend streaming fixture was requested but selected Chat session was not found');
    } else {
      sseProbe = createSseProbe(piboSessionId, startedAt);
      await waitForSseProbeReady(sseProbe.result, 500);
      try {
        const response = await fetchWithTimeout('/api/chat/debug/streaming-fixture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ piboSessionId, profile: options.fixtureProfile, mix: options.fixtureMix, ...((options.simulateReconnect || options.simulateTraceCatchup) ? { cadenceMs: 150 } : {}), ...(options.simulateTraceCatchup ? { traceSnapshots: true, suppressLiveDeltas: true } : {}) }),
        }, options.simulateTraceCatchup ? 15000 : 5000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : response.status + ' ' + response.statusText);
        fixtureConfig = payload.fixture || payload;
        fixtureStarted = true;
      } catch (error) {
        backendFixtureError = String(error && error.message ? error.message : error);
        warnings.push('failed to start backend streaming fixture: ' + backendFixtureError);
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  sample();
  if (traceProbe) {
    await traceProbe.sample();
    traceProbe.stop();
  }
  const sseSummary = sseProbe ? await sseProbe.stop() : undefined;
  observer.disconnect();
  if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
  try { perfObserver && perfObserver.disconnect(); } catch {}

  const debugAfter = cloneDebugSnapshot(window.__piboStreamingDebug);
  const overlayDropSummary = overlayDrop ? cloneDebugSnapshot(window.__piboStreamingBenchmarkOverlayDrop) : undefined;
  installOverlayDropSimulation(false);
  if (!debugAfter) warnings.push('window.__piboStreamingDebug was absent; run with ?debugStreaming=1 or start a fresh stream after this command enables localStorage');
  const positiveUpdates = updates.filter((update) => update.delta > 0);
  const positiveGaps = [];
  for (let i = 1; i < positiveUpdates.length; i++) positiveGaps.push(positiveUpdates[i].t - positiveUpdates[i - 1].t);
  const debugDelta = numericDelta(debugBefore, debugAfter, [
    'liveOpenCount',
    'liveErrorCount',
    'eventCount',
    'textDeltaCount',
    'textDeltaBytes',
    'reasoningDeltaCount',
    'reasoningDeltaBytes',
    'enqueueCount',
    'flushCount',
    'flushedEventCount',
    'overlayUpdateCount',
    'liveTraceComputeCount',
    'liveTraceComputeDurationMsTotal',
    'markdownRenderCount',
    'markdownRenderPlainCount',
    'markdownRenderFullCount',
    'markdownRenderCommonMarkCount',
    'markdownRenderGfmCount',
    'markdownRenderGfmFastCount',
    'markdownRenderDurationMsTotal',
    'markdownRenderCommonMarkDurationMsTotal',
    'markdownRenderGfmDurationMsTotal',
    'markdownRenderGfmFastDurationMsTotal',
    'traceRefreshStartedCount',
    'traceRefreshCompletedCount',
    'traceRefreshFailedCount',
    'traceBaseUpdateCount',
  ]);
  const domGaps = stats(positiveGaps);
  const domJumps = stats(positiveJumps);
  const fixtureScheduleMs = numberArray(fixtureConfig && fixtureConfig.scheduleMs);
  const fixtureReasoningScheduleMs = numberArray(fixtureConfig && fixtureConfig.reasoningScheduleMs);
  const fixtureSummary = (options.startFixture || options.startBackendFixture) ? {
    requested: true,
    mode: options.startBackendFixture ? 'backend' : 'browser',
    profile: fixtureConfig && typeof fixtureConfig.profile === 'string' ? fixtureConfig.profile : options.fixtureProfile,
    mix: fixtureConfig && typeof fixtureConfig.mix === 'string' ? fixtureConfig.mix : options.fixtureMix,
    simulation: options.simulateTraceCatchup ? 'trace-catchup' : (options.simulateReconnect ? 'reconnect' : (options.simulateOverlayDrop ? 'overlay-drop' : undefined)),
    available: options.startBackendFixture ? !backendFixtureError : typeof window.__piboStreamingFixtureStart === 'function',
    started: fixtureStarted,
    deltaCount: fixtureConfig && typeof fixtureConfig.deltaCount === 'number' ? fixtureConfig.deltaCount : undefined,
    reasoningDeltaCount: fixtureConfig && typeof fixtureConfig.reasoningDeltaCount === 'number' ? fixtureConfig.reasoningDeltaCount : undefined,
    cadenceMs: fixtureConfig && typeof fixtureConfig.cadenceMs === 'number' ? fixtureConfig.cadenceMs : undefined,
    scheduleMs: fixtureScheduleMs.length ? fixtureScheduleMs : undefined,
    scheduleGapsMs: fixtureScheduleMs.length ? stats(scheduleGaps(fixtureScheduleMs)) : undefined,
    reasoningScheduleMs: fixtureReasoningScheduleMs.length ? fixtureReasoningScheduleMs : undefined,
    reasoningScheduleGapsMs: fixtureReasoningScheduleMs.length ? stats(scheduleGaps(fixtureReasoningScheduleMs)) : undefined,
    textBytes: fixtureConfig && typeof fixtureConfig.textBytes === 'number' ? fixtureConfig.textBytes : undefined,
    reasoningBytes: fixtureConfig && typeof fixtureConfig.reasoningBytes === 'number' ? fixtureConfig.reasoningBytes : undefined,
    piboSessionId: fixtureConfig && typeof fixtureConfig.piboSessionId === 'string' ? fixtureConfig.piboSessionId : undefined,
    preludeMessages: backendPreludeConfig && typeof backendPreludeConfig.preludeMessages === 'number' ? backendPreludeConfig.preludeMessages : (options.fixturePreludeMessages || undefined),
    error: backendPreludeError || backendFixtureError,
  } : undefined;
  const eventSourceSummary = summarizeEventSourceProbe(startedAt, Boolean(options.startBackendFixture), options.reconnectAtMs, Boolean(options.simulateTraceCatchup), options.traceCatchupDropMs);
  const traceSummary = traceProbe && traceProbe.result;
  const regressions = streamingBenchmarkRegressions({
    debugAfter,
    debugDelta,
    fixture: fixtureSummary,
    eventSource: eventSourceSummary,
    sse: sseSummary,
    trace: traceSummary,
    dom: { lengthStart: initialText.length, lengthEnd: currentLength, lengthMax: maxLength, positiveUpdateCount: positiveUpdates.length, gapsMs: domGaps, positiveCharJumps: domJumps, firstPositiveUpdateMs },
    longTasks,
  });
  return {
    kind: 'streaming-benchmark',
    createdAt: nowIso(),
    url: location.href,
    title: document.title,
    durationMs: options.durationMs,
    debug: {
      enabledRequested: true,
      available: Boolean(debugAfter),
      reset,
      before: debugBefore,
      stateBeforeReset: debugStateBeforeReset,
      after: debugAfter,
      delta: debugDelta,
    },
    dom: {
      selector: ASSISTANT_SELECTOR,
      targetCountStart,
      targetCountEnd: assistantTargets().length,
      lengthStart: initialText.length,
      lengthEnd: currentLength,
      lengthMax: maxLength,
      updateCount: updates.length,
      positiveUpdateCount: positiveUpdates.length,
      firstPositiveUpdateMs: firstPositiveUpdateMs === undefined ? undefined : Math.round(firstPositiveUpdateMs),
      lastPositiveUpdateMs: lastPositiveAt === undefined ? undefined : Math.round(lastPositiveAt),
      gapsMs: domGaps,
      positiveCharJumps: domJumps,
    },
    raf: { count: rafCount, gapsMs: stats(rafGaps) },
    longTasks: {
      count: longTasks.length,
      totalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0) * 1000) / 1000,
      maxMs: Math.round((longTasks.length ? Math.max(...longTasks) : 0) * 1000) / 1000,
    },
    fixture: fixtureSummary,
    eventSource: eventSourceSummary,
    sse: sseSummary,
    trace: traceSummary,
    overlayDrop: overlayDropSummary,
    regressions,
    warnings,
  };
}
`;
}

function browserSnapshotLibrary(): string {
	return String.raw`
function nowIso() { return new Date().toISOString(); }
function safeString(value) { return typeof value === 'string' ? value : ''; }
function short(value, limit) {
  const text = safeString(value).replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, Math.max(0, limit - 1)) + '…' : text;
}
function redactText(element, options) {
  const tag = element.tagName.toLowerCase();
  const debug = element.getAttribute('data-pibo-debug') || '';
  if (tag === 'textarea' || tag === 'input' || debug === 'composer') {
    const value = 'value' in element ? String(element.value || '') : '';
    return value ? '[redacted:' + value.length + ' chars]' : '';
  }
  const text = element.innerText || element.textContent || '';
  if (!options.includeText && /message|trace|terminal|composer/i.test(debug)) return text ? '[redacted]' : '';
  return short(text, options.textLimit);
}
function classSummary(element) {
  const value = safeString(element.getAttribute('class'));
  if (!value) return undefined;
  const parts = value.split(/\s+/).filter(Boolean);
  const useful = parts.filter((part) => /selected|active|hidden|opacity|translate|animate|border|bg-|text-|ring|disabled|pointer|sr-only/.test(part));
  return (useful.length ? useful : parts.slice(0, 6)).slice(0, 10).join(' ');
}
function attrMap(element) {
  const attrs = {};
  const allow = /^(id|role|aria-|data-pibo-|data-testid$|disabled$|checked$|selected$|hidden$|tabindex$|title$)/;
  for (const attr of Array.from(element.attributes || [])) {
    if (!allow.test(attr.name)) continue;
    if (/token|cookie|authorization|secret|password/i.test(attr.name)) {
      attrs[attr.name] = '[redacted]';
    } else {
      attrs[attr.name] = short(attr.value, 120);
    }
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    attrs.value = element.value ? '[redacted:' + element.value.length + ' chars]' : '';
    attrs.disabled = Boolean(element.disabled);
  }
  return attrs;
}
function roleOf(element) {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') return 'input';
  if (tag === 'select') return 'combobox';
  if (tag === 'main') return 'main';
  if (tag === 'aside') return 'complementary';
  if (tag === 'nav') return 'navigation';
  return undefined;
}
function nameOf(element, options) {
  const aria = element.getAttribute('aria-label');
  if (aria) return short(aria, options.textLimit);
  const title = element.getAttribute('title');
  if (title) return short(title, options.textLimit);
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return short(element.getAttribute('placeholder') || '', options.textLimit);
  const debug = element.getAttribute('data-pibo-debug');
  if (debug === 'session-row') return short(element.getAttribute('data-pibo-title') || element.innerText || '', options.textLimit);
  return undefined;
}
function elementPath(element) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const index = Array.from(parent.children).filter((child) => child.tagName === current.tagName).indexOf(current) + 1;
    parts.unshift(tag + ':nth-of-type(' + index + ')');
    current = parent;
  }
  return parts.join('>');
}
function identityOf(element) {
  const debug = element.getAttribute('data-pibo-debug');
  const session = element.getAttribute('data-pibo-session-id');
  const room = element.getAttribute('data-pibo-room-id');
  const view = element.getAttribute('data-pibo-view-id');
  const testId = element.getAttribute('data-testid');
  const id = element.id;
  if (debug && session) return { identity: debug + ':' + session, kind: 'pibo-session' };
  if (debug && room) return { identity: debug + ':' + room, kind: 'pibo-room' };
  if (debug && view) return { identity: debug + ':' + view, kind: 'pibo-view' };
  if (debug) return { identity: debug, kind: 'pibo-debug' };
  if (testId) return { identity: 'testid:' + testId, kind: 'testid' };
  if (id) return { identity: 'id:' + id, kind: 'id' };
  const role = roleOf(element);
  const name = nameOf(element, { textLimit: 40 }) || '';
  if (role && name) return { identity: role + ':' + name, kind: 'role-name' };
  return { identity: 'path:' + elementPath(element), kind: 'path' };
}
function boxOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
}
function isImportantElement(element, depth) {
  if (!(element instanceof Element)) return false;
  const tag = element.tagName.toLowerCase();
  if (depth === 0) return true;
  if (['script', 'style', 'svg', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon'].includes(tag)) return false;
  if (element.hasAttribute('data-pibo-debug') || element.hasAttribute('data-pibo-session-id') || element.hasAttribute('data-testid')) return true;
  if (element.hasAttribute('aria-label') || element.hasAttribute('title') || element.hasAttribute('role')) return true;
  if (['button', 'a', 'input', 'textarea', 'select', 'option', 'main', 'aside', 'nav'].includes(tag)) return true;
  if (element === document.activeElement) return true;
  if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('data-pibo-selected') === 'true' || element.hasAttribute('hidden')) return true;
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  if (text && element.children.length === 0 && depth <= 4) return true;
  return false;
}
function summarizeElement(element, depth, ref, options) {
  const ident = identityOf(element);
  const node = {
    ref,
    identity: ident.identity,
    identityKind: ident.kind,
    depth,
    tag: element.tagName.toLowerCase(),
    attributes: attrMap(element),
    path: elementPath(element),
  };
  const role = roleOf(element); if (role) node.role = role;
  const name = nameOf(element, options); if (name) node.name = name;
  const text = redactText(element, options); if (text) node.text = text;
  const classes = classSummary(element); if (classes) node.classSummary = classes;
  if (document.activeElement === element) node.focused = true;
  if (options.includeLayout) node.box = boxOf(element);
  return node;
}
function captureSnapshot(options) {
  const root = document.querySelector(options.scope);
  const nodes = [];
  const omitted = { nodes: 0, depth: 0, budget: false };
  let refSeq = 0;
  function walk(element, depth) {
    if (!(element instanceof Element)) return;
    if (depth > options.maxDepth) { omitted.depth += 1; return; }
    if (isImportantElement(element, depth)) {
      if (nodes.length >= options.maxNodes) { omitted.nodes += 1; omitted.budget = true; return; }
      const node = summarizeElement(element, depth, '@n' + (++refSeq), options);
      nodes.push(node);
    }
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  }
  if (root) walk(root, 0);
  const active = document.activeElement instanceof Element ? summarizeElement(document.activeElement, 0, '@focus', options) : undefined;
  return {
    kind: 'snapshot',
    createdAt: nowIso(),
    url: location.href,
    title: document.title || '',
    scope: options.scope,
    rootFound: Boolean(root),
    root: nodes[0],
    activeElement: active ? { identity: active.identity, tag: active.tag, name: active.name, path: active.path } : undefined,
    nodes,
    omitted,
  };
}
function mutationTarget(mutation, options) {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return target ? summarizeElement(target, 0, '@target', options) : undefined;
}
function pushEvent(events, omitted, maxEvents, event) {
  if (events.length >= maxEvents) { omitted.events += 1; return; }
  events.push(event);
}
function findNewSessionButton() {
  const candidates = Array.from(document.querySelectorAll('button'));
  return candidates.find((button) => {
    const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].filter(Boolean).join(' ');
    return /New Session/i.test(label);
  });
}
async function runWatch(options) {
  const root = document.querySelector(options.scope);
  const events = [];
  const omitted = { events: 0, nodes: 0, depth: 0, budget: false };
  const start = performance.now();
  const at = () => Math.max(0, Math.round(performance.now() - start));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  let action = undefined;
  const routeEvent = (kind, beforeUrl, afterUrl) => {
    if (beforeUrl !== afterUrl) pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'route', kind, before: beforeUrl, after: afterUrl });
  };
  history.pushState = function(...args) {
    const beforeUrl = location.href;
    const result = originalPushState.apply(this, args);
    routeEvent('pushState', beforeUrl, location.href);
    return result;
  };
  history.replaceState = function(...args) {
    const beforeUrl = location.href;
    const result = originalReplaceState.apply(this, args);
    routeEvent('replaceState', beforeUrl, location.href);
    return result;
  };
  const onPopState = () => pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'route', kind: 'popstate', after: location.href });
  const onFocusIn = (event) => {
    if (!(event.target instanceof Element)) return;
    if (root && !root.contains(event.target)) return;
    const node = summarizeElement(event.target, 0, '@focus', options);
    pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'focus', kind: 'focusin', target: node.identity, node });
  };
  const observer = root ? new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const added of Array.from(mutation.addedNodes)) {
          if (!(added instanceof Element)) continue;
          const node = summarizeElement(added, 0, '@added', options);
          pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'added', target: node.identity, node });
        }
        for (const removed of Array.from(mutation.removedNodes)) {
          if (!(removed instanceof Element)) continue;
          const node = summarizeElement(removed, 0, '@removed', options);
          pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'removed', target: node.identity, node });
        }
      } else if (mutation.type === 'attributes') {
        const node = mutationTarget(mutation, options);
        if (!node) continue;
        const name = mutation.attributeName || 'attribute';
        const after = mutation.target instanceof Element ? mutation.target.getAttribute(name) : undefined;
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'attr', target: node.identity, detail: name, before: mutation.oldValue || '', after: after || '', node });
      } else if (mutation.type === 'characterData') {
        const node = mutationTarget(mutation, options);
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'dom', kind: 'text', target: node ? node.identity : undefined, before: short(mutation.oldValue || '', options.textLimit), after: short(mutation.target.textContent || '', options.textLimit), node });
      }
    }
  }) : undefined;
  if (observer && root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected', 'aria-expanded', 'data-pibo-selected', 'data-pibo-session-id', 'data-pibo-selected-session-id', 'data-pibo-state', 'data-pibo-debug'] });
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('popstate', onPopState, true);
  const before = captureSnapshot(options);
  omitted.nodes += before.omitted.nodes;
  omitted.depth += before.omitted.depth;
  omitted.budget = omitted.budget || before.omitted.budget;
  if (options.action === 'new-session') {
    try {
      const button = findNewSessionButton();
      action = { requested: 'new-session', performed: Boolean(button) };
      if (button) {
        const node = summarizeElement(button, 0, '@action', options);
        pushEvent(events, omitted, options.maxEvents, { t: at(), source: 'action', kind: 'click', target: node.identity, detail: 'New Session', node });
        button.click();
      } else {
        action.error = 'New Session button not found';
      }
    } catch (error) {
      action = { requested: 'new-session', performed: false, error: String(error && error.message ? error.message : error) };
    }
  }
  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  observer?.disconnect();
  document.removeEventListener('focusin', onFocusIn, true);
  window.removeEventListener('popstate', onPopState, true);
  history.pushState = originalPushState;
  history.replaceState = originalReplaceState;
  const after = captureSnapshot(options);
  omitted.nodes += after.omitted.nodes;
  omitted.depth += after.omitted.depth;
  omitted.budget = omitted.budget || after.omitted.budget || omitted.events > 0;
  return {
    kind: 'watch',
    createdAt: nowIso(),
    url: location.href,
    title: document.title || '',
    scope: options.scope,
    durationMs: options.durationMs,
    rootFound: Boolean(before.rootFound || after.rootFound),
    events,
    before,
    after,
    omitted,
    action,
  };
}
`;
}

function parseOptions(args: string[]): WebOptions {
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

function resolveScope(options: WebOptions): string {
	if (options.scope) return options.scope;
	if (options.preset) return presetScope(options.preset);
	throw new Error("Missing --scope or --preset. Try --preset session-list, chat-shell, composer, or app.");
}

function presetScope(preset: string): string {
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

function parseDuration(value?: string): number {
	if (!value) return DEFAULT_WATCH_DURATION_MS;
	const duration = Number(value);
	if (!Number.isFinite(duration) || duration <= 0) throw new Error("--duration must be a positive number of milliseconds");
	if (duration > MAX_WATCH_DURATION_MS) throw new Error(`--duration must be <= ${MAX_WATCH_DURATION_MS}ms`);
	return Math.round(duration);
}

function parseRuns(value?: string): number {
	if (!value) return 1;
	const runs = Number(value);
	if (!Number.isInteger(runs) || runs <= 0) throw new Error("--runs must be a positive integer");
	if (runs > 10) throw new Error("--runs must be <= 10");
	return runs;
}

function parseFixtureProfile(value?: string): StreamingFixtureProfile {
	if (!value) return "steady";
	if (value === "steady" || value === "jitter" || value === "burst" || value === "batch") return value;
	throw new Error("--fixture-profile must be steady, jitter, burst, or batch");
}

function parseFixtureMix(value?: string): StreamingFixtureMix {
	if (!value) return "text";
	if (value === "text" || value === "reasoning-text" || value === "markdown" || value === "gfm-markdown" || value === "gfm-task-markdown" || value === "gfm-full-markdown") return value;
	throw new Error("--fixture-mix must be text, reasoning-text, markdown, gfm-markdown, gfm-task-markdown, or gfm-full-markdown");
}

function parseFixturePreludeMessages(value?: string): number {
	if (!value) return 0;
	const count = Number(value);
	if (!Number.isInteger(count) || count < 0) throw new Error("--fixture-prelude-messages must be a non-negative integer");
	if (count > 2000) throw new Error("--fixture-prelude-messages must be <= 2000");
	return count;
}

function parseNegativeProfile(value?: string): StreamingNegativeProfile | undefined {
	if (!value) return undefined;
	if (value === "batch" || value === "overlay-drop") return value;
	throw new Error("--negative-profile must be batch or overlay-drop");
}

function applyNegativeStreamingProfile(options: WebOptions, profile: StreamingNegativeProfile): WebOptions {
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

function scoreStreamingBenchmark(benchmark: Omit<StreamingBenchmark, "score">): StreamingSmoothnessScore {
	const debugDelta = benchmark.debug.delta ?? {};
	const textDeltaCount = numberField(debugDelta, "textDeltaCount");
	const domGapP50Ms = finiteNumber(benchmark.dom.gapsMs.p50);
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const domJumpP90Chars = finiteNumber(benchmark.dom.positiveCharJumps.p90);
	const firstVisibleMs = finiteNumber(benchmark.dom.firstPositiveUpdateMs);
	const providerToDomRatio = textDeltaCount > 0 ? Math.min(1, benchmark.dom.positiveUpdateCount / textDeltaCount) : 0;
	const smoothness =
		0.30 * clampScore(100 - (domGapP50Ms ?? 100))
		+ 0.25 * clampScore(((300 - (domGapP90Ms ?? 300)) / 3))
		+ 0.20 * clampScore(((120 - (domJumpP90Chars ?? 120)) / 1.2))
		+ 0.15 * clampScore(providerToDomRatio * 100)
		+ 0.10 * clampScore(100 - ((firstVisibleMs ?? 500) / 5));
	return {
		smoothness: round3(smoothness),
		domGapP50Ms,
		domGapP90Ms,
		domJumpP90Chars,
		textDeltaCount,
		domPositiveUpdateCount: benchmark.dom.positiveUpdateCount,
		firstVisibleMs,
	};
}

function summarizeStreamingCadence(benchmark: Pick<StreamingBenchmark, "fixture" | "dom" | "sse">): StreamingBenchmarkCadence | undefined {
	const fixtureScheduleGapP90Ms = finiteNumber(benchmark.fixture?.scheduleGapsMs?.p90);
	if (fixtureScheduleGapP90Ms === undefined) return undefined;
	const domGapP90Ms = finiteNumber(benchmark.dom.gapsMs.p90);
	const sseTextGapP90Ms = finiteNumber(benchmark.sse?.textEventGapsMs.p90);
	return {
		fixtureScheduleGapP90Ms,
		domGapP90Ms,
		sseTextGapP90Ms,
		domLagOverScheduleP90Ms: domGapP90Ms === undefined ? undefined : round3(domGapP90Ms - fixtureScheduleGapP90Ms),
		sseTextLagOverScheduleP90Ms: sseTextGapP90Ms === undefined ? undefined : round3(sseTextGapP90Ms - fixtureScheduleGapP90Ms),
		domToScheduleP90Ratio: domGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(domGapP90Ms / fixtureScheduleGapP90Ms),
		sseTextToScheduleP90Ratio: sseTextGapP90Ms === undefined || fixtureScheduleGapP90Ms <= 0 ? undefined : round3(sseTextGapP90Ms / fixtureScheduleGapP90Ms),
	};
}

export function summarizeStreamingProviderPreservation(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "streams">; dom?: Pick<StreamingBenchmark["dom"], "positiveUpdateCount"> }): StreamingBenchmarkProviderPreservation | undefined {
	const provider = benchmark.provider;
	if (!provider?.available) return undefined;
	const selectedLive = summarizeStreamingSelectedLiveEventSource(benchmark);
	return {
		providerTextDeltaCount: provider.textDeltaCount,
		providerReasoningDeltaCount: provider.reasoningDeltaCount,
		sseTextEventCount: benchmark.sse?.textEventCount,
		sseReasoningEventCount: benchmark.sse?.reasoningEventCount,
		selectedLiveTextEventCountAfterStart: selectedLive?.textEventCountAfterStart,
		selectedLiveReasoningEventCountAfterStart: selectedLive?.reasoningEventCountAfterStart,
		domPositiveUpdateCount: benchmark.dom?.positiveUpdateCount,
		sseTextToProviderRatio: ratioToProvider(benchmark.sse?.textEventCount, provider.textDeltaCount),
		sseReasoningToProviderRatio: ratioToProvider(benchmark.sse?.reasoningEventCount, provider.reasoningDeltaCount),
		selectedLiveTextToProviderRatio: ratioToProvider(selectedLive?.textEventCountAfterStart, provider.textDeltaCount),
		selectedLiveReasoningToProviderRatio: ratioToProvider(selectedLive?.reasoningEventCountAfterStart, provider.reasoningDeltaCount),
		domPositiveToProviderTextRatio: ratioToProvider(benchmark.dom?.positiveUpdateCount, provider.textDeltaCount),
	};
}

export function summarizeStreamingLivePipeline(benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta" | "stateBeforeReset" | "after">; fixture?: StreamingBenchmark["fixture"]; provider?: StreamingBenchmarkProviderTelemetry }): StreamingBenchmarkLivePipeline | undefined {
	const debugDelta = benchmark.debug?.delta ?? {};
	const debugStateBeforeReset = benchmark.debug?.stateBeforeReset ?? {};
	const debugAfter = benchmark.debug?.after ?? {};
	const fixtureTextCount = finiteNumber(benchmark.fixture?.deltaCount);
	const fixtureReasoningCount = finiteNumber(benchmark.fixture?.reasoningDeltaCount);
	const provider = benchmark.provider?.available ? benchmark.provider : undefined;
	const debugTextCount = finiteNumber(debugDelta.textDeltaCount);
	const debugReasoningCount = finiteNumber(debugDelta.reasoningDeltaCount);
	const expectedSource = fixtureTextCount !== undefined || fixtureReasoningCount !== undefined ? "fixture" : provider ? "provider" : "debug";
	const expectedTextDeltaCount = expectedSource === "fixture" ? (fixtureTextCount ?? 0) : expectedSource === "provider" ? provider?.textDeltaCount ?? 0 : debugTextCount ?? 0;
	const expectedReasoningDeltaCount = expectedSource === "fixture" ? (fixtureReasoningCount ?? 0) : expectedSource === "provider" ? provider?.reasoningDeltaCount ?? 0 : debugReasoningCount ?? 0;
	const expectedInputEventCount = expectedTextDeltaCount + expectedReasoningDeltaCount;
	if (expectedInputEventCount <= 0) return undefined;
	const expectedPipelineEventCount = expectedStreamingPipelineEventCount(benchmark, expectedInputEventCount);
	const enqueueCount = finiteNumber(debugDelta.enqueueCount);
	const flushCount = finiteNumber(debugDelta.flushCount);
	const flushedEventCount = finiteNumber(debugDelta.flushedEventCount);
	const overlayUpdateCount = finiteNumber(debugDelta.overlayUpdateCount);
	const overlayEventCount = stateWindowNumber(debugAfter.overlayEventCount, debugStateBeforeReset.overlayEventCount);
	const currentOutputLength = stateWindowNumber(debugAfter.currentOutputLength, debugStateBeforeReset.currentOutputLength);
	const expectedTextBytes = finiteNumber(benchmark.fixture?.textBytes);
	const debugStartedAt = typeof debugAfter.startedAt === "string" ? debugAfter.startedAt : undefined;
	return {
		expectedSource,
		expectedTextDeltaCount,
		expectedReasoningDeltaCount,
		expectedInputEventCount,
		expectedPipelineEventCount,
		enqueueCount,
		flushCount,
		flushedEventCount,
		overlayUpdateCount,
		overlayEventCount,
		currentOutputLength,
		expectedTextBytes,
		enqueueToExpectedRatio: ratioToProvider(enqueueCount, expectedPipelineEventCount),
		flushedEventsToExpectedRatio: ratioToProvider(flushedEventCount, expectedPipelineEventCount),
		overlayEventsToExpectedRatio: ratioToProvider(overlayEventCount, expectedInputEventCount),
		currentOutputToExpectedTextBytesRatio: ratioToProvider(currentOutputLength, expectedTextBytes),
		flushToEnqueueRatio: ratioToProvider(flushCount, enqueueCount),
		overlayUpdatesToFlushedEventsRatio: ratioToProvider(overlayUpdateCount, flushedEventCount),
		firstEventMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEventAt),
		firstTextDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstTextDeltaAt),
		firstReasoningDeltaMs: elapsedIsoMs(debugStartedAt, debugAfter.firstReasoningDeltaAt),
		firstEnqueueMs: elapsedIsoMs(debugStartedAt, debugAfter.firstEnqueueAt),
		firstFlushMs: elapsedIsoMs(debugStartedAt, debugAfter.firstFlushAt),
		firstOverlayUpdateMs: elapsedIsoMs(debugStartedAt, debugAfter.firstOverlayUpdateAt),
	};
}

function expectedStreamingPipelineEventCount(_benchmark: { debug?: Pick<StreamingBenchmark["debug"], "delta">; fixture?: StreamingBenchmark["fixture"] }, fallbackInputEventCount: number): number {
	return fallbackInputEventCount;
}

export function evaluateStreamingLivePipelineRegressions(benchmark: { livePipeline?: StreamingBenchmarkLivePipeline; fixture?: StreamingBenchmark["fixture"] }): string[] {
	const pipeline = benchmark.livePipeline;
	if (!pipeline || pipeline.expectedSource === "debug" || pipeline.expectedInputEventCount <= 0 || benchmark.fixture?.simulation === "trace-catchup") return [];
	const hasLiveCounters = [pipeline.enqueueCount, pipeline.flushCount, pipeline.flushedEventCount, pipeline.overlayUpdateCount, pipeline.overlayEventCount].some((value) => value !== undefined);
	if (!hasLiveCounters) return [];
	const regressions: string[] = [];
	pushMinimumRatioRegression(regressions, pipeline.flushedEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline flushed events/overlay expected ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayEventsToExpectedRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline overlay events/input expected ratio");
	if (pipeline.expectedTextDeltaCount > 0 && pipeline.expectedTextBytes !== undefined) {
		pushMinimumRatioRegression(regressions, pipeline.currentOutputToExpectedTextBytesRatio, LIVE_PIPELINE_MIN_PRESERVATION_RATIO, "live pipeline current text/expected bytes ratio");
	}
	pushMinimumRatioRegression(regressions, pipeline.flushToEnqueueRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline flush/enqueue ratio");
	pushMinimumRatioRegression(regressions, pipeline.overlayUpdatesToFlushedEventsRatio, LIVE_PIPELINE_MIN_FLUSH_RATIO, "live pipeline overlay updates/flushed ratio");
	return regressions;
}

export function evaluateStreamingProviderRegressions(benchmark: { provider?: StreamingBenchmarkProviderTelemetry; providerPreservation?: StreamingBenchmarkProviderPreservation; sse?: StreamingBenchmarkSseProbe; eventSource?: Pick<StreamingBenchmarkEventSourceProbe, "requested"> }): string[] {
	const provider = benchmark.provider;
	if (!provider?.available) return [];
	const regressions: string[] = [];
	if ((provider.parseErrorCount ?? 0) > 0) regressions.push(`provider parse errors ${provider.parseErrorCount} > 0`);
	if ((provider.unknownEventCount ?? 0) > 0) regressions.push(`provider unknown events ${provider.unknownEventCount} > 0`);
	if (provider.truncated) regressions.push("provider telemetry events were truncated");
	const preservation = benchmark.providerPreservation;
	if (provider.textDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider SSE text preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveTextToProviderRatio, PROVIDER_MIN_TEXT_PRESERVATION_RATIO, "provider selected-live text preservation ratio");
	}
	if (provider.reasoningDeltaCount > 0) {
		if (benchmark.sse?.requested) pushProviderRatioRegression(regressions, preservation?.sseReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider SSE reasoning preservation ratio");
		if (benchmark.eventSource?.requested) pushProviderRatioRegression(regressions, preservation?.selectedLiveReasoningToProviderRatio, PROVIDER_MIN_REASONING_PRESERVATION_RATIO, "provider selected-live reasoning preservation ratio");
	}
	return regressions;
}

function pushProviderRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	pushMinimumRatioRegression(regressions, ratio, minimum, label);
}

function pushMinimumRatioRegression(regressions: string[], ratio: number | undefined, minimum: number, label: string): void {
	if (ratio === undefined) regressions.push(`${label} unavailable`);
	else if (ratio < minimum) regressions.push(`${label} ${ratio} < ${minimum}`);
}

function ratioToProvider(numerator: number | undefined, denominator: number | undefined): number | undefined {
	if (numerator === undefined || denominator === undefined || denominator <= 0) return undefined;
	return round3(numerator / denominator);
}

function commonStreamingNegativeProfile(runs: readonly StreamingBenchmark[]): StreamingNegativeProfile | undefined {
	const profile = runs[0]?.negativeProfile;
	return profile && runs.every((run) => run.negativeProfile === profile) ? profile : undefined;
}

function summarizeStreamingBenchmarkGroup(runs: StreamingBenchmark[], baselineRuns?: StreamingBenchmark[]): StreamingBenchmarkGroup {
	const summary = summarizeStreamingBenchmarks(runs);
	return {
		kind: "streaming-benchmark-runs",
		createdAt: new Date().toISOString(),
		durationMs: runs[0]?.durationMs ?? 0,
		runs,
		negativeProfile: commonStreamingNegativeProfile(runs),
		summary,
		comparison: baselineRuns?.length ? compareStreamingBenchmarkSummaries(summarizeStreamingBenchmarks(baselineRuns), summary) : undefined,
		regressions: runs.flatMap((run, index) => run.regressions.map((regression) => `run ${index + 1}: ${regression}`)),
		warnings: runs.flatMap((run, index) => run.warnings.map((warning) => `run ${index + 1}: ${warning}`)),
	};
}

export function summarizeStreamingBenchmarkUrlComparison(primaryUrl: string, compareUrl: string, primary: StreamingBenchmarkGroup, compare: StreamingBenchmarkGroup): StreamingBenchmarkUrlComparison {
	const summaryComparison = compareStreamingBenchmarkSummaries(primary.summary, compare.summary);
	const negativeProfile = primary.negativeProfile && primary.negativeProfile === compare.negativeProfile ? primary.negativeProfile : undefined;
	return {
		kind: "streaming-benchmark-url-comparison",
		createdAt: new Date().toISOString(),
		durationMs: primary.durationMs,
		primaryUrl,
		compareUrl,
		primary,
		compare,
		negativeProfile,
		comparison: summaryComparison,
		regressions: [
			...primary.regressions.map((regression) => `primary: ${regression}`),
			...compare.regressions.map((regression) => `compare: ${regression}`),
			...evaluateStreamingBenchmarkUrlComparisonRegressions(summaryComparison).map((regression) => `comparison: ${regression}`),
		],
		warnings: [
			...primary.warnings.map((warning) => `primary: ${warning}`),
			...compare.warnings.map((warning) => `compare: ${warning}`),
		],
	};
}

export function evaluateStreamingBenchmarkUrlComparisonRegressions(comparison: StreamingBenchmarkComparison): string[] {
	const regressions: string[] = [];
	if (comparison.smoothnessDelta !== undefined && comparison.smoothnessDelta < -URL_COMPARISON_MAX_SMOOTHNESS_DROP) {
		regressions.push(`compare smoothness delta ${comparison.smoothnessDelta} below -${URL_COMPARISON_MAX_SMOOTHNESS_DROP}`);
	}
	if (comparison.domLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.domLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_DOM_LAG_DELTA_MS) {
		regressions.push(`compare DOM lag over schedule delta ${comparison.domLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_DOM_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseTextLagOverFixtureScheduleP90DeltaMs !== undefined && comparison.sseTextLagOverFixtureScheduleP90DeltaMs > URL_COMPARISON_MAX_SSE_LAG_DELTA_MS) {
		regressions.push(`compare SSE text lag over schedule delta ${comparison.sseTextLagOverFixtureScheduleP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_LAG_DELTA_MS}ms`);
	}
	if (comparison.sseChunkGapP90DeltaMs !== undefined && comparison.sseChunkGapP90DeltaMs > URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS) {
		regressions.push(`compare SSE chunk p90 gap delta ${comparison.sseChunkGapP90DeltaMs}ms exceeds ${URL_COMPARISON_MAX_SSE_CHUNK_GAP_DELTA_MS}ms`);
	}
	if (comparison.selectedLiveFirstTextEventDeltaMs !== undefined && comparison.selectedLiveFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare selected-live first text latency delta ${comparison.selectedLiveFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseFirstTextEventDeltaMs !== undefined && comparison.sseFirstTextEventDeltaMs > URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS) {
		regressions.push(`compare SSE first text latency delta ${comparison.sseFirstTextEventDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_TRANSPORT_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstTextDeltaDeltaMs !== undefined && comparison.liveFirstTextDeltaDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first text latency delta ${comparison.liveFirstTextDeltaDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstEnqueueDeltaMs !== undefined && comparison.liveFirstEnqueueDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first enqueue latency delta ${comparison.liveFirstEnqueueDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstFlushDeltaMs !== undefined && comparison.liveFirstFlushDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first flush latency delta ${comparison.liveFirstFlushDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.liveFirstOverlayUpdateDeltaMs !== undefined && comparison.liveFirstOverlayUpdateDeltaMs > URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS) {
		regressions.push(`compare live first overlay latency delta ${comparison.liveFirstOverlayUpdateDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_LIVE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.firstVisibleDeltaMs !== undefined && comparison.firstVisibleDeltaMs > URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS) {
		regressions.push(`compare DOM first visible latency delta ${comparison.firstVisibleDeltaMs}ms exceeds ${URL_COMPARISON_MAX_FIRST_VISIBLE_LATENCY_DELTA_MS}ms`);
	}
	if (comparison.sseTextEventDelta !== undefined && comparison.sseTextEventDelta < 0) regressions.push(`compare SSE text events delta ${comparison.sseTextEventDelta} below 0`);
	if (comparison.selectedLiveTextEventDelta !== undefined && comparison.selectedLiveTextEventDelta < 0) regressions.push(`compare selected-live text events delta ${comparison.selectedLiveTextEventDelta} below 0`);
	if (comparison.selectedLiveReasoningEventDelta !== undefined && comparison.selectedLiveReasoningEventDelta < 0) regressions.push(`compare selected-live reasoning events delta ${comparison.selectedLiveReasoningEventDelta} below 0`);
	return regressions;
}

function resolveStreamingBenchmarkCompareUrl(rawCompareUrl: string, primaryUrl: string): string {
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

async function resolveStreamingBenchmarkHostedCompareUrl(options: { optional?: boolean } = {}): Promise<string | undefined> {
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

function applyExpectedStreamingRegressions(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison, expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const assertion = evaluateStreamingBenchmarkAssertion(benchmark.regressions, expectedPatterns);
	if (expectedPatterns.length > 0) benchmark.assertion = assertion;
	return assertion;
}

export function evaluateStreamingBenchmarkAssertion(regressions: readonly string[], expectedPatterns: readonly string[]): StreamingBenchmarkAssertion {
	const expectedRegressionPatterns = expectedPatterns.filter((pattern) => pattern.length > 0);
	const expectedRegressions: string[] = [];
	const unexpectedRegressions: string[] = [];
	const matchedPatterns = new Set<string>();
	for (const regression of regressions) {
		const matches = expectedRegressionPatterns.filter((pattern) => regression.includes(pattern));
		if (matches.length > 0) {
			expectedRegressions.push(regression);
			for (const pattern of matches) matchedPatterns.add(pattern);
		} else {
			unexpectedRegressions.push(regression);
		}
	}
	const missingExpectedRegressionPatterns = expectedRegressionPatterns.filter((pattern) => !matchedPatterns.has(pattern));
	return {
		expectedRegressionPatterns,
		expectedRegressions,
		unexpectedRegressions,
		missingExpectedRegressionPatterns,
		passed: unexpectedRegressions.length === 0 && missingExpectedRegressionPatterns.length === 0,
	};
}

export function summarizeStreamingBenchmarks(runs: StreamingBenchmark[]): StreamingBenchmarkSummary {
	return {
		runs: runs.length,
		smoothness: numericStats(runs.map((run) => run.score.smoothness)),
		textDeltaCount: numericStats(runs.map((run) => run.score.textDeltaCount)),
		reasoningDeltaCount: numericStats(runs.map((run) => numberField(run.debug.delta ?? {}, "reasoningDeltaCount"))),
		domPositiveUpdateCount: numericStats(runs.map((run) => run.score.domPositiveUpdateCount)),
		domGapP50Ms: numericStats(runs.map((run) => run.dom.gapsMs.p50)),
		domGapP90Ms: numericStats(runs.map((run) => run.dom.gapsMs.p90)),
		domGapMaxMs: numericStats(runs.map((run) => run.dom.gapsMs.max)),
		domJumpP90Chars: numericStats(runs.map((run) => run.dom.positiveCharJumps.p90)),
		domJumpMaxChars: numericStats(runs.map((run) => run.dom.positiveCharJumps.max)),
		firstVisibleMs: numericStats(runs.map((run) => run.dom.firstPositiveUpdateMs)),
		longTaskMaxMs: numericStats(runs.map((run) => run.longTasks.maxMs)),
		regressionCount: numericStats(runs.map((run) => run.regressions.length)),
		debugEnqueueCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "enqueueCount"))),
		debugFlushCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushCount"))),
		debugFlushedEventCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "flushedEventCount"))),
		debugOverlayUpdateCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "overlayUpdateCount"))),
		debugOverlayEventCount: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "overlayEventCount"))),
		debugLiveTraceComputeCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeCount"))),
		debugLiveTraceComputeDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "liveTraceComputeDurationMsTotal"))),
		debugLiveTraceComputeDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "liveTraceComputeDurationMsMax"))),
		debugMarkdownRenderCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCount"))),
		debugMarkdownRenderPlainCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderPlainCount"))),
		debugMarkdownRenderFullCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderFullCount"))),
		debugMarkdownRenderCommonMarkCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderCommonMarkCount"))),
		debugMarkdownRenderGfmCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmCount"))),
		debugMarkdownRenderGfmFastCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderGfmFastCount"))),
		debugMarkdownRenderDurationTotalMs: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "markdownRenderDurationMsTotal"))),
		debugMarkdownRenderDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderDurationMsMax"))),
		debugMarkdownRenderPlainDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderPlainDurationMsMax"))),
		debugMarkdownRenderFullDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderFullDurationMsMax"))),
		debugMarkdownRenderCommonMarkDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderCommonMarkDurationMsMax"))),
		debugMarkdownRenderGfmDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmDurationMsMax"))),
		debugMarkdownRenderGfmFastDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "markdownRenderGfmFastDurationMsMax"))),
		debugTraceRefreshScheduledCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshScheduledCount"))),
		debugTraceRefreshCompletedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshCompletedCount"))),
		debugTraceRefreshFailedCount: numericStats(runs.map((run) => streamingDebugDeltaNumber(run, "traceRefreshFailedCount"))),
		debugTraceRefreshDurationMaxMs: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceRefreshDurationMsMax"))),
		debugCurrentOutputLength: numericStats(runs.map((run) => streamingDebugStateWindowNumber(run, "currentOutputLength"))),
		debugTraceBaseOutputLength: numericStats(runs.map((run) => streamingDebugAfterNumber(run, "traceBaseOutputLength"))),
		liveExpectedInputEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedInputEventCount)),
		liveExpectedPipelineEventCount: numericStats(runs.map((run) => streamingLivePipeline(run)?.expectedPipelineEventCount)),
		liveEnqueueToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.enqueueToExpectedRatio)),
		liveFlushedEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushedEventsToExpectedRatio)),
		liveOverlayEventsToExpectedRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayEventsToExpectedRatio)),
		liveCurrentOutputToExpectedTextBytesRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.currentOutputToExpectedTextBytesRatio)),
		liveFlushToEnqueueRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.flushToEnqueueRatio)),
		liveOverlayUpdatesToFlushedEventsRatio: numericStats(runs.map((run) => streamingLivePipeline(run)?.overlayUpdatesToFlushedEventsRatio)),
		liveFirstEventMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEventMs)),
		liveFirstTextDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstTextDeltaMs)),
		liveFirstReasoningDeltaMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstReasoningDeltaMs)),
		liveFirstEnqueueMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstEnqueueMs)),
		liveFirstFlushMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstFlushMs)),
		liveFirstOverlayUpdateMs: numericStats(runs.map((run) => streamingLivePipeline(run)?.firstOverlayUpdateMs)),
		traceSampleCount: numericStats(runs.map((run) => run.trace?.sampleCount)),
		traceLiveVersionCount: numericStats(runs.map((run) => run.trace?.liveVersionCount)),
		traceFirstLiveVersionMs: numericStats(runs.map((run) => run.trace?.firstLiveVersionMs)),
		traceMaxAssistantOutputLength: numericStats(runs.map((run) => run.trace?.maxAssistantOutputLength)),
		traceFinalAssistantOutputLength: numericStats(runs.map((run) => run.trace?.finalAssistantOutputLength)),
		traceDurableEventDelta: numericStats(runs.map((run) => traceDurableEventDelta(run.trace))),
		fixtureScheduleGapP90Ms: numericStats(runs.map((run) => run.fixture?.scheduleGapsMs?.p90)),
		domLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.domLagOverScheduleP90Ms)),
		sseTextLagOverFixtureScheduleP90Ms: numericStats(runs.map((run) => run.cadence?.sseTextLagOverScheduleP90Ms)),
		domToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.domToScheduleP90Ratio)),
		sseTextToFixtureScheduleP90Ratio: numericStats(runs.map((run) => run.cadence?.sseTextToScheduleP90Ratio)),
		eventSourceTextEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.textEventCountAfterStart)),
		eventSourceReasoningEventCountAfterStart: numericStats(runs.map((run) => run.eventSource?.reasoningEventCountAfterStart)),
		eventSourceForcedCloseCountAfterStart: numericStats(runs.map((run) => run.eventSource?.forcedCloseCountAfterStart)),
		eventSourceReconnectOpenCountAfterStart: numericStats(runs.map((run) => run.eventSource?.openCountAfterStart)),
		eventSourceTransientIdCountAfterStart: numericStats(runs.map((run) => run.eventSource?.transientIdCountAfterStart)),
		sseTextEventCount: numericStats(runs.map((run) => run.sse?.textEventCount)),
		sseReasoningEventCount: numericStats(runs.map((run) => run.sse?.reasoningEventCount)),
		sseChunkBytesP50: numericStats(runs.map((run) => run.sse?.chunkBytes.p50)),
		sseChunkGapP90Ms: numericStats(runs.map((run) => run.sse?.chunkGapsMs.p90)),
		sseTextEventsPerChunkP90: numericStats(runs.map((run) => run.sse?.textEventsPerChunk.p90)),
		sseTextEventGapP90Ms: numericStats(runs.map((run) => run.sse?.textEventGapsMs.p90)),
		sseFirstTextEventMs: numericStats(runs.map((run) => run.sse?.firstTextEventMs)),
		selectedLiveTextEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.textEventCountAfterStart)),
		selectedLiveReasoningEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.reasoningEventCountAfterStart)),
		selectedLiveEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.eventCountAfterStart)),
		selectedLiveForcedCloseCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.forcedCloseCountAfterStart)),
		selectedLiveReconnectOpenCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.openCountAfterStart)),
		selectedLiveTransientIdCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.transientIdCountAfterStart)),
		selectedLiveLiveSinceCount: numericStats(runs.map((run) => selectedLiveStream(run)?.liveSinceValues?.length)),
		selectedLiveReplayEventCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayEventCountAfterStart)),
		selectedLiveReplayCursorLagMaxAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayCursorLagMaxAfterStart)),
		selectedLiveReplayDuplicateCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayDuplicateCountAfterStart)),
		selectedLiveReplayMissedCountAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.liveReplayMissedCountAfterStart)),
		selectedLiveFirstTextEventMsAfterStart: numericStats(runs.map((run) => selectedLiveStream(run)?.firstTextEventMsAfterStart)),
		roomSummaryEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.eventCountAfterStart)),
		roomSummaryTextEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.textEventCountAfterStart)),
		roomSummaryReasoningEventCountAfterStart: numericStats(runs.map((run) => roomSummaryStream(run)?.reasoningEventCountAfterStart)),
		providerTextDeltaCount: numericStats(runs.map((run) => run.provider?.textDeltaCount)),
		providerReasoningDeltaCount: numericStats(runs.map((run) => run.provider?.reasoningDeltaCount)),
		providerTextDeltaBytesP50: numericStats(runs.map((run) => run.provider?.textDeltaBytes.p50)),
		providerTextDeltaGapP90Ms: numericStats(runs.map((run) => run.provider?.textDeltaGapsMs.p90)),
		providerFirstTextLatencyMs: numericStats(runs.map((run) => run.provider?.firstTextLatencyMs)),
		providerParseErrorCount: numericStats(runs.map((run) => run.provider?.parseErrorCount)),
		providerUnknownEventCount: numericStats(runs.map((run) => run.provider?.unknownEventCount)),
		providerSseTextRatio: numericStats(runs.map((run) => run.providerPreservation?.sseTextToProviderRatio)),
		providerSseReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.sseReasoningToProviderRatio)),
		providerSelectedLiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveTextToProviderRatio)),
		providerSelectedLiveReasoningRatio: numericStats(runs.map((run) => run.providerPreservation?.selectedLiveReasoningToProviderRatio)),
		providerDomPositiveTextRatio: numericStats(runs.map((run) => run.providerPreservation?.domPositiveToProviderTextRatio)),
	};
}

function compareStreamingBenchmarkSummaries(baseline: StreamingBenchmarkSummary, current: StreamingBenchmarkSummary): StreamingBenchmarkComparison {
	return {
		baselineRuns: baseline.runs,
		currentRuns: current.runs,
		smoothnessDelta: statDelta(current.smoothness, baseline.smoothness),
		domGapP90DeltaMs: statDelta(current.domGapP90Ms, baseline.domGapP90Ms),
		domPositiveUpdateDelta: statDelta(current.domPositiveUpdateCount, baseline.domPositiveUpdateCount),
		domJumpMaxDeltaChars: statDelta(current.domJumpMaxChars, baseline.domJumpMaxChars),
		longTaskMaxDeltaMs: statDelta(current.longTaskMaxMs, baseline.longTaskMaxMs),
		firstVisibleDeltaMs: statDelta(current.firstVisibleMs, baseline.firstVisibleMs),
		liveFirstTextDeltaDeltaMs: statDelta(current.liveFirstTextDeltaMs, baseline.liveFirstTextDeltaMs),
		liveFirstEnqueueDeltaMs: statDelta(current.liveFirstEnqueueMs, baseline.liveFirstEnqueueMs),
		liveFirstFlushDeltaMs: statDelta(current.liveFirstFlushMs, baseline.liveFirstFlushMs),
		liveFirstOverlayUpdateDeltaMs: statDelta(current.liveFirstOverlayUpdateMs, baseline.liveFirstOverlayUpdateMs),
		sseFirstTextEventDeltaMs: statDelta(current.sseFirstTextEventMs, baseline.sseFirstTextEventMs),
		selectedLiveFirstTextEventDeltaMs: statDelta(current.selectedLiveFirstTextEventMsAfterStart, baseline.selectedLiveFirstTextEventMsAfterStart),
		providerFirstTextLatencyDeltaMs: statDelta(current.providerFirstTextLatencyMs, baseline.providerFirstTextLatencyMs),
		debugEnqueueCountDelta: statDelta(current.debugEnqueueCount, baseline.debugEnqueueCount),
		debugFlushCountDelta: statDelta(current.debugFlushCount, baseline.debugFlushCount),
		debugOverlayUpdateCountDelta: statDelta(current.debugOverlayUpdateCount, baseline.debugOverlayUpdateCount),
		debugTraceRefreshCompletedCountDelta: statDelta(current.debugTraceRefreshCompletedCount, baseline.debugTraceRefreshCompletedCount),
		liveEnqueueToExpectedRatioDelta: statDelta(current.liveEnqueueToExpectedRatio, baseline.liveEnqueueToExpectedRatio),
		liveFlushedEventsToExpectedRatioDelta: statDelta(current.liveFlushedEventsToExpectedRatio, baseline.liveFlushedEventsToExpectedRatio),
		liveOverlayEventsToExpectedRatioDelta: statDelta(current.liveOverlayEventsToExpectedRatio, baseline.liveOverlayEventsToExpectedRatio),
		liveFlushToEnqueueRatioDelta: statDelta(current.liveFlushToEnqueueRatio, baseline.liveFlushToEnqueueRatio),
		liveOverlayUpdatesToFlushedEventsRatioDelta: statDelta(current.liveOverlayUpdatesToFlushedEventsRatio, baseline.liveOverlayUpdatesToFlushedEventsRatio),
		traceLiveVersionCountDelta: statDelta(current.traceLiveVersionCount, baseline.traceLiveVersionCount),
		traceMaxAssistantOutputDelta: statDelta(current.traceMaxAssistantOutputLength, baseline.traceMaxAssistantOutputLength),
		traceDurableEventDeltaDelta: statDelta(current.traceDurableEventDelta, baseline.traceDurableEventDelta),
		fixtureScheduleGapP90DeltaMs: statDelta(current.fixtureScheduleGapP90Ms, baseline.fixtureScheduleGapP90Ms),
		domLagOverFixtureScheduleP90DeltaMs: statDelta(current.domLagOverFixtureScheduleP90Ms, baseline.domLagOverFixtureScheduleP90Ms),
		sseTextLagOverFixtureScheduleP90DeltaMs: statDelta(current.sseTextLagOverFixtureScheduleP90Ms, baseline.sseTextLagOverFixtureScheduleP90Ms),
		eventSourceTextEventDelta: statDelta(current.eventSourceTextEventCountAfterStart, baseline.eventSourceTextEventCountAfterStart),
		eventSourceReasoningEventDelta: statDelta(current.eventSourceReasoningEventCountAfterStart, baseline.eventSourceReasoningEventCountAfterStart),
		sseTextEventDelta: statDelta(current.sseTextEventCount, baseline.sseTextEventCount),
		sseChunkGapP90DeltaMs: statDelta(current.sseChunkGapP90Ms, baseline.sseChunkGapP90Ms),
		selectedLiveTextEventDelta: statDelta(current.selectedLiveTextEventCountAfterStart, baseline.selectedLiveTextEventCountAfterStart),
		selectedLiveReasoningEventDelta: statDelta(current.selectedLiveReasoningEventCountAfterStart, baseline.selectedLiveReasoningEventCountAfterStart),
		selectedLiveEventDelta: statDelta(current.selectedLiveEventCountAfterStart, baseline.selectedLiveEventCountAfterStart),
		providerSseTextRatioDelta: statDelta(current.providerSseTextRatio, baseline.providerSseTextRatio),
		providerSelectedLiveTextRatioDelta: statDelta(current.providerSelectedLiveTextRatio, baseline.providerSelectedLiveTextRatio),
		providerSseReasoningRatioDelta: statDelta(current.providerSseReasoningRatio, baseline.providerSseReasoningRatio),
		providerSelectedLiveReasoningRatioDelta: statDelta(current.providerSelectedLiveReasoningRatio, baseline.providerSelectedLiveReasoningRatio),
		providerDomPositiveTextRatioDelta: statDelta(current.providerDomPositiveTextRatio, baseline.providerDomPositiveTextRatio),
	};
}

function streamingLivePipeline(run: StreamingBenchmark): StreamingBenchmarkLivePipeline | undefined {
	return run.livePipeline ?? summarizeStreamingLivePipeline(run);
}

function streamingDebugDeltaNumber(run: StreamingBenchmark, key: string): number | undefined {
	const value = run.debug.delta?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugAfterNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	const value = run.debug.after?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function streamingDebugStateWindowNumber(run: StreamingBenchmark, key: keyof StreamingDebugCounters): number | undefined {
	return stateWindowNumber(run.debug.after?.[key], run.debug.stateBeforeReset?.[key]);
}

function selectedLiveStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return summarizeStreamingSelectedLiveEventSource(run);
}

function roomSummaryStream(run: StreamingBenchmark): StreamingBenchmarkEventSourceStreamProbe | undefined {
	return run.eventSource?.streams.find((stream) => stream.role === "room-summary");
}

function traceDurableEventDelta(trace: StreamingBenchmarkTraceProbe | undefined): number | undefined {
	if (!trace || trace.durableEventCountStart === undefined || trace.durableEventCountEnd === undefined) return undefined;
	return trace.durableEventCountEnd - trace.durableEventCountStart;
}

async function readStreamingBenchmarkArtifact(file: string): Promise<StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison> {
	const parsed = JSON.parse(await readFile(file, "utf8"));
	const value = parsed.benchmark ?? parsed;
	if (value?.kind === "streaming-benchmark") return normalizeStreamingBenchmarkRun(value as StreamingBenchmark);
	if (value?.kind === "streaming-benchmark-runs") {
		const runs = Array.isArray(value.runs) ? value.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		return normalizeStreamingBenchmarkGroupArtifact(value as Partial<StreamingBenchmarkGroup>, runs);
	}
	if (value?.kind === "streaming-benchmark-url-comparison") {
		const primaryRuns = Array.isArray(value.primary?.runs) ? value.primary.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const compareRuns = Array.isArray(value.compare?.runs) ? value.compare.runs.map((run: StreamingBenchmark) => normalizeStreamingBenchmarkRun(run)) : [];
		const primary = normalizeStreamingBenchmarkGroupArtifact(value.primary as Partial<StreamingBenchmarkGroup> | undefined, primaryRuns);
		const compare = normalizeStreamingBenchmarkGroupArtifact(value.compare as Partial<StreamingBenchmarkGroup> | undefined, compareRuns);
		return {
			...(value as StreamingBenchmarkUrlComparison),
			primary,
			compare,
			comparison: compareStreamingBenchmarkSummaries(primary.summary, compare.summary),
			regressions: Array.isArray(value.regressions) ? value.regressions : [],
			warnings: Array.isArray(value.warnings) ? value.warnings : [],
		};
	}
	throw new Error(`File is not a streaming benchmark artifact: ${file}`);
}

function normalizeStreamingBenchmarkGroupArtifact(value: Partial<StreamingBenchmarkGroup> | undefined, runs: StreamingBenchmark[]): StreamingBenchmarkGroup {
	return {
		...(value as StreamingBenchmarkGroup | undefined),
		kind: "streaming-benchmark-runs",
		createdAt: value?.createdAt ?? new Date().toISOString(),
		durationMs: value?.durationMs ?? runs[0]?.durationMs ?? 0,
		runs,
		summary: summarizeStreamingBenchmarks(runs),
		regressions: Array.isArray(value?.regressions) ? value.regressions : [],
		warnings: Array.isArray(value?.warnings) ? value.warnings : [],
	};
}

function normalizeStreamingBenchmarkRun(run: StreamingBenchmark): StreamingBenchmark {
	const scored = { ...run, regressions: Array.isArray(run.regressions) ? run.regressions : [], warnings: Array.isArray(run.warnings) ? run.warnings : [], score: run.score ?? scoreStreamingBenchmark(run) };
	const withProviderPreservation = { ...scored, providerPreservation: run.providerPreservation ?? summarizeStreamingProviderPreservation(scored) };
	const withLivePipeline = { ...withProviderPreservation, livePipeline: run.livePipeline ?? summarizeStreamingLivePipeline(withProviderPreservation) };
	return { ...withLivePipeline, cadence: run.cadence ?? summarizeStreamingCadence(withLivePipeline) };
}

function streamingBenchmarkReportTarget(benchmark: StreamingBenchmark | StreamingBenchmarkGroup | StreamingBenchmarkUrlComparison): { id: string; url: string; title: string } {
	const url = benchmark.kind === "streaming-benchmark-url-comparison"
		? benchmark.primaryUrl
		: benchmark.kind === "streaming-benchmark-runs"
			? benchmark.runs[0]?.url ?? ""
			: benchmark.url;
	return { id: "artifact", url, title: "streaming benchmark artifact" };
}

async function readStreamingBenchmarkRuns(file: string): Promise<StreamingBenchmark[]> {
	const value = await readStreamingBenchmarkArtifact(file);
	const runs = value.kind === "streaming-benchmark-runs"
		? value.runs
		: value.kind === "streaming-benchmark-url-comparison"
			? [...value.primary.runs, ...value.compare.runs]
			: [value];
	return runs.filter((run): run is StreamingBenchmark => run.kind === "streaming-benchmark");
}

function numericStats(values: readonly unknown[]): NumberStats {
	const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).slice().sort((a, b) => a - b);
	if (!nums.length) return { count: 0 };
	const pick = (q: number) => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
	const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
	return {
		count: nums.length,
		min: round3(nums[0]),
		p50: round3(pick(0.50)),
		p90: round3(pick(0.90)),
		p99: round3(pick(0.99)),
		max: round3(nums[nums.length - 1]),
		avg: round3(avg),
	};
}

function statDelta(current: NumberStats, baseline: NumberStats): number | undefined {
	if (current.p50 === undefined || baseline.p50 === undefined) return undefined;
	return round3(current.p50 - baseline.p50);
}

function clampScore(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stateWindowNumber(afterValue: unknown, beforeValue: unknown): number | undefined {
	const after = finiteNumber(afterValue);
	if (after === undefined) return undefined;
	const before = finiteNumber(beforeValue);
	if (before === undefined || before <= 0 || after < before) return after;
	return round3(after - before);
}

function elapsedIsoMs(startedAt: unknown, value: unknown): number | undefined {
	if (typeof startedAt !== "string" || typeof value !== "string") return undefined;
	const start = Date.parse(startedAt);
	const end = Date.parse(value);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
	return round3(end - start);
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

async function writeLastSnapshot(snapshot: WebSnapshot | undefined): Promise<void> {
	if (!snapshot) return;
	const file = lastSnapshotPath();
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function readBaselineSnapshot(file?: string): Promise<WebSnapshot> {
	const target = file ?? lastSnapshotPath();
	let text: string;
	try {
		text = await readFile(target, "utf-8");
	} catch {
		throw new Error(`Baseline snapshot not found at ${target}. Run pibo debug web snapshot first or pass --from <artifact>.`);
	}
	const parsed = JSON.parse(text) as unknown;
	if (isSnapshot(parsed)) return parsed;
	if (isRecord(parsed) && isSnapshot(parsed.snapshot)) return parsed.snapshot;
	if (isRecord(parsed) && isSnapshot(parsed.current)) return parsed.current;
	throw new Error(`File is not a web render snapshot: ${target}`);
}

async function writeArtifact(kind: string, payload: unknown): Promise<string> {
	return writeTextArtifact(kind, "json", JSON.stringify(payload, null, 2));
}

async function writeTextArtifact(kind: string, extension: string, content: string): Promise<string> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = path.join(getPiboHome(), "debug", "web-render", stamp);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${kind}.${extension}`);
	await writeFile(file, content, "utf-8");
	return file;
}

async function writeReportOutput(outputPath: string, content: string): Promise<string> {
	const file = path.resolve(outputPath);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content, "utf-8");
	return file;
}

function lastSnapshotPath(): string {
	return path.join(getPiboHome(), "debug", "web-render", "last-snapshot.json");
}

function compactTarget(target: BrowserUseCdpTarget | { id: string; url: string; title: string; webSocketDebuggerUrl?: string }): Record<string, unknown> {
	return { id: target.id, url: target.url, title: target.title, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

function limitStdout(value: string): string {
	if (value.length <= STDOUT_BUDGET) return value;
	return `${value.slice(0, STDOUT_BUDGET)}\n... truncated ${value.length - STDOUT_BUDGET} chars by stdout budget ...`;
}

function isSnapshot(value: unknown): value is WebSnapshot {
	return isRecord(value) && value.kind === "snapshot" && typeof value.scope === "string" && Array.isArray(value.nodes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWebSocketUrl(value?: string): boolean {
	return Boolean(value && /^wss?:\/\//.test(value));
}

function jsonShort(value: unknown): string {
	if (value === undefined) return "undefined";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
