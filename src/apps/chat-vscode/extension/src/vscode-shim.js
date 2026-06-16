// Minimal runtime shim for the `vscode` module. Only loaded when the
// extension code is exercised outside a real VS Code extension host
// (i.e. in `node --test` unit tests). In production, the real
// `vscode` module is provided by the VS Code extension host and
// the `--external:vscode` flag in the esbuild config prevents this
// file from being bundled.

import { EventEmitter } from "node:events";

class Uri {
	constructor(value) {
		this.value = value;
		const url = new URL(value);
		this.fsPath = url.pathname;
		this.toString = () => value;
	}
}

function parseUri(value) {
	return new Uri(value);
}

class Memento {
	constructor() {
		this.store = new Map();
	}
	get(key) {
		return this.store.get(key);
	}
	async update(key, value) {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
	}
}

class Disposable {
	constructor(call) {
		this.call = call;
	}
	dispose() {
		if (this.call) this.call();
	}
}

function disposableFrom(...items) {
	return new Disposable(() => {
		for (const item of items) {
			if (item && typeof item.dispose === "function") item.dispose();
		}
	});
}

const subscriptions = [];

const workspace = {
	workspaceFolders: undefined,
	onDidChangeWorkspaceFolders: new EventEmitter(),
	getConfiguration: () => ({
		get: () => undefined,
		has: () => false,
	}),
};

const window = {
	registerWebviewViewProvider: () => new Disposable(),
	showErrorMessage: async () => undefined,
	showWarningMessage: async () => undefined,
	showInformationMessage: async () => undefined,
	showQuickPick: async () => undefined,
	createTerminal: () => ({
		show: () => undefined,
		hide: () => undefined,
		sendText: () => undefined,
		dispose: () => undefined,
	}),
};

const commands = {
	registerCommand: () => new Disposable(),
	executeCommand: async () => undefined,
};

const env = {
	openExternal: async () => true,
};

class ExtensionContext {
	constructor() {
		this.subscriptions = subscriptions;
		this.workspaceState = new Memento();
		this.globalState = new Memento();
		this.extensionPath = "/tmp/pibo-vscode-shim";
	}
}

export {
	Disposable,
	ExtensionContext,
	Uri,
	commands,
	disposableFrom,
	env,
	parseUri,
	window,
	workspace,
};
