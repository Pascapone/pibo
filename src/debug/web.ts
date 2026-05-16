import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPiboHome } from "../core/pibo-home.js";
import { listBrowserUseCdpTargets, selectBestChatTarget, formatBrowserUseTargets, type BrowserUseCdpTarget } from "../tools/browser-use-cdp.js";

const DEFAULT_WATCH_DURATION_MS = 5_000;
const MAX_WATCH_DURATION_MS = 30_000;
const DEFAULT_NODE_LIMIT = 250;
const DEFAULT_DEPTH_LIMIT = 8;
const DEFAULT_EVENT_LIMIT = 500;
const DEFAULT_TEXT_LIMIT = 80;
const STDOUT_BUDGET = 12_000;

type WebOptions = {
	positionals: string[];
	cdpUrl?: string;
	target?: string;
	scope?: string;
	preset?: string;
	duration?: string;
	json: boolean;
	artifact: boolean;
	from?: string;
	act: boolean;
	manual: boolean;
	includeText: boolean;
	includeLayout: boolean;
};

type SnapshotNode = {
	ref: string;
	identity: string;
	identityKind: string;
	depth: number;
	tag: string;
	role?: string;
	name?: string;
	text?: string;
	attributes: Record<string, string | boolean | number>;
	classSummary?: string;
	path: string;
	focused?: boolean;
	box?: { x: number; y: number; w: number; h: number };
};

type WebSnapshot = {
	kind: "snapshot";
	createdAt: string;
	url: string;
	title: string;
	scope: string;
	rootFound: boolean;
	root?: SnapshotNode;
	activeElement?: { identity: string; tag: string; name?: string; path: string };
	nodes: SnapshotNode[];
	omitted: { nodes: number; depth: number; budget: boolean };
};

type WatchEvent = {
	t: number;
	source: "dom" | "focus" | "route" | "action";
	kind: string;
	target?: string;
	detail?: string;
	before?: string;
	after?: string;
	node?: SnapshotNode;
};

type WebWatch = {
	kind: "watch";
	createdAt: string;
	url: string;
	title: string;
	scope: string;
	durationMs: number;
	rootFound: boolean;
	events: WatchEvent[];
	before?: WebSnapshot;
	after?: WebSnapshot;
	omitted: { events: number; nodes: number; depth: number; budget: boolean };
	action?: { requested: string; performed: boolean; error?: string };
};

type CdpRuntimeResult = {
	result?: {
		type?: string;
		value?: unknown;
		description?: string;
	};
	exceptionDetails?: unknown;
};

type CdpResponse = {
	id?: number;
	result?: unknown;
	error?: { message?: string; code?: number; data?: unknown };
};

class CdpClient {
	private nextId = 0;
	private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private socket?: WebSocket;

	constructor(private readonly webSocketUrl: string) {}

	connect(timeoutMs = 3_000): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(this.webSocketUrl);
			this.socket = socket;
			let settled = false;
			const timer = setTimeout(() => fail(new Error("Timed out connecting to CDP target")), timeoutMs);

			const settle = () => {
				if (settled) return false;
				settled = true;
				clearTimeout(timer);
				return true;
			};
			const succeed = () => {
				if (settle()) resolve();
			};
			const fail = (error: Error) => {
				if (settle()) reject(error);
			};

			socket.addEventListener("open", succeed);
			socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
			socket.addEventListener("error", () => fail(new Error("CDP WebSocket error")));
			socket.addEventListener("close", () => {
				for (const [id, pending] of this.pending) {
					clearTimeout(pending.timer);
					pending.reject(new Error("CDP target closed"));
					this.pending.delete(id);
				}
			});
		});
	}

	send(method: string, params?: Record<string, unknown>, timeoutMs = 10_000): Promise<unknown> {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP target is not connected");
		const id = ++this.nextId;
		const payload = params ? { id, method, params } : { id, method };
		const promise = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for CDP method ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
		});
		this.socket.send(JSON.stringify(payload));
		return promise;
	}

	async evaluate<T>(expression: string, timeoutMs = 10_000): Promise<T> {
		const response = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		}, timeoutMs) as CdpRuntimeResult;
		if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
		return response.result?.value as T;
	}

	close(): void {
		try {
			this.socket?.close();
		} catch {
			// ignore close races
		}
	}

	private handleMessage(raw: string): void {
		let message: CdpResponse;
		try {
			message = JSON.parse(raw) as CdpResponse;
		} catch {
			return;
		}
		if (typeof message.id !== "number") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
			return;
		}
		pending.resolve(message.result);
	}
}

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

