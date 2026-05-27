import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { responseHtml } from "../../web/http.js";

export const CHAT_WEB_MOUNT_PATH = "/apps/chat";

const CHAT_UI_DIST_DIR = resolve(fileURLToPath(new URL("../../../dist/apps/chat-ui", import.meta.url)));
const compressedAssetCache = new Map<string, Uint8Array>();

export function responseChatAppShell(): Response {
	return responseBuiltChatIndex() ?? responseHtml(createChatHtml());
}

export function responseBuiltChatIndex(): Response | undefined {
	const indexPath = resolve(CHAT_UI_DIST_DIR, "index.html");
	if (!existsSync(indexPath)) return undefined;
	return responseHtml(readFileSync(indexPath, "utf8"));
}

export function responseBuiltChatAsset(request: Request, pathname: string): Response | undefined {
	if (!pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/assets/`)) return undefined;
	return responseBuiltChatStaticFile(request, pathname, "public, max-age=31536000, immutable");
}

export function responseBuiltChatPublicFile(request: Request, pathname: string): Response | undefined {
	const publicFilePaths = new Set([
		`${CHAT_WEB_MOUNT_PATH}/manifest.webmanifest`,
		`${CHAT_WEB_MOUNT_PATH}/sw.js`,
	]);
	if (!publicFilePaths.has(pathname)) return undefined;
	const cacheControl = pathname.endsWith("/sw.js") || pathname.endsWith("/manifest.webmanifest")
		? "no-cache"
		: "public, max-age=31536000, immutable";
	return responseBuiltChatStaticFile(request, pathname, cacheControl);
}

function responseBuiltChatStaticFile(request: Request, pathname: string, cacheControl: string): Response | undefined {
	const relativePath = pathname.slice(`${CHAT_WEB_MOUNT_PATH}/`.length);
	const filePath = resolve(CHAT_UI_DIST_DIR, relativePath);
	if (!filePath.startsWith(CHAT_UI_DIST_DIR) || !existsSync(filePath)) return undefined;
	const body = readFileSync(filePath);
	const headers: Record<string, string> = {
		"content-type": contentTypeFor(filePath),
		"cache-control": cacheControl,
	};
	const encoding = preferredAssetEncoding(request.headers.get("accept-encoding"), filePath);
	if (!encoding) return new Response(body, { headers });
	headers["content-encoding"] = encoding;
	headers["vary"] = "accept-encoding";
	return new Response(compressedAssetBody(filePath, body, encoding), { headers });
}

export function isChatAppPath(pathname: string): boolean {
	if (pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/assets/`)) return false;
	if (pathname === `${CHAT_WEB_MOUNT_PATH}/manifest.webmanifest`) return false;
	if (pathname === `${CHAT_WEB_MOUNT_PATH}/sw.js`) return false;
	if (pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/icons/`)) return false;
	return pathname === CHAT_WEB_MOUNT_PATH || pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/`);
}

