/**
 * Types and constants for the `pibo vscode` sub-command.
 *
 * The pibo VS Code extension is a thin VS Code client that opens a WebView
 * pointing at the gateway-served chat-vscode-web app. The extension itself
 * ships as a `.vsix` artifact, published to the VS Code Marketplace and
 * mirrored on GitHub Releases.
 */

export const PIBO_VSCODE_EXTENSION_PUBLISHER = "pibo";
export const PIBO_VSCODE_EXTENSION_NAME = "pibo-vscode";
export const PIBO_VSCODE_EXTENSION_ID = `${PIBO_VSCODE_EXTENSION_PUBLISHER}.${PIBO_VSCODE_EXTENSION_NAME}`;

export const DEFAULT_GITHUB_OWNER = "Pascapone";
export const DEFAULT_GITHUB_REPO = "pibo";

export const PIBO_VSCODE_CACHE_DIR = "vscode";

export type GitHubReleaseAsset = {
	name: string;
	browserDownloadUrl: string;
	size: number;
	contentType: string;
};

export type GitHubRelease = {
	tagName: string;
	name: string;
	publishedAt: string;
	htmlUrl: string;
	assets: GitHubReleaseAsset[];
};

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SpawnLike = typeof import("node:child_process").spawn;

export type VsixFetchResult = {
	tagName: string;
	asset: GitHubReleaseAsset;
	bytes: Buffer;
};

export type InstallResult =
	| { status: "installed"; tagName: string; vsixPath: string; codeBinary: string }
	| { status: "already-installed"; tagName: string; codeBinary: string }
	| { status: "failed"; reason: string; tagName?: string; codeBinary?: string };

export type UninstallResult =
	| { status: "uninstalled"; codeBinary: string }
	| { status: "not-installed"; codeBinary: string }
	| { status: "failed"; reason: string; codeBinary?: string };

export type ExtensionStatus = {
	installed: boolean;
	version: string | undefined;
	codeBinary: string | undefined;
	vsixCacheDir: string;
	availableReleases: string[];
};
