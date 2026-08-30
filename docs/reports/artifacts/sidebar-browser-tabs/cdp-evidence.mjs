import fs from "node:fs/promises";
import WebSocket from "ws";

const [, , command, ...args] = process.argv;
const browserHome = process.env.BROWSER_USE_HOME ?? "/root/.pibo/tools/browser-use/home";
const port = (await fs.readFile(`${browserHome}/pibo-cdp/sidebar-browser-tabs.port`, "utf8")).trim();
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url.includes("/apps/chat"));
if (!target?.webSocketDebuggerUrl) throw new Error("Chat Web CDP target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.once("open", resolve);
	socket.once("error", reject);
});
let sequence = 0;
const pending = new Map();
socket.on("message", (buffer) => {
	const message = JSON.parse(buffer.toString());
	if (message.id && pending.has(message.id)) {
		const { resolve, reject } = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) reject(new Error(message.error.message));
		else resolve(message.result);
	}
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const id = ++sequence;
	pending.set(id, { resolve, reject });
	socket.send(JSON.stringify({ id, method, params }));
});

if (command === "viewport") {
	const width = Number(args[0]);
	const height = Number(args[1]);
	const mobile = args[2] === "mobile";
	await send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 1,
		mobile,
		screenWidth: width,
		screenHeight: height,
	});
	console.log(JSON.stringify({ width, height, mobile }));
} else if (command === "audit") {
	const result = await send("Runtime.evaluate", {
		returnByValue: true,
		expression: `(() => {
			const rect = (selector) => {
				const node = document.querySelector(selector);
				if (!node) return null;
				const value = node.getBoundingClientRect();
				return { x: value.x, y: value.y, width: value.width, height: value.height };
			};
			return {
				url: location.href,
				viewport: { width: innerWidth, height: innerHeight },
				area: document.querySelector('[data-pibo-debug="chat-app"]')?.getAttribute('data-pibo-area'),
				desktopSidebar: rect('[data-pibo-debug="desktop-session-sidebar"]'),
				desktopCenter: rect('[data-pibo-debug="desktop-session-center"]'),
				desktopTabs: rect('[data-pibo-debug="desktop-tab-sidebar"]'),
				mobileRouteShell: rect('[data-pibo-debug="route-shell"]'),
				activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
				tabOrder: [...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent?.trim()),
				failedResources: performance.getEntriesByType('resource').filter((entry) => entry.duration === 0 && entry.transferSize === 0).map((entry) => entry.name),
			};
		})()`,
	});
	const serialized = `${JSON.stringify(result.result.value, null, 2)}\n`;
	if (args[0]) await fs.writeFile(args[0], serialized);
	console.log(serialized.trimEnd());
} else if (command === "monitor") {
	const durationMs = Number(args[0] ?? 60_000);
	const output = args[1];
	if (!output) throw new Error("monitor output path is required");
	const events = [];
	const requestUrls = new Map();
	socket.on("message", (buffer) => {
		const message = JSON.parse(buffer.toString());
		if (message.method === "Network.requestWillBeSent") requestUrls.set(message.params.requestId, message.params.request.url);
		if (message.method === "Runtime.exceptionThrown") events.push({ kind: "exception", detail: message.params.exceptionDetails });
		if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) events.push({ kind: `console-${message.params.type}`, detail: message.params });
		if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) events.push({ kind: `log-${message.params.entry.level}`, detail: message.params.entry });
		if (message.method === "Network.responseReceived" && message.params.response.status >= 400) events.push({ kind: "http-error", detail: { url: message.params.response.url, status: message.params.response.status } });
		if (message.method === "Network.loadingFailed") events.push({
			kind: "network-failed",
			detail: { ...message.params, url: requestUrls.get(message.params.requestId) },
		});
	});
	await Promise.all([send("Runtime.enable"), send("Log.enable"), send("Network.enable")]);
	await new Promise((resolve) => setTimeout(resolve, durationMs));
	await fs.writeFile(output, `${JSON.stringify({ target: target.url, durationMs, events }, null, 2)}\n`);
	console.log(JSON.stringify({ output, eventCount: events.length }));
} else {
	throw new Error(`Unknown command: ${command}`);
}

socket.close();
