import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as McpProtocolServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	isInitializeRequest,
	type CallToolRequest,
	type CallToolResult,
	type ServerNotification,
	type ServerRequest,
	type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { buildRemoteOpenApiDocument, remoteRestPathForTool } from "./openapi.js";
import {
	OAuthDisplayError,
	OAuthRedirectError,
	PiboRemoteAgentOAuth,
	REMOTE_OAUTH_PATHS,
} from "./oauth.js";
import type { RemoteModuleTool, RemoteToolContext, RemoteToolResult } from "./tool.js";
import {
	REMOTE_AGENT_HISTORY_JSON_MAX_BYTES,
	REMOTE_AGENT_HISTORY_TEXT_MAX_CHARS,
	REMOTE_AGENT_MCP_SERVER_NAME,
	REMOTE_AGENT_MCP_SERVER_VERSION,
	REMOTE_AGENT_TOOL_NAMES,
	RemoteAgentError,
	toolModuleForToolName,
	type NewRemoteToolCallRecord,
	type RemoteTokenScope,
	type RemoteToolCallTransport,
} from "./types.js";

const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export type PiboRemoteAgentServerAddress = {
	host: string;
	port: number;
	url: string;
};

export type RemoteAgentMcpServerOptions = {
	/** OAuth 2.1 authorization server (ChatGPT plugin flow). Absent in unit tests without OAuth. */
	oauth?: PiboRemoteAgentOAuth;
	authenticate(token: string): RemoteTokenScope | Promise<RemoteTokenScope>;
	isRoomActive(roomId: string): boolean | Promise<boolean>;
	resolveTools(scope: RemoteTokenScope): readonly RemoteModuleTool[] | Promise<readonly RemoteModuleTool[]>;
	resolveContext(scope: RemoteTokenScope, toolCallId: string, signal?: AbortSignal): RemoteToolContext | Promise<RemoteToolContext>;
	/** Full tool catalog for the public OpenAPI document (ungated; runtime calls stay gated). */
	catalogTools?: () => readonly RemoteModuleTool[] | Promise<readonly RemoteModuleTool[]>;
	publicBaseUrl?: string;
	host?: "127.0.0.1" | "::1";
	port?: number;
	maxRequestBytes?: number;
	serverName?: string;
	serverVersion?: string;
	/** History hook: best-effort recording of every tool invocation (MCP + REST). */
	recordToolCall?: (record: NewRemoteToolCallRecord) => void;
};

export class RemoteAgentAuthorizationError extends Error {
	readonly code: "room_inactive" | "tool_not_allowed";

	constructor(code: RemoteAgentAuthorizationError["code"], message: string) {
		super(message);
		this.name = "RemoteAgentAuthorizationError";
		this.code = code;
	}
}

function readBearerToken(request: IncomingMessage): string | undefined {
	const header = request.headers.authorization;
	const value = Array.isArray(header) ? header[0] : header;
	if (!value) return undefined;
	const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
	return match?.[1];
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
	const chunks: Buffer[] = [];
	let byteLength = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += buffer.byteLength;
		if (byteLength > maxBytes) throw new Error(`MCP request exceeds ${maxBytes} bytes.`);
		chunks.push(buffer);
	}
	if (chunks.length === 0) return undefined;
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
	if (response.headersSent || response.writableEnded) return;
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...headers,
	});
	response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
	if (response.headersSent || response.writableEnded) return;
	response.writeHead(statusCode, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(html);
}

