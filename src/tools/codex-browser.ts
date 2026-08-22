import { spawn } from "node:child_process";
import { join } from "node:path";
import { Type } from "typebox";
import { piboStringEnum } from "./schema.js";
import { definePiboTool, type PiboToolDefinition } from "./contract.js";
import type { ToolProfile } from "../core/profiles.js";
import { CdpClient, connectCdpTarget, listCdpTargets, type CdpTarget } from "./cdp-client.js";
import { browserPoolPaths, releaseBrowserPoolLease } from "./browser-pool.js";
import { browserUseLeaseEnvironment, findActiveBrowserUseLeaseForHolder } from "./browser-use-leases.js";
import { ensureBrowserUseWrapper } from "./browser-use-wrapper.js";
import { findCliToolEntry, getCliToolStatus, type CliToolStatus } from "./registry.js";
import {
	CodexBrowserNodeRepl,
	type NodeReplExecResult,
	type NodeReplResetResult,
} from "./codex-browser-node-repl.js";

export const BROWSER_USE_OPEN_TABS_TOOL_NAME = "browser_use_open_tabs";
export const BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME = "browser_use_take_screenshot";
export const BROWSER_USE_TOOL_NAME = "browser_use_browser_use";
export const NODE_REPL_JS_TOOL_NAME = "node_repl_js";
export const NODE_REPL_JS_RESET_TOOL_NAME = "node_repl_js_reset";

export const CODEX_BROWSER_TOOL_NAMES = [
	BROWSER_USE_OPEN_TABS_TOOL_NAME,
	BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME,
	BROWSER_USE_TOOL_NAME,
	NODE_REPL_JS_TOOL_NAME,
	NODE_REPL_JS_RESET_TOOL_NAME,
] as const;

export type CodexBrowserToolName = (typeof CODEX_BROWSER_TOOL_NAMES)[number];

export type BrowserUseAction =
	| "navigate"
	| "state"
	| "click"
	| "input"
	| "type"
	| "scroll"
	| "back"
	| "switch_tab"
	| "close_tab"
	| "keys"
	| "evaluate"
	| "wait_selector"
	| "wait_text";

export type BrowserUseInput = {
	action: BrowserUseAction;
	url?: string;
	index?: number;
	coordinateX?: number;
	coordinateY?: number;
	text?: string;
	direction?: "up" | "down";
	amount?: number;
	tab?: number;
	keys?: string;
	js?: string;
	selector?: string;
	timeoutMs?: number;
};

export type BrowserUseTab = {
	index: number;
	tabId: string;
	targetId: string;
	title: string;
	url: string;
	type: string;
};

export type BrowserUseResult = {
	status: "ok";
	sessionName: string;
	browserPoolLeaseId: string;
	authLeaseId?: string;
	command: string[];
	output: unknown;
	stderr?: string;
};

export type BrowserUseScreenshotResult = {
	status: "ok";
	sessionName: string;
	browserPoolLeaseId: string;
	authLeaseId?: string;
	tab: BrowserUseTab;
	fullPage: boolean;
	mimeType: "image/png";
	data: string;
};

export type BrowserUseCommandRequest = {
	executable: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
	signal?: AbortSignal;
};

export type BrowserUseCommandResponse = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
};

export type CodexBrowserSessionControllerOptions = {
	cwd: string;
	piboSessionId?: string;
	status?: CliToolStatus;
	env?: NodeJS.ProcessEnv;
	runCommand?: (request: BrowserUseCommandRequest) => Promise<BrowserUseCommandResponse>;
};

export type CodexBrowserToolController = {
	openTabs(): Promise<BrowserUseTab[]>;
	takeScreenshot(input?: { tabId?: string; fullPage?: boolean; timeoutMs?: number }): Promise<BrowserUseScreenshotResult>;
	use(input: BrowserUseInput, signal?: AbortSignal): Promise<BrowserUseResult>;
	js(code: string, timeoutMs?: number): Promise<NodeReplExecResult>;
	jsReset(): Promise<NodeReplResetResult>;
	dispose(): Promise<void> | void;
};

