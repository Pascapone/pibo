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
import { Value } from "typebox/value";
import type { PiboJsonObject, PiboJsonValue } from "../core/events.js";
import {
	PiboToolCredentialError,
	PiboToolCredentialRegistry,
	type IssuedPiboToolCredential,
	type PiboToolCredentialInfo,
	type PiboToolCredentialScope,
} from "./credential-registry.js";
import type {
	PiboToolContent,
	PiboToolDefinition,
	PiboToolDefinitionContext,
	PiboToolProgress,
	PiboToolResult,
} from "./contract.js";

const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_LARGE_RESULT_THRESHOLD_BYTES = 128 * 1024;
const DEFAULT_PREVIEW_BYTES = 4 * 1024;

export type PiboToolPayloadWriteInput = {
	piboSessionId: string;
	toolName: string;
	toolCallId: string;
	contentType: string;
	value: PiboJsonValue | string | Uint8Array;
};

export type PiboToolPayloadWriteResult = {
	ref: string;
	byteLength: number;
	preview?: string;
};

export type PiboToolPayloadWriter = {
	write(input: PiboToolPayloadWriteInput): Promise<PiboToolPayloadWriteResult> | PiboToolPayloadWriteResult;
};

export type PiboToolMcpBridgeOptions = {
	credentialRegistry?: PiboToolCredentialRegistry;
	resolveTools(scope: PiboToolCredentialInfo): readonly PiboToolDefinition[] | Promise<readonly PiboToolDefinition[]>;
	isSessionGenerationActive?: (scope: PiboToolCredentialInfo) => boolean | Promise<boolean>;
	resolveExecutionContext?: (
		scope: PiboToolCredentialInfo,
	) => Partial<PiboToolDefinitionContext> | Promise<Partial<PiboToolDefinitionContext>>;
	payloadWriter?: PiboToolPayloadWriter;
	host?: "127.0.0.1" | "::1";
	port?: number;
	maxRequestBytes?: number;
	largeResultThresholdBytes?: number;
	previewBytes?: number;
	serverName?: string;
	serverVersion?: string;
};

export type PiboToolMcpBridgeAddress = {
	host: string;
	port: number;
	url: string;
};

export class PiboToolMcpBridgeAuthorizationError extends Error {
	readonly code: "session_generation_inactive" | "tool_not_allowed" | "tool_not_portable";

	constructor(code: PiboToolMcpBridgeAuthorizationError["code"], message: string) {
		super(message);
		this.name = "PiboToolMcpBridgeAuthorizationError";
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

function jsonRpcError(code: number, message: string): PiboJsonObject {
	return {
		jsonrpc: "2.0",
		id: null,
		error: { code, message },
	};
}

function toJsonValue(value: unknown): PiboJsonValue | undefined {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
	} catch {
		return undefined;
	}
}

function toStructuredObject(value: PiboJsonValue | undefined): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	return { value };
}

function textPreview(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	let preview = value.slice(0, maxBytes);
	while (Buffer.byteLength(preview, "utf8") > maxBytes) preview = preview.slice(0, -1);
	return `${preview}\n…`;
}

function piboToolToMcpTool(tool: PiboToolDefinition): McpTool {
	const inputSchema = tool.inputSchema as McpTool["inputSchema"];
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema,
		...(tool.outputSchema ? { outputSchema: tool.outputSchema as McpTool["outputSchema"] } : {}),
		...(tool.annotations
			? {
				annotations: {
					title: tool.title,
					...(tool.annotations.readOnly !== undefined ? { readOnlyHint: tool.annotations.readOnly } : {}),
					...(tool.annotations.destructive !== undefined ? { destructiveHint: tool.annotations.destructive } : {}),
					...(tool.annotations.idempotent !== undefined ? { idempotentHint: tool.annotations.idempotent } : {}),
					...(tool.annotations.openWorld !== undefined ? { openWorldHint: tool.annotations.openWorld } : {}),
				},
			}
			: {}),
	};
}

async function storeLargeContent(options: {
	writer: PiboToolPayloadWriter;
	scope: PiboToolCredentialInfo;
	tool: PiboToolDefinition;
	toolCallId: string;
	contentType: string;
	value: PiboJsonValue | string | Uint8Array;
}): Promise<PiboToolPayloadWriteResult> {
	return await options.writer.write({
		piboSessionId: options.scope.piboSessionId,
		toolName: options.tool.name,
		toolCallId: options.toolCallId,
		contentType: options.contentType,
		value: options.value,
	});
}

