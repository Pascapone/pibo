import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export type InstallationProfileName = "batteries-included" | "vanilla";
export type InstallationComponentName = "core" | "vscode-web" | "browser-tools" | "managed-browser" | "web-annotations" | "mcp-defaults";

export type InstallationComponent = {
	name: InstallationComponentName;
	version: string;
	description: string;
	optional: boolean;
	sha256?: Record<string, string>;
	integrity?: Record<string, string>;
};

export type InstallationFile = {
	path: string;
	purpose: string;
	content: string;
	mode?: number;
};

export type InstallationAction = {
	id: string;
	description: string;
	command: string;
	checkCommand?: string;
	privileged: boolean;
	restartEffect?: string;
};

export type InstallationPlan = {
	schemaVersion: 1;
	profileVersion: 1;
	profile: InstallationProfileName;
	summary: string;
	piboHome: string;
	workspaceRoot: string;
	piboCommand: string;
	domain?: string;
	components: InstallationComponent[];
	hostPackages: string[];
	downloads: Array<{ name: string; version: string; urls: Record<string, string>; sha256: Record<string, string> }>;
	services: Array<{ name: string; bind: string; public: boolean; user: string }>;
	ports: Array<{ name: string; host: string; port: number; exposure: "loopback" | "public" | "public-via-proxy" }>;
	files: InstallationFile[];
	actions: InstallationAction[];
	securityBoundaries: string[];
	warnings: string[];
	repairCommand: string;
};

export type InstallationManifest = {
	schemaVersion: 1;
	profileVersion: 1;
	profile: InstallationProfileName;
	components: InstallationComponent[];
	piboHome: string;
	workspaceRoot: string;
	piboCommand: string;
	domain?: string;
	installedAt: string;
	updatedAt: string;
	ownedFiles: Array<{ path: string; sha256: string; mode?: number; purpose: string }>;
	completedActions: Array<{ id: string; fingerprint: string; completedAt: string }>;
};

export type InstallationWriteResult = {
	manifestPath: string;
	written: string[];
	unchanged: string[];
	removed: string[];
	preserved: string[];
};

export type InstallationStatus = {
	installed: boolean;
	manifestPath: string;
	profile?: InstallationProfileName;
	profileVersion?: number;
	components: InstallationComponent[];
	checks: Array<{ name: string; status: "ok" | "warn" | "fail"; detail: string }>;
	repairCommand: string;
};

const CODE_SERVER_VERSION = "4.135.0";
const BROWSER_USE_VERSION = "0.12.6";
const AGENT_BROWSER_VERSION = "0.27.0";
const CHROME_DEVTOOLS_MCP_VERSION = "1.8.0";
const FILESYSTEM_MCP_VERSION = "2026.7.10";
const CODE_SERVER_SHA256 = {
	x64: "300ef4e37e469e6368a4673c6a623e1c9ba8a34f42b394fb49c431a8900bc7d1",
	arm64: "fe6561798415e709109cb902dca2a57a687240af7d8220f6fa1d01cd2ae0541e",
} as const;

const COMPONENTS: Record<InstallationComponentName, InstallationComponent> = {
	core: { name: "core", version: "package", description: "Pibo gateway and Chat Web", optional: false },
	"vscode-web": { name: "vscode-web", version: CODE_SERVER_VERSION, description: "Embedded code-server workspace", optional: true, sha256: { "linux-amd64": CODE_SERVER_SHA256.x64, "linux-arm64": CODE_SERVER_SHA256.arm64 } },
	"browser-tools": { name: "browser-tools", version: `browser-use ${BROWSER_USE_VERSION}; agent-browser ${AGENT_BROWSER_VERSION}`, description: "Curated browser automation CLIs", optional: true, integrity: { "browser-use-wheel-sha256": "f969aa1f895cbf44525e13b5743d78282bee589e68cc5d0ee238666b8b0d0b13", "agent-browser-npm-sri": "sha512-mmHzVsYFVA6nshNNGJzg83aVMgKpf4h98ytY3pvtJB1Cot0ZyA2bfnkbSngGD56Azkj+GlhVH6qx9DfKOVE0yg==" } },
	"managed-browser": { name: "managed-browser", version: "system chromium", description: "Managed Chromium/CDP runtime prerequisites", optional: true },
	"web-annotations": { name: "web-annotations", version: "package", description: "Pibo Web Annotations integration", optional: true },
	"mcp-defaults": { name: "mcp-defaults", version: `chrome-devtools-mcp ${CHROME_DEVTOOLS_MCP_VERSION}; filesystem ${FILESYSTEM_MCP_VERSION}`, description: "Allowlisted Chrome DevTools MCP integration", optional: true, integrity: { "chrome-devtools-mcp-npm-sri": "sha512-Wrm9z0/5WbVs778apjWgYRkpe9bvYQWjK2zVRwqoPAtz1IHQ5+GvotM07UGXJcfrA0rj6Gt1Pnn5+w/Tf1nU4w==", "filesystem-npm-sri": "sha512-Mmjg4anFBD5OzbPnGJOA0jPPN8645ERhQk38HQLpSenx1ox9bfdPkmAzUnNjeQtqQGFLtKe13J20RtLBmUKMZA==" } },
};

