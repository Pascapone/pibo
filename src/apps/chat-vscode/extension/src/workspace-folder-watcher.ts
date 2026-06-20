import * as vscode from "vscode";
import {
	canonicalizePath,
	resolveRoomForWorkspace,
	type CookieSource,
	type RoomResolution,
} from "./room-resolver";
import type { WebviewProvider } from "./webview-host";

export type WatcherOptions = {
	baseUrl: string;
	webviewProvider: WebviewProvider;
	/**
	 * Optional dev-auth cookie source. When provided, the resolver
	 * attaches the cookie so the gateway can identify the request.
	 */
	cookieSource?: CookieSource;
};

const STATE_KEY_ROOM_ID = "pibo-vscode.activeRoomId";
const STATE_KEY_WORKSPACE = "pibo-vscode.activeWorkspace";

export function createWorkspaceFolderWatcher(
	context: vscode.ExtensionContext,
	options: WatcherOptions,
): vscode.Disposable {
	const handle = async (folder: string | undefined): Promise<void> => {
		if (!folder) {
			await context.workspaceState.update(STATE_KEY_ROOM_ID, undefined);
			await context.workspaceState.update(STATE_KEY_WORKSPACE, undefined);
			return;
		}
		const canonical = await canonicalizePath(folder);
		let resolution: RoomResolution;
		try {
			resolution = await resolveRoomForWorkspace(options.baseUrl, canonical, {
				cookieSource: options.cookieSource,
			});
		} catch (caught) {
			vscode.window.showErrorMessage(`Pibo: failed to resolve room: ${caught instanceof Error ? caught.message : String(caught)}`);
			return;
		}
		if (resolution.kind === "single") {
			await context.workspaceState.update(STATE_KEY_ROOM_ID, resolution.room.id);
			await context.workspaceState.update(STATE_KEY_WORKSPACE, canonical);
			options.webviewProvider.pushSelectorMode({ kind: "sessions", roomId: resolution.room.id });
		} else {
			await context.workspaceState.update(STATE_KEY_WORKSPACE, canonical);
			await context.workspaceState.update(STATE_KEY_ROOM_ID, undefined);
			options.webviewProvider.pushSelectorMode({
				kind: "rooms",
				candidates: resolution.rooms,
				workspace: resolution.workspace,
			});
		}
	};

	const initial = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (initial) void handle(initial);

	const subscription = vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
		if (event.added.length > 0) {
			await handle(event.added[0].uri.fsPath);
		} else if (event.removed.length > 0) {
			await handle(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
		}
	});

	return subscription;
}
