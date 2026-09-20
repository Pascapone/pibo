import type { RemoteModuleTool } from "./tool.js";
import { REMOTE_AGENT_TOOL_NAMES } from "./types.js";

/** Placeholder: replaced with the real public (FRP) URL in the GPT Action schema. */
export const REMOTE_AGENT_OPENAPI_SERVER_PLACEHOLDER = "https://REPLACE_WITH_PUBLIC_URL";

export const REMOTE_AGENT_PING_TOOL_NAME = REMOTE_AGENT_TOOL_NAMES.ping;

export function remoteRestPathForTool(toolName: string): string {
	return `/api/remote/${toolName.replace(/^remote_/, "")}`;
}

function plainJsonSchema(schema: unknown): Record<string, unknown> {
	return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

export type RemoteOpenApiTool = Pick<RemoteModuleTool, "name" | "title" | "description" | "inputSchema">;

export function buildRemoteOpenApiDocument(input: {
	tools: readonly RemoteOpenApiTool[];
	publicBaseUrl?: string;
}): Record<string, unknown> {
	const paths: Record<string, unknown> = {};
	for (const tool of input.tools) {
		paths[remoteRestPathForTool(tool.name)] = {
			post: {
				operationId: tool.name,
				summary: tool.title,
				description: `${tool.description}\n\nResponds with {ok, text, details?} on success or {ok:false, error, code?} when the tool reports a problem.`,
				requestBody: {
					required: true,
					content: { "application/json": { schema: plainJsonSchema(tool.inputSchema) } },
				},
				responses: {
					"200": {
						description: "Tool result (check ok flag).",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										ok: { type: "boolean" },
										text: { type: "string" },
										code: { type: "string" },
										error: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
		};
	}
	return {
		openapi: "3.1.0",
		info: {
			title: "Pibo Remote Agent",
			version: "1",
			description: "Room-scoped remote control for Pibo. Every tool acts in the room the Bearer [REDACTED] belongs to. Available tools depend on the connection's enabled modules (sessions, observe, files, bash).",
		},
		servers: [{ url: input.publicBaseUrl ?? REMOTE_AGENT_OPENAPI_SERVER_PLACEHOLDER }],
		paths,
		components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
		security: [{ bearerAuth: [] }],
	};
}