const PROFILE_COMPONENTS: Record<InstallationProfileName, InstallationComponentName[]> = {
	vanilla: ["core"],
	"batteries-included": ["core", "vscode-web", "browser-tools", "managed-browser", "web-annotations", "mcp-defaults"],
};

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeContent(content: string): string {
	return content.endsWith("\n") ? content : `${content}\n`;
}

export function installationManifestPath(piboHome: string): string {
	return join(piboHome, "setup", "installation.json");
}

function gatewayService(options: { piboHome: string; workspaceRoot: string; hasVscode: boolean; hasMcpDefaults: boolean; piboCommand: string }): string {
	const integrationEnvironment = [
		...(options.hasVscode ? ["Environment=PIBO_VSCODE_WEB_URL=/apps/vscode/", `Environment=PIBO_VSCODE_WORKSPACE_ROOT=${options.workspaceRoot}`] : []),
		...(options.hasMcpDefaults ? [`Environment=MCP_CONFIG_PATH=${options.piboHome}/setup/mcp-defaults.json`] : []),
	];
	return `[Unit]
Description=Pibo web gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment=HOME=/root
Environment=PIBO_HOME=${options.piboHome}
Environment=NODE_ENV=production
Environment=PIBO_GATEWAY_WEB_PORT=4788
${integrationEnvironment.length > 0 ? `${integrationEnvironment.join("\n")}\n` : ""}ExecStart=${options.piboCommand} gateway:web --web-host 127.0.0.1 --web-port 4788
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;
}

function codeServerService(workspaceRoot: string): string {
	return `[Unit]
Description=Pibo VS Code Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pibo-code
Group=pibo-code
WorkingDirectory=${workspaceRoot}
Environment=HOME=/var/lib/pibo-code
Environment=XDG_DATA_HOME=/var/lib/pibo-code/.local/share
Environment=XDG_CONFIG_HOME=/var/lib/pibo-code/.config
ExecStart=/opt/pibo/code-server/${CODE_SERVER_VERSION}/bin/code-server --bind-addr 127.0.0.1:4790 --auth none --disable-telemetry --disable-update-check --disable-workspace-trust ${workspaceRoot}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${workspaceRoot} /var/lib/pibo-code

[Install]
WantedBy=multi-user.target
`;
}

function proxyConfig(domain: string | undefined, batteriesIncluded: boolean): string {
	const site = domain ?? "http://127.0.0.1:8080";
	const vscode = batteriesIncluded
		? `\tredir /apps/vscode /apps/vscode/ 308
\thandle_path /apps/vscode/* {
\t\tforward_auth 127.0.0.1:4788 {
\t\t\turi /api/chat/bootstrap
\t\t\theader_up -Connection
\t\t\theader_up -Upgrade
\t\t}
\t\treverse_proxy 127.0.0.1:4790 {
\t\t\theader_down -X-Frame-Options
\t\t\theader_down +Content-Security-Policy "frame-ancestors 'self'"
\t\t}
\t}
`
		: "";
	return `${site} {
\tencode zstd gzip
${vscode}\thandle {
\t\treverse_proxy 127.0.0.1:4788
\t}
}
`;
}

function mcpDefaults(piboHome: string, workspaceRoot: string): string {
	const binDir = join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin");
	return `${JSON.stringify({
		mcpServers: {
			"chrome-devtools": {
				command: join(piboHome, "setup", "bin", "chrome-devtools-mcp"),
				allowedTools: ["list_pages", "select_page", "navigate_page", "take_screenshot", "take_snapshot", "evaluate_script", "list_console_messages", "list_network_requests", "get_network_request"],
				pibo: { description: "Inspect the Pibo-managed Chromium instance without broad host access", descriptionSource: "registry" },
			},
			filesystem: {
				command: join(binDir, "mcp-server-filesystem"),
				args: [workspaceRoot],
				allowedTools: ["read_text_file", "read_media_file", "read_multiple_files", "list_directory", "list_directory_with_sizes", "directory_tree", "search_files", "get_file_info", "list_allowed_directories"],
				pibo: { description: "Read-only workspace inspection restricted to the configured Pibo workspace root", descriptionSource: "registry" },
			},
		},
	}, null, 2)}\n`;
}

function chromeDevtoolsMcpWrapper(piboHome: string, piboCommand: string): string {
	const executable = join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin", "chrome-devtools-mcp");
	return `#!/bin/sh
set -eu
export PIBO_HOME=${shellQuote(piboHome)}
eval "$(${piboCommand} tools env browser-use)"
cdp_url=$(browser-use --pibo-ensure-chrome | tail -n 1)
exec ${shellQuote(executable)} --browserUrl "$cdp_url" --no-usage-statistics --no-performance-crux "$@"
`;
}

function installPackagesCommand(packages: string[]): string {
	const names = packages.map(shellQuote).join(" ");
	return `if command -v apt-get >/dev/null 2>&1; then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${names}; elif command -v dnf >/dev/null 2>&1; then dnf install -y ${names}; elif command -v pacman >/dev/null 2>&1; then pacman -Sy --needed --noconfirm ${names}; else echo "Supported package manager not found (apt-get, dnf, or pacman)" >&2; exit 2; fi`;
}

function codeServerInstallCommand(): string {
	return `set -eu; arch=$(uname -m); case "$arch" in x86_64|amd64) asset=amd64; sha=${CODE_SERVER_SHA256.x64};; aarch64|arm64) asset=arm64; sha=${CODE_SERVER_SHA256.arm64};; *) echo "Unsupported architecture: $arch" >&2; exit 2;; esac; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-$asset.tar.gz" -o "$tmp/code-server.tgz"; echo "$sha  $tmp/code-server.tgz" | sha256sum -c -; mkdir -p /opt/pibo/code-server/${CODE_SERVER_VERSION}; tar -xzf "$tmp/code-server.tgz" --strip-components=1 -C /opt/pibo/code-server/${CODE_SERVER_VERSION}`;
}

function protectedRouteProbe(url: string, websocket = false): string {
	const headers = websocket ? " --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: cGliby1zZXR1cC1wcm9iZQ=='" : "";
	return `status=$(curl -sS -o /dev/null -w '%{http_code}'${headers} ${shellQuote(url)}); case "$status" in 302|303|307|308|401|403) ;; *) echo "Expected authenticated route to reject anonymous request, got HTTP $status" >&2; exit 1;; esac`;
}

function availableRouteProbe(url: string): string {
	return `status=$(curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(url)}); case "$status" in 200|204|302|303|307|308|401|403) ;; *) echo "Expected maintained integration route to be available, got HTTP $status" >&2; exit 1;; esac`;
}

export function createInstallationPlan(options: {
	profile: InstallationProfileName;
	piboHome?: string;
	workspaceRoot?: string;
	domain?: string;
	piboCommand?: string;
	piboVersion?: string;
	additionalComponents?: InstallationComponentName[];
}): InstallationPlan {
	const piboHome = options.piboHome ?? "/root/.pibo";
	const workspaceRoot = options.workspaceRoot ?? "/srv/pibo-workspaces";
	const piboCommand = options.piboCommand ?? "/usr/bin/pibo";
	const requestedComponents = [...PROFILE_COMPONENTS[options.profile], ...(options.additionalComponents ?? [])];
	if (requestedComponents.includes("mcp-defaults")) requestedComponents.push("browser-tools");
	if (requestedComponents.includes("browser-tools")) requestedComponents.push("managed-browser");
	const componentNames = [...new Set(requestedComponents)];
	const components = componentNames.map((name) => name === "core" && options.piboVersion ? { ...COMPONENTS.core, version: options.piboVersion } : COMPONENTS[name]);
	const hasVscode = componentNames.includes("vscode-web");
	const hasBrowserTools = componentNames.includes("browser-tools");
	const hasManagedBrowser = componentNames.includes("managed-browser");
	const hasMcpDefaults = componentNames.includes("mcp-defaults");
	const hasWebAnnotations = componentNames.includes("web-annotations");
	const files: InstallationFile[] = [
		{ path: "/etc/systemd/system/pibo-web.service", purpose: "Pibo gateway service", content: gatewayService({ piboHome, workspaceRoot, hasVscode, hasMcpDefaults, piboCommand }) },
		{ path: "/etc/caddy/Caddyfile", purpose: hasVscode ? "Authenticated same-origin Pibo and VS Code Web proxy" : "Pibo HTTPS proxy", content: proxyConfig(options.domain, hasVscode) },
	];
	if (componentNames.includes("vscode-web")) {
		files.push(
			{ path: "/etc/systemd/system/pibo-code-server.service", purpose: "Loopback VS Code Web service", content: codeServerService(workspaceRoot) },
			{ path: "/etc/pibo/code-server-default-settings.json", purpose: "Initial Pibo-compatible VS Code Web defaults", content: `${JSON.stringify({ "workbench.colorTheme": "Default Dark Modern", "window.autoDetectColorScheme": false, "telemetry.telemetryLevel": "off" }, null, 2)}\n`, mode: 0o600 },
			{ path: `/opt/pibo/code-server/${CODE_SERVER_VERSION}/.pibo-owned`, purpose: "Ownership marker for the pinned VS Code Web binary", content: `code-server ${CODE_SERVER_VERSION}\n`, mode: 0o600 },
		);
	}
	if (componentNames.includes("mcp-defaults")) {
		files.push(
			{ path: join(piboHome, "setup", "mcp-defaults.json"), purpose: "Allowlisted MCP defaults", content: mcpDefaults(piboHome, workspaceRoot), mode: 0o600 },
			{ path: join(piboHome, "setup", "bin", "chrome-devtools-mcp"), purpose: "Dynamic managed-CDP launcher for Chrome DevTools MCP", content: chromeDevtoolsMcpWrapper(piboHome, piboCommand), mode: 0o755 },
			{ path: join(piboHome, "setup", "mcp-runtime", ".pibo-owned"), purpose: "Ownership marker for isolated curated MCP packages", content: `chrome-devtools-mcp ${CHROME_DEVTOOLS_MCP_VERSION}\n@modelcontextprotocol/server-filesystem ${FILESYSTEM_MCP_VERSION}\n`, mode: 0o600 },
		);
	}
	const browserUseProfiles = join(piboHome, "tools/browser-use/home/chrome-profiles");
	const browserUseAuthPool = join(piboHome, "tools/browser-use/home/auth-pool");
	const browserUseProcessPool = join(piboHome, "tools/browser-use/home/pibo-browser-pool");
	const agentBrowserProfiles = join(piboHome, "tools/agent-browser/home/profiles");
	const browserHealthCommand = `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools browser-use health --json | grep -q '\"overall\": \"ok\"' && PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools agent-browser health --json | grep -q '\"overall\": \"ok\"'`;
	const mcpHealthCommand = `test -x ${shellQuote(join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin", "chrome-devtools-mcp"))} && test -x ${shellQuote(join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin", "mcp-server-filesystem"))} && ${shellQuote(join(piboHome, "setup", "mcp-runtime", "node_modules", ".bin", "chrome-devtools-mcp"))} --help >/dev/null`;
	const actions: InstallationAction[] = [
		{ id: "host-packages", description: "Install core reverse-proxy prerequisites", command: installPackagesCommand(["ca-certificates", "caddy"]), checkCommand: "command -v caddy >/dev/null 2>&1", privileged: true },
	];
	if (hasVscode) actions.push(
		{ id: "vscode-packages", description: "Install VS Code Web download prerequisites", command: installPackagesCommand(["curl"]), checkCommand: "command -v curl >/dev/null 2>&1", privileged: true },
		{ id: "service-account", description: "Create the dedicated VS Code Web account and workspace", command: `id -u pibo-code >/dev/null 2>&1 || { nologin=$(command -v nologin || printf /usr/sbin/nologin); useradd --system --home /var/lib/pibo-code --create-home --shell "$nologin" pibo-code; }; settings=/var/lib/pibo-code/.local/share/code-server/User/settings.json; mkdir -p ${shellQuote(workspaceRoot)} "$(dirname "$settings")"; test -e "$settings" || install -m 600 -o pibo-code -g pibo-code /etc/pibo/code-server-default-settings.json "$settings"; chown -R pibo-code:pibo-code ${shellQuote(workspaceRoot)} /var/lib/pibo-code`, checkCommand: `id -u pibo-code >/dev/null 2>&1 && test -d ${shellQuote(workspaceRoot)} && test -f /var/lib/pibo-code/.local/share/code-server/User/settings.json`, privileged: true },
		{ id: "code-server", description: `Install pinned code-server ${CODE_SERVER_VERSION}`, command: codeServerInstallCommand(), checkCommand: `test -x /opt/pibo/code-server/${CODE_SERVER_VERSION}/bin/code-server`, privileged: true },
	);
	if (hasManagedBrowser) actions.push({ id: "chromium", description: "Install managed Chromium prerequisites", command: installPackagesCommand(["chromium"]), checkCommand: "command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1", privileged: true });
	if (hasBrowserTools) actions.push(
		{ id: "browser-profiles", description: "Create private managed browser-profile infrastructure", command: `install -d -m 700 ${shellQuote(browserUseProfiles)} ${shellQuote(browserUseAuthPool)} ${shellQuote(browserUseProcessPool)} ${shellQuote(agentBrowserProfiles)} ${shellQuote(join(agentBrowserProfiles, "auth-template"))} ${shellQuote(join(agentBrowserProfiles, "leases"))}`, checkCommand: `test "$(stat -c %a ${shellQuote(browserUseProfiles)})" = 700 && test "$(stat -c %a ${shellQuote(browserUseAuthPool)})" = 700 && test "$(stat -c %a ${shellQuote(browserUseProcessPool)})" = 700 && test "$(stat -c %a ${shellQuote(agentBrowserProfiles)})" = 700`, privileged: true },
		{ id: "browser-use", description: `Install browser-use ${BROWSER_USE_VERSION} through the curated Pibo tool registry`, command: `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools install browser-use && PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools env browser-use >/dev/null`, checkCommand: `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools browser-use health --json | grep -q '\"overall\": \"ok\"'`, privileged: false },
		{ id: "agent-browser", description: `Install agent-browser ${AGENT_BROWSER_VERSION} through the curated Pibo tool registry`, command: `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools install agent-browser`, checkCommand: `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} tools agent-browser health --json | grep -q '\"overall\": \"ok\"'`, privileged: false },
		{ id: "browser-health", description: "Verify curated browser runtimes and managed profile infrastructure", command: browserHealthCommand, checkCommand: browserHealthCommand, privileged: false },
	);
	if (hasMcpDefaults) actions.push(
		{ id: "mcp-defaults", description: "Install pinned curated MCP packages in an isolated runtime", command: `npm install --prefix ${shellQuote(join(piboHome, "setup", "mcp-runtime"))} chrome-devtools-mcp@${CHROME_DEVTOOLS_MCP_VERSION} @modelcontextprotocol/server-filesystem@${FILESYSTEM_MCP_VERSION}`, checkCommand: mcpHealthCommand, privileged: false },
		{ id: "mcp-health", description: "Verify curated MCP executables and command startup", command: mcpHealthCommand, checkCommand: mcpHealthCommand, privileged: false },
	);
	const healthCommand = [
		`PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} gateway web doctor`,
		...(hasVscode ? ["curl -fsS http://127.0.0.1:4790/healthz >/dev/null"] : []),
		...(hasWebAnnotations ? [availableRouteProbe("http://127.0.0.1:4788/apps/web-annotations/overlay.js?pibo-setup-probe=1")] : []),
		...(hasVscode && options.domain ? [protectedRouteProbe(`https://${options.domain}/apps/vscode/?pibo-setup-probe=1`), protectedRouteProbe(`https://${options.domain}/apps/vscode/ws?pibo-setup-probe=1`, true)] : []),
	].join(" && ");
	actions.push(
		{ id: "systemd", description: "Reload and enable setup-managed services", command: `systemctl daemon-reload && systemctl enable pibo-web${hasVscode ? " && systemctl enable --now pibo-code-server" : ""}`, checkCommand: `systemctl is-enabled --quiet pibo-web${hasVscode ? " && systemctl is-enabled --quiet pibo-code-server && systemctl is-active --quiet pibo-code-server" : ""}`, privileged: true, restartEffect: hasVscode ? "Starts or restarts the loopback VS Code Web service" : "Registers the Pibo gateway service" },
		{ id: "gateway", description: "Use the Pibo-owned safe gateway lifecycle", command: `PIBO_HOME=${shellQuote(piboHome)} ${piboCommand} gateway web restart`, checkCommand: "systemctl is-active --quiet pibo-web", privileged: true, restartEffect: "May be blocked while production sessions are active" },
		{ id: "caddy", description: "Validate and reload the public proxy", command: "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy", checkCommand: "caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl is-active --quiet caddy", privileged: true, restartEffect: "Reloads Caddy without dropping established connections" },
		{ id: "health", description: "Verify gateway, optional VS Code Web, public auth, and WebSocket gates", command: healthCommand, checkCommand: healthCommand, privileged: false },
	);
	const warnings = options.domain ? [] : ["No domain was provided. Caddy remains loopback-only on http://127.0.0.1:8080 and cannot provision trusted TLS."];
	return {
		schemaVersion: 1,
		profileVersion: 1,
		profile: options.profile,
		summary: options.profile === "batteries-included" ? "Complete supported Pibo workstation with embedded IDE, browser tooling, annotations, and curated MCP defaults." : "Minimal Pibo gateway and Chat Web installation without optional integrations.",
		piboHome,
		workspaceRoot,
		piboCommand,
		domain: options.domain,
		components,
		hostPackages: ["node >=24", "npm", "caddy", "ca-certificates", ...(hasVscode ? ["curl"] : []), ...(hasManagedBrowser ? ["chromium"] : [])],
		downloads: hasVscode ? [{
			name: "code-server",
			version: CODE_SERVER_VERSION,
			urls: {
				"linux-amd64": `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz`,
				"linux-arm64": `https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-arm64.tar.gz`,
			},
			sha256: { "linux-amd64": CODE_SERVER_SHA256.x64, "linux-arm64": CODE_SERVER_SHA256.arm64 },
		}] : [],
		services: [
			{ name: "pibo-web", bind: "127.0.0.1:4788", public: false, user: "root" },
			...(hasVscode ? [{ name: "pibo-code-server", bind: "127.0.0.1:4790", public: false, user: "pibo-code" }] : []),
		],
		ports: [
			{ name: "chat-web", host: "127.0.0.1", port: 4788, exposure: options.domain ? "public-via-proxy" : "loopback" },
			...(hasVscode ? [{ name: "vscode-web", host: "127.0.0.1", port: 4790, exposure: options.domain ? "public-via-proxy" as const : "loopback" as const }] : []),
			options.domain ? { name: "https-proxy", host: options.domain, port: 443, exposure: "public" } : { name: "local-proxy", host: "127.0.0.1", port: 8080, exposure: "loopback" },
		],
		files,
		actions,
		securityBoundaries: [
			"The Pibo gateway binds only to 127.0.0.1:4788.",
			"Caddy is the only public listener and terminates TLS when a domain is configured.",
			...(hasVscode ? ["VS Code Web binds only to 127.0.0.1:4790.", "Caddy authenticates /apps/vscode/* through the Pibo Chat bootstrap endpoint.", "The IDE runs as pibo-code and can write only its data directory and the configured workspace root."] : []),
			...(hasMcpDefaults ? ["MCP defaults use explicit tool allowlists and the Pibo-managed loopback CDP endpoint."] : []),
		],
		warnings,
		repairCommand: `${piboCommand} setup install --profile ${options.profile} --pibo-home ${shellQuote(piboHome)}${options.domain ? ` --domain ${shellQuote(options.domain)}` : ""} --apply --yes`,
	};
}

function ownedDirectoryMarkerParent(path: string): string | undefined {
	return /(?:\/opt\/pibo\/code-server\/[^/]+|\/setup\/mcp-runtime)\/\.pibo-owned$/.test(path) ? dirname(path) : undefined;
}

function outputPath(path: string, root?: string): string {
	if (!root) return path;
	const resolvedRoot = resolve(root);
	const stagedPath = isAbsolute(path) ? relative(parse(path).root, path) : path;
	const destination = resolve(resolvedRoot, stagedPath);
	const relativeDestination = relative(resolvedRoot, destination);
	if (relativeDestination === ".." || relativeDestination.startsWith(`..${sep}`) || isAbsolute(relativeDestination)) {
		throw new Error(`Refusing staged path outside root: ${path}`);
	}
	return destination;
}

export function installationOutputPath(path: string, root?: string): string {
	return outputPath(path, root);
}

function atomicWrite(path: string, content: string, mode?: number): void {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.pibo-setup-${process.pid}.tmp`;
	writeFileSync(tempPath, content, { mode: mode ?? 0o644 });
	renameSync(tempPath, path);
}

export function validateInstallationPlanTargets(plan: InstallationPlan, options: { root?: string } = {}): void {
	const manifestPath = outputPath(installationManifestPath(plan.piboHome), options.root);
	const previous = readInstallationManifest(manifestPath);
	for (const file of plan.files) {
		const destination = outputPath(file.path, options.root);
		if (!existsSync(destination)) continue;
		const currentDigest = sha256(readFileSync(destination, "utf8"));
		const targetDigest = sha256(normalizeContent(file.content));
		if (currentDigest === targetDigest) continue;
		const wasOwned = previous?.ownedFiles.find((entry) => entry.path === file.path);
		if (!wasOwned || currentDigest !== wasOwned.sha256) throw new Error(`Refusing to overwrite unmanaged or modified file: ${destination}`);
	}
}

export function materializeInstallationPlan(plan: InstallationPlan, options: { root?: string; now?: string } = {}): InstallationWriteResult {
	validateInstallationPlanTargets(plan, options);
	const manifestPath = outputPath(installationManifestPath(plan.piboHome), options.root);
	const previous = readInstallationManifest(manifestPath);
	const written: string[] = [];
	const unchanged: string[] = [];
	const removed: string[] = [];
	const preserved: string[] = [];
	const ownedFiles: InstallationManifest["ownedFiles"] = [];
	for (const file of plan.files) {
		const destination = outputPath(file.path, options.root);
		const content = normalizeContent(file.content);
		const digest = sha256(content);
		if (existsSync(destination)) {
			const current = readFileSync(destination, "utf8");
			if (sha256(current) === digest) {
				if (process.platform !== "win32" && file.mode !== undefined && (statSync(destination).mode & 0o777) !== file.mode) {
					chmodSync(destination, file.mode);
					written.push(destination);
				} else unchanged.push(destination);
			} else {
				const wasOwned = previous?.ownedFiles.find((entry) => entry.path === file.path);
				if (!wasOwned || sha256(current) !== wasOwned.sha256) throw new Error(`Refusing to overwrite unmanaged or modified file: ${destination}`);
				atomicWrite(destination, content, file.mode);
				written.push(destination);
			}
		} else {
			atomicWrite(destination, content, file.mode);
			written.push(destination);
		}
		ownedFiles.push({ path: file.path, sha256: digest, mode: file.mode, purpose: file.purpose });
	}
	const plannedPaths = new Set(ownedFiles.map((file) => file.path));
	for (const stale of previous?.ownedFiles ?? []) {
		if (plannedPaths.has(stale.path)) continue;
		const path = outputPath(stale.path, options.root);
		if (!existsSync(path)) continue;
		if (sha256(readFileSync(path, "utf8")) !== stale.sha256) {
			preserved.push(path);
			ownedFiles.push(stale);
			continue;
		}
		rmSync(path);
		removed.push(path);
		const ownedDirectory = ownedDirectoryMarkerParent(path);
		if (ownedDirectory) {
			rmSync(ownedDirectory, { recursive: true, force: true });
			removed.push(ownedDirectory);
		}
	}
	const now = options.now ?? new Date().toISOString();
	const manifestContent = (updatedAt: string, completedActions: InstallationManifest["completedActions"]): InstallationManifest => ({
		schemaVersion: 1,
		profileVersion: plan.profileVersion,
		profile: plan.profile,
		components: plan.components,
		piboHome: plan.piboHome,
		workspaceRoot: plan.workspaceRoot,
		piboCommand: plan.piboCommand,
		domain: plan.domain,
		installedAt: previous?.installedAt ?? now,
		updatedAt,
		ownedFiles,
		completedActions,
	});
	const comparable = (manifest: InstallationManifest): string => JSON.stringify({ ...manifest, installedAt: "", updatedAt: "", completedActions: [] });
	const previousActions = previous?.completedActions ?? [];
	const unchangedManifest = previous !== undefined && comparable(previous) === comparable(manifestContent(previous.updatedAt, previousActions));
	if (!unchangedManifest) atomicWrite(manifestPath, `${JSON.stringify(manifestContent(now, []), null, 2)}\n`, 0o600);
	else if (process.platform !== "win32" && (statSync(manifestPath).mode & 0o777) !== 0o600) {
		chmodSync(manifestPath, 0o600);
		written.push(manifestPath);
	}
	return { manifestPath, written, unchanged, removed, preserved };
}

export function readInstallationManifest(path: string): InstallationManifest | undefined {
	if (!existsSync(path)) return undefined;
	const parsed = JSON.parse(readFileSync(path, "utf8")) as InstallationManifest;
	if (parsed.schemaVersion !== 1) throw new Error(`Unsupported installation manifest schema: ${String(parsed.schemaVersion)}`);
	parsed.completedActions ??= [];
	parsed.piboCommand ??= "/usr/bin/pibo";
	return parsed;
}

export function runPendingInstallationActions(
	plan: InstallationPlan,
	manifestPath: string,
	run: (action: InstallationAction) => void,
	options: { now?: () => string; isComplete?: (action: InstallationAction) => boolean } = {},
): { completed: string[]; skipped: string[] } {
	const manifest = readInstallationManifest(manifestPath);
	if (!manifest) throw new Error(`No installation manifest found at ${manifestPath}`);
	const completed: string[] = [];
	const skipped: string[] = [];
	for (const action of plan.actions) {
		const fingerprint = sha256(JSON.stringify({ command: action.command, checkCommand: action.checkCommand }));
		const recorded = manifest.completedActions.some((entry) => entry.id === action.id && entry.fingerprint === fingerprint);
		if (recorded && (options.isComplete === undefined || options.isComplete(action))) {
			skipped.push(action.id);
			continue;
		}
		run(action);
		manifest.completedActions = manifest.completedActions.filter((entry) => entry.id !== action.id);
		manifest.completedActions.push({ id: action.id, fingerprint, completedAt: options.now?.() ?? new Date().toISOString() });
		manifest.updatedAt = options.now?.() ?? new Date().toISOString();
		atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
		completed.push(action.id);
	}
	return { completed, skipped };
}

export function inspectInstallation(options: { piboHome: string; root?: string }): InstallationStatus {
	const manifestPath = outputPath(installationManifestPath(options.piboHome), options.root);
	const manifest = readInstallationManifest(manifestPath);
	if (!manifest) return { installed: false, manifestPath, components: [], checks: [{ name: "manifest", status: "fail", detail: "No setup installation manifest found" }], repairCommand: "pibo setup install --profile batteries-included --apply --yes" };
	const manifestModeOk = process.platform === "win32" || (statSync(manifestPath).mode & 0o777) === 0o600;
	const checks: InstallationStatus["checks"] = [{ name: "manifest", status: manifestModeOk ? "ok" : "fail", detail: manifestModeOk ? `${manifest.profile} profile version ${manifest.profileVersion}` : `Installation manifest mode is ${(statSync(manifestPath).mode & 0o777).toString(8)}; expected 600` }];
	for (const file of manifest.ownedFiles) {
		const path = outputPath(file.path, options.root);
		if (!existsSync(path)) checks.push({ name: `file:${file.path}`, status: "fail", detail: "Owned file is missing" });
		else if (sha256(readFileSync(path, "utf8")) !== file.sha256) checks.push({ name: `file:${file.path}`, status: "warn", detail: "Owned file was modified; setup will preserve it until explicitly reconciled" });
		else if (process.platform !== "win32" && file.mode !== undefined && (statSync(path).mode & 0o777) !== file.mode) checks.push({ name: `file:${file.path}`, status: "fail", detail: `Owned file mode is ${(statSync(path).mode & 0o777).toString(8)}; expected ${file.mode.toString(8)}` });
		else checks.push({ name: `file:${file.path}`, status: "ok", detail: "Owned file matches the installation manifest" });
	}
	if (!options.root) {
		const expectedPlan = createInstallationPlan({ profile: manifest.profile, piboHome: manifest.piboHome, workspaceRoot: manifest.workspaceRoot, piboCommand: manifest.piboCommand, domain: manifest.domain, additionalComponents: manifest.components.map((component) => component.name) });
		for (const action of expectedPlan.actions) {
			const fingerprint = sha256(JSON.stringify({ command: action.command, checkCommand: action.checkCommand }));
			const complete = manifest.completedActions.some((entry) => entry.id === action.id && entry.fingerprint === fingerprint);
			checks.push({ name: `action:${action.id}`, status: complete ? "ok" : "fail", detail: complete ? `${action.id} completed with the current plan fingerprint` : `${action.id} is incomplete or stale` });
		}
	}
	return { installed: true, manifestPath, profile: manifest.profile, profileVersion: manifest.profileVersion, components: manifest.components, checks, repairCommand: `${manifest.piboCommand} setup upgrade --pibo-home ${shellQuote(manifest.piboHome)} --apply --yes` };
}

export function uninstallInstallation(options: { piboHome: string; root?: string }): { removed: string[]; preserved: string[]; manifestPath: string } {
	const manifestPath = outputPath(installationManifestPath(options.piboHome), options.root);
	const manifest = readInstallationManifest(manifestPath);
	if (!manifest) throw new Error(`No installation manifest found at ${manifestPath}`);
	const removed: string[] = [];
	const preserved: string[] = [];
	for (const file of manifest.ownedFiles) {
		const path = outputPath(file.path, options.root);
		if (!existsSync(path)) continue;
		if (sha256(readFileSync(path, "utf8")) !== file.sha256) {
			preserved.push(path);
			continue;
		}
		rmSync(path);
		removed.push(path);
	}
	const ownedDirectoryMarkers = manifest.ownedFiles.filter((file) => ownedDirectoryMarkerParent(file.path) !== undefined);
	for (const marker of ownedDirectoryMarkers) {
		const markerPath = outputPath(marker.path, options.root);
		if (!removed.includes(markerPath)) continue;
		const ownedDirectory = ownedDirectoryMarkerParent(markerPath)!;
		rmSync(ownedDirectory, { recursive: true, force: true });
		removed.push(ownedDirectory);
	}
	rmSync(manifestPath);
	removed.push(manifestPath);
	return { removed, preserved, manifestPath };
}

export function parseInstallationProfile(value: string): InstallationProfileName {
	if (value === "batteries-included" || value === "vanilla") return value;
	throw new Error("Profile must be 'batteries-included' or 'vanilla'");
}

export function parseInstallationComponent(value: string): InstallationComponentName {
	if (value in COMPONENTS) return value as InstallationComponentName;
	throw new Error(`Unknown setup component: ${value}`);
}