function sendRedirect(response: ServerResponse, url: string): void {
	if (response.headersSent || response.writableEnded) return;
	response.writeHead(302, {
		location: url,
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
	});
	response.end(`<a href="${url.replaceAll('"', "%22")}">Continue</a>`);
}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<string> {
	const chunks: Buffer[] = [];
	let byteLength = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += buffer.byteLength;
		if (byteLength > maxBytes) throw new Error(`Request exceeds ${maxBytes} bytes.`);
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

export type RemoteFormFields = {
	values(name: string): string[];
	single(name: string): string | undefined;
};

async function readFormFields(request: IncomingMessage, maxBytes: number): Promise<RemoteFormFields> {
	const contentType = (Array.isArray(request.headers["content-type"]) ? request.headers["content-type"][0] : request.headers["content-type"]) ?? "";
	const raw = await readRawBody(request, maxBytes);
	if (contentType.split(";")[0]!.trim().toLowerCase() === "application/json") {
		const parsed = (raw.trim() ? JSON.parse(raw) : {}) as Record<string, unknown>;
		return {
			values: (name) => {
				const value = parsed[name];
				if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
				return typeof value === "string" ? [value] : [];
			},
			single: (name) => {
				const value = parsed[name];
				return typeof value === "string" ? value : undefined;
			},
		};
	}
	const params = new URLSearchParams(raw);
	return {
		values: (name) => params.getAll(name),
		single: (name) => params.get(name) ?? undefined,
	};
}

function queryParams(request: IncomingMessage): Record<string, string | undefined> {
	try {
		const url = new URL(request.url ?? "/", "http://localhost");
		const params: Record<string, string | undefined> = {};
		for (const [key, value] of url.searchParams) params[key] = value;
		return params;
	} catch {
		return {};
	}
}

function basicAuthClientId(request: IncomingMessage): string | undefined {
	const header = request.headers.authorization;
	const value = Array.isArray(header) ? header[0] : header;
	if (!value) return undefined;
	const match = /^Basic\s+([^\s]+)$/i.exec(value.trim());
	if (!match?.[1]) return undefined;
	try {
		const decoded = Buffer.from(match[1], "base64").toString("utf8");
		const separator = decoded.indexOf(":");
		const clientId = (separator >= 0 ? decoded.slice(0, separator) : decoded).trim();
		return clientId || undefined;
	} catch {
		return undefined;
	}
}

function jsonRpcError(code: number, message: string): { jsonrpc: string; id: null; error: { code: number; message: string } } {
	return { jsonrpc: "2.0", id: null, error: { code, message } };
}

function remoteToolToMcpTool(tool: RemoteModuleTool): McpTool {
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema as unknown as McpTool["inputSchema"],
		...(tool.readOnly !== undefined ? { annotations: { title: tool.title, readOnlyHint: tool.readOnly } } : {}),
	};
}

function toStructuredObject(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	try {
		const normalized = JSON.parse(JSON.stringify(value)) as unknown;
		if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) return normalized as Record<string, unknown>;
		return { value: normalized };
	} catch {
		return undefined;
	}
}

function truncateHistoryJson(value: unknown, maxBytes = REMOTE_AGENT_HISTORY_JSON_MAX_BYTES): string {
	let text: string;
	try {
		text = JSON.stringify(value ?? null) ?? "null";
	} catch {
		return '"[unserializable]"';
	}
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	return `${Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")}…[truncated]`;
}