async function convertContent(
	items: readonly PiboToolContent[],
	options: {
		scope: PiboToolCredentialInfo;
		tool: PiboToolDefinition;
		toolCallId: string;
		writer?: PiboToolPayloadWriter;
		threshold: number;
		previewBytes: number;
	},
): Promise<{ content: CallToolResult["content"]; payloadRefs: string[] }> {
	const content: CallToolResult["content"] = [];
	const payloadRefs: string[] = [];
	for (const item of items) {
		if (item.type === "text") {
			const byteLength = Buffer.byteLength(item.text, "utf8");
			if (options.writer && byteLength > options.threshold) {
				const stored = await storeLargeContent({
					writer: options.writer,
					scope: options.scope,
					tool: options.tool,
					toolCallId: options.toolCallId,
					contentType: "text/plain; charset=utf-8",
					value: item.text,
				});
				payloadRefs.push(stored.ref);
				content.push({
					type: "text",
					text: `${stored.preview ?? textPreview(item.text, options.previewBytes)}\n[Large result stored as ${stored.ref}; ${stored.byteLength} bytes]`,
				});
			} else {
				content.push({ type: "text", text: item.text });
			}
			continue;
		}

		if (item.payloadRef && item.data === undefined) {
			payloadRefs.push(item.payloadRef);
			content.push({ type: "text", text: item.alt ?? `Image payload stored as ${item.payloadRef}` });
			continue;
		}

		if (item.data === undefined) {
			content.push({ type: "text", text: item.alt ?? "Image result omitted." });
			continue;
		}
		const bytes = Buffer.from(item.data, "base64");
		if (options.writer && bytes.byteLength > options.threshold) {
			const stored = await storeLargeContent({
				writer: options.writer,
				scope: options.scope,
				tool: options.tool,
				toolCallId: options.toolCallId,
				contentType: item.mimeType,
				value: bytes,
			});
			payloadRefs.push(stored.ref);
			content.push({ type: "text", text: item.alt ?? `Image stored as ${stored.ref}; ${stored.byteLength} bytes` });
		} else {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		}
	}
	return { content, payloadRefs };
}

async function piboResultToMcp(
	result: PiboToolResult,
	options: {
		scope: PiboToolCredentialInfo;
		tool: PiboToolDefinition;
		toolCallId: string;
		writer?: PiboToolPayloadWriter;
		threshold: number;
		previewBytes: number;
	},
): Promise<CallToolResult> {
	const preserveCompleteRunRead = options.tool.name === "pibo_run_read";
	const conversionOptions = preserveCompleteRunRead ? { ...options, writer: undefined } : options;
	const converted = await convertContent(result.content, conversionOptions);
	const payloadRefs = [...new Set([...(result.payloadRefs ?? []), ...converted.payloadRefs])];
	let structuredContent = result.structuredContent ?? toJsonValue(result.details);
	if (structuredContent !== undefined && options.writer && !preserveCompleteRunRead) {
		const encoded = JSON.stringify(structuredContent);
		if (Buffer.byteLength(encoded, "utf8") > options.threshold) {
			const stored = await storeLargeContent({
				writer: options.writer,
				scope: options.scope,
				tool: options.tool,
				toolCallId: options.toolCallId,
				contentType: "application/json",
				value: structuredContent,
			});
			payloadRefs.push(stored.ref);
			structuredContent = undefined;
			converted.content.push({
				type: "text",
				text: `[Structured result stored as ${stored.ref}; ${stored.byteLength} bytes]`,
			});
		}
	}
	if (converted.content.length === 0) converted.content.push({ type: "text", text: result.isError ? "Tool failed." : "Tool completed." });
	return {
		content: converted.content,
		...(toStructuredObject(structuredContent) ? { structuredContent: toStructuredObject(structuredContent) } : {}),
		...(result.isError !== undefined ? { isError: result.isError } : {}),
		_meta: {
			piboSessionId: options.scope.piboSessionId,
			runtimeInstanceId: options.scope.runtimeInstanceId,
			adapterId: options.scope.adapterId,
			sessionGeneration: options.scope.sessionGeneration,
			toolCallId: options.toolCallId,
			...(payloadRefs.length ? { payloadRefs } : {}),
			...(result.metadata ? { metadata: result.metadata } : {}),
		},
	};
}

function progressMessage(update: PiboToolProgress): string | undefined {
	if (update.message) return update.message;
	const text = update.content.find((item) => item.type === "text");
	return text?.type === "text" ? text.text : undefined;
}

type ActiveMcpSession = {
	credentialId: string;
	piboSessionId: string;
	sessionGeneration: string;
	protocolServer: McpProtocolServer;
	transport: StreamableHTTPServerTransport;
	sessionId?: string;
	closing?: boolean;
};