Next:
  pibo debug web targets
  pibo debug web snapshot --preset session-list
  pibo debug web watch --preset chat-shell --duration 5000
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

Default:
  --manual waits while you click New Session yourself.
  --act clicks the discovered New Session button after the watcher starts.
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
	if (scenario !== "new-session") throw new Error(`Unknown pibo debug web scenario "${scenario}". Run pibo debug web scenario --help.`);
	const durationMs = parseDuration(options.duration);
	const { client, target } = await connectTarget({ ...options, preset: "app" });
	try {
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
	const targets = await listBrowserUseCdpTargets({ cdpUrl, probe: true });
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
		act: false,
		manual: false,
		includeText: false,
		includeLayout: false,
	};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") options.json = true;
		else if (arg === "--artifact") options.artifact = true;
		else if (arg === "--act") options.act = true;
		else if (arg === "--manual") options.manual = true;
		else if (arg === "--include-text") options.includeText = true;
		else if (arg === "--include-layout") options.includeLayout = true;
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

function formatSnapshot(snapshot: WebSnapshot, target: BrowserUseCdpTarget | { id: string; url: string; title: string }): string {
	const lines = [
		`# Web Render Snapshot`,
		`# target: ${target.id} ${target.url || snapshot.url}`,
		`# scope: ${snapshot.scope}`,
	];
	if (!snapshot.rootFound) {
		lines.push("root: not found");
		return lines.join("\n");
	}
	for (const node of snapshot.nodes) lines.push(formatNodeLine(node));
	lines.push(`Summary: ${snapshot.nodes.length} nodes, omitted=${snapshot.omitted.nodes}, depth_omitted=${snapshot.omitted.depth}`);
	return lines.join("\n");
}

function formatNodeLine(node: SnapshotNode): string {
	const indent = "  ".repeat(Math.min(node.depth, 8));
	const parts = [`${indent}${node.ref}`, node.identityKind === "path" ? `${node.identity} unstable` : node.identity, `<${node.tag}>`];
	if (node.role) parts.push(`role=${node.role}`);
	if (node.name) parts.push(`name=${JSON.stringify(node.name)}`);
	if (node.attributes["data-pibo-session-id"]) parts.push(`session=${node.attributes["data-pibo-session-id"]}`);
	if (node.attributes["data-pibo-selected"]) parts.push(`selected=${node.attributes["data-pibo-selected"]}`);
	if (node.attributes["data-pibo-state"]) parts.push(`state=${node.attributes["data-pibo-state"]}`);
	if (node.classSummary) parts.push(`class=${JSON.stringify(node.classSummary)}`);
	if (node.text && !node.name) parts.push(`text=${JSON.stringify(node.text)}`);
	if (node.focused) parts.push("focused=true");
	if (node.box) parts.push(`box=${node.box.x},${node.box.y},${node.box.w},${node.box.h}`);
	return parts.join(" ");
}

function diffSnapshots(before: WebSnapshot, after: WebSnapshot): { added: SnapshotNode[]; removed: SnapshotNode[]; changed: Array<{ before: SnapshotNode; after: SnapshotNode; changes: string[] }>; suspectedFlickers: string[] } {
	const beforeMap = new Map(before.nodes.map((node) => [node.identity, node]));
	const afterMap = new Map(after.nodes.map((node) => [node.identity, node]));
	const added: SnapshotNode[] = [];
	const removed: SnapshotNode[] = [];
	const changed: Array<{ before: SnapshotNode; after: SnapshotNode; changes: string[] }> = [];
	for (const node of after.nodes) if (!beforeMap.has(node.identity)) added.push(node);
	for (const node of before.nodes) if (!afterMap.has(node.identity)) removed.push(node);
	for (const [identity, beforeNode] of beforeMap) {
		const afterNode = afterMap.get(identity);
		if (!afterNode) continue;
		const changes = nodeChanges(beforeNode, afterNode);
		if (changes.length) changed.push({ before: beforeNode, after: afterNode, changes });
	}
	const suspectedFlickers = inferSnapshotFlickers(removed, added);
	return { added, removed, changed, suspectedFlickers };
}

