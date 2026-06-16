// Inliner for the chat-vscode Vite bundle.
//
// The VS Code webview's workbench CSP only allows JS to run from
// `<script nonce="...">...</script>` tags inside the webview's own
// HTML, and only allows CSS to be applied from inline `<style>` blocks
// (or from `vscode-webview:` sources). It does not allow external
// `<script src="...">` or `<link rel="stylesheet" href="...">` tags
// to load from a different origin.
//
// To run the existing Vite-bundled React SPA inside the webview, we
// read the bundle (`index.html`, the hashed JS file, and the hashed
// CSS file) from disk, inline the script and the stylesheet, and emit
// a single HTML string that the webview can host as its `html`
// property. The `<base href="...">` tag points all relative URLs
// (including the `/api/...` calls in the SPA) at the port-mapped
// origin, so the sidecar handles them.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_BUNDLE_RELATIVE_DIR = "dist/chat-vscode-web";

export type InlinedChatHtmlOptions = {
	/**
	 * Absolute path to the extension's installation directory (the
	 * `context.extensionPath` value passed in by VS Code). The
	 * chat-vscode bundle is read from a fixed subdirectory inside
	 * this path.
	 */
	extensionPath: string;
	/**
	 * Path of the sidecar's port-mapped origin, including the
	 * `https://<webviewId>.vscode-resource.vscode-cdn.net:<port>`
	 * portion. Used as the `<base href="...">` value and to build
	 * absolute asset URLs.
	 */
	portMappedOrigin: string;
	/**
	 * VS Code webview CSP source (e.g. `vscode-webview://<uuid>/`).
	 * Added to the meta CSP for defense in depth so the merged CSP
	 * stays valid on VS Code versions that prepend their own default
	 * CSP.
	 */
	cspSource: string;
	/**
	 * URL-safe base64 CSP nonce. Must match the value on every inline
	 * script that needs to run.
	 */
	nonce: string;
	/**
	 * Subdirectory of the extension installation that contains the
	 * prebuilt Vite output. Defaults to `dist/chat-vscode-web`, which
	 * is the path that `vscode-build.mjs` copies the bundle into
	 * before packaging the VSIX.
	 */
	bundleRelativeDir?: string;
};

export type InlinedChatHtml = {
	html: string;
	/**
	 * For diagnostics: the asset paths that were inlined into the
	 * document. Useful when verifying that the inliner picked up the
	 * current Vite output.
	 */
	inlined: {
		javascript: string;
		css: string;
	};
	/**
	 * The absolute base href that the inlined HTML will use.
	 */
	baseHref: string;
};

/**
 * Read the Vite-bundled chat-vscode app and emit a single HTML string
 * with the JS and CSS inlined as `<script nonce="...">` and
 * `<style>` blocks. Throws if the bundle cannot be read.
 */