function contentTypeFor(path: string): string {
	switch (extname(path)) {
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".webmanifest":
			return "application/manifest+json; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

function preferredAssetEncoding(acceptEncoding: string | null, path: string): "br" | "gzip" | undefined {
	if (!isCompressibleAsset(path) || !acceptEncoding) return undefined;
	if (/\bbr\b/.test(acceptEncoding)) return "br";
	if (/\bgzip\b/.test(acceptEncoding)) return "gzip";
	return undefined;
}

function isCompressibleAsset(path: string): boolean {
	const extension = extname(path);
	return extension === ".js" || extension === ".css" || extension === ".html" || extension === ".json";
}

function compressedAssetBody(path: string, body: Uint8Array, encoding: "br" | "gzip"): Uint8Array {
	const cacheKey = `${encoding}:${path}`;
	const cached = compressedAssetCache.get(cacheKey);
	if (cached) return cached;
	const compressed = encoding === "br" ? brotliCompressSync(body) : gzipSync(body);
	compressedAssetCache.set(cacheKey, compressed);
	return compressed;
}

function createChatHtml(): string {
	return `<!doctype html>
<html lang="de">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#101d22">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-title" content="Pibo Chat">
	<link rel="manifest" href="/apps/chat/manifest.webmanifest">
	<link rel="apple-touch-icon" href="/apps/chat/assets/pwa-images/ios/180.png">
	<title>Pibo Web Chat</title>
	<style>
		:root { color-scheme: dark; font-family: "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101d22; color: #d8e3e7; }
		* { box-sizing: border-box; }
		body { margin: 0; height: 100vh; overflow: hidden; background: #101d22; }
		button, textarea { font: inherit; }
		button { border: 1px solid #334155; background: #151f24; color: #d8e3e7; border-radius: 3px; padding: 7px 10px; cursor: pointer; }
		button:hover { border-color: #11a4d4; color: #ffffff; }
		button.primary { background: #11a4d4; border-color: #11a4d4; color: #ffffff; }
		button.ghost { background: transparent; }
		.app { display: grid; grid-template-rows: 56px 1fr; height: 100vh; }
		.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; background: #1a262b; border-bottom: 1px solid #1e293b; }
		.brand { font-size: 17px; font-weight: 800; letter-spacing: .08em; color: #e7f7fb; text-transform: uppercase; white-space: nowrap; }
		.tabs { display: flex; gap: 6px; }
		.tab { height: 32px; text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }
		.tab.active { border-color: #11a4d4; color: #11a4d4; background: rgba(17,164,212,.08); }
		.userbar { display: flex; align-items: center; gap: 8px; min-width: 0; color: #94a3b8; font-size: 12px; }
		.workspace { display: grid; grid-template-columns: 300px minmax(0,1fr) 320px; min-height: 0; }
		.sidebar, .inspector { background: #1a262b; border-right: 1px solid #1e293b; min-height: 0; overflow: auto; }
		.inspector { border-right: 0; border-left: 1px solid #1e293b; background: #0e1116; }
		.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.panel-actions { display: flex; align-items: center; gap: 6px; }
		.icon-button { width: 28px; height: 28px; padding: 0; display: grid; place-items: center; line-height: 1; }
		.session-tree { padding: 8px; }
		.session-row { width: 100%; display: grid; grid-template-columns: 28px minmax(0,1fr); align-items: center; margin-bottom: 4px; border: 1px solid transparent; border-radius: 3px; background: transparent; padding: 0 8px 0 0; }
		.session-row.active { border-color: #11a4d4; background: rgba(17,164,212,.10); }
		.session-toggle, .session-select { border: 0; background: transparent; border-radius: 0; padding: 0; }
		.session-toggle { width: 28px; height: 32px; display: grid; place-items: center; color: #64748b; }
		.session-toggle:hover { color: #11a4d4; border-color: transparent; }
		.session-select { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; align-items: center; text-align: left; padding: 7px 0; }
		.session-select:hover { border-color: transparent; }
		.session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #e2e8f0; }
		.session-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #64748b; }
		.status-dot { width: 7px; height: 7px; border-radius: 999px; background: #64748b; }
		.status-dot.running { background: #0bda57; box-shadow: 0 0 10px rgba(11,218,87,.35); }
		.status-dot.error { background: #ef4444; }
		.main { min-height: 0; display: grid; grid-template-rows: auto 1fr auto; background: #101d22; }
		.session-head { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #1e293b; background: #151f24; }
		.session-name { margin: 0; font-size: 16px; line-height: 1.2; }
		.session-meta { margin-top: 4px; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
		.trace-controls { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
		.content { min-height: 0; overflow: auto; padding: 14px; }
		.trace-list { min-width: 620px; display: flex; flex-direction: column; gap: 9px; }
		/* Ported from pydantic-tracing SpanNode/JsonRenderer visual structure. */
		.span-card { border: 1px solid #334155; border-radius: 3px; background: #1a262b; overflow: hidden; }
		.span-card.ok { border-color: rgba(11,218,87,.30); }
		.span-card.running { border-color: rgba(17,164,212,.50); box-shadow: 0 0 10px rgba(17,164,212,.10); }
		.span-card.error { border-color: rgba(255,107,0,.50); }
		.span-card[data-span-type="tool.call"] { border-color: rgba(168,85,247,.52); }
		.span-card[data-span-type="tool.result"] { border-color: rgba(34,197,94,.42); }
		.span-card[data-span-type="model.reasoning"] { border-color: rgba(245,158,11,.48); }
		.span-card[data-span-type="agent.delegation"] { border-color: rgba(249,115,22,.58); }
		.span-card[data-span-type="user.prompt"] { border-color: rgba(6,182,212,.48); }
		.span-header { width: 100%; display: grid; grid-template-columns: 18px 22px minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; background: #151f24; border: 0; text-align: left; }
		.span-card.ok > .span-header { background: rgba(11,218,87,.05); }
		.span-card.running > .span-header { background: rgba(17,164,212,.05); }
		.span-card.error > .span-header { background: rgba(255,107,0,.05); }
		.span-chevron { color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
		.span-icon { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: rgba(17,164,212,.20); color: #11a4d4; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
		.span-card[data-span-type="tool.call"] .span-icon { background: rgba(168,85,247,.20); color: #a855f7; }
		.span-card[data-span-type="tool.result"] .span-icon { background: rgba(34,197,94,.20); color: #22c55e; }
		.span-card[data-span-type="model.reasoning"] .span-icon { background: rgba(245,158,11,.20); color: #f59e0b; }
		.span-card[data-span-type="agent.delegation"] .span-icon { background: rgba(249,115,22,.20); color: #f97316; }
		.span-card[data-span-type="user.prompt"] .span-icon { background: rgba(6,182,212,.20); color: #06b6d4; }
		.span-type-label { color: #cbd5e1; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
		.span-title { color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.span-meta { display: flex; align-items: center; gap: 6px; }
		.span-body { display: none; border-top: 1px solid #1e293b; }
		.span-card.open > .span-body { display: block; }
		.span-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #1e293b; background: rgba(15,23,42,.18); }
		.span-quote { padding: 14px; color: #cbd5e1; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
		.span-code-well { padding: 12px 14px; background: #0e1116; border-bottom: 1px solid #1e293b; overflow: auto; }
		.span-function { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #22c55e; white-space: pre-wrap; }
		.syntax-keyword { color: #c084fc; }
		.syntax-name { color: #fde047; }
		.syntax-key { color: #60a5fa; }
		.syntax-string { color: #86efac; }
		.span-output-summary { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 14px; background: rgba(15,23,42,.28); border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 12px; }
		.span-output-summary code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
		.span-section { padding: 12px 14px; background: #0e1116; border-top: 1px solid rgba(51,65,85,.55); }
		.span-section-title { margin-bottom: 7px; color: #60a5fa; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.span-section-title.output { color: #22c55e; }
		.reasoning-block { padding: 14px; background: rgba(245,158,11,.06); color: #cbd5e1; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
		.reasoning-comment { color: rgba(245,158,11,.75); }
		.delegation-card { padding: 14px; background: rgba(249,115,22,.06); border-bottom: 1px solid rgba(249,115,22,.20); }
		.delegation-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: #f97316; font-size: 13px; font-weight: 700; }
		.delegation-query { color: #94a3b8; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.json-renderer { margin: 0; max-height: 24rem; overflow: auto; white-space: pre-wrap; color: #dbeafe; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.trace-node { border: 1px solid #334155; border-radius: 3px; background: #1a262b; overflow: hidden; }
		.trace-node[data-type="user.message"] { border-color: rgba(6,182,212,.42); }
		.trace-node[data-type="assistant.message"] { border-color: rgba(34,197,94,.35); }
		.trace-node[data-type="model.reasoning"] { border-color: rgba(245,158,11,.45); }
		.trace-node[data-type="tool.call"] { border-color: rgba(168,85,247,.45); }
		.trace-node[data-type="agent.delegation"] { border-color: rgba(249,115,22,.55); }
		.trace-node[data-type="agent.async"] { border-color: rgba(249,115,22,.55); }
		.trace-node[data-type="execution.command"] { border-color: rgba(17,164,212,.42); }
		.trace-node[data-type="error"] { border-color: rgba(239,68,68,.65); }
		.trace-header { width: 100%; display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px; padding: 9px 10px; background: #151f24; border: 0; text-align: left; }
		.trace-icon { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: rgba(17,164,212,.14); color: #11a4d4; font-size: 11px; }
		.trace-label { color: #cbd5e1; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
		.trace-summary { margin-top: 3px; color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.trace-actions { display: flex; align-items: center; gap: 6px; }
		.badge { border: 1px solid #334155; border-radius: 999px; padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #94a3b8; }
		.badge.running { color: #0bda57; border-color: rgba(11,218,87,.35); }
		.badge.error { color: #ef4444; border-color: rgba(239,68,68,.45); }
		.trace-body { display: none; padding: 10px; border-top: 1px solid #1e293b; }
		.trace-node.open > .trace-body { display: block; }
		.payload { margin: 0; white-space: pre-wrap; overflow: auto; max-height: 360px; padding: 10px; border: 1px solid #1e293b; border-radius: 3px; background: #0e1116; color: #dbeafe; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.children { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-left: 12px; border-left: 1px solid #334155; }
		.composer-wrap { position: relative; padding: 10px 12px; border-top: 1px solid #1e293b; background: #151f24; }
		.composer { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
		textarea { width: 100%; min-height: 48px; max-height: 150px; resize: vertical; border: 1px solid #334155; border-radius: 3px; padding: 10px; background: #0e1116; color: #e2e8f0; }
		.command-menu { position: absolute; left: 12px; bottom: 74px; width: min(520px, calc(100% - 24px)); max-height: 280px; overflow: auto; background: #0e1116; border: 1px solid #11a4d4; border-radius: 3px; box-shadow: 0 12px 30px rgba(0,0,0,.35); z-index: 20; }
		.command-item { display: grid; grid-template-columns: 120px 1fr; gap: 10px; width: 100%; padding: 9px 10px; border: 0; border-bottom: 1px solid #1e293b; text-align: left; background: transparent; }
		.command-item.active { background: rgba(17,164,212,.13); }
		.command-name { color: #11a4d4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
		.command-desc { color: #94a3b8; font-size: 12px; }
		.inspector-log { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
		.raw-event { border-left: 2px solid #11a4d4; padding: 8px; background: #151f24; }
		.raw-event-type { color: #11a4d4; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; margin-bottom: 5px; }
		.placeholder { padding: 18px; color: #94a3b8; }
		.modal-backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.62); z-index: 50; }
		.modal { width: min(420px, calc(100vw - 32px)); border: 1px solid #334155; border-radius: 4px; background: #1a262b; padding: 16px; }
		.modal h2 { margin: 0 0 8px; font-size: 15px; }
		.modal p { margin: 0 0 14px; color: #94a3b8; font-size: 13px; }
		.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
		.hidden { display: none !important; }
		@media (max-width: 980px) {
			.workspace { grid-template-columns: 240px minmax(0,1fr); }
			.inspector { display: none; }
		}
		@media (max-width: 720px) {
			body { overflow: auto; }
			.app { height: auto; min-height: 100vh; }
			.topbar { flex-wrap: wrap; height: auto; min-height: 56px; padding: 10px; }
			.workspace { grid-template-columns: 1fr; }
			.sidebar { max-height: 260px; }
			.main { min-height: 70vh; }
			.trace-list { min-width: 0; }
			.composer { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<div class="app">
		<header class="topbar">
			<div class="brand">Pibo Chat</div>
			<nav class="tabs">
				<button class="tab active" data-area="sessions">Sessions</button>
				<button class="tab" data-area="agents">Agents</button>
				<button class="tab" data-area="settings">Settings</button>
			</nav>
			<div class="userbar" id="user"></div>
		</header>
		<div class="workspace">
			<aside class="sidebar">
				<div class="panel-head">
					<span id="sidebar-title">Sessions</span>
					<div class="panel-actions">
						<button class="ghost icon-button" id="new-session" title="New Session" aria-label="New Session">+</button>
						<button class="ghost" id="refresh">Refresh</button>
					</div>
				</div>
				<div class="session-tree" id="session-tree"></div>
			</aside>
			<main class="main">
				<div class="session-head">
					<div>
						<h1 class="session-name" id="session-title">Loading</h1>
						<div class="session-meta" id="session-meta"></div>
					</div>
					<div class="trace-controls">
						<button class="ghost" id="thinking-toggle">Thinking Off</button>
						<button class="ghost" id="collapse-all">Collapse All</button>
						<button class="ghost" id="expand-one">Depth 1</button>
						<button class="ghost" id="expand-all">Expand All</button>
					</div>
				</div>
				<section class="content" id="content"></section>
				<div class="composer-wrap" id="composer-wrap">
					<div class="command-menu hidden" id="command-menu"></div>
					<form class="composer" id="composer">
						<textarea id="message" name="message" placeholder="Send Message (/ for commands or $ for skills)"></textarea>
						<button class="primary" type="submit">Send</button>
					</form>
				</div>
			</main>
			<aside class="inspector">
				<div class="panel-head"><span>Raw Events</span><button class="ghost" id="clear-local">Clear UI</button></div>
				<div class="inspector-log" id="raw-log"></div>
			</aside>
		</div>
	</div>
	<div class="modal-backdrop hidden" id="fork-modal">
		<div class="modal">
			<h2>Zur geforkten Session wechseln?</h2>
			<p>Der Fork wurde erstellt. Wenn du wechselst, wird die neue Session geladen.</p>
			<div class="modal-actions">
				<button id="fork-stay">Nein</button>
				<button class="primary" id="fork-switch">Ja</button>
			</div>
		</div>
	</div>
	<script>
		const userEl = document.querySelector("#user");
		const sessionTreeEl = document.querySelector("#session-tree");
		const sessionTitleEl = document.querySelector("#session-title");
		const sessionMetaEl = document.querySelector("#session-meta");
		const contentEl = document.querySelector("#content");
		const rawLogEl = document.querySelector("#raw-log");
		const composer = document.querySelector("#composer");
		const messageInput = document.querySelector("#message");
		const commandMenu = document.querySelector("#command-menu");
		const forkModal = document.querySelector("#fork-modal");
		const newSessionButton = document.querySelector("#new-session");
		let eventSource;
		let bootstrap;
		let selectedPiboSessionId;
		let area = "sessions";
		let pendingForkResult;
		let pendingForkComposerText;
		let showThinking = localStorage.getItem("pibo.chat.showThinking") === "true";
		let selectedAgentProfile = localStorage.getItem("pibo.chat.newSessionProfile") || "";
		let openNodes = new Set(JSON.parse(localStorage.getItem("pibo.chat.openNodes") || "[]"));
		let openSessionNodes = new Set();
		let commandIndex = 0;

		function saveOpenNodes() {
			localStorage.setItem("pibo.chat.openNodes", JSON.stringify(Array.from(openNodes)));
		}
		function escapeText(value) {
			return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
			});
		}
		function pretty(value) {
			if (value == null || value === "") return "";
			if (typeof value === "string") return value;
			try { return JSON.stringify(value, null, 2); } catch { return String(value); }
		}
		function short(value, n) {
			const text = String(value || "").replace(/\\s+/g, " ").trim();
			return text.length > n ? text.slice(0, n - 1) + "…" : text;
		}
		function nodeLabel(type) {
			return {
				"user.message": "User Message",
				"assistant.message": "Agent Message",
				"agent.turn": "Agent Turn",
				"model.reasoning": "Reasoning",
				"tool.call": "Tool Call",
				"tool.result": "Tool Result",
				"agent.delegation": "Agent Delegation",
				"agent.async": "Async Agent",
				"execution.command": "Execution Command",
				"yielded.run": "Yielded Run",
				"error": "Error"
			}[type] || type;
		}
		function nodeIcon(type) {
			return {
				"user.message": "U",
				"assistant.message": "A",
				"agent.turn": "R",
				"model.reasoning": "?",
				"tool.call": "T",
				"tool.result": "O",
				"agent.delegation": "D",
				"agent.async": "A",
				"execution.command": "$",
				"yielded.run": "Y",
				"error": "!"
			}[type] || "*";
		}
		function spanType(type) {
			return {
				"user.message": "user.prompt",
				"assistant.message": "model.response",
				"agent.turn": "agent.run",
				"model.reasoning": "model.reasoning",
				"tool.call": "tool.call",
				"tool.result": "tool.result",
				"agent.delegation": "agent.delegation",
				"agent.async": "agent.async",
				"execution.command": "tool.result",
				"yielded.run": "tool.call",
				"error": "tool.result"
			}[type] || "agent.run";
		}
		function spanLabel(type) {
			const mapped = spanType(type);
			return {
				"agent.run": "Agent Run",
				"tool.call": "Tool Call",
				"tool.result": "Tool Result",
				"model.response": "Model Response",
				"model.reasoning": "Reasoning",
				"agent.delegation": "Agent Delegation",
				"agent.async": "Async Agent",
				"user.prompt": "User Prompt"
			}[mapped] || mapped;
		}
		function spanStatusClass(status) {
			if (status === "error") return "error";
			if (status === "running") return "running";
			return "ok";
		}
		function renderJson(value) {
			return '<pre class="json-renderer">' + escapeText(pretty(value)) + '</pre>';
		}
		function functionSignature(name, args) {
			const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
			const params = Object.entries(input).map(function(entry) {
				const key = entry[0];
				const value = entry[1];
				const raw = typeof value === "string" ? "'" + short(value, 50) + "'" : short(pretty(value), 50);
				return '<span class="syntax-key">' + escapeText(key) + '</span>=<span class="syntax-string">' + escapeText(raw) + '</span>';
			}).join(", ");
			return '<code class="span-function"><span class="syntax-keyword">def</span> <span class="syntax-name">' + escapeText(name || "tool") + '</span>(' + params + ')</code>';
		}
		function renderSpanContent(node) {
			const actionHtml = [];
			if (node.type === "user.message" && node.entryId) actionHtml.push('<button class="ghost fork-button" data-entry-id="' + escapeText(node.entryId) + '">Fork From Here</button>');
			if (node.linkedPiboSessionId) actionHtml.push('<button class="ghost session-link" data-pibo-session-id="' + escapeText(node.linkedPiboSessionId) + '">Open Child Session</button>');
			const actions = actionHtml.length ? '<div class="span-actions">' + actionHtml.join("") + '</div>' : "";

			if (node.type === "user.message") {
				return actions + '<div class="span-quote">' + escapeText(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "assistant.message") {
				return actions + '<div class="span-section"><div class="span-section-title output">Structured Output</div>' + renderJson(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "model.reasoning") {
				return actions + '<div class="reasoning-block"><span class="reasoning-comment">// Model reasoning</span>\\n' + escapeText(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "tool.call" || node.type === "yielded.run") {
				return actions +
					'<div class="span-code-well">' + functionSignature(node.title, node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-output-summary"><span>Output:</span><code>' + escapeText(short(pretty(node.output), 120)) + '</code></div>' : "") +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "tool.result" || node.type === "execution.command") {
				return actions + '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output || node.input || "") + '</div>';
			}
			if (node.type === "agent.delegation") {
				return actions +
					'<div class="delegation-card"><div class="delegation-title">Agent Delegation · ' + escapeText(node.title || "subagent") + '</div><div class="delegation-query">' + escapeText(short(node.summary || pretty(node.input), 220)) + '</div></div>' +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "agent.async") {
				const input = node.input && typeof node.input === "object" ? node.input : {};
				const startedBy = input.startedBy || "pibo_run_start";
				const runId = input.runId || node.runId || "";
				return actions +
					'<div class="delegation-card"><div class="delegation-title">Async Agent · ' + escapeText(node.title || "subagent") + '</div><div class="delegation-query">Started by ' + escapeText(startedBy) + (runId ? ' · ' + escapeText(runId) : "") + '</div></div>' +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Run</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "error") {
				return actions + '<div class="span-section"><div class="span-section-title">Error</div>' + renderJson(node.error || node.output || "") + '</div>';
			}
			return actions + '<div class="span-section">' + renderJson(node.output || node.input || node.summary || "") + '</div>';
		}

		async function signIn() {
			const response = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "google", callbackURL: "/apps/chat", disableRedirect: true }),
			});
			const data = await response.json();
			if (!response.ok || !data.url) {
				renderSignedOut(data.message || data.error || "Could not start Google sign in.");
				return;
			}
			location.href = data.url;
		}

			async function clearAuthSession() {
				await fetch("/api/auth/sign-out", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: "{}",
				});
			}

			async function signOut() {
				await clearAuthSession();
				location.reload();
			}

			function renderSignedOut(message) {
				userEl.replaceChildren();
				sessionTreeEl.innerHTML = "";
				contentEl.innerHTML = '<div class="placeholder">' + escapeText(message || "Sign in to start a Pibo session.") + '</div>';
				composer.closest(".composer-wrap").classList.add("hidden");
				const button = document.createElement("button");
				button.className = "primary";
				button.textContent = "Sign in with Google";
				button.addEventListener("click", signIn);
				userEl.append(button);
				sessionTitleEl.textContent = "Signed Out";
				sessionMetaEl.textContent = "";
			}

			function renderSignedIn(data) {
				userEl.replaceChildren();
				const label = document.createElement("span");
				label.textContent = data.identity.email || data.identity.name || data.identity.userId;
				userEl.append(label);
				const button = document.createElement("button");
				button.textContent = "Sign out";
				button.addEventListener("click", signOut);
				userEl.append(button);
				composer.closest(".composer-wrap").classList.remove("hidden");
			}

		function connectEvents() {
			if (eventSource) eventSource.close();
			if (!selectedPiboSessionId) return;
			eventSource = new EventSource("/api/chat/events?piboSessionId=" + encodeURIComponent(selectedPiboSessionId));
			eventSource.addEventListener("pibo", (event) => {
				const payload = JSON.parse(event.data);
				appendRawEvent({ type: payload.type, payload });
				if (payload.type !== "TEXT_MESSAGE_CONTENT" && payload.type !== "REASONING_MESSAGE_CONTENT") {
					void refreshTrace();
				}
			});
			eventSource.onerror = () => appendRawEvent({ type: "stream_error", payload: "Event stream disconnected." });
		}

			async function loadSession() {
				const response = await fetch("/api/chat/bootstrap");
				if (response.status === 401) {
					renderSignedOut();
					return;
				}
				const data = await response.json();
				if (response.status === 403) {
					await clearAuthSession().catch(() => {});
					renderSignedOut("Not authorized. Sign in with an allowed Google account.");
					return;
				}
				if (!response.ok) {
					renderSignedOut(data.error || "Could not load session.");
					return;
				}
				bootstrap = data;
				selectedPiboSessionId = selectedPiboSessionId || data.selectedPiboSessionId;
				ensureSelectedAgentProfile();
				renderSignedIn(data);
				renderArea();
				connectEvents();
		}

		function ensureSelectedAgentProfile() {
			const agents = (bootstrap && bootstrap.agents) || [];
			if (!agents.length) return "";
			const exists = agents.some(function(agent) {
				return agent.name === selectedAgentProfile || (agent.aliases || []).includes(selectedAgentProfile);
			});
			if (!selectedAgentProfile || !exists) {
				selectedAgentProfile = bootstrap.session && bootstrap.session.profile || agents[0].name;
			}
			localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
			return selectedAgentProfile;
		}

		function renderArea() {
			document.querySelectorAll(".tab").forEach(function(tab) {
				tab.classList.toggle("active", tab.dataset.area === area);
			});
			document.querySelector("#sidebar-title").textContent = area[0].toUpperCase() + area.slice(1);
			newSessionButton.classList.toggle("hidden", area !== "sessions");
			if (area === "sessions") {
				renderSessions();
				void refreshTrace();
				return;
			}
			if (area === "agents") {
				renderAgents();
				return;
			}
			renderSettings();
		}
		function renderSessions() {
			sessionTreeEl.innerHTML = "";
			(bootstrap.sessions || []).forEach(function(node) { sessionTreeEl.append(renderSessionNode(node, 0)); });
		}
		function renderSessionNode(node, depth) {
			const children = node.children || [];
			const hasChildren = children.length > 0;
			if (sessionTreeHasSession(children, selectedPiboSessionId)) {
				openSessionNodes.add(node.piboSessionId);
			}
			const expanded = openSessionNodes.has(node.piboSessionId);
			const wrap = document.createElement("div");
			const row = document.createElement("div");
			row.className = "session-row" + (node.piboSessionId === selectedPiboSessionId ? " active" : "");
			row.style.paddingLeft = 8 + depth * 14 + "px";
			row.title = (node.title || "Untitled Session") + "\n" + node.piboSessionId;
			if (hasChildren) {
				const toggle = document.createElement("button");
				toggle.type = "button";
				toggle.className = "session-toggle";
				toggle.textContent = expanded ? "v" : ">";
				toggle.setAttribute("aria-expanded", String(expanded));
				toggle.setAttribute("aria-label", expanded ? "Collapse Subsessions" : "Expand Subsessions");
				toggle.title = expanded ? "Collapse Subsessions" : "Expand Subsessions";
				toggle.addEventListener("click", function() {
					if (openSessionNodes.has(node.piboSessionId)) openSessionNodes.delete(node.piboSessionId);
					else openSessionNodes.add(node.piboSessionId);
					renderSessions();
				});
				row.append(toggle);
			} else {
				row.append(document.createElement("span"));
			}
			const select = document.createElement("button");
			select.type = "button";
			select.className = "session-select";
			select.innerHTML =
				'<span><span class="session-title">' + escapeText(node.title) + '</span><span class="session-id">' + escapeText(node.piboSessionId) + '</span></span>' +
				'<span class="status-dot ' + escapeText(node.status) + '"></span>';
			select.addEventListener("click", function() { selectSession(node.piboSessionId); });
			row.append(select);
			wrap.append(row);
			if (expanded) children.forEach(function(child) { wrap.append(renderSessionNode(child, depth + 1)); });
			return wrap;
		}
		function sessionTreeHasSession(nodes, piboSessionId) {
			return (nodes || []).some(function(node) {
				return node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId);
			});
		}
		async function selectSession(piboSessionId) {
			selectedPiboSessionId = piboSessionId;
			connectEvents();
			await refreshBootstrap(false);
			renderArea();
		}
		async function createSession(profile) {
			const selectedProfile = profile || ensureSelectedAgentProfile();
			const created = await postJson("/api/chat/sessions", selectedProfile ? { profile: selectedProfile } : {});
			selectedPiboSessionId = created.session && created.session.id;
			connectEvents();
			await refreshBootstrap(false);
			renderArea();
		}
		async function refreshBootstrap(keepTrace) {
			const response = await fetch("/api/chat/bootstrap?piboSessionId=" + encodeURIComponent(selectedPiboSessionId || ""));
			if (!response.ok) return;
			bootstrap = await response.json();
			selectedPiboSessionId = bootstrap.selectedPiboSessionId;
			if (!keepTrace) renderSessions();
		}
		async function refreshTrace() {
			if (!selectedPiboSessionId) return;
			const response = await fetch("/api/chat/trace?piboSessionId=" + encodeURIComponent(selectedPiboSessionId) + "&includeRawEvents=true&rawEventsLimit=80");
			if (!response.ok) return;
			const trace = await response.json();
			sessionTitleEl.textContent = trace.title || selectedPiboSessionId;
			sessionMetaEl.textContent = trace.piboSessionId + " · " + trace.piSessionId;
			renderTrace(trace.nodes || []);
			renderRawEvents(trace.rawEvents || []);
		}
		function renderTrace(nodes) {
			const visible = nodes.filter(function(node) { return showThinking || node.type !== "model.reasoning"; });
			if (!visible.length) {
				contentEl.innerHTML = '<div class="placeholder">No trace events yet.</div>';
				return;
			}
			const list = document.createElement("div");
			list.className = "trace-list";
			visible.forEach(function(node) { list.append(renderTraceNode(node, 0)); });
			contentEl.replaceChildren(list);
		}
		function renderTraceNode(node, depth) {
			const wrapper = document.createElement("article");
			const mappedSpanType = spanType(node.type);
			wrapper.className = "span-card " + spanStatusClass(node.status) + (openNodes.has(node.id) ? " open" : "");
			wrapper.dataset.spanType = mappedSpanType;
			wrapper.dataset.nodeId = node.id;
			wrapper.style.marginLeft = Math.min(depth * 12, 96) + "px";
			const header = document.createElement("button");
			header.className = "span-header";
			const statusClass = node.status === "running" ? "running" : node.status === "error" ? "error" : "";
			header.innerHTML =
				'<span class="span-chevron">' + (openNodes.has(node.id) ? "v" : ">") + '</span>' +
				'<span class="span-icon">' + escapeText(nodeIcon(node.type)) + '</span>' +
				'<span><span class="span-type-label">' + escapeText(spanLabel(node.type)) + '</span><span class="span-title">' + escapeText(node.title || "") + (node.summary ? " · " + escapeText(short(node.summary, 160)) : "") + '</span></span>' +
				'<span class="span-meta"><span class="badge ' + statusClass + '">' + escapeText(node.status) + '</span></span>';
			header.addEventListener("click", function() {
				if (openNodes.has(node.id)) openNodes.delete(node.id); else openNodes.add(node.id);
				saveOpenNodes();
				wrapper.classList.toggle("open");
				header.querySelector(".span-chevron").textContent = wrapper.classList.contains("open") ? "v" : ">";
			});
			wrapper.append(header);
			const body = document.createElement("div");
			body.className = "span-body";
			body.innerHTML = renderSpanContent(node);
			body.querySelectorAll(".fork-button").forEach(function(button) {
				button.addEventListener("click", function(event) {
					event.stopPropagation();
					void forkFrom(button.dataset.entryId);
				});
			});
			body.querySelectorAll(".session-link").forEach(function(button) {
				button.addEventListener("click", function(event) {
					event.stopPropagation();
					void selectSession(button.dataset.piboSessionId);
				});
			});
			if (node.children && node.children.length) {
				const childWrap = document.createElement("div");
				childWrap.className = "children span-children";
				node.children.filter(function(child) { return showThinking || child.type !== "model.reasoning"; }).forEach(function(child) {
					childWrap.append(renderTraceNode(child, depth + 1));
				});
				body.append(childWrap);
			}
			wrapper.append(body);
			return wrapper;
		}
		function appendRawEvent(event) {
			const item = document.createElement("div");
			item.className = "raw-event";
			item.innerHTML = '<div class="raw-event-type">' + escapeText(event.type) + '</div><pre class="payload">' + escapeText(pretty(event.payload)) + '</pre>';
			rawLogEl.prepend(item);
		}
		function renderRawEvents(events) {
			rawLogEl.innerHTML = "";
			events.slice(-80).reverse().forEach(appendRawEvent);
		}
		function renderAgents() {
			sessionTitleEl.textContent = "Agents";
			sessionMetaEl.textContent = "Profile selection";
			const agents = (bootstrap && bootstrap.agents) || [];
			ensureSelectedAgentProfile();
			sessionTreeEl.innerHTML = agents.map(function(agent) {
				const active = agent.name === selectedAgentProfile ? " active" : "";
				return '<button class="session-row' + active + '" data-profile="' + escapeText(agent.name) + '"><span></span><span><span class="session-title">' + escapeText(agent.name) + '</span><span class="session-id">' + escapeText((agent.aliases || []).join(", ") || "profile") + '</span></span><span class="status-dot"></span></button>';
			}).join("");
			sessionTreeEl.querySelectorAll("[data-profile]").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					renderAgents();
				});
			});
			contentEl.innerHTML = '<div class="trace-list">' + agents.map(function(agent) {
				const selected = agent.name === selectedAgentProfile ? "selected" : "available";
				return '<article class="trace-node open" data-type="agent.turn"><div class="trace-header"><span class="trace-icon">A</span><span><span class="trace-label">' + escapeText(agent.name) + '</span><span class="trace-summary">' + escapeText(agent.description || "No description") + '</span></span><span class="trace-actions"><button class="ghost profile-select" data-profile="' + escapeText(agent.name) + '">' + selected + '</button><button class="ghost profile-create" data-profile="' + escapeText(agent.name) + '">New Session</button></span></div><div class="trace-body"><pre class="payload">' + escapeText(pretty(agent)) + '</pre></div></article>';
			}).join("") + '</div>';
			contentEl.querySelectorAll(".profile-select").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					renderAgents();
				});
			});
			contentEl.querySelectorAll(".profile-create").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					void createSession(selectedAgentProfile);
				});
			});
		}
		function renderSettings() {
			sessionTitleEl.textContent = "Settings";
			sessionMetaEl.textContent = "Browser-local V1 settings";
			sessionTreeEl.innerHTML = '<div class="placeholder">Settings navigation placeholder.</div>';
			contentEl.innerHTML = '<div class="placeholder">Thinking display and trace expansion state are stored in this browser.</div>';
		}
		function availableCommands() {
			const actions = (bootstrap && bootstrap.capabilities && bootstrap.capabilities.actions) || [];
			const commands = [];
			actions.forEach(function(action) {
				(action.slashCommands || []).forEach(function(command) {
					if (command !== "tree") commands.push({ slash: "/" + command, action: action.name, description: action.description || action.name });
				});
			});
			commands.push({ slash: "/thinking-show", action: "thinking-show", description: "Toggle historical thinking display in this browser." });
			return commands;
		}
		function renderCommandMenu() {
			const query = messageInput.value.trim();
			if (!query.startsWith("/")) { commandMenu.classList.add("hidden"); return; }
			const commands = availableCommands().filter(function(command) { return command.slash.startsWith(query.split(/\\s+/)[0]); });
			if (!commands.length) { commandMenu.classList.add("hidden"); return; }
			commandIndex = Math.min(commandIndex, commands.length - 1);
			commandMenu.innerHTML = "";
			commands.forEach(function(command, index) {
				const item = document.createElement("button");
				item.type = "button";
				item.className = "command-item" + (index === commandIndex ? " active" : "");
				item.innerHTML = '<span class="command-name">' + escapeText(command.slash) + '</span><span class="command-desc">' + escapeText(command.description) + '</span>';
				item.addEventListener("click", function() { void runCommand(command); });
				commandMenu.append(item);
			});
			commandMenu.classList.remove("hidden");
		}
		async function runCommand(command) {
			commandMenu.classList.add("hidden");
			const text = messageInput.value.trim();
			messageInput.value = "";
			if (command.action === "thinking-show") {
				showThinking = !showThinking;
				localStorage.setItem("pibo.chat.showThinking", String(showThinking));
				updateThinkingButton();
				await refreshTrace();
				return;
			}
			const commandArgs = text.slice(command.slash.length).trim();
			const params = command.action === "thinking" && commandArgs
				? { level: commandArgs.split(/\\s+/, 1)[0] }
				: command.action === "compact" && commandArgs
					? { customInstructions: commandArgs }
					: undefined;
			const result = await postJson("/api/chat/action", { piboSessionId: selectedPiboSessionId, action: command.action, params: params });
			appendRawEvent({ type: "command_result", payload: result });
			if (command.action === "session.clone" && result && result.result && result.result.piboSessionId) {
				await selectSession(result.result.piboSessionId);
			}
		}
		async function forkFrom(entryId) {
			const result = await postJson("/api/chat/action", { piboSessionId: selectedPiboSessionId, action: "session.fork", params: { entryId: entryId } });
			appendRawEvent({ type: "fork_result", payload: result });
			pendingForkResult = result && result.result ? result.result : undefined;
			const selectedText = pendingForkResult && typeof pendingForkResult.selectedText === "string" ? pendingForkResult.selectedText : undefined;
			if (pendingForkResult && pendingForkResult.piboSessionId) {
				await selectSession(pendingForkResult.piboSessionId);
			} else {
				await refreshBootstrap(false);
				await refreshTrace();
			}
			if (selectedText !== undefined) {
				messageInput.value = selectedText;
				messageInput.focus();
			}
		}
		async function postJson(url, payload) {
			const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
			const data = await response.json().catch(function() { return { error: "Request failed" }; });
			if (!response.ok) throw new Error(data.error || "Request failed");
			return data;
		}

		newSessionButton.addEventListener("click", function() { void createSession(); });
		composer.addEventListener("submit", async (event) => {
			event.preventDefault();
			const text = messageInput.value.trim();
			if (!text) return;
			const command = availableCommands().find(function(candidate) { return text.split(/\\s+/)[0] === candidate.slash; });
			if (text.startsWith("/") && command) {
				await runCommand(command);
				return;
			}
			messageInput.value = "";
			await postJson("/api/chat/message", { piboSessionId: selectedPiboSessionId, text: text });
			await refreshTrace();
		});
		messageInput.addEventListener("input", renderCommandMenu);
		messageInput.addEventListener("keydown", function(event) {
			if (commandMenu.classList.contains("hidden")) {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					composer.requestSubmit();
				}
				return;
			}
			const count = commandMenu.querySelectorAll(".command-item").length;
			if (event.key === "ArrowDown") { event.preventDefault(); commandIndex = (commandIndex + 1) % count; renderCommandMenu(); }
			if (event.key === "ArrowUp") { event.preventDefault(); commandIndex = (commandIndex - 1 + count) % count; renderCommandMenu(); }
			if (event.key === "Enter" && !event.shiftKey) {
				const item = commandMenu.querySelectorAll(".command-item")[commandIndex];
				if (item) { event.preventDefault(); item.click(); }
			}
		});
		document.querySelectorAll(".tab").forEach(function(tab) {
			tab.addEventListener("click", function() { area = tab.dataset.area; renderArea(); });
		});
		document.querySelector("#refresh").addEventListener("click", function() { void refreshBootstrap(false).then(renderArea); });
		document.querySelector("#clear-local").addEventListener("click", function() { rawLogEl.innerHTML = ""; });
		document.querySelector("#collapse-all").addEventListener("click", function() { openNodes.clear(); saveOpenNodes(); void refreshTrace(); });
		document.querySelector("#expand-all").addEventListener("click", function() {
			contentEl.querySelectorAll(".span-card").forEach(function(node) {
				if (node.dataset.nodeId) openNodes.add(node.dataset.nodeId);
				node.classList.add("open");
				const chevron = node.querySelector(".span-chevron");
				if (chevron) chevron.textContent = "v";
			});
			saveOpenNodes();
		});
		document.querySelector("#expand-one").addEventListener("click", function() {
			openNodes.clear();
			contentEl.querySelectorAll(".trace-list > .span-card").forEach(function(node) {
				if (node.dataset.nodeId) openNodes.add(node.dataset.nodeId);
				node.classList.add("open");
				const chevron = node.querySelector(".span-chevron");
				if (chevron) chevron.textContent = "v";
			});
			saveOpenNodes();
		});
		function updateThinkingButton() {
			document.querySelector("#thinking-toggle").textContent = showThinking ? "Thinking On" : "Thinking Off";
		}
		document.querySelector("#thinking-toggle").addEventListener("click", async function() {
			showThinking = !showThinking;
			localStorage.setItem("pibo.chat.showThinking", String(showThinking));
			updateThinkingButton();
			await refreshTrace();
		});
		document.querySelector("#fork-stay").addEventListener("click", function() {
			forkModal.classList.add("hidden");
			const previousFile = pendingForkResult && pendingForkResult.previous && pendingForkResult.previous.sessionFile;
			const targetPiboSessionId = pendingForkResult && pendingForkResult.piboSessionId ? pendingForkResult.piboSessionId : selectedPiboSessionId;
			pendingForkResult = undefined;
			messageInput.value = pendingForkComposerText || "";
			pendingForkComposerText = undefined;
			if (previousFile) {
				void postJson("/api/chat/action", { piboSessionId: targetPiboSessionId, action: "session.switch", params: { sessionFile: previousFile } })
					.then(function(result) { appendRawEvent({ type: "fork_restore", payload: result }); return refreshTrace(); })
					.catch(function(error) { appendRawEvent({ type: "fork_restore_error", payload: String(error) }); });
			}
		});
		document.querySelector("#fork-switch").addEventListener("click", async function() {
			forkModal.classList.add("hidden");
			const targetPiboSessionId = pendingForkResult && pendingForkResult.piboSessionId ? pendingForkResult.piboSessionId : selectedPiboSessionId;
			pendingForkResult = undefined;
			pendingForkComposerText = undefined;
			if (targetPiboSessionId) await selectSession(targetPiboSessionId);
		});

		updateThinkingButton();
		loadSession();
	</script>
</body>
</html>`;
}