function nodeChanges(before: SnapshotNode, after: SnapshotNode): string[] {
	const changes: string[] = [];
	if (before.name !== after.name) changes.push(`name ${jsonShort(before.name)} -> ${jsonShort(after.name)}`);
	if (before.text !== after.text) changes.push(`text ${jsonShort(before.text)} -> ${jsonShort(after.text)}`);
	if (before.classSummary !== after.classSummary) changes.push(`class ${jsonShort(before.classSummary)} -> ${jsonShort(after.classSummary)}`);
	for (const key of new Set([...Object.keys(before.attributes), ...Object.keys(after.attributes)])) {
		if (before.attributes[key] !== after.attributes[key]) changes.push(`${key} ${jsonShort(before.attributes[key])} -> ${jsonShort(after.attributes[key])}`);
	}
	if (before.box && after.box) {
		const moved = Math.abs(before.box.x - after.box.x) + Math.abs(before.box.y - after.box.y);
		const resized = Math.abs(before.box.w - after.box.w) + Math.abs(before.box.h - after.box.h);
		if (moved > 2 || resized > 2) changes.push(`box ${before.box.x},${before.box.y},${before.box.w},${before.box.h} -> ${after.box.x},${after.box.y},${after.box.w},${after.box.h}`);
	}
	return changes;
}

function inferSnapshotFlickers(removed: SnapshotNode[], added: SnapshotNode[]): string[] {
	const flickers: string[] = [];
	for (const oldNode of removed) {
		const match = bestLogicalMatch(oldNode, added);
		if (match && match.score >= 55) {
			flickers.push(`remount-like ${oldNode.identity} -> ${match.node.identity} reason=${match.reason}`);
		}
	}
	return flickers.slice(0, 20);
}

function formatSnapshotDiff(diff: ReturnType<typeof diffSnapshots>, before: WebSnapshot, after: WebSnapshot, target: BrowserUseCdpTarget | { id: string; url: string; title: string }): string {
	const lines = [
		`# Web Render Diff`,
		`# target: ${target.id} ${target.url || after.url}`,
		`# scope: ${after.scope}`,
		`# baseline: ${before.createdAt}`,
		`# current: ${after.createdAt}`,
	];
	for (const node of diff.removed) lines.push(`- ${node.identity} ${describeNode(node)}`);
	for (const node of diff.added) lines.push(`+ ${node.identity} ${describeNode(node)}`);
	for (const item of diff.changed) lines.push(`~ ${item.after.identity} ${item.changes.join("; ")}`);
	if (diff.suspectedFlickers.length) {
		lines.push("", "Suspected flicker:");
		for (const flicker of diff.suspectedFlickers) lines.push(`- ${flicker}`);
	}
	lines.push(``, `Summary: ${diff.added.length} adds, ${diff.removed.length} removals, ${diff.changed.length} updates, ${diff.suspectedFlickers.length} suspected flickers`);
	return lines.join("\n");
}

export function formatWatch(watch: WebWatch, target: BrowserUseCdpTarget | { id: string; url: string; title: string }, label = "watch"): string {
	const lines = [
		`# Web Render Watch: ${label}, ${(watch.durationMs / 1000).toFixed(1)}s`,
		`# target: ${target.id} ${target.url || watch.url}`,
		`# scope: ${watch.scope}`,
	];
	if (!watch.rootFound) {
		lines.push("root: not found");
		return lines.join("\n");
	}
	if (watch.action) {
		lines.push(`# action: ${watch.action.requested} performed=${watch.action.performed}${watch.action.error ? ` error=${watch.action.error}` : ""}`);
	}
	const snapshotDelta = watch.before && watch.after ? diffSnapshots(watch.before, watch.after) : undefined;
	const hasSnapshotDelta = snapshotDelta ? hasSnapshotDiff(snapshotDelta) : false;
	if (!watch.events.length && hasSnapshotDelta) {
		lines.push("no mutation events captured; final snapshot differs:");
		lines.push(...formatCompactSnapshotDelta(snapshotDelta!));
	} else if (!watch.events.length) {
		lines.push("no changes");
	}
	for (const event of watch.events) {
		lines.push(formatWatchEvent(event));
	}
	const flickers = inferWatchFlickers(watch.events);
	if (flickers.length) {
		lines.push("", "Suspected flicker:");
		for (const flicker of flickers) lines.push(`- ${flicker}`);
	}
	const counts = countEvents(watch.events);
	lines.push("", `Summary: ${counts.added} adds, ${counts.removed} removals, ${counts.attr} attr updates, ${counts.text} text updates, ${counts.focus} focus, ${counts.route} route, ${flickers.length} suspected flickers, omitted=${watch.omitted.events}`);
	return lines.join("\n");
}