function truncateHistoryText(text: string, maxChars = REMOTE_AGENT_HISTORY_TEXT_MAX_CHARS): string {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[truncated]`;
}

function remoteResultToMcp(result: RemoteToolResult, meta: { roomId: string; tokenId: string; toolCallId: string }): CallToolResult {
	return {
		content: [{ type: "text", text: result.text }],
		...(toStructuredObject(result.details) ? { structuredContent: toStructuredObject(result.details) } : {}),
		...(result.isError !== undefined ? { isError: result.isError } : {}),
		_meta: { roomId: meta.roomId, tokenId: meta.tokenId, toolCallId: meta.toolCallId },
	};
}

const PING_TOOL: RemoteModuleTool = {
	name: REMOTE_AGENT_TOOL_NAMES.ping,
	title: "Ping remote agent",
	description: "Connectivity check. Always available to authenticated connections.",
	module: "sessions",
	inputSchema: Type.Object({}, { additionalProperties: false }),
	readOnly: true,
	async execute(_args, context) {
		return {
			text: `pong (room ${context.roomId}, mode ${context.mode})`,
			details: { roomId: context.roomId, mode: context.mode },
		};
	},
};

type ActiveMcpSession = {
	tokenId: string;
	roomId: string;
	protocolServer: McpProtocolServer;
	transport: StreamableHTTPServerTransport;
	sessionId?: string;
	closing?: boolean;
};

export class PiboRemoteAgentMcpServer {
	private readonly options: Required<Pick<RemoteAgentMcpServerOptions, "host" | "port" | "maxRequestBytes" | "serverName" | "serverVersion">>
		& Omit<RemoteAgentMcpServerOptions, "host" | "port" | "maxRequestBytes" | "serverName" | "serverVersion">;
	private readonly requestScope = new AsyncLocalStorage<RemoteTokenScope>();
	private readonly mcpSessions = new Map<string, ActiveMcpSession>();
	private readonly closingSessions = new Set<Promise<unknown>>();
	private server?: ReturnType<typeof createServer>;
	private address?: PiboRemoteAgentServerAddress;

	constructor(options: RemoteAgentMcpServerOptions) {
		if (options.host !== undefined && options.host !== "127.0.0.1" && options.host !== "::1") {
			throw new Error("Pibo Remote Agent MCP server must bind to a loopback address.");
		}
		this.options = {
			...options,
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 0,
			maxRequestBytes: options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
			serverName: options.serverName ?? REMOTE_AGENT_MCP_SERVER_NAME,
			serverVersion: options.serverVersion ?? REMOTE_AGENT_MCP_SERVER_VERSION,
		};
	}

	async start(): Promise<PiboRemoteAgentServerAddress> {
		if (this.address) return { ...this.address };
		const server = createServer((request, response) => {
			void this.handleRequest(request, response).catch((error) => {
				sendJson(response, 500, jsonRpcError(-32603, error instanceof Error ? error.message : String(error)));
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.options.port, this.options.host, () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("Pibo Remote Agent MCP server failed to resolve its loopback address.");
		}
		this.server = server;
		this.address = {
			host: this.options.host,
			port: address.port,
			url: `http://${this.options.host === "::1" ? "[::1]" : this.options.host}:${address.port}/mcp`,
		};
		return { ...this.address };
	}

	getAddress(): PiboRemoteAgentServerAddress | undefined {
		return this.address ? { ...this.address } : undefined;
	}

	get oauthHandler(): PiboRemoteAgentOAuth {
		const oauth = this.options.oauth;
		if (!oauth) throw new RemoteAgentError("oauth_disabled", "OAuth is not configured for this server.");
		return oauth;
	}

	private unauthorizedChallenge(): string {
		return this.options.oauth ? this.options.oauth.resourceChallenge() : "Bearer";
	}

	closeTokenSessions(tokenId: string): number {
		return this.closeMatchingSessions((session) => session.tokenId === tokenId);
	}

	closeRoomSessions(roomId: string): number {
		return this.closeMatchingSessions((session) => session.roomId === roomId);
	}

	async stop(): Promise<void> {
		this.closeMatchingSessions(() => true);
		await Promise.allSettled([...this.closingSessions]);
		const server = this.server;
		this.server = undefined;
		this.address = undefined;
		if (!server) return;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => error ? reject(error) : resolve());
			server.closeAllConnections();
		});
	}

	private closeMatchingSessions(predicate: (session: ActiveMcpSession) => boolean): number {
		let closed = 0;
		for (const session of new Set(this.mcpSessions.values())) {
			if (session.closing || !predicate(session)) continue;
			session.closing = true;
			if (session.sessionId) this.mcpSessions.delete(session.sessionId);
			const closing = Promise.allSettled([
				session.transport.close(),
				session.protocolServer.close(),
			]).finally(() => this.closingSessions.delete(closing));
			this.closingSessions.add(closing);
			closed += 1;
		}
		return closed;
	}

	private async authenticate(request: IncomingMessage): Promise<RemoteTokenScope> {
		const token = readBearerToken(request);
		if (!token) throw new RemoteAgentError("token_invalid", "Bearer [REDACTED] is required.");
		const scope = await this.options.authenticate(token);
		if (!await this.options.isRoomActive(scope.roomId)) {
			throw new RemoteAgentAuthorizationError("room_inactive", "Remote access is disabled for this room.");
		}
		return scope;
	}

	private async resolveAllowedTools(scope: RemoteTokenScope): Promise<Map<string, RemoteModuleTool>> {
		const modules = new Set(scope.modules);
		const tools = await this.options.resolveTools(scope);
		const allowed = new Map<string, RemoteModuleTool>();
		allowed.set(PING_TOOL.name, PING_TOOL);
		for (const tool of tools) {
			const module = toolModuleForToolName(tool.name) ?? tool.module;
			if (modules.has(module)) allowed.set(tool.name, { ...tool, module });
		}
		return allowed;
	}

	private currentRequestScope(): RemoteTokenScope {
		const scope = this.requestScope.getStore();
		if (!scope) throw new RemoteAgentAuthorizationError("room_inactive", "MCP request has no active remote credential scope.");
		return scope;
	}

	private configureProtocolServer(protocolServer: McpProtocolServer): void {
		protocolServer.setRequestHandler(ListToolsRequestSchema, async () => {
			const scope = this.currentRequestScope();
			const tools = await this.resolveAllowedTools(scope);
			return { tools: [...tools.values()].map(remoteToolToMcpTool) };
		});
		protocolServer.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
			return await this.executeToolCall(call, extra);
		});
	}

	private recordToolCall(record: NewRemoteToolCallRecord): void {
		try {
			this.options.recordToolCall?.(record);
		} catch {
			// History must never break tool execution.
		}
	}

	private finishToolCallRecord(input: {
		scope: RemoteTokenScope;
		transport: RemoteToolCallTransport;
		toolCallId: string;
		toolName: string;
		argsJson: string;
		startedAt: string;
		startedMs: number;
		ok: boolean;
		resultText?: string;
		resultJson?: string;
		error?: string;
	}): void {
		const finishedMs = Date.now();
		this.recordToolCall({
			toolCallId: input.toolCallId,
			roomId: input.scope.roomId,
			tokenId: input.scope.tokenId,
			label: input.scope.label,
			transport: input.transport,
			toolName: input.toolName,
			argsJson: input.argsJson,
			ok: input.ok,
			...(input.resultText !== undefined ? { resultText: input.resultText } : {}),
			...(input.resultJson !== undefined ? { resultJson: input.resultJson } : {}),
			...(input.error !== undefined ? { error: input.error } : {}),
			startedAt: input.startedAt,
			finishedAt: new Date(finishedMs).toISOString(),
			durationMs: Math.max(finishedMs - input.startedMs, 0),
		});
	}

	private async executeToolCall(
		call: CallToolRequest,
		extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
	): Promise<CallToolResult> {
		const scope = this.currentRequestScope();
		const startedMs = Date.now();
		const startedAt = new Date(startedMs).toISOString();
		const toolCallId = String(extra.requestId);
		const tools = await this.resolveAllowedTools(scope);
		const tool = tools.get(call.params.name);
		const argsJson = truncateHistoryJson(call.params.arguments ?? {});
		if (!tool) {
			const module = toolModuleForToolName(call.params.name);
			const reason = module && !scope.modules.includes(module)
				? `Tool "${call.params.name}" is not enabled for this connection.`
				: `Tool "${call.params.name}" is unknown.`;
			this.finishToolCallRecord({ scope, transport: "mcp", toolCallId, toolName: call.params.name, argsJson, startedAt, startedMs, ok: false, error: reason });
			return { content: [{ type: "text", text: reason }], isError: true };
		}
		const input = call.params.arguments ?? {};
		if (!Value.Check(tool.inputSchema, input)) {
			const errors = [...Value.Errors(tool.inputSchema, input)].slice(0, 5).map((error) => {
				const location = (error as { path?: string }).path ?? "/";
				return `${location || "/"}: ${error.message}`;
			});
			const reason = `Invalid arguments for ${tool.name}: ${errors.join("; ")}`;
			this.finishToolCallRecord({ scope, transport: "mcp", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs, ok: false, error: reason });
			return {
				content: [{ type: "text", text: reason }],
				isError: true,
			};
		}
		const context = await this.options.resolveContext(scope, toolCallId, extra.signal);
		try {
			const result = await tool.execute(input as Record<string, unknown>, context);
			this.finishToolCallRecord({
				scope, transport: "mcp", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs,
				ok: result.isError !== true,
				resultText: truncateHistoryText(result.text),
				...(result.details !== undefined ? { resultJson: truncateHistoryJson(toStructuredObject(result.details) ?? result.details) } : {}),
			});
			return remoteResultToMcp(result, { roomId: scope.roomId, tokenId: scope.tokenId, toolCallId });
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.finishToolCallRecord({ scope, transport: "mcp", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs, ok: false, error: reason });
			return {
				content: [{ type: "text", text: reason }],
				isError: true,
				_meta: { roomId: scope.roomId, tokenId: scope.tokenId, toolCallId },
			};
		}
	}

	private async createMcpSession(scope: RemoteTokenScope): Promise<ActiveMcpSession> {
		const protocolServer = new McpProtocolServer(
			{ name: this.options.serverName, version: this.options.serverVersion },
			{ capabilities: { tools: {} } },
		);
		let session: ActiveMcpSession;
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: randomUUID,
			onsessioninitialized: (sessionId) => {
				session.sessionId = sessionId;
				this.mcpSessions.set(sessionId, session);
			},
			onsessionclosed: (sessionId) => {
				this.mcpSessions.delete(sessionId);
			},
		});
		session = { tokenId: scope.tokenId, roomId: scope.roomId, protocolServer, transport };
		this.configureProtocolServer(protocolServer);
		await protocolServer.connect(transport);
		return session;
	}

	private requestSessionId(request: IncomingMessage): string | undefined {
		const header = request.headers["mcp-session-id"];
		return (Array.isArray(header) ? header[0] : header)?.trim() || undefined;
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const pathname = (request.url ?? "").split("?")[0];
		if (pathname === "/openapi.json" && request.method === "GET") {
			await this.handleOpenApi(response);
			return;
		}
		if (pathname.startsWith("/api/remote/") && request.method === "POST") {
			await this.handleRestToolCall(request, response, pathname);
			return;
		}
		if (await this.handleOAuthRequest(request, response, pathname)) return;
		if (request.url !== "/mcp") {
			sendJson(response, 404, jsonRpcError(-32601, "Not found."));
			return;
		}
		if (!request.method || !["POST", "GET", "DELETE"].includes(request.method)) {
			sendJson(response, 405, jsonRpcError(-32600, "Unsupported MCP HTTP method."), { allow: "POST, GET, DELETE" });
			return;
		}
		let scope: RemoteTokenScope;
		try {
			scope = await this.authenticate(request);
		} catch (error) {
			const status = error instanceof RemoteAgentAuthorizationError ? 403 : 401;
			sendJson(response, status, jsonRpcError(-32001, error instanceof Error ? error.message : "Unauthorized."), {
				"www-authenticate": this.unauthorizedChallenge(),
			});
			return;
		}
		let body: unknown;
		if (request.method === "POST") {
			try {
				body = await readJsonBody(request, this.options.maxRequestBytes);
			} catch (error) {
				sendJson(response, 400, jsonRpcError(-32700, error instanceof Error ? error.message : "Invalid JSON."));
				return;
			}
		}
		const sessionId = this.requestSessionId(request);
		let session = sessionId ? this.mcpSessions.get(sessionId) : undefined;
		if (sessionId && !session) {
			sendJson(response, 404, jsonRpcError(-32001, "Unknown or closed MCP session."));
			return;
		}
		if (session && session.tokenId !== scope.tokenId) {
			sendJson(response, 403, jsonRpcError(-32001, "MCP session belongs to a different remote credential."));
			return;
		}
		if (!session) {
			if (request.method !== "POST" || !isInitializeRequest(body)) {
				sendJson(response, 400, jsonRpcError(-32600, "An initialize request is required before using the MCP session."));
				return;
			}
			session = await this.createMcpSession(scope);
		}
		await this.requestScope.run(scope, async () => {
			await session!.transport.handleRequest(request, response, body);
		});
	}

	private async handleOAuthRequest(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
		const method = request.method ?? "";
		const isMetadata = pathname === REMOTE_OAUTH_PATHS.protectedResourceMetadata
			|| pathname === REMOTE_OAUTH_PATHS.authorizationServerMetadata
			|| pathname === REMOTE_OAUTH_PATHS.openIdConfiguration;
		const isOAuth = isMetadata
			|| pathname === REMOTE_OAUTH_PATHS.register
			|| pathname === REMOTE_OAUTH_PATHS.authorize
			|| pathname === REMOTE_OAUTH_PATHS.token;
		if (!isOAuth) return false;
		const oauth = this.options.oauth;
		if (!oauth) {
			sendJson(response, 501, { error: "OAuth is not configured for this server." });
			return true;
		}
		if (pathname === REMOTE_OAUTH_PATHS.protectedResourceMetadata && method === "GET") {
			sendJson(response, 200, oauth.protectedResourceMetadata());
			return true;
		}
		if ((pathname === REMOTE_OAUTH_PATHS.authorizationServerMetadata || pathname === REMOTE_OAUTH_PATHS.openIdConfiguration) && method === "GET") {
			sendJson(response, 200, oauth.authorizationServerMetadata());
			return true;
		}
		if (pathname === REMOTE_OAUTH_PATHS.register && method === "POST") {
			await this.handleOAuthRegister(request, response, oauth);
			return true;
		}
		if (pathname === REMOTE_OAUTH_PATHS.authorize && method === "GET") {
			try {
				const parsed = oauth.parseAuthorizeRequest(queryParams(request));
				sendHtml(response, 200, oauth.renderAuthorizePage(parsed));
			} catch (error) {
				if (error instanceof OAuthRedirectError) {
					sendRedirect(response, oauth.errorRedirectUrl(error));
					return true;
				}
				sendHtml(response, 400, oauth.renderErrorPage(error instanceof Error ? error.message : "Invalid authorize request."));
			}
			return true;
		}
		if (pathname === REMOTE_OAUTH_PATHS.authorize && method === "POST") {
			await this.handleOAuthDecision(request, response, oauth);
			return true;
		}
		if (pathname === REMOTE_OAUTH_PATHS.token && method === "POST") {
			await this.handleOAuthToken(request, response, oauth);
			return true;
		}
		sendJson(response, 405, { error: "Method not allowed." }, { allow: "GET, POST" });
		return true;
	}

	private async handleOAuthRegister(request: IncomingMessage, response: ServerResponse, oauth: PiboRemoteAgentOAuth): Promise<void> {
		let body: unknown = {};
		try {
			const raw = await readRawBody(request, this.options.maxRequestBytes);
			if (raw.trim()) body = JSON.parse(raw) as unknown;
		} catch {
			sendJson(response, 400, { error: "invalid_request", error_description: "Request body must be valid JSON." });
			return;
		}
		const input = (body && typeof body === "object" ? body : {}) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
		sendJson(response, 201, oauth.registerClient(input));
	}

	private async handleOAuthDecision(request: IncomingMessage, response: ServerResponse, oauth: PiboRemoteAgentOAuth): Promise<void> {
		let form: RemoteFormFields;
		try {
			form = await readFormFields(request, this.options.maxRequestBytes);
		} catch {
			sendHtml(response, 400, oauth.renderErrorPage("Request body is too large or unreadable."));
			return;
		}
		try {
			const result = oauth.submitDecision({ values: (name) => form.values(name), single: (name) => form.single(name) });
			if ("redirectUrl" in result) {
				sendRedirect(response, result.redirectUrl);
				return;
			}
			sendHtml(response, 200, oauth.renderAuthorizePage(result.rerender, { error: result.error }));
		} catch (error) {
			if (error instanceof OAuthRedirectError) {
				sendRedirect(response, oauth.errorRedirectUrl(error));
				return;
			}
			const message = error instanceof OAuthDisplayError || error instanceof Error ? error.message : "Invalid authorize request.";
			sendHtml(response, 400, oauth.renderErrorPage(message));
		}
	}

	private async handleOAuthToken(request: IncomingMessage, response: ServerResponse, oauth: PiboRemoteAgentOAuth): Promise<void> {
		let form: RemoteFormFields;
		try {
			form = await readFormFields(request, this.options.maxRequestBytes);
		} catch {
			sendJson(response, 400, { error: "invalid_request" });
			return;
		}
		const result = oauth.exchangeCode({
			...(form.single("grant_type") ? { grantType: form.single("grant_type") } : {}),
			...(form.single("code") ? { code: form.single("code") } : {}),
			...(form.single("redirect_uri") ? { redirectUri: form.single("redirect_uri") } : {}),
			...((form.single("client_id") ?? basicAuthClientId(request)) ? { clientId: (form.single("client_id") ?? basicAuthClientId(request))! } : {}),
			...(form.single("code_verifier") ? { codeVerifier: form.single("code_verifier") } : {}),
		});
		sendJson(response, result.status, result.body);
	}

	private async handleOpenApi(response: ServerResponse): Promise<void> {
		if (!this.options.catalogTools) {
			sendJson(response, 501, { ok: false, error: "OpenAPI catalog is not configured." });
			return;
		}
		const catalog = await this.options.catalogTools();
		const document = buildRemoteOpenApiDocument({
			tools: [PING_TOOL, ...catalog],
			...(this.options.publicBaseUrl ? { publicBaseUrl: this.options.publicBaseUrl } : {}),
		});
		if (response.headersSent || response.writableEnded) return;
		response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		response.end(JSON.stringify(document));
	}

	private async handleRestToolCall(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
		let scope: RemoteTokenScope;
		try {
			scope = await this.authenticate(request);
		} catch (error) {
			const status = error instanceof RemoteAgentAuthorizationError ? 403 : 401;
			sendJson(response, status, { ok: false, error: error instanceof Error ? error.message : "Unauthorized." }, {
				"www-authenticate": this.unauthorizedChallenge(),
			});
			return;
		}
		const startedMs = Date.now();
		const startedAt = new Date(startedMs).toISOString();
		const toolCallId = `rest_${randomUUID()}`;
		const tools = await this.resolveAllowedTools(scope);
		const tool = [...tools.values()].find((candidate) => remoteRestPathForTool(candidate.name) === pathname);
		if (!tool) {
			const reason = `Unknown tool path: ${pathname}.`;
			this.finishToolCallRecord({ scope, transport: "rest", toolCallId, toolName: pathname, argsJson: "{}", startedAt, startedMs, ok: false, error: reason });
			sendJson(response, 404, { ok: false, error: reason });
			return;
		}
		let body: unknown;
		try {
			body = await readJsonBody(request, this.options.maxRequestBytes);
		} catch {
			const reason = "Request body must be valid JSON.";
			this.finishToolCallRecord({ scope, transport: "rest", toolCallId, toolName: tool.name, argsJson: "{}", startedAt, startedMs, ok: false, error: reason });
			sendJson(response, 200, { ok: false, error: reason });
			return;
		}
		const input = (body ?? {}) as Record<string, unknown>;
		const argsJson = truncateHistoryJson(input);
		if (!Value.Check(tool.inputSchema, input)) {
			const errors = [...Value.Errors(tool.inputSchema, input)].slice(0, 5).map((error) => {
				const location = (error as { path?: string }).path ?? "/";
				return `${location || "/"}: ${error.message}`;
			});
			const reason = `Invalid arguments for ${tool.name}: ${errors.join("; ")}`;
			this.finishToolCallRecord({ scope, transport: "rest", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs, ok: false, error: reason });
			sendJson(response, 200, { ok: false, error: reason, code: "args_invalid" });
			return;
		}
		// Tool-level failures stay HTTP 200 with ok:false so GPT-style clients can read them.
		const context = await this.options.resolveContext(scope, toolCallId);
		try {
			const result = await tool.execute(input, context);
			this.finishToolCallRecord({
				scope, transport: "rest", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs,
				ok: result.isError !== true,
				resultText: truncateHistoryText(result.text),
				...(result.details !== undefined ? { resultJson: truncateHistoryJson(toStructuredObject(result.details) ?? result.details) } : {}),
			});
			sendJson(response, 200, {
				ok: !result.isError,
				text: result.text,
				...(result.details !== undefined ? { details: toStructuredObject(result.details) ?? result.details } : {}),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.finishToolCallRecord({ scope, transport: "rest", toolCallId, toolName: tool.name, argsJson, startedAt, startedMs, ok: false, error: reason });
			if (error instanceof RemoteAgentError && ["session_forbidden", "path_forbidden", "room_inactive", "tool_not_allowed"].includes(error.code)) {
				sendJson(response, 403, { ok: false, error: error.message, code: error.code });
				return;
			}
			sendJson(response, 200, {
				ok: false,
				error: reason,
				...(error instanceof RemoteAgentError ? { code: error.code } : {}),
			});
		}
	}
}
