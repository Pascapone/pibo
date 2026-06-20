import * as crypto from "node:crypto";

export const EMPTY_STATE_COMMAND = "pibo gateway:web";
export const GATEWAY_HEALTH_PATH = "/api/chat/bootstrap?roomId=__vscode_health__";
export const HEALTH_CHECK_TIMEOUT_MS = 1500;
export const HEALTH_POLL_INTERVAL_MS = 3000;

export function generateNonce(): string {
	// Use base64url (RFC 4648 §5) so the output is restricted to
	// [A-Za-z0-9_-]. Standard base64 would emit '+', '/', and '=', which
	// the CSP parser inside VS Code's webview treats as source-expression
	// separators when the meta CSP is merged with VS Code's default CSP,
	// breaking the nonce and triggering ERR_BLOCKED_BY_CSP.
	return crypto.randomBytes(16).toString("base64url");
}

export type WebviewShellArgs = {
	healthUrl: string;
	baseUrl: string;
	command: string;
	nonce: string;
	/**
	 * VS Code webview CSP source (e.g. `vscode-webview://<uuid>/`). Added
	 * to `script-src`, `style-src`, `img-src`, and `connect-src` as
	 * defense in depth so the merged CSP stays valid on VS Code versions
	 * that prepend their own default CSP. Optional; defaults to an empty
	 * string so test renders and other non-VS Code contexts still produce
	 * a parseable meta tag.
	 */
	cspSource?: string;
	healthCheckTimeoutMs?: number;
	pollIntervalMs?: number;
};

/**
 * Build the WebView HTML shell.
 *
 * The shell probes the gateway health endpoint on load. If the gateway
 * responds, it asks the extension host to swap the webview HTML for
 * the inlined chat-vscode SPA via a postMessage round-trip
 * (`pibo/swap-to-inlined`). If the swap succeeds, the extension
 * replaces the shell with the inlined SPA. If the swap fails (the
 * gateway is reachable but not in dev-auth mode, for example), the
 * shell stays put and shows the failure reason inline.
 *
 * If the gateway is not reachable at all, the shell shows a clear
 * empty state with the command the user needs to run.
 *
 * The shell polls every `pollIntervalMs` while in the empty state and
 * auto-swaps as soon as the gateway becomes reachable.
 */
export function buildWebviewShellHtml(args: WebviewShellArgs): string {
	const {
		healthUrl,
		baseUrl,
		command,
		nonce,
		cspSource = "",
		healthCheckTimeoutMs = HEALTH_CHECK_TIMEOUT_MS,
		pollIntervalMs = HEALTH_POLL_INTERVAL_MS,
	} = args;

	const q = (s: string): string =>
		JSON.stringify(s)
			// Defense in depth: keep the surrounding <script>...</script> intact
			// and keep HTML parsing from interpreting the JS literal as markup.
			.replace(/</g, "\\u003c")
			.replace(/>/g, "\\u003e")
			.replace(/&/g, "\\u0026")
			.replace(/\u2028/g, "\\u2028")
			.replace(/\u2029/g, "\\u2029");
	const htmlCommand = escapeHtml(command);
	const htmlBaseUrl = escapeHtml(baseUrl);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} vscode-resource: https: data:; connect-src ${baseUrl} ${cspSource};" />
<title>Pibo</title>
<style>
  body { font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
         color: var(--vscode-foreground);
         background: var(--vscode-editor-background);
         padding: 20px; margin: 0; line-height: 1.5; }
  h2 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  p  { margin: 0 0 12px; }
  code { font-family: var(--vscode-editor-font-family, monospace);
         background: var(--vscode-textBlockQuote-background);
         padding: 1px 6px; border-radius: 3px; font-size: 12.5px; }
  pre { background: var(--vscode-textBlockQuote-background);
        padding: 10px 12px; border-radius: 4px;
        margin: 0 0 14px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  button { background: var(--vscode-button-background);
           color: var(--vscode-button-foreground);
           border: 0; padding: 6px 10px; font-size: 12px;
           border-radius: 3px; cursor: pointer; font-family: inherit; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  button:hover { filter: brightness(1.1); }
  button:focus { outline: 1px solid var(--vscode-focusBorder); }
  #status { margin-top: 14px; font-size: 11.5px;
            color: var(--vscode-descriptionForeground); }
  #empty-state { max-width: 560px; }
  #hint { color: var(--vscode-errorForeground); font-size: 11.5px;
          margin-top: 8px; padding: 6px 8px; border-radius: 3px;
          background: var(--vscode-inputValidation-errorBackground, transparent);
          border: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }
  .hidden { display: none; }
