import * as vscode from "vscode";
import type { PiboRoom } from "../../../chat/types/rooms.js";
import { buildInlinedChatHtml } from "./inlined-chat-html";
import {
	createSidecar,
	type Sidecar,
	type SidecarLogger,
} from "./sidecar";
import { createSidecarAuthBridge, type SidecarAuthBridge } from "./sidecar-auth";
import {
	buildWebviewShellHtml,
	EMPTY_STATE_COMMAND,
	GATEWAY_HEALTH_PATH,
	generateNonce,
} from "./webview-shell";

export type SelectorMode =
	| { kind: "sessions"; roomId: string }
	| { kind: "rooms"; candidates: readonly PiboRoom[]; workspace: string };

export type HostToWebViewMessage =
	| { type: "pibo/set-selector-mode"; mode: SelectorModeForWeb }
	| { type: "pibo/refresh-bootstrap" };

export type WebViewToHostMessage =
	| { type: "pibo/select-room"; roomId: string }
	| { type: "pibo/open-external"; uri: string }
	| { type: "pibo/refresh-bootstrap-request" }
	| { type: "pibo/open-terminal"; command: string };

type SelectorModeForWeb =
	| { kind: "sessions"; roomId: string; sessions: readonly unknown[]; selectedPiboSessionId: string | null }
	| { kind: "rooms"; candidates: readonly PiboRoom[]; workspace: string };

export type WebviewProviderOptions = {
	baseUrl: string;
	/**
	 * Override factory for the sidecar. Defaults to `createSidecar`.
	 * Tests use this to inject a mock.
	 */
	createSidecarImpl?: (options: SidecarOptionsForHost) => Sidecar;
	/**
	 * Override factory for the auth bridge. Defaults to
	 * `createSidecarAuthBridge`. Tests use this to inject a mock.
	 */
	createAuthBridgeImpl?: (options: { gatewayBaseUrl: string; fetchImpl?: typeof fetch }) => SidecarAuthBridge;
	/**
	 * Logger for sidecar diagnostics. Defaults to a no-op logger in
	 * production so we never accidentally spam the Extension-Host
	 * output channel.
	 */
	sidecarLogger?: SidecarLogger;
};

type SidecarOptionsForHost = {
	gatewayBaseUrl: string;
	sidecarPort?: number;
	webviewId: string;
	healthProbeTimeoutMs?: number;
	logger?: SidecarLogger;
	authBridge?: SidecarAuthBridge;
};

export type WebviewProvider = vscode.WebviewViewProvider & {
	resolveRoom(baseUrl: string, folder: string): Promise<void>;
	pushSelectorMode(mode: SelectorMode): void;
	getCurrentRoomId(): string | null;
	getCurrentWorkspace(): string | null;
};

const STATE_KEY_ROOM_ID = "pibo-vscode.activeRoomId";
const STATE_KEY_WORKSPACE = "pibo-vscode.activeWorkspace";

/**
 * Parse VS Code's `vscode-webview://<uuid>/` style CSP source into its
 * `<webviewId>` component. Used to build the port-mapped origin
 * `https://<webviewId>.vscode-resource.vscode-cdn.net:<port>` that
 * the workbench's `connect-src` allowlists for fetch and
 * EventSource traffic.
 */
function webviewIdFromCspSource(cspSource: string): string {
	const match = cspSource.match(/^vscode-webview:\/\/([^/]+)\/?$/);
	if (!match) {
		throw new Error(`unexpected webview cspSource: ${cspSource}`);
	}
	return match[1];
}

