import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { createAuthBridge, type AuthBridge } from "./auth-bridge";
import { createSidecarAuthBridge } from "./sidecar-auth";
import { createWebviewHost } from "./webview-host";
import { createWorkspaceFolderWatcher } from "./workspace-folder-watcher";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration("pibo");
	const baseUrl = (config.get<string>("chatWebUrl") ?? "http://127.0.0.1:4788").replace(/\/$/, "");

	// Construct a single dev-auth cookie bridge at activation time so the
	// session cookie survives webview dispose/re-render cycles and is
	// available to the room resolver before any webview has been resolved.
	const sidecarAuthBridge = createSidecarAuthBridge({ gatewayBaseUrl: baseUrl });
	context.subscriptions.push({ dispose: () => sidecarAuthBridge.reset() });

	const cookieSource = {
		getCookieHeader: () => sidecarAuthBridge.getCookieHeader(),
	};

	const webviewProvider = createWebviewHost(context, {
		baseUrl,
		cookieSource,
	});
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("pibo.sessionPanel", webviewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	const workspaceWatcher = createWorkspaceFolderWatcher(context, {
		baseUrl,
		webviewProvider,
		cookieSource,
	});
	context.subscriptions.push(workspaceWatcher);

	const authBridge: AuthBridge = createAuthBridge({ baseUrl });
	context.subscriptions.push(authBridge);

	registerCommands(context, { baseUrl, webviewProvider, authBridge });
}

export function deactivate(): void {
	// Subscriptions are disposed automatically by VS Code.
}