export class PiboToolMcpBridge {
	readonly credentials: PiboToolCredentialRegistry;
	private readonly options: Required<Pick<PiboToolMcpBridgeOptions,
		"host" | "port" | "maxRequestBytes" | "largeResultThresholdBytes" | "previewBytes" | "serverName" | "serverVersion"
	>> & Omit<PiboToolMcpBridgeOptions,
		"host" | "port" | "maxRequestBytes" | "largeResultThresholdBytes" | "previewBytes" | "serverName" | "serverVersion" | "credentialRegistry"
	>;
	private readonly requestScope = new AsyncLocalStorage<PiboToolCredentialInfo>();
	private readonly mcpSessions = new Map<string, ActiveMcpSession>();
	private readonly closingSessions = new Set<Promise<unknown>>();
	private server?: ReturnType<typeof createServer>;
	private address?: PiboToolMcpBridgeAddress;

	constructor(options: PiboToolMcpBridgeOptions) {
		if (options.host !== undefined && options.host !== "127.0.0.1" && options.host !== "::1") {
			throw new Error("Pibo tool MCP bridge must bind to a loopback address.");
		}
		this.credentials = options.credentialRegistry ?? new PiboToolCredentialRegistry();
		this.options = {
			...options,
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 0,
			maxRequestBytes: options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
			largeResultThresholdBytes: options.largeResultThresholdBytes ?? DEFAULT_LARGE_RESULT_THRESHOLD_BYTES,
			previewBytes: options.previewBytes ?? DEFAULT_PREVIEW_BYTES,
			serverName: options.serverName ?? "pibo-session-tools",
			serverVersion: options.serverVersion ?? "1",
		};
	}