export function createWebviewHost(
	context: vscode.ExtensionContext,
	options: WebviewProviderOptions,
): WebviewProvider {
	let webviewView: vscode.WebviewView | null = null;
	let activeSidecar: Sidecar | null = null;
	let activeDispose: vscode.Disposable | null = null;
	let pendingMessages: HostToWebViewMessage[] = [];

	const createSidecarImpl = options.createSidecarImpl ?? ((opts: SidecarOptionsForHost) => createSidecar(opts));
	const createAuthBridgeImpl =
		options.createAuthBridgeImpl ??
		((opts: { gatewayBaseUrl: string; fetchImpl?: typeof fetch }) => createSidecarAuthBridge(opts));
	const sidecarLogger = options.sidecarLogger ?? silentSidecarLogger();

	const flush = (): void => {
		if (!webviewView) return;
		for (const message of pendingMessages) {
			webviewView.webview.postMessage(message);
		}
		pendingMessages = [];
	};

	const stopActiveSidecar = async (): Promise<void> => {
		if (!activeSidecar) return;
		const sidecar = activeSidecar;
		activeSidecar = null;
		try {
			await sidecar.stop();
		} catch (err) {
			sidecarLogger.warn(
				`sidecar.stop() failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	const provider: WebviewProvider = {
		resolveRoom: async (_baseUrl: string, folder: string) => {
			// Resolution is delegated to the workspace-folder-watcher; this method
			// exists for symmetry with the public API surface.
			void folder;
		},
		pushSelectorMode: (mode: SelectorMode) => {
			const message: HostToWebViewMessage = { type: "pibo/set-selector-mode", mode: mode as SelectorModeForWeb };
			if (webviewView) {
				webviewView.webview.postMessage(message);
			} else {
				pendingMessages.push(message);
			}
		},
		getCurrentRoomId: () => context.workspaceState.get<string>(STATE_KEY_ROOM_ID) ?? null,
		getCurrentWorkspace: () => context.workspaceState.get<string>(STATE_KEY_WORKSPACE) ?? null,

		async resolveWebviewView(view: vscode.WebviewView) {
			// Defensive cleanup if a previous webview session left a sidecar
			// running. This can happen when VS Code re-resolves the view
			// without firing `onDidDispose` first (e.g. after a window reload).
			await stopActiveSidecar();
			webviewView = view;
			view.webview.options = {
				enableScripts: true,
				retainContextWhenHidden: true,
			};

			const folders = vscode.workspace.workspaceFolders ?? [];
			const folder = folders[0]?.uri.fsPath;
			const cachedRoomId = context.workspaceState.get<string>(STATE_KEY_ROOM_ID);
			const cachedWorkspace = context.workspaceState.get<string>(STATE_KEY_WORKSPACE);

			const nonce = generateNonce();
			const cspSource = view.webview.cspSource;

			// 1. Start the sidecar so we have a port to embed in the
			//    port-mapping, the meta CSP, and the `<base>` href.
			let sidecar: Sidecar;
			try {
				const webviewId = webviewIdFromCspSource(cspSource);
				const authBridge = createAuthBridgeImpl({ gatewayBaseUrl: options.baseUrl });
				sidecar = createSidecarImpl({
					gatewayBaseUrl: options.baseUrl,
					webviewId,
					authBridge,
					logger: sidecarLogger,
				});
				await sidecar.start();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				sidecarLogger.error(`sidecar failed to start: ${message}`);
				// Fall back to the empty-state shell with a clear error.
				view.webview.html = renderShellHtml({
					baseUrl: options.baseUrl,
					folder: folder ?? null,
					roomId: cachedRoomId ?? null,
					workspace: cachedWorkspace,
					nonce,
					cspSource,
				});
				view.webview.html = injectShellDiagnostic(view.webview.html, message);
				attachMessageHandler(view, provider, context);
				flush();
				return;
			}
			activeSidecar = sidecar;

			// 2. Configure port-mapping so the workbench routes
			//    `https://<webviewId>.vscode-resource.vscode-cdn.net:<port>`
			//    through to our 127.0.0.1 listener.
			view.webview.options = {
				...view.webview.options,
				portMapping: [
					{ webviewPort: sidecar.port(), extensionHostPort: sidecar.port() },
				],
			};

			// 3. Probe the gateway. If reachable, serve the inlined
			//    chat-vscode bundle. Otherwise fall back to the empty
			//    state so the user can still start the gateway.
			const healthy = await sidecar.isHealthy();
			if (healthy) {
				try {
					const inlined = buildInlinedChatHtml({
						extensionPath: context.extensionPath,
						portMappedOrigin: sidecar.getOrigin(),
						cspSource,
						nonce,
					});
					// Append workspace / roomId to the inlined HTML's <base>
					// href so the SPA's router sees them in window.location.
					view.webview.html = appendQueryToBaseHref(inlined.html, {
						workspace: folder,
						roomId: cachedRoomId && (!folder || cachedWorkspace === folder) ? cachedRoomId : null,
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					sidecarLogger.error(`inlined HTML build failed: ${message}`);
					view.webview.html = injectShellDiagnostic(renderShellHtml({
						baseUrl: options.baseUrl,
						folder: folder ?? null,
						roomId: cachedRoomId ?? null,
						workspace: cachedWorkspace,
						nonce,
						cspSource,
					}), `Inlined bundle unavailable: ${message}`);
				}
			} else {
				view.webview.html = renderShellHtml({
					baseUrl: options.baseUrl,
					folder: folder ?? null,
					roomId: cachedRoomId ?? null,
					workspace: cachedWorkspace,
					nonce,
					cspSource,
				});
			}

			// 4. Wire up message handling. The sidecar is bound to the
			//    webview's lifetime via `onDidDispose` below.
			attachMessageHandler(view, provider, context);
			activeDispose = { dispose: () => void stopActiveSidecar() };
			view.onDidDispose?.(() => {
				activeDispose?.dispose();
				activeDispose = null;
				webviewView = null;
			});

			flush();
		},
	};

	return provider;
}

function renderShellHtml(args: {
	baseUrl: string;
	folder: string | null;
	roomId: string | null;
	workspace: string | undefined;
	nonce: string;
	cspSource: string;
}): string {
	const { baseUrl, folder, roomId, workspace, nonce, cspSource } = args;
	const targetUrl = new URL(`${baseUrl}/apps/chat-vscode/`);
	if (folder) targetUrl.searchParams.set("workspace", folder);
	if (roomId && (!folder || workspace === folder)) targetUrl.searchParams.set("roomId", roomId);
	return buildWebviewShellHtml({
		healthUrl: `${baseUrl}${GATEWAY_HEALTH_PATH}`,
		targetUrl: targetUrl.toString(),
		baseUrl,
		command: EMPTY_STATE_COMMAND,
		nonce,
		cspSource,
	});
}

/**
 * Inject a short diagnostic line into the empty-state shell. The
 * existing shell already has a `#status` element that the boot script
 * updates, so we add an adjacent `<p>` that the user can see
 * immediately.
 */
function injectShellDiagnostic(html: string, diagnostic: string): string {
	const safe = diagnostic
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const block = `<p id="pibo-sidecar-diagnostic" data-pibo-sidecar-error="true" style="margin-top:8px;font-size:11.5px;color:var(--vscode-errorForeground);">${safe}</p>`;
	return html.replace(
		'<p id="status">',
		`${block}\n  <p id="status">`,
	);
}

/**
 * Add `?workspace=...&roomId=...` to the inlined HTML's `<base>` href
 * so the chat-vscode SPA's router picks up the room selection from
 * `window.location.search`. We must do this AFTER `buildInlinedChatHtml`
 * because the inliner cannot know the workspace / roomId.
 */
function appendQueryToBaseHref(
	html: string,
	query: { workspace?: string | null; roomId?: string | null },
): string {
	const params = new URLSearchParams();
	if (query.workspace) params.set("workspace", query.workspace);
	if (query.roomId) params.set("roomId", query.roomId);
	if (params.size === 0) return html;
	const suffix = params.toString();
	return html.replace(/<base href="([^"]+)"\s*\/>/, (_match, baseHref) => {
		const separator = baseHref.includes("?") ? "&" : "?";
		const nextHref = `${baseHref.replace(/\/$/, "")}${separator}${suffix}`;
		return `<base href="${nextHref}" />`;
	});
}

function attachMessageHandler(
	view: vscode.WebviewView,
	provider: WebviewProvider,
	context: vscode.ExtensionContext,
): void {
	view.webview.onDidReceiveMessage(async (raw: unknown) => {
		const message = raw as WebViewToHostMessage;
		if (!message || typeof message !== "object") return;
		if (message.type === "pibo/select-room") {
			await context.workspaceState.update(STATE_KEY_ROOM_ID, message.roomId);
		} else if (message.type === "pibo/open-external") {
			if (typeof message.uri === "string" && /^https?:\/\//.test(message.uri)) {
				await vscode.env.openExternal(vscode.Uri.parse(message.uri));
			}
		} else if (message.type === "pibo/refresh-bootstrap-request") {
			provider.pushSelectorMode({ kind: "sessions", roomId: provider.getCurrentRoomId() ?? "" });
		} else if (message.type === "pibo/open-terminal") {
			if (typeof message.command === "string" && message.command.length > 0) {
				const term = vscode.window.createTerminal({ name: "Pibo Gateway" });
				term.show();
				term.sendText(message.command);
			}
		}
	});
}

function silentSidecarLogger(): SidecarLogger {
	const noop = (): void => undefined;
	return { info: noop, warn: noop, error: noop, debug: noop };
}