export class CodexBrowserSessionController implements CodexBrowserToolController {
	readonly sessionName: string;
	readonly browserPoolLeaseId: string;
	readonly authLeaseId?: string;
	private readonly status: CliToolStatus;
	private readonly wrapperPath: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly runCommand: (request: BrowserUseCommandRequest) => Promise<BrowserUseCommandResponse>;
	private cdpUrl?: string;
	private nodeRepl?: CodexBrowserNodeRepl;
	private browserLeaseUsed = false;

	constructor(private readonly options: CodexBrowserSessionControllerOptions) {
		const entry = findCliToolEntry("browser-use");
		if (!entry) throw new Error("Pibo browser-use registry entry is unavailable");
		this.status = options.status ?? getCliToolStatus(entry);
		this.wrapperPath = this.status.installed
			? ensureBrowserUseWrapper(this.status) ?? this.status.executablePath
			: this.status.executablePath;
		const baseEnv = options.env ?? process.env;
		const explicitAuthLease = baseEnv.PIBO_BROWSER_USE_LEASE_ID?.trim();
		const sessionId = options.piboSessionId?.trim() || "local";
		const registeredLease = explicitAuthLease ? undefined : findRegisteredLease(this.status, sessionId);
		const registeredLeaseEnv = registeredLease ? browserUseLeaseEnvironment(this.status, registeredLease) : undefined;
		this.sessionName = explicitAuthLease && baseEnv.PIBO_BROWSER_USE_SESSION
			? baseEnv.PIBO_BROWSER_USE_SESSION
			: registeredLease?.sessionName ?? `pibo-${safeSessionName(sessionId)}`;
		this.browserPoolLeaseId = explicitAuthLease && baseEnv.PIBO_BROWSER_POOL_LEASE_ID
			? baseEnv.PIBO_BROWSER_POOL_LEASE_ID
			: registeredLease?.browserPoolLeaseId ?? `browser-use:${this.sessionName}`;
		this.authLeaseId = explicitAuthLease || registeredLease?.id;
		this.env = {
			...baseEnv,
			...(registeredLeaseEnv ?? {}),
			BROWSER_USE_HOME: this.status.homeDir,
			PIBO_BROWSER_USE_SESSION: this.sessionName,
			PIBO_BROWSER_POOL_LEASE_ID: this.browserPoolLeaseId,
			PIBO_BROWSER_POOL_HOLDER: `pibo-session:${sessionId}`,
		};
		if (!this.authLeaseId) {
			delete this.env.PIBO_BROWSER_USE_LEASE_ID;
			delete this.env.PIBO_BROWSER_USE_CHROME_USER_DATA_DIR;
		}
		this.runCommand = options.runCommand ?? runBrowserUseCommand;
	}

	async openTabs(): Promise<BrowserUseTab[]> {
		const cdpUrl = await this.ensureChrome();
		const targets = await listCdpTargets({ cdpUrl });
		return pageTargets(targets).map(toBrowserUseTab);
	}

	async takeScreenshot(input: { tabId?: string; fullPage?: boolean; timeoutMs?: number } = {}): Promise<BrowserUseScreenshotResult> {
		const timeoutMs = input.timeoutMs ?? 15_000;
		const cdpUrl = await this.ensureChrome(timeoutMs);
		const targets = pageTargets(await listCdpTargets({ cdpUrl, timeoutMs }));
		const target = selectTarget(targets, input.tabId);
		if (!target) throw new Error(input.tabId ? `Browser tab "${input.tabId}" was not found` : "No open browser tab was found");
		const client = await connectCdpTarget(target, Math.min(timeoutMs, 5_000));
		try {
			const data = await captureScreenshot(client, input.fullPage === true, timeoutMs);
			return {
				status: "ok",
				sessionName: this.sessionName,
				browserPoolLeaseId: this.browserPoolLeaseId,
				...(this.authLeaseId ? { authLeaseId: this.authLeaseId } : {}),
				tab: toBrowserUseTab(target, targets.indexOf(target)),
				fullPage: input.fullPage === true,
				mimeType: "image/png",
				data,
			};
		} finally {
			client.close();
		}
	}

