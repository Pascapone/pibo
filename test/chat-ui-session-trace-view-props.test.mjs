import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runSessionTraceViewPropsScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			createSessionTraceViewLinks,
			createSessionTraceViewProps,
			resolveSessionTraceModelBadge,
			resolveSessionTraceTitle,
			sessionCanSteer,
			sessionSupportsFork,
			sessionSupportsForkWhileRunning,
			sessionSupportsToolIntent,
			traceUserMessageRevision,
			withSessionForkCandidates,
		} = await import("./src/apps/chat-ui/src/session-trace-view-props.ts");
		const { createPiboSignalRegistry } = await import("./src/signals/registry.ts");

		function session(overrides) {
			return {
				piboSessionId: overrides.piboSessionId,
				piSessionId: overrides.piSessionId ?? \`pi-\${overrides.piboSessionId}\`,
				profile: overrides.profile ?? "pibo-agent",
				title: overrides.title ?? overrides.piboSessionId,
				status: overrides.status ?? "idle",
				derivedSessions: overrides.derivedSessions ?? [],
				children: overrides.children ?? [],
				...overrides,
			};
		}

		function traceNode(overrides) {
			return {
				id: overrides.id,
				piboSessionId: overrides.piboSessionId ?? "ps-child",
				type: overrides.type ?? "execution.command",
				title: overrides.title,
				status: overrides.status ?? "done",
				children: overrides.children ?? [],
				...overrides,
			};
		}

		const origin = session({ piboSessionId: "ps-origin", profile: "origin-profile", title: "Origin title" });
		const child = session({
			piboSessionId: "ps-child",
			profile: "worker-profile",
			initialThinkingLevel: "high",
			subagentName: "reviewer",
			title: "Child title",
			parentId: "ps-root",
			originId: "ps-origin",
			derivedSessions: [
				{ piboSessionId: "ps-derived-a", profile: "derived-profile", subagentName: "critic", title: "Derived A", status: "running" },
				{ piboSessionId: "ps-derived-b", profile: "derived-profile", title: "Derived B", status: "idle" },
			],
		});
		const root = session({ piboSessionId: "ps-root", profile: "root-profile", title: "Root title", children: [child] });
		const sessions = [origin, root];

		assert.equal(resolveSessionTraceTitle({
			sessionNodes: sessions,
			selectedPiboSessionId: "ps-child",
			traceTitle: "Untitled Session",
		}), "Child title");
		assert.equal(resolveSessionTraceTitle({
			sessionNodes: sessions,
			selectedPiboSessionId: "ps-missing",
			traceTitle: "Trace title",
		}), "Trace title");
		assert.equal(resolveSessionTraceTitle({
			sessionNodes: sessions,
			selectedPiboSessionId: null,
			fallback: "No session selected",
		}), "No session selected");
		assert.notEqual(resolveSessionTraceTitle({
			sessionNodes: sessions,
			selectedPiboSessionId: null,
			fallback: "No session selected",
		}), "Shared Chat");

		assert.deepEqual(createSessionTraceViewLinks(sessions, null), {
			sessionBreadcrumbs: [],
			originSession: undefined,
			derivedSessions: [],
		});

		const links = createSessionTraceViewLinks(sessions, "ps-child");
		assert.deepEqual(links.sessionBreadcrumbs, [
			{ piboSessionId: "ps-root", label: "root-profile" },
			{ piboSessionId: "ps-child", label: "reviewer (worker-profile)" },
		]);
		assert.deepEqual(links.originSession, { piboSessionId: "ps-origin", label: "origin-profile" });
		assert.deepEqual(links.derivedSessions, [
			{ piboSessionId: "ps-derived-a", label: "critic (derived-profile)", profile: "derived-profile", status: "running" },
			{ piboSessionId: "ps-derived-b", label: "Derived B", profile: "derived-profile", status: "idle" },
		]);

		const bootstrap = {
			identity: { userId: "user-1" },
			session: { id: "ps-child", piSessionId: "pi-child", channel: "web", kind: "chat", profile: "worker-profile", createdAt: "now", updatedAt: "now" },
			selectedRoomId: "room-1",
			selectedPiboSessionId: "ps-child",
			rooms: [],
			sessions,
			agents: [
				{
					name: "root-profile",
					aliases: [],
					mainThinkingLevel: "low",
					subagentThinkingLevel: "high",
					mainFast: false,
					subagentFast: true,
				},
			],
			customAgents: [
				{
					id: "custom-worker",
					profileName: "worker-profile",
					runtimeInstanceId: "pi",
					runtimeOptions: { intentTracing: true },
					name: "Worker",
					description: "Worker profile",
					thinkingLevel: "minimal",
					mainThinkingLevel: "medium",
					subagentThinkingLevel: "xhigh",
					fast: false,
					subagentFast: true,
					tools: [],
					subagents: [],
					contextFiles: [],
					skills: [],
					createdAt: "now",
					updatedAt: "now",
				},
			],
			modelDefaults: { thinking: "off", fast: false },
			agentCatalog: {
				agentRuntimes: [{
					id: "pi",
					adapterId: "pi",
					enabled: true,
					available: true,
					capabilities: {
						input: { steering: true },
						lifecycle: { fork: true, forkWhileRunning: true },
						tools: { intentTracing: { supported: true, configurable: true, enabledByDefault: false } },
					},
				}],
			},
			capabilities: { actions: [] },
		};

		assert.equal(sessionSupportsFork(bootstrap, "ps-child", "worker-profile"), true);
		assert.equal(sessionSupportsForkWhileRunning(bootstrap, "ps-child", "worker-profile"), true);
		assert.equal(sessionSupportsFork({
			...bootstrap,
			agentCatalog: { agentRuntimes: [{ ...bootstrap.agentCatalog.agentRuntimes[0], capabilities: { lifecycle: { fork: false, forkWhileRunning: false } } }] },
		}, "ps-child", "worker-profile"), false);
		assert.equal(sessionSupportsToolIntent(bootstrap, "ps-child", "worker-profile"), true);
		assert.equal(sessionSupportsToolIntent({ ...bootstrap, customAgents: [{ ...bootstrap.customAgents[0], runtimeOptions: {} }] }, "ps-child", "worker-profile"), false);
		assert.equal(sessionSupportsToolIntent({
			...bootstrap,
			session: {
				...bootstrap.session,
				runtimeBinding: { piboSessionId: "ps-child", runtimeInstanceId: "pi", adapterId: "pi", state: "bound", metadata: { intentTracing: false } },
			},
		}, "ps-child", "worker-profile"), false);
		assert.equal(sessionSupportsToolIntent({
			...bootstrap,
			session: {
				...bootstrap.session,
				runtimeBinding: { piboSessionId: "ps-child", runtimeInstanceId: "pi", adapterId: "pi", state: "bound", metadata: { intentTracing: true } },
			},
			customAgents: [{ ...bootstrap.customAgents[0], runtimeOptions: {} }],
		}, "ps-child", "worker-profile"), true);

		const activeSignal = { latestTurn: { state: "running" } };
		assert.equal(sessionCanSteer(bootstrap, "ps-child", "worker-profile", activeSignal), true, "an active local turn on a steering runtime can be steered");
		const raceRegistry = createPiboSignalRegistry();
		raceRegistry.project({ type: "session_created", session: { id: "ps-child", channel: "web", kind: "runtime", profile: "worker-profile" } });
		raceRegistry.project({ type: "message_accepted", piboSessionId: "ps-child", eventId: "new-user-turn", source: "user" });
		raceRegistry.project({ type: "pibo_output", event: { type: "session_error", piboSessionId: "ps-child", eventId: "old-loop-continuation", error: "Loop continuation is no longer authorized (paused)" } });
		raceRegistry.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: "ps-child", eventId: "new-user-turn", source: "user", text: "continue" } });
		const racedSignal = raceRegistry.snapshotTree("ps-child").sessions["ps-child"];
		assert.equal(racedSignal.latestTurn?.state, "running");
		assert.equal(sessionCanSteer(bootstrap, "ps-child", "worker-profile", racedSignal), true, "a stale error from another event does not suppress steering for the active turn");
		assert.equal(sessionCanSteer(bootstrap, "ps-child", "worker-profile", { latestTurn: { state: "completed" }, isTreeActive: true }), false, "descendant-only activity cannot steer the selected session");
		assert.equal(sessionCanSteer({
			...bootstrap,
			agentCatalog: {
				...bootstrap.agentCatalog,
				agentRuntimes: [{ ...bootstrap.agentCatalog.agentRuntimes[0], capabilities: { ...bootstrap.agentCatalog.agentRuntimes[0].capabilities, input: { steering: false } } }],
			},
		}, "ps-child", "worker-profile", activeSignal), false, "runtime capability gates steering");
		assert.equal(sessionCanSteer(bootstrap, "ps-child", "worker-profile", undefined), false, "status alone does not imply steering eligibility");

		assert.equal(resolveSessionTraceModelBadge({
			bootstrap,
			selectedPiboSessionId: "ps-child",
			selectedSessionProfile: "worker-profile",
			selectedSessionActiveModel: "gpt-test",
			currentTraceView: null,
		}), "gpt-test high fast");

		const traceView = {
			piboSessionId: "ps-root",
			piSessionId: "pi-root",
			title: "Root trace",
			version: "1",
			nodes: [
				traceNode({ id: "thinking-1", title: "thinking", output: { level: "medium" } }),
				traceNode({ id: "fast-1", title: "fast_mode", output: { mode: "fast" } }),
			],
			rawEvents: [],
		};
		assert.equal(resolveSessionTraceModelBadge({
			bootstrap: { ...bootstrap, runtimeStatus: undefined },
			selectedPiboSessionId: "ps-root",
			selectedSessionProfile: "root-profile",
			selectedSessionActiveModel: "gpt-test",
			currentTraceView: traceView,
		}), "gpt-test medium fast");

		assert.equal(resolveSessionTraceModelBadge({
			bootstrap: { ...bootstrap, runtimeStatus: { piboSessionId: "ps-root", thinkingLevel: "minimal", fastMode: false } },
			selectedPiboSessionId: "ps-root",
			selectedSessionProfile: "root-profile",
			selectedSessionActiveModel: "gpt-test",
			currentTraceView: traceView,
		}), "gpt-test minimal");

		assert.equal(resolveSessionTraceModelBadge({
			bootstrap,
			selectedPiboSessionId: "ps-child",
			selectedSessionProfile: "worker-profile",
			selectedSessionActiveModel: undefined,
			currentTraceView: null,
		}), undefined);

		const productTrace = {
			...traceView,
			nodes: [
				traceNode({ id: "user-1", type: "user.message", title: "User", output: "repeat" }),
				traceNode({ id: "assistant-1", type: "assistant.message", title: "Assistant", output: "answer" }),
				traceNode({ id: "user-2", type: "user.message", title: "User", output: "repeat" }),
			],
		};
		assert.equal(traceUserMessageRevision(productTrace), "2:user-2");
		const forkableTrace = withSessionForkCandidates(productTrace, [
			{ entryId: "native-user-a", text: "repeat" },
			{ entryId: "native-user-b", text: "repeat" },
		]);
		assert.equal(productTrace.nodes[0].entryId, undefined);
		assert.equal(forkableTrace.nodes[0].entryId, "native-user-a");
		assert.equal(forkableTrace.nodes[2].entryId, "native-user-b");
		assert.equal(forkableTrace.nodes[1].entryId, undefined);
		const runningTrace = {
			...productTrace,
			nodes: [
				traceNode({ id: "completed-user-a", type: "user.message", title: "User", output: "repeat" }),
				traceNode({ id: "completed-user-b", type: "user.message", title: "User", output: "repeat" }),
				traceNode({ id: "active-user", type: "user.message", title: "User", output: "currently running" }),
			],
		};
		const runningForkableTrace = withSessionForkCandidates(runningTrace, [
			{ entryId: "native-user-a", text: "repeat" },
			{ entryId: "native-user-b", text: "repeat" },
		]);
		assert.equal(runningForkableTrace.nodes[0].entryId, "native-user-a");
		assert.equal(runningForkableTrace.nodes[1].entryId, "native-user-b");
		assert.equal(runningForkableTrace.nodes[2].entryId, undefined, "the active user message stays non-forkable until completed");
		const partialTrace = {
			...productTrace,
			nodes: [
				traceNode({ id: "user-unique", type: "user.message", title: "User", output: "unique" }),
				traceNode({ id: "user-repeat-a", type: "user.message", title: "User", output: "repeat" }),
				traceNode({ id: "user-repeat-b", type: "user.message", title: "User", output: "repeat" }),
			],
		};
		const safelyMappedTrace = withSessionForkCandidates(partialTrace, [
			{ entryId: "native-extra", text: "older native prompt" },
			{ entryId: "native-unique", text: "unique" },
			{ entryId: "native-repeat", text: "repeat" },
			{ entryId: "native-newer-extra", text: "newer native prompt" },
		]);
		assert.equal(safelyMappedTrace.nodes[0].entryId, "native-unique");
		assert.equal(safelyMappedTrace.nodes[1].entryId, undefined, "ambiguous duplicate text must fail closed");
		assert.equal(safelyMappedTrace.nodes[2].entryId, undefined, "a mismatched candidate must never be assigned by position");

		const staleAnchors = {
			...productTrace,
			nodes: [
				traceNode({ id: "stale-user", type: "user.message", title: "User", output: "current prompt", entryId: "native-stale" }),
				traceNode({ id: "current-user", type: "user.message", title: "User", output: "later prompt", entryId: "native-current" }),
			],
		};
		const authoritativeAnchors = withSessionForkCandidates(staleAnchors, [
			{ entryId: "native-replacement", text: "current prompt" },
			{ entryId: "native-current", text: "later prompt" },
			{ entryId: "", text: "blank ids are unusable" },
			{ entryId: "native-current", text: "duplicate ids are unusable" },
		]);
		assert.equal(authoritativeAnchors.nodes[0].entryId, "native-replacement");
		assert.equal(authoritativeAnchors.nodes[1].entryId, "native-current");
		assert.equal(JSON.stringify(authoritativeAnchors).includes("native-stale"), false, "successful reads remove stale native anchors");
		const noForkCandidates = withSessionForkCandidates(authoritativeAnchors, []);
		assert.equal(noForkCandidates.nodes[0].entryId, undefined);
		assert.equal(noForkCandidates.nodes[1].entryId, undefined, "an empty successful candidate set is authoritative");

		const calls = [];
		const props = createSessionTraceViewProps({
			currentTraceView: traceView,
			isLoading: false,
			showThinking: true,
			expandThinking: false,
			toolDisplayMode: "intent",
			selectedSessionProfile: "worker-profile",
			sessionActiveModelBadge: "gpt-test xhigh fast",
			sessionRuntimeBinding: { piboSessionId: "ps-child", runtimeInstanceId: "pi", adapterId: "pi", nativeSessionId: "pi-child", state: "bound", revision: 2 },
			selectedSessionStatus: "running",
			sessionNodes: sessions,
			sessionLinks: links,
			agentProfiles: bootstrap.agents,
			sessionProfileChangeDisabled: true,
			onSessionAgentProfileChange: (profile) => calls.push(\`profile:\${profile}\`),
			onFork: (entryId) => calls.push(\`fork:\${entryId}\`),
			onOpenSession: (piboSessionId) => calls.push(\`open:\${piboSessionId}\`),
			onThinkingLevelChange: (level) => calls.push(\`thinking:\${level}\`),
			onRefreshBootstrap: async () => calls.push("bootstrap"),
			onRefreshTrace: async () => calls.push("trace"),
			onError: (message) => calls.push(\`error:\${message}\`),
		});
		assert.equal(props.traceView, traceView);
		assert.equal(props.selectedTrace.id, "ps-root");
		assert.deepEqual(props.selectedTrace.spans.map((span) => span.name), ["thinking", "fast_mode"]);
		assert.equal(props.sessionActiveModel, "gpt-test xhigh fast");
		assert.equal(props.toolDisplayMode, "intent");
		assert.equal(props.sessionRuntimeBinding.runtimeInstanceId, "pi");
		assert.equal(props.sessionRuntimeBinding.state, "bound");
		assert.equal(props.sessionBreadcrumbs, links.sessionBreadcrumbs);
		assert.equal(props.originSession, links.originSession);
		assert.equal(props.derivedSessions, links.derivedSessions);
		await props.onModelChanged();
		assert.deepEqual(calls, ["bootstrap", "trace"]);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session trace view props helpers preserve link labels and model badge fallbacks", async () => {
	await assert.doesNotReject(runSessionTraceViewPropsScenario());
});

test("composer delivery choices use explicit steering eligibility instead of presentation status", () => {
	const source = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	assert.match(source, /const canSteer = sessionCanSteer\(/);
	assert.match(source, /if \(canSteer\) \{/);
	assert.doesNotMatch(source, /if \(selectedSessionStatus === "running"\)/);
	assert.match(source, /selectedSessionStatus !== "running" \|\| forkWhileRunningSupported/);
	assert.match(source, /const forkCandidateStatusRevision = selectedSessionStatus \?\? "unknown"/);
	assert.match(source, /\["chat", "fork-candidates", selectedBackendPiboSessionId, forkCandidateRevision, forkCandidateStatusRevision\]/);
	assert.match(source, /forkCandidatesEnabled && forkCandidatesQuery\.data[\s\S]*withSessionForkCandidates\(currentTraceView, forkCandidatesQuery\.data\.messages\)[\s\S]*: currentTraceView/);
	assert.doesNotMatch(source, /forkCandidatesQuery\.data\?\.messages \?\? \[\]/, "loading and failed reads must not masquerade as an authoritative empty result");
});
