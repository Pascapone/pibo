import * as vscode from "vscode";
import type { PiboRoom } from "../../../chat/types/rooms.js";
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
};

export type WebviewProvider = vscode.WebviewViewProvider & {
	resolveRoom(baseUrl: string, folder: string): Promise<void>;
	pushSelectorMode(mode: SelectorMode): void;
	getCurrentRoomId(): string | null;
	getCurrentWorkspace(): string | null;
};

const STATE_KEY_ROOM_ID = "pibo-vscode.activeRoomId";
const STATE_KEY_WORKSPACE = "pibo-vscode.activeWorkspace";

export function createWebviewHost(
	context: vscode.ExtensionContext,
	options: WebviewProviderOptions,
): WebviewProvider {
	let webviewView: vscode.WebviewView | null = null;
	let pendingMessages: HostToWebViewMessage[] = [];

	const flush = (): void => {
		if (!webviewView) return;
		for (const message of pendingMessages) {
			webviewView.webview.postMessage(message);
		}
		pendingMessages = [];
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
			webviewView = view;
			view.webview.options = {
				enableScripts: true,
				retainContextWhenHidden: true,
			};

			const folders = vscode.workspace.workspaceFolders ?? [];
			const folder = folders[0]?.uri.fsPath;
			const cachedRoomId = context.workspaceState.get<string>(STATE_KEY_ROOM_ID);
			const cachedWorkspace = context.workspaceState.get<string>(STATE_KEY_WORKSPACE);

			const url = new URL(`${options.baseUrl}/apps/chat-vscode/`);
			if (folder) url.searchParams.set("workspace", folder);
			if (cachedRoomId && (!folder || cachedWorkspace === folder)) {
				url.searchParams.set("roomId", cachedRoomId);
			}

			const nonce = generateNonce();
			view.webview.html = buildWebviewShellHtml({
				healthUrl: `${options.baseUrl}${GATEWAY_HEALTH_PATH}`,
				targetUrl: url.toString(),
				baseUrl: options.baseUrl,
				command: EMPTY_STATE_COMMAND,
				nonce,
			});

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

			flush();
		},
	};

	return provider;
}