	async use(input: BrowserUseInput, signal?: AbortSignal): Promise<BrowserUseResult> {
		const command = browserUseCommand(input);
		const response = await this.execute(command, input.timeoutMs ?? 30_000, signal);
		if (response.exitCode !== 0) {
			throw new Error(response.stderr.trim() || response.stdout.trim() || `browser-use exited with code ${response.exitCode ?? "unknown"}`);
		}
		return {
			status: "ok",
			sessionName: this.sessionName,
			browserPoolLeaseId: this.browserPoolLeaseId,
			...(this.authLeaseId ? { authLeaseId: this.authLeaseId } : {}),
			command,
			output: parseJsonOrText(response.stdout),
			...(response.stderr.trim() ? { stderr: response.stderr.trim() } : {}),
		};
	}

	async js(code: string, timeoutMs = 30_000): Promise<NodeReplExecResult> {
		const repl = await this.getNodeRepl();
		return repl.exec(code, timeoutMs);
	}

	async jsReset(): Promise<NodeReplResetResult> {
		if (!this.nodeRepl?.isAlive()) return { status: "ok", reset: true };
		return this.nodeRepl.reset();
	}

	async dispose(): Promise<void> {
		await this.nodeRepl?.dispose();
		this.nodeRepl = undefined;
		if (!this.browserLeaseUsed) return;
		const identity = {
			workerId: this.env.PIBO_BROWSER_POOL_WORKER_ID || this.env.PIBO_COMPUTE_WORKER_ID || this.env.HOSTNAME || "local",
			poolId: this.env.PIBO_BROWSER_POOL_ID || "default",
			maxBrowserProcesses: positiveInteger(this.env.PIBO_BROWSER_POOL_MAX_PROCESSES, 1),
		};
		const rootDir = this.env.PIBO_BROWSER_POOL_ROOT || join(this.status.homeDir, "pibo-browser-pool");
		try {
			await releaseBrowserPoolLease(browserPoolPaths(rootDir, identity), identity, { leaseId: this.browserPoolLeaseId });
		} catch {
			// Browser pool cleanup is best-effort during Pi session disposal.
		}
	}

	private async getNodeRepl(): Promise<CodexBrowserNodeRepl> {
		if (this.nodeRepl?.isAlive()) return this.nodeRepl;
		this.nodeRepl = await CodexBrowserNodeRepl.start({
			openTabs: () => this.openTabs(),
			use: (input) => this.use(requireBrowserUseInput(input)),
		}, this.options.cwd);
		return this.nodeRepl;
	}