function formatWatchEvent(event: WatchEvent): string {
	const t = String(event.t).padStart(4, "0");
	if (event.source === "dom" && event.kind === "attr") return `${t}ms dom ~ ${event.target ?? "?"} ${event.detail}: ${jsonShort(event.before)} -> ${jsonShort(event.after)}`;
	if (event.source === "dom" && event.kind === "text") return `${t}ms dom ~ ${event.target ?? "?"} text: ${jsonShort(event.before)} -> ${jsonShort(event.after)}`;
	if (event.source === "dom" && event.kind === "added") return `${t}ms dom + ${event.target ?? "?"} ${event.node ? describeNode(event.node) : ""}`;
	if (event.source === "dom" && event.kind === "removed") return `${t}ms dom - ${event.target ?? "?"} ${event.node ? describeNode(event.node) : ""}`;
	if (event.source === "focus") return `${t}ms focus ${event.kind} ${event.target ?? "?"}`;
	if (event.source === "route") return `${t}ms route ${event.kind} ${event.before ? `${event.before} -> ` : ""}${event.after ?? ""}`;
	if (event.source === "action") return `${t}ms action ${event.kind} ${event.detail ?? ""} ${event.target ?? ""}`;
	return `${t}ms ${event.source} ${event.kind} ${event.target ?? ""}`;
}

function hasSnapshotDiff(diff: ReturnType<typeof diffSnapshots>): boolean {
	return Boolean(diff.added.length || diff.removed.length || diff.changed.length);
}

function formatCompactSnapshotDelta(diff: ReturnType<typeof diffSnapshots>, limit = 8): string[] {
	const lines: string[] = [];
	for (const node of diff.removed) lines.push(`  - ${node.identity} ${describeNode(node)}`);
	for (const node of diff.added) lines.push(`  + ${node.identity} ${describeNode(node)}`);
	for (const item of diff.changed) lines.push(`  ~ ${item.after.identity} ${item.changes.join("; ")}`);
	if (lines.length > limit) return [...lines.slice(0, limit), `  … ${lines.length - limit} more snapshot changes`];
	return lines;
}

export function inferWatchFlickers(events: readonly WatchEvent[]): string[] {
	const flickers: string[] = [];
	const removals = events.filter((event) => event.kind === "removed" && event.node);
	const additions = events.filter((event) => event.kind === "added" && event.node);
	for (const added of additions) {
		const addedNode = added.node!;
		const removal = removals.find((removed) => removed.t >= added.t && removed.t - added.t <= 500 && removed.node && sameStableNode(addedNode, removed.node));
		if (removal?.node) flickers.push(`transient node within ${removal.t - added.t}ms: ${addedNode.identity} added then removed`);
	}
	for (const removed of removals) {
		const removedNode = removed.node!;
		const candidates = additions.filter((added) => added.t >= removed.t && added.t - removed.t <= 500 && added.node);
		const match = bestLogicalMatch(removedNode, candidates.map((candidate) => candidate.node!));
		if (match && match.score >= 55) {
			const event = candidates.find((candidate) => candidate.node === match.node);
			if (event) flickers.push(`remove/add within ${event.t - removed.t}ms: ${removedNode.identity} -> ${match.node.identity} reason=${match.reason}`);
		}
	}
	const attrRollbacks = new Map<string, WatchEvent[]>();
	for (const event of events) {
		if (event.kind !== "attr" || !event.target || !event.detail) continue;
		const key = `${event.target}:${event.detail}`;
		attrRollbacks.set(key, [...(attrRollbacks.get(key) ?? []), event]);
	}
	for (const [key, entries] of attrRollbacks) {
		for (let i = 1; i < entries.length; i++) {
			if (entries[i - 1].before === entries[i].after && entries[i].t - entries[i - 1].t <= 500) {
				flickers.push(`attribute rollback within ${entries[i].t - entries[i - 1].t}ms: ${key}`);
				break;
			}
		}
	}
	return [...new Set(flickers)].slice(0, 20);
}

