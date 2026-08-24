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
			sessionSupportsToolIntent,
		} = await import("./src/apps/chat-ui/src/session-trace-view-props.ts");

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
				agentRuntimes: [{ id: "pi", adapterId: "pi", enabled: true, available: true, capabilities: { input: { steering: true }, tools: { intentTracing: { supported: true, configurable: true, enabledByDefault: false } } } }],
			},
			capabilities: { actions: [] },
		};

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
});