</style>
</head>
<body>
  <div id="empty-state" class="hidden">
    <h2>Pibo Web-Gateway läuft nicht</h2>
    <p>Die Pibo Sidebar braucht ein laufendes Web-Gateway. Öffne ein Terminal und starte:</p>
    <pre><code>${htmlCommand}</code></pre>
    <div class="row">
      <button id="btn-copy" type="button">Kopieren</button>
      <button id="btn-term" class="secondary" type="button">Im VS Code Terminal öffnen</button>
      <button id="btn-retry" class="secondary" type="button">Erneut prüfen</button>
    </div>
    <p id="status">Suche Gateway auf <code>${htmlBaseUrl}</code>…</p>
    <p id="hint" class="hidden"></p>
  </div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const HEALTH = ${q(healthUrl)};
  const CMD = ${q(command)};
  const POLL_MS = ${pollIntervalMs};
  const TIMEOUT_MS = ${healthCheckTimeoutMs};
  const empty = document.getElementById("empty-state");
  const statusEl = document.getElementById("status");

  // Track a swap request so we do not fire duplicates while one is
  // already in flight. The extension host responds with a
  // \`pibo/swap-to-inlined-result\` postMessage.
  let swapInFlight = false;

  async function probeGateway() {
    // \`no-cors\` keeps the response opaque so we never leak token
    // cookies across origins. The shell only needs to know whether
    // the gateway is reachable enough to serve a bootstrap response.
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    try {
      await fetch(HEALTH, { method: "GET", mode: "no-cors", cache: "no-store", signal: ctl.signal });
      return true;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async function requestSwap() {
    if (swapInFlight) return;
    swapInFlight = true;
    try {
      const probe = await probeGateway();
      if (!probe) {
        statusEl.textContent = "Gateway noch nicht erreichbar.";
        return;
      }
      vscode.postMessage({ type: "pibo/swap-to-inlined" });
    } finally {
      // We do not clear \`swapInFlight\` here; the response handler
      // clears it once the extension host has answered.
    }
  }

  window.addEventListener("message", function (event) {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "pibo/swap-to-inlined-result") {
      swapInFlight = false;
      if (data.ok) {
        // The extension host will replace \`window.webview.html\` on
        // the next tick. Stay silent; do not poke the DOM while the
        // swap is in flight.
        statusEl.textContent = "Inlined view wird geladen…";
      } else {
        statusEl.textContent = "Swap fehlgeschlagen: " + (data.reason || "Unbekannter Fehler");
        if (data.hint) {
          const hintEl = document.getElementById("hint");
          if (hintEl) hintEl.textContent = data.hint;
        }
      }
    }
  });

  function showEmpty() { empty.classList.remove("hidden"); }

  document.getElementById("btn-copy").addEventListener("click", function () {
    if (!navigator.clipboard) {
      statusEl.textContent = "Zwischenablage nicht verfügbar.";
      return;
    }
    navigator.clipboard.writeText(CMD).then(
      function () { statusEl.textContent = "In Zwischenablage kopiert."; },
      function () { statusEl.textContent = "Kopieren fehlgeschlagen."; }
    );
  });
  document.getElementById("btn-term").addEventListener("click", function () {
    vscode.postMessage({ type: "pibo/open-terminal", command: CMD });
  });
  document.getElementById("btn-retry").addEventListener("click", function () { requestSwap(); });

  let pollId = null;
  (async function start() {
    if (await probeGateway()) {
      requestSwap();
      return;
    }
    showEmpty();
    pollId = setInterval(async function () {
      if (document.hidden) return;
      if (await probeGateway()) {
        requestSwap();
        if (pollId) { clearInterval(pollId); pollId = null; }
      }
    }, POLL_MS);
  })();
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