function sameStableNode(left: SnapshotNode, right: SnapshotNode): boolean {
	if (left.identity === right.identity) return true;
	const leftSession = attrText(left, "data-pibo-session-id");
	const rightSession = attrText(right, "data-pibo-session-id");
	return Boolean(leftSession && leftSession === rightSession);
}

function bestLogicalMatch(node: SnapshotNode, candidates: readonly SnapshotNode[]): { node: SnapshotNode; score: number; reason: string } | undefined {
	let best: { node: SnapshotNode; score: number; reason: string } | undefined;
	for (const candidate of candidates) {
		const match = logicalMatchScore(node, candidate);
		if (!best || match.score > best.score) best = { node: candidate, ...match };
	}
	return best && best.score > 0 ? best : undefined;
}

function logicalMatchScore(left: SnapshotNode, right: SnapshotNode): { score: number; reason: string } {
	if (left.identity === right.identity) return { score: 100, reason: "same-identity" };
	const leftSession = attrText(left, "data-pibo-session-id");
	const rightSession = attrText(right, "data-pibo-session-id");
	if (leftSession && rightSession && leftSession === rightSession) return { score: 90, reason: "same-session-id" };

	const reasons: string[] = [];
	let score = 0;
	const leftDebug = attrText(left, "data-pibo-debug");
	const rightDebug = attrText(right, "data-pibo-debug");
	if (leftDebug || rightDebug) {
		if (leftDebug !== rightDebug) return { score: 0, reason: "different-debug-anchor" };
		score += 45;
		reasons.push("same-debug-anchor");
	}
	if (left.tag === right.tag) {
		score += 10;
		reasons.push("same-tag");
	}
	if (left.path && left.path === right.path) {
		score += 25;
		reasons.push("same-path");
	}
	if (left.role && left.role === right.role) {
		score += 10;
		reasons.push("same-role");
	}

	const differentSessionIds = Boolean(leftSession && rightSession && leftSession !== rightSession);
	if (!differentSessionIds) {
		if (left.name && left.name === right.name) {
			score += 15;
			reasons.push("same-name");
		}
		if (left.text && left.text === right.text) {
			score += 10;
			reasons.push("same-text");
		}
	}
	return { score, reason: reasons.join("+") || "weak-match" };
}

function attrText(node: SnapshotNode, key: string): string | undefined {
	const value = node.attributes[key];
	return typeof value === "string" && value.length ? value : undefined;
}

function countEvents(events: readonly WatchEvent[]): { added: number; removed: number; attr: number; text: number; focus: number; route: number } {
	return {
		added: events.filter((event) => event.kind === "added").length,
		removed: events.filter((event) => event.kind === "removed").length,
		attr: events.filter((event) => event.kind === "attr").length,
		text: events.filter((event) => event.kind === "text").length,
		focus: events.filter((event) => event.source === "focus").length,
		route: events.filter((event) => event.source === "route").length,
	};
}

function describeNode(node: SnapshotNode): string {
	const parts = [`<${node.tag}>`];
	if (node.role) parts.push(`role=${node.role}`);
	if (node.name) parts.push(`name=${JSON.stringify(node.name)}`);
	if (node.text && !node.name) parts.push(`text=${JSON.stringify(node.text)}`);
	if (node.attributes["data-pibo-session-id"]) parts.push(`session=${node.attributes["data-pibo-session-id"]}`);
	if (node.attributes["data-pibo-selected"]) parts.push(`selected=${node.attributes["data-pibo-selected"]}`);
	if (node.classSummary) parts.push(`class=${JSON.stringify(node.classSummary)}`);
	return parts.join(" ");
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
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = path.join(getPiboHome(), "debug", "web-render", stamp);
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, `${kind}.json`);
	await writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
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