	private async ensureChrome(timeoutMs = 15_000): Promise<string> {
		if (this.cdpUrl) {
			try {
				await listCdpTargets({ cdpUrl: this.cdpUrl, timeoutMs: Math.min(timeoutMs, 1_000) });
				return this.cdpUrl;
			} catch {
				this.cdpUrl = undefined;
			}
		}
		const response = await this.execute(["--pibo-ensure-chrome"], timeoutMs);
		if (response.exitCode !== 0) {
			throw new Error(response.stderr.trim() || response.stdout.trim() || "browser-use could not start Chrome");
		}
		const cdpUrl = response.stdout.split(/\r?\n/).map((line) => line.trim()).findLast((line) => /^https?:\/\//.test(line));
		if (!cdpUrl) throw new Error(`browser-use did not return a CDP URL: ${response.stdout.trim()}`);
		this.cdpUrl = cdpUrl.replace(/\/+$/, "");
		return this.cdpUrl;
	}

	private execute(command: string[], timeoutMs: number, signal?: AbortSignal): Promise<BrowserUseCommandResponse> {
		if (!this.status.installed) {
			throw new Error("browser-use is not installed. Run `pibo tools install browser-use`.");
		}
		const args = ["--session", this.sessionName, ...(command[0]?.startsWith("--") ? [] : ["--json"]), ...command];
		this.browserLeaseUsed = true;
		return this.runCommand({
			executable: this.wrapperPath,
			args,
			cwd: this.options.cwd,
			env: this.env,
			timeoutMs,
			signal,
		});
	}
}

export function createCodexBrowserToolProfiles(): ToolProfile[] {
	const descriptions: Record<CodexBrowserToolName, string> = {
		[BROWSER_USE_OPEN_TABS_TOOL_NAME]: "List tabs in the persistent Browser Use session (Codex-compatible label: browser_use.open_tabs).",
		[BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME]: "Capture a browser tab screenshot (Codex-compatible label: browser_use.take_screenshot).",
		[BROWSER_USE_TOOL_NAME]: "Control the persistent Browser Use session through structured actions (Codex-compatible label: browser_use.browser_use).",
		[NODE_REPL_JS_TOOL_NAME]: "Run JavaScript in a persistent browser-bound Node REPL (Codex-compatible label: node_repl.js).",
		[NODE_REPL_JS_RESET_TOOL_NAME]: "Reset the persistent browser-bound Node REPL (Codex-compatible label: node_repl.js_reset).",
	};
	return CODEX_BROWSER_TOOL_NAMES.map((name) => ({
		name,
		description: descriptions[name],
		yieldable: name === BROWSER_USE_TOOL_NAME,
		builtInPiboTool: "codex_browser",
	}));
}

export function createCodexBrowserToolDefinitions(
	controller: CodexBrowserToolController,
	enabledNames: readonly CodexBrowserToolName[] = CODEX_BROWSER_TOOL_NAMES,
): PiboToolDefinition[] {
	const enabled = new Set(enabledNames);
	const tools: Array<[CodexBrowserToolName, PiboToolDefinition]> = [
		[BROWSER_USE_OPEN_TABS_TOOL_NAME, definePiboTool({
			name: BROWSER_USE_OPEN_TABS_TOOL_NAME,
			title: "browser_use.open_tabs",
			description: "List open tabs in the persistent Browser Use session. Returns stable target IDs, short tab IDs, titles, URLs, and tab indices.",
			promptSnippet: "Use browser_use_open_tabs (browser_use.open_tabs) to discover tabs before targeting a screenshot or tab-specific action.",
			executionMode: "parallel",
			inputSchema: Type.Object({}),
			async execute() {
				return toolResult(await controller.openTabs());
			},
		})],
		[BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME, definePiboTool({
			name: BROWSER_USE_TAKE_SCREENSHOT_TOOL_NAME,
			title: "browser_use.take_screenshot",
			description: "Take a PNG screenshot from the persistent Browser Use session. Omit tabId to capture the first attachable page tab.",
			promptSnippet: "Use browser_use_take_screenshot (browser_use.take_screenshot) when visual page state matters.",
			executionMode: "parallel",
			inputSchema: Type.Object({
				tabId: Type.Optional(Type.String({ description: "Full target ID or short tab ID returned by browser_use_open_tabs." })),
				fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page instead of only the viewport." })),
				timeoutMs: Type.Optional(Type.Number({ description: "Screenshot timeout in milliseconds." })),
			}),
			async execute(_toolCallId, params) {
				const result = await controller.takeScreenshot(params);
				const { data, ...details } = result;
				return {
					content: [
						{ type: "text", text: JSON.stringify(details, null, 2) },
						{ type: "image", data, mimeType: result.mimeType },
					],
					details,
				};
			},
		})],
		[BROWSER_USE_TOOL_NAME, definePiboTool({
			name: BROWSER_USE_TOOL_NAME,
			title: "browser_use.browser_use",
			description: "Control one persistent Browser Use session with a structured action. State and element indices persist through the same Pibo session and managed browser-pool lease.",
			promptSnippet: "Use browser_use_browser_use (browser_use.browser_use) for structured navigation and interaction; call state before index-based clicks or input.",
			executionMode: "sequential",
			inputSchema: Type.Object({
				action: piboStringEnum(["navigate", "state", "click", "input", "type", "scroll", "back", "switch_tab", "close_tab", "keys", "evaluate", "wait_selector", "wait_text"], { description: "Browser action." }),
				url: Type.Optional(Type.String({ description: "URL for navigate." })),
				index: Type.Optional(Type.Number({ description: "Interactive element index for click or input." })),
				coordinateX: Type.Optional(Type.Number({ description: "Viewport X coordinate for click; use with coordinateY." })),
				coordinateY: Type.Optional(Type.Number({ description: "Viewport Y coordinate for click; use with coordinateX." })),
				text: Type.Optional(Type.String({ description: "Text for input, type, or wait_text." })),
				direction: Type.Optional(piboStringEnum(["up", "down"], { description: "Scroll direction." })),
				amount: Type.Optional(Type.Number({ description: "Scroll amount in pixels." })),
				tab: Type.Optional(Type.Number({ description: "Browser Use tab index for switch_tab or close_tab." })),
				keys: Type.Optional(Type.String({ description: "Keys to send, such as Enter or Control+a." })),
				js: Type.Optional(Type.String({ description: "JavaScript for evaluate." })),
				selector: Type.Optional(Type.String({ description: "CSS selector for wait_selector." })),
				timeoutMs: Type.Optional(Type.Number({ description: "Action timeout in milliseconds." })),
			}),
			async execute(_toolCallId, params, signal) {
				return toolResult(await controller.use(params as BrowserUseInput, signal));
			},
		})],
		[NODE_REPL_JS_TOOL_NAME, definePiboTool({
			name: NODE_REPL_JS_TOOL_NAME,
			title: "node_repl.js",
			description: "Execute JavaScript in a persistent, session-scoped Node REPL with top-level await. Top-level bindings persist. The sandbox omits require and process, and exposes browser.openTabs() plus browser.use(action, params) for the same Browser Use session.",
			promptSnippet: "Use node_repl_js (node_repl.js) for persistent JavaScript state and browser-bound analysis. Top-level await and reusable top-level bindings are supported.",
			executionMode: "sequential",
			inputSchema: Type.Object({
				code: Type.String({ description: "JavaScript to execute. Top-level declarations persist across calls." }),
				timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds." })),
			}),
			async execute(_toolCallId, params) {
				return nodeReplToolResult(await controller.js(params.code, params.timeoutMs));
			},
		})],
		[NODE_REPL_JS_RESET_TOOL_NAME, definePiboTool({
			name: NODE_REPL_JS_RESET_TOOL_NAME,
			title: "node_repl.js_reset",
			description: "Reset the persistent node_repl.js namespace for the current Pibo session.",
			promptSnippet: "Use node_repl_js_reset (node_repl.js_reset) only when persistent JavaScript state should be discarded.",
			executionMode: "sequential",
			inputSchema: Type.Object({}),
			async execute() {
				return nodeReplToolResult(await controller.jsReset());
			},
		})],
	];
	return tools.filter(([name]) => enabled.has(name)).map(([, definition]) => definition);
}

function safeSessionName(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "local";
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findRegisteredLease(status: CliToolStatus, piboSessionId: string) {
	try {
		return findActiveBrowserUseLeaseForHolder(status, piboSessionId);
	} catch {
		return undefined;
	}
}

function runBrowserUseCommand(request: BrowserUseCommandRequest): Promise<BrowserUseCommandResponse> {
	return new Promise((resolve, reject) => {
		const child = spawn(request.executable, request.args, {
			cwd: request.cwd,
			env: request.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const abort = () => child.kill("SIGTERM");
		request.signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(() => child.kill("SIGTERM"), request.timeoutMs);
		child.stdout.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr.on("data", (chunk) => { stderr += String(chunk); });
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			request.signal?.removeEventListener("abort", abort);
			reject(error);
		});
		child.once("close", (exitCode) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			request.signal?.removeEventListener("abort", abort);
			resolve({ exitCode, stdout, stderr });
		});
	});
}

function browserUseCommand(input: BrowserUseInput): string[] {
	switch (input.action) {
		case "navigate":
			return ["open", requireText(input.url, "url")];
		case "state":
			return ["state"];
		case "click":
			if (input.index !== undefined) return ["click", integerText(input.index, "index")];
			if (input.coordinateX !== undefined && input.coordinateY !== undefined) {
				return ["click", integerText(input.coordinateX, "coordinateX"), integerText(input.coordinateY, "coordinateY")];
			}
			throw new Error("browser_use.browser_use click requires index or coordinateX and coordinateY");
		case "input":
			return ["input", integerText(input.index, "index"), requireText(input.text, "text")];
		case "type":
			return ["type", requireText(input.text, "text")];
		case "scroll":
			return ["scroll", input.direction ?? "down", ...(input.amount === undefined ? [] : ["--amount", integerText(input.amount, "amount")])];
		case "back":
			return ["back"];
		case "switch_tab":
			return ["switch", integerText(input.tab, "tab")];
		case "close_tab":
			return ["close-tab", ...(input.tab === undefined ? [] : [integerText(input.tab, "tab")])];
		case "keys":
			return ["keys", requireText(input.keys, "keys")];
		case "evaluate":
			return ["eval", requireText(input.js, "js")];
		case "wait_selector":
			return ["wait", "selector", requireText(input.selector, "selector")];
		case "wait_text":
			return ["wait", "text", requireText(input.text, "text")];
	}
}

function requireBrowserUseInput(value: Record<string, unknown>): BrowserUseInput {
	if (typeof value.action !== "string") throw new Error("browser.use requires action");
	return value as BrowserUseInput;
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`browser_use.browser_use ${field} must be a non-empty string`);
	return value;
}

