// Minimal local type stub for the `vscode` module so the extension host
// code can be typechecked outside a VS Code extension host. The real types
// come from @types/vscode when packaged; this file just covers the surface
// our extension code touches.

declare module "vscode" {
	export class Uri {
		static parse(value: string): Uri;
		fsPath: string;
		toString(): string;
	}

	export type ConfigurationScope = "application" | "machine" | "window" | "resource" | "workspace";
	export type ConfigurationTarget = boolean | ConfigurationScope | { id?: string; scope?: ConfigurationScope };

	export interface Webview {
		html: string;
		options: WebviewOptions;
		/**
		 * A unique origin string (e.g. `vscode-webview://abc123...`) that
		 * VS Code assigns to this webview. Recommended to be included in
		 * the meta CSP `script-src` and `style-src` lists so the merged
		 * CSP stays valid on VS Code versions that prepend their own
		 * default CSP. See https://code.visualstudio.com/api/extension-guides/webview#content-security-policy
		 */
		cspSource: string;
		postMessage(message: unknown): Thenable<boolean>;
		onDidReceiveMessage: { (listener: (message: unknown) => unknown): { dispose(): unknown } };
	}

	export interface WebviewView {
		webview: Webview;
		visible: boolean;
	}

	export interface WebviewOptions {
		enableScripts?: boolean;
		retainContextWhenHidden?: boolean;
		localResourceRoots?: readonly Uri[];
	}

	export interface WebviewViewProvider {
		resolveWebviewView?(webviewView: WebviewView): void | Promise<void>;
	}

	export interface WebviewViewProviderOptions {
		webviewOptions?: WebviewOptions;
	}

	export interface WorkspaceFolder {
		uri: Uri;
		name: string;
		index: number;
	}

	export interface Memento {
		get<T>(key: string): T | undefined;
		update(key: string, value: unknown): Promise<void>;
	}

	export interface ExtensionContext {
		subscriptions: { push(...items: { dispose(): unknown }[]): void };
		workspaceState: Memento;
		globalState: Memento;
		extensionPath: string;
		storagePath?: string;
	}

	export interface WorkspaceConfiguration {
		get<T>(key: string): T | undefined;
		has(key: string): boolean;
	}

	export interface QuickPickOptions {
		title?: string;
		placeHolder?: string;
	}

	export interface TerminalOptions {
		name?: string;
		cwd?: string;
		env?: { [key: string]: string | null | undefined };
	}

	export interface Terminal {
		show(preserveFocus?: boolean): void;
		hide(): void;
		sendText(text: string, addNewLine?: boolean): void;
		dispose(): void;
	}

	export interface Event<T> {
		(listener: (e: T) => unknown): { dispose(): unknown };
	}

	export interface Window {
		registerWebviewViewProvider(id: string, provider: WebviewViewProvider, options?: WebviewViewProviderOptions): { dispose(): unknown };
		showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
		showQuickPick<T extends string>(items: readonly T[] | Thenable<readonly T[]>, options?: QuickPickOptions): Promise<T | undefined>;
		createTerminal(options: TerminalOptions): Terminal;
	}

	export interface Workspace {
		workspaceFolders?: readonly WorkspaceFolder[];
		onDidChangeWorkspaceFolders: Event<{ added: readonly WorkspaceFolder[]; removed: readonly WorkspaceFolder[] }>;
		getConfiguration(section?: string): WorkspaceConfiguration;
	}

	export interface Commands {
		registerCommand(id: string, callback: (...args: unknown[]) => unknown): { dispose(): unknown };
		executeCommand<T = unknown>(command: string, ...rest: unknown[]): Promise<T | undefined>;
	}

	export interface Disposable {
		dispose(): unknown;
	}

	export const env: { openExternal(uri: Uri): Promise<boolean> };
	export const window: Window;
	export const workspace: Workspace;
	export const commands: Commands;
}
