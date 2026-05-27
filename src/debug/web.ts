import path from "node:path";
import { listBrowserUseCdpTargets, selectBestChatTarget, formatBrowserUseTargets, type BrowserUseCdpTarget } from "../tools/browser-use-cdp.js";
import { CdpClient } from "../tools/cdp-client.js";
import { diffSnapshots, formatSnapshot, formatSnapshotDiff, formatWatch, inferWatchFlickers, type SnapshotNode, type WebSnapshot, type WatchEvent, type WebWatch } from "./web-render-analysis.js";
import type {
	StreamingBenchmark,
	StreamingBenchmarkGroup,
	StreamingBenchmarkProviderTelemetry,
	StreamingBenchmarkUrlComparison,
	StreamingNegativeProfile,
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
} from "./web-streaming-report.js";
import {
	applyExpectedStreamingRegressions,
	attachStreamingProviderTelemetryToBenchmarks,
	evaluateStreamingLivePipelineRegressions,
	evaluateStreamingProviderRegressions,
	readStreamingBenchmarkArtifact,
	readStreamingBenchmarkRuns,
	scoreStreamingBenchmark,
	streamingBenchmarkReportTarget,
	summarizeStreamingBenchmarkGroup,
	summarizeStreamingBenchmarkUrlComparison,
	summarizeStreamingCadence,
	summarizeStreamingLivePipeline,
	summarizeStreamingProviderPreservation,
} from "./web-streaming-benchmark-analysis.js";
import {
	collectStreamingProviderTelemetry,
	collectStreamingProviderTelemetryFromSelectedBrowserSession,
	collectStreamingProviderTelemetryFromSession,
	collectStreamingProviderTelemetryFromTurn,
} from "./web-streaming-provider-telemetry.js";
import { buildStreamingBenchmarkExpression, streamingBenchmarkEventSourceProbeScript, streamingBenchmarkFixtureHtml, type StreamingFixtureMix, type StreamingFixtureProfile } from "./web-streaming-browser-scripts.js";
import { buildSnapshotExpression, buildWatchExpression } from "./web-snapshot-browser-scripts.js";
import { compactTarget, limitStdout, readBaselineSnapshot, writeArtifact, writeLastSnapshot, writeReportOutput, writeTextArtifact } from "./web-artifacts.js";
import { applyNegativeStreamingProfile, DEFAULT_DEPTH_LIMIT, DEFAULT_EVENT_LIMIT, DEFAULT_NODE_LIMIT, DEFAULT_TEXT_LIMIT, parseDuration, parseFixtureMix, parseFixturePreludeMessages, parseFixtureProfile, parseNegativeProfile, parseOptions, parseRuns, presetScope, resolveScope, resolveStreamingBenchmarkCompareUrl, resolveStreamingBenchmarkHostedCompareUrl, type WebOptions } from "./web-options.js";
export { formatStreamingBenchmarkAssertionSummary, formatStreamingBenchmarkUrlComparison, summarizeStreamingSelectedLiveEventSource } from "./web-streaming-report.js";
export { resolveStreamingBenchmarkHostedCompareUrlFromValues } from "./web-options.js";
export { attachStreamingProviderTelemetryToBenchmark, evaluateStreamingBenchmarkAssertion, evaluateStreamingBenchmarkUrlComparisonRegressions, evaluateStreamingLivePipelineRegressions, evaluateStreamingProviderRegressions, summarizeStreamingBenchmarkUrlComparison, summarizeStreamingBenchmarks, summarizeStreamingLivePipeline, summarizeStreamingProviderPreservation } from "./web-streaming-benchmark-analysis.js";
export { collectStreamingProviderTelemetryFromSelectedBrowserSession, collectStreamingProviderTelemetryFromSession, collectStreamingProviderTelemetryFromTurn, summarizeStreamingProviderTelemetry } from "./web-streaming-provider-telemetry.js";
export { formatWatch, inferWatchFlickers } from "./web-render-analysis.js";

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