export function buildInlinedChatHtml(options: InlinedChatHtmlOptions): InlinedChatHtml {
	const bundleDir = resolve(
		options.extensionPath,
		options.bundleRelativeDir ?? DEFAULT_BUNDLE_RELATIVE_DIR,
	);
	const indexPath = resolve(bundleDir, "index.html");
	if (!existsSync(indexPath)) {
		throw new Error(`chat-vscode bundle index.html not found at ${indexPath}`);
	}
	const source = readFileSync(indexPath, "utf8");

	const scriptAsset = findAsset(source, /<script\s+[^>]*src="([^"]+)"[^>]*>/i);
	const cssAsset = findAsset(source, /<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i);
	if (!scriptAsset) {
		throw new Error(`chat-vscode bundle is missing a <script src="..."> tag in ${indexPath}`);
	}
	if (!cssAsset) {
		throw new Error(`chat-vscode bundle is missing a <link rel="stylesheet" href="..."> tag in ${indexPath}`);
	}

	const scriptPath = resolveBundleAssetPath(bundleDir, scriptAsset);
	const cssPath = resolveBundleAssetPath(bundleDir, cssAsset);
	if (!scriptPath) {
		throw new Error(`chat-vscode bundle script not found (asset hint: ${scriptAsset})`);
	}
	if (!cssPath) {
		throw new Error(`chat-vscode bundle stylesheet not found (asset hint: ${cssAsset})`);
	}

	const scriptBody = escapeScriptBody(readFileSync(scriptPath, "utf8"));
	const cssBody = escapeStyleBody(readFileSync(cssPath, "utf8"));

	const baseHref = `${options.portMappedOrigin.replace(/\/$/, "")}/`;
	const metaCsp = buildMetaCsp(options.cspSource, options.portMappedOrigin);

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width" />
<meta http-equiv="Content-Security-Policy" content="${metaCsp}" />
<base href="${escapeAttribute(baseHref)}" />
<title>Pibo</title>
<style nonce="${options.nonce}">${cssBody}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${options.nonce}" type="module">${scriptBody}</script>
</body>
</html>`;

	return {
		html,
		inlined: { javascript: scriptPath, css: cssPath },
		baseHref,
	};
}

function buildMetaCsp(cspSource: string, portMappedOrigin: string): string {
	const directives: Record<string, string[]> = {
		"default-src": ["'none'"],
		"script-src": [cspSource, "'unsafe-inline'", "'unsafe-eval'"],
		"style-src": [cspSource, "'unsafe-inline'"],
		"img-src": [cspSource, "vscode-resource:", "https:", "data:"],
		"connect-src": [cspSource, portMappedOrigin],
		"font-src": [cspSource, "data:"],
		"frame-src": ["'none'"],
		"object-src": ["'none'"],
		"base-uri": [cspSource],
	};
	const lines: string[] = [];
	for (const [name, values] of Object.entries(directives)) {
		const filtered = values.filter((v) => v.length > 0);
		lines.push(`${name} ${filtered.join(" ")}`);
	}
	return lines.join("; ");
}

function findAsset(source: string, pattern: RegExp): string | undefined {
	const match = source.match(pattern);
	if (!match) return undefined;
	return match[1];
}

/**
 * Resolve a Vite asset URL (e.g. `/apps/chat-vscode/assets/index-XYZ.js`)
 * to an on-disk path inside `bundleDir`. Vite emits absolute URLs that
 * encode the deployment base, so we cannot `path.resolve` them
 * directly. Instead, take the basename and look it up in the
 * conventional `assets/` subdirectory of the bundle.
 */
function resolveBundleAssetPath(bundleDir: string, assetUrl: string): string | undefined {
	const cleanUrl = stripQueryAndHash(assetUrl);
	const basename = cleanUrl.split("/").pop() ?? "";
	if (!basename) return undefined;
	const candidates = [
		resolve(bundleDir, "assets", basename),
		resolve(bundleDir, basename),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function stripQueryAndHash(value: string): string {
	const q = value.indexOf("?");
	const h = value.indexOf("#");
	const cut = [q, h].filter((i) => i >= 0).sort((a, b) => a - b)[0];
	if (cut === undefined) return value;
	return value.slice(0, cut);
}

/**
 * Escape a JS body so the HTML parser cannot terminate the wrapping
 * `<script>` tag prematurely. The Chromium HTML parser looks for the
 * byte sequence `</script>` (case-insensitive) regardless of string
 * literal context, so any occurrence inside the JS must be rewritten.
 * We also neutralise HTML comment markers to be safe with parser-
 * quirk workarounds.
 */
function escapeScriptBody(source: string): string {
	return source
		.replace(/<\/script/gi, "<\\/script")
		.replace(/<!--/g, "<\\!--")
		.replace(/-->/g, "--\\>");
}

/**
 * Escape a CSS body so the HTML parser cannot terminate the wrapping
 * `<style>` block prematurely. The parser looks for `</style>`
 * regardless of context.
 */
function escapeStyleBody(source: string): string {
	return source.replace(/<\/style/gi, "<\\/style");
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * List the asset filenames inside a Vite bundle directory. Exposed for
 * tests and diagnostics.
 */
export function listBundleAssetNames(bundleDir: string): { javascript: string | null; css: string | null } {
	const assetsDir = resolve(bundleDir, "assets");
	if (!existsSync(assetsDir)) return { javascript: null, css: null };
	const entries = readdirSync(assetsDir);
	const js = entries.find((e) => e.endsWith(".js")) ?? null;
	const css = entries.find((e) => e.endsWith(".css")) ?? null;
	return { javascript: js, css };
}