	async start(): Promise<PiboToolMcpBridgeAddress> {
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
			throw new Error("Pibo tool MCP bridge failed to resolve its loopback address.");
		}
		this.server = server;
		this.address = {
			host: this.options.host,
			port: address.port,
			url: `http://${this.options.host === "::1" ? "[::1]" : this.options.host}:${address.port}/mcp`,
		};
		return { ...this.address };
	}

	getAddress(): PiboToolMcpBridgeAddress | undefined {
		return this.address ? { ...this.address } : undefined;
	}

	issueCredential(scope: PiboToolCredentialScope, ttlMs?: number): IssuedPiboToolCredential {
		return this.credentials.issue(scope, ttlMs);
	}

	closeCredentialSessions(credentialId: string): number {
		return this.closeMatchingSessions((session) => session.credentialId === credentialId);
	}

	closeSessionGeneration(piboSessionId: string, sessionGeneration: string): number {
		return this.closeMatchingSessions((session) => (
			session.piboSessionId === piboSessionId
			&& session.sessionGeneration === sessionGeneration
		));
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

	private async authenticate(request: IncomingMessage): Promise<PiboToolCredentialInfo> {
		const token = readBearerToken(request);
		if (!token) throw new PiboToolCredentialError("credential_invalid", "Bearer credential is required.");
		const scope = this.credentials.authenticate(token);
		if (this.options.isSessionGenerationActive && !await this.options.isSessionGenerationActive(scope)) {
			throw new PiboToolMcpBridgeAuthorizationError(
				"session_generation_inactive",
				"The Pibo runtime session generation for this tool credential is no longer active.",
			);
		}
		return scope;
	}

	private async resolveAllowedTools(scope: PiboToolCredentialInfo): Promise<Map<string, PiboToolDefinition>> {
		const selected = new Set(scope.allowedToolNames);
		const tools = await this.options.resolveTools(scope);
		return new Map(
			tools
				.filter((tool) => selected.has(tool.name) && tool.portable !== false)
				.map((tool) => [tool.name, tool]),
		);
	}

	private currentRequestScope(): PiboToolCredentialInfo {
		const scope = this.requestScope.getStore();
		if (!scope) throw new PiboToolMcpBridgeAuthorizationError("session_generation_inactive", "MCP request has no active Pibo credential scope.");
		return scope;
	}

	private configureProtocolServer(protocolServer: McpProtocolServer): void {
		protocolServer.setRequestHandler(ListToolsRequestSchema, async () => {
			const scope = this.currentRequestScope();
			const tools = await this.resolveAllowedTools(scope);
			return { tools: [...tools.values()].map(piboToolToMcpTool) };
		});
		protocolServer.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
			return await this.executeToolCall(call, extra);
		});
	}

	private async executeToolCall(
		call: CallToolRequest,
		extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
	): Promise<CallToolResult> {
		const scope = this.currentRequestScope();
		const tools = await this.resolveAllowedTools(scope);
		const tool = tools.get(call.params.name);
		if (!scope.allowedToolNames.includes(call.params.name)) {
			return {
				content: [{ type: "text", text: `Tool "${call.params.name}" is outside this session credential's selected tool set.` }],
				isError: true,
			};
		}
		if (!tool) {
			return {
				content: [{ type: "text", text: `Tool "${call.params.name}" is unavailable or not portable for this runtime session.` }],
				isError: true,
			};
		}
		const input = call.params.arguments ?? {};
		if (!Value.Check(tool.inputSchema, input)) {
			const errors = [...Value.Errors(tool.inputSchema, input)].slice(0, 5).map((error) => {
				const location = (error as { path?: string; instancePath?: string }).path
					?? (error as { instancePath?: string }).instancePath
					?? "/";
				return `${location || "/"}: ${error.message}`;
			});
			return {
				content: [{ type: "text", text: `Invalid arguments for ${tool.name}: ${errors.join("; ")}` }],
				isError: true,
			};
		}
		const preparedInput = tool.prepareInput ? tool.prepareInput(input) : input;
		const toolCallId = String(extra.requestId);
		const executionDefaults = this.options.resolveExecutionContext
			? await this.options.resolveExecutionContext(scope)
			: {};
		const pendingProgress: Promise<void>[] = [];
		let updateSequence = 0;
		const onUpdate = extra._meta?.progressToken === undefined
			? undefined
			: (update: PiboToolProgress) => {
				updateSequence += 1;
				pendingProgress.push(extra.sendNotification({
					method: "notifications/progress",
					params: {
						progressToken: extra._meta!.progressToken!,
						progress: update.progress ?? updateSequence,
						...(update.total !== undefined ? { total: update.total } : {}),
						...(progressMessage(update) ? { message: progressMessage(update) } : {}),
					},
				}).catch(() => {}));
			};
		try {
			const result = await tool.execute(
				toolCallId,
				preparedInput,
				extra.signal,
				onUpdate,
				{
					...executionDefaults,
					piboSessionId: scope.piboSessionId,
					piboRoomId: scope.piboRoomId,
					profileName: scope.profileName,
					cwd: scope.cwd,
					runtimeInstanceId: scope.runtimeInstanceId,
					adapterId: scope.adapterId,
					sessionGeneration: scope.sessionGeneration,
				},
			);
			await Promise.allSettled(pendingProgress);
			if (tool.outputSchema && (
				result.structuredContent === undefined
				|| !Value.Check(tool.outputSchema, result.structuredContent)
			)) {
				throw new Error(`Tool "${tool.name}" returned structuredContent that does not match its output schema.`);
			}
			return await piboResultToMcp(result, {
				scope,
				tool,
				toolCallId,
				writer: this.options.payloadWriter,
				threshold: this.options.largeResultThresholdBytes,
				previewBytes: this.options.previewBytes,
			});
		} catch (error) {
			await Promise.allSettled(pendingProgress);
			return {
				content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
				isError: true,
				_meta: {
					piboSessionId: scope.piboSessionId,
					runtimeInstanceId: scope.runtimeInstanceId,
					adapterId: scope.adapterId,
					sessionGeneration: scope.sessionGeneration,
					toolCallId,
				},
			};
		}
	}

	private async createMcpSession(scope: PiboToolCredentialInfo): Promise<ActiveMcpSession> {
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
		session = {
			credentialId: scope.credentialId,
			piboSessionId: scope.piboSessionId,
			sessionGeneration: scope.sessionGeneration,
			protocolServer,
			transport,
		};
		this.configureProtocolServer(protocolServer);
		await protocolServer.connect(transport);
		return session;
	}

	private requestSessionId(request: IncomingMessage): string | undefined {
		const header = request.headers["mcp-session-id"];
		return (Array.isArray(header) ? header[0] : header)?.trim() || undefined;
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (request.url !== "/mcp") {
			sendJson(response, 404, jsonRpcError(-32601, "Not found."));
			return;
		}
		if (!request.method || !["POST", "GET", "DELETE"].includes(request.method)) {
			sendJson(response, 405, jsonRpcError(-32600, "Unsupported MCP HTTP method."), { allow: "POST, GET, DELETE" });
			return;
		}

		let scope: PiboToolCredentialInfo;
		try {
			scope = await this.authenticate(request);
		} catch (error) {
			const status = error instanceof PiboToolMcpBridgeAuthorizationError ? 403 : 401;
			sendJson(response, status, jsonRpcError(-32001, error instanceof Error ? error.message : "Unauthorized."), {
				"www-authenticate": "Bearer",
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
		if (session && session.credentialId !== scope.credentialId) {
			sendJson(response, 403, jsonRpcError(-32001, "MCP session belongs to a different Pibo tool credential."));
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
}
