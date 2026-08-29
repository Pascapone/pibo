import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const endpoint = process.argv[2];
const artifactDir = process.argv[3];
if (!endpoint || !artifactDir) throw new Error("usage: node stream-render-rereview2-cdp-evidence.mjs <cdp-http-endpoint> <artifact-dir>");
fs.mkdirSync(artifactDir, { recursive: true });

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url.includes("/apps/chat"));
if (!target?.webSocketDebuggerUrl) throw new Error("No Chat Web CDP target found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.once("open", resolve);
	socket.once("error", reject);
});

let requestId = 0;
const pending = new Map();
const network = [];
const consoleEntries = [];
socket.on("message", (raw) => {
	const message = JSON.parse(String(raw));
	if (message.id !== undefined) {
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(message.error.message));
		else waiter.resolve(message.result);
		return;
	}
	if (message.method.startsWith("Network.")) network.push({ method: message.method, params: message.params });
	if (message.method === "Runtime.consoleAPICalled" || message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded") {
		consoleEntries.push({ method: message.method, params: message.params });
	}
});

function send(method, params = {}) {
	const id = ++requestId;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
	return result.result.value;
}

await Promise.all([
	send("Page.enable"),
	send("Runtime.enable"),
	send("Network.enable"),
	send("Performance.enable"),
	send("Log.enable"),
]);

for (let attempt = 0; attempt < 50; attempt += 1) {
	if (await evaluate("document.querySelector('[data-pibo-debug=chat-shell]')?.getAttribute('data-pibo-state')") === "ready") break;
	await new Promise((resolve) => setTimeout(resolve, 100));
}

await evaluate("console.info('stream-render-rereview2-cdp-evidence')");
const domRows = await evaluate(`(() => [...document.querySelectorAll('[data-pibo-terminal-row=true]')].map((element, index) => ({
	index,
	rowId: element.getAttribute('data-row-id'),
	eventId: element.getAttribute('data-event-id'),
	kind: element.getAttribute('data-row-kind'),
	nodeId: element.getAttribute('data-trace-node-id'),
	text: (element.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120),
})))()`);

const pagination = await evaluate(`(async () => {
	const pages = [];
	let before;
	for (let page = 0; page < 10; page += 1) {
		const params = new URLSearchParams({ piboSessionId: 'ps_stream_render_rereview2_browser', limit: '5' });
		if (before) params.set('before', before);
		const response = await fetch('/api/chat/trace/timeline?' + params);
		const body = await response.json();
		pages.push({
			status: response.status,
			serverTiming: response.headers.get('server-timing'),
			version: response.headers.get('x-pibo-trace-version'),
			before,
			nextBeforeCursor: body.nextBeforeCursor,
			hasOlderEvents: body.hasOlderEvents,
			nodeIds: (body.nodes ?? []).map((node) => node.nodeId),
		});
		if (!body.hasOlderEvents || !body.nextBeforeCursor || body.nextBeforeCursor === before) break;
		before = body.nextBeforeCursor;
	}
	const tail = await fetch('/api/chat/trace/timeline?piboSessionId=ps_stream_render_rereview2_browser&limit=50');
	const body = await tail.json();
	const serialized = JSON.stringify(body);
	const tools = [];
	const visit = (nodes) => { for (const node of nodes ?? []) { if (node.toolCallId === 'browser-reused-tool') tools.push({ id: node.id, eventId: node.eventId, ordinal: node.toolInvocationOrdinal, payloadRefs: node.payloadRefs }); visit(node.children); } };
	visit(body.nodes);
	return {
		pages,
		uniquePageNodeIds: [...new Set(pages.flatMap((page) => page.nodeIds))],
		duplicateNodeIdsAcrossPages: [...new Set(pages.flatMap((page) => page.nodeIds).filter((nodeId, index, all) => all.indexOf(nodeId) !== index))],
		responseBytes: new TextEncoder().encode(serialized).byteLength,
		containsLargeInlinePayload: serialized.includes('A'.repeat(4096)),
		tools,
	};
})()`);

const performanceMetrics = await send("Performance.getMetrics");
const resourceTiming = await evaluate(`performance.getEntriesByType('resource')
	.filter((entry) => entry.name.includes('/api/chat/trace'))
	.map((entry) => ({ name: entry.name, duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize }))`);
const screenshot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
fs.writeFileSync(path.join(artifactDir, "03-cdp-terminal.png"), Buffer.from(screenshot.data, "base64"));

const compactNetwork = network.flatMap((event) => {
	if (event.method === "Network.requestWillBeSent" && event.params.request.url.includes("/api/chat/trace")) {
		return [{ phase: "request", requestId: event.params.requestId, method: event.params.request.method, url: event.params.request.url }];
	}
	if (event.method === "Network.responseReceived" && event.params.response.url.includes("/api/chat/trace")) {
		return [{ phase: "response", requestId: event.params.requestId, status: event.params.response.status, url: event.params.response.url, timing: event.params.response.timing }];
	}
	return [];
});
const evidence = {
	createdAt: new Date().toISOString(),
	target: { id: target.id, title: target.title, url: target.url },
	domRows,
	pagination,
	resourceTiming,
	performanceMetrics: performanceMetrics.metrics,
	network: compactNetwork,
	console: consoleEntries,
};
for (const [name, value] of Object.entries({
	"cdp-evidence.json": evidence,
	"dom-rows.json": domRows,
	"pagination.json": pagination,
	"network.json": compactNetwork,
	"console.json": consoleEntries,
	"performance.json": { metrics: performanceMetrics.metrics, resourceTiming },
})) fs.writeFileSync(path.join(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`);

socket.close();
process.stdout.write(`${JSON.stringify({ artifactDir, rowCount: domRows.length, pageCount: pagination.pages.length, toolCount: pagination.tools.length, networkEvents: compactNetwork.length, consoleEvents: consoleEntries.length })}\n`);