function integerText(value: unknown, field: string): string {
	if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`browser_use.browser_use ${field} must be an integer`);
	return String(value);
}

function pageTargets(targets: readonly CdpTarget[]): CdpTarget[] {
	return targets.filter((target) => target.type === "page" && Boolean(target.webSocketDebuggerUrl));
}

function toBrowserUseTab(target: CdpTarget, index = 0): BrowserUseTab {
	return {
		index,
		tabId: target.id.slice(-4),
		targetId: target.id,
		title: target.title,
		url: target.url,
		type: target.type,
	};
}

function selectTarget(targets: readonly CdpTarget[], tabId?: string): CdpTarget | undefined {
	if (!tabId) return targets.find((target) => target.url !== "about:blank") ?? targets[0];
	return targets.find((target) => target.id === tabId || target.id.endsWith(tabId));
}

async function captureScreenshot(client: CdpClient, fullPage: boolean, timeoutMs: number): Promise<string> {
	await client.send("Page.enable", undefined, timeoutMs);
	const params: Record<string, unknown> = { format: "png", fromSurface: true, captureBeyondViewport: fullPage };
	if (fullPage) {
		const metrics = await client.send("Page.getLayoutMetrics", undefined, timeoutMs) as { cssContentSize?: { width?: number; height?: number } };
		const width = metrics.cssContentSize?.width;
		const height = metrics.cssContentSize?.height;
		if (typeof width === "number" && typeof height === "number") {
			params.clip = { x: 0, y: 0, width, height, scale: 1 };
		}
	}
	const response = await client.send("Page.captureScreenshot", params, timeoutMs) as { data?: unknown };
	if (typeof response.data !== "string" || response.data.length === 0) throw new Error("CDP screenshot returned no image data");
	return response.data;
}

function parseJsonOrText(stdout: string): unknown {
	const text = stdout.trim();
	if (!text) return "";
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function toolResult(result: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
		details: result,
	};
}

function nodeReplToolResult(result: NodeReplExecResult | NodeReplResetResult) {
	const lines = [`status: ${result.status}`];
	if ("executionCount" in result) lines.push(`executionCount: ${result.executionCount}`, `durationMs: ${result.durationMs}`);
	if ("reset" in result) lines.push(`reset: ${result.reset}`);
	if ("stdout" in result && result.stdout) lines.push("", "stdout:", result.stdout);
	if ("stderr" in result && result.stderr) lines.push("", "stderr:", result.stderr);
	if ("result" in result && result.result !== undefined && result.result !== null) lines.push("", "result:", JSON.stringify(result.result, null, 2));
	if (result.error) lines.push("", "error:", JSON.stringify(result.error, null, 2));
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: result,
		isError: result.status !== "ok",
	};
}
