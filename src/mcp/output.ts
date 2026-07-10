/**
 * Output formatting utilities
 */

import type { ToolInfo } from './client.js';
import type { ServerConfig } from './config.js';
import { isHttpServer } from './config.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Check if output should be colorized
 */
function shouldColorize(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

/**
 * Apply color if terminal supports it
 */
function color(text: string, colorCode: string): string {
  if (!shouldColorize()) return text;
  return `${colorCode}${text}${colors.reset}`;
}

/**
 * Default character budget for truncated tool descriptions in compact views.
 * Single-line summaries stay readable while keeping server overviews short.
 */
export const TOOL_DESCRIPTION_TRUNCATE_LENGTH = 100;

/**
 * Return a compact, single-line summary of a tool description.
 *
 * - Prefers the first paragraph (text before a blank line or line break).
 * - Truncates at `maxLength` characters with an ellipsis suffix when needed.
 * - Returns undefined when there is no description to summarize.
 */
export function truncateToolDescription(
  description: string | undefined,
  maxLength: number = TOOL_DESCRIPTION_TRUNCATE_LENGTH,
): string | undefined {
  if (!description) return undefined;

  // Collapse whitespace so newlines and runs of spaces become single spaces.
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Return an info-view summary without generated OpenAPI error-response noise.
 */
export function summarizeToolDescriptionForInfo(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;

  const withoutErrorResponses = description
    .replace(/\s*Error Responses:\s*[\s\S]*$/i, '')
    .trim();

  return truncateToolDescription(withoutErrorResponses);
}

/**
 * Format server list for display
 */
export function formatServerList(
  servers: Array<{ name: string; tools: ToolInfo[]; instructions?: string }>,
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  for (const server of servers) {
    lines.push(color(server.name, colors.bold + colors.cyan));

    // Show instructions if available (first line only in list view, or all if short)
    if (server.instructions) {
      const instructionLines = server.instructions.split('\n');
      const firstLine = instructionLines[0].slice(0, 100);
      const suffix =
        instructionLines.length > 1 || instructionLines[0].length > 100
          ? '...'
          : '';
      lines.push(
        `  ${color(`Instructions: ${firstLine}${suffix}`, colors.dim)}`,
      );
    }

    for (const tool of server.tools) {
      // Always try to show a short summary so agents can pick a tool without -d.
      const summary = withDescriptions
        ? tool.description
        : truncateToolDescription(tool.description);
      if (summary) {
        lines.push(`  • ${tool.name} - ${color(summary, colors.dim)}`);
      } else {
        lines.push(`  • ${tool.name}`);
      }
    }

    lines.push(''); // Empty line between servers
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format search results
 */
export function formatSearchResults(
  results: Array<{ server: string; tool: ToolInfo }>,
  withDescriptions: boolean,
): string {
  const lines: string[] = [];

  for (const result of results) {
    const server = color(result.server, colors.cyan);
    const tool = color(result.tool.name, colors.green);
    // Always show a short summary so agents can decide without -d; full text on -d.
    const summary = withDescriptions
      ? result.tool.description
      : truncateToolDescription(result.tool.description);
    if (summary) {
      lines.push(`${server} ${tool} ${color(summary, colors.dim)}`);
    } else {
      lines.push(`${server} ${tool}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format server details
 */
export function formatServerDetails(
  serverName: string,
  config: ServerConfig,
  tools: ToolInfo[],
  withDescriptions = false,
  instructions?: string,
): string {
  const lines: string[] = [];

  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );

  if (isHttpServer(config)) {
    lines.push(`${color('Transport:', colors.bold)} HTTP`);
    lines.push(`${color('URL:', colors.bold)} ${config.url}`);
  } else {
    lines.push(`${color('Transport:', colors.bold)} stdio`);
    lines.push(
      `${color('Command:', colors.bold)} ${config.command} ${(config.args || []).join(' ')}`,
    );
  }

  // Surface the agent-facing Pibo description so it is visible without -d.
  const piboDescription = config.pibo?.description?.trim();
  if (piboDescription) {
    lines.push('');
    lines.push(`${color('Description:', colors.bold)}`);
    lines.push(`  ${piboDescription}`);
  }

  if (instructions) {
    lines.push('');
    lines.push(`${color('Instructions:', colors.bold)}`);
    // Indent multi-line instructions
    const indentedInstructions = instructions
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    lines.push(indentedInstructions);
  }

  lines.push('');
  lines.push(`${color(`Tools (${tools.length}):`, colors.bold)}`);

  for (const tool of tools) {
    lines.push(`  ${color(tool.name, colors.green)}`);
    const toolSummary = withDescriptions
      ? tool.description
      : summarizeToolDescriptionForInfo(tool.description);
    if (toolSummary) {
      lines.push(`    ${color(toolSummary, colors.dim)}`);
    }

    // Show parameters from schema
    const schema = tool.inputSchema as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    const parameters = Object.entries(schema.properties ?? {});
    lines.push(`    ${color('Parameters:', colors.yellow)}`);
    if (parameters.length === 0) {
      lines.push(`      ${color('No parameters', colors.dim)}`);
    } else {
      for (const [name, prop] of parameters) {
        const required = schema.required?.includes(name)
          ? 'required'
          : 'optional';
        const type = prop.type || 'any';
        const desc =
          withDescriptions && prop.description ? ` - ${prop.description}` : '';
        lines.push(`      • ${name} (${type}, ${required})${desc}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format tool schema
 */
export function formatToolSchema(serverName: string, tool: ToolInfo): string {
  const lines: string[] = [];

  lines.push(
    `${color('Tool:', colors.bold)} ${color(tool.name, colors.green)}`,
  );
  lines.push(
    `${color('Server:', colors.bold)} ${color(serverName, colors.cyan)}`,
  );
  lines.push('');

  if (tool.description) {
    lines.push(`${color('Description:', colors.bold)}`);
    lines.push(`  ${tool.description}`);
    lines.push('');
  }

  lines.push(`${color('Input Schema:', colors.bold)}`);
  lines.push(JSON.stringify(tool.inputSchema, null, 2));

  return lines.join('\n');
}

/**
 * Format tool call result
 */
export function formatToolResult(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const r = result as { content?: Array<{ type: string; text?: string }> };

    // Handle MCP tool result format
    if (r.content && Array.isArray(r.content)) {
      const textParts = r.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);

      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
  }

  // Fallback to JSON
  return JSON.stringify(result, null, 2);
}

/**
 * Format as JSON
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format error message
 */
export function formatError(message: string): string {
  return color(`Error: ${message}`, '\x1b[31m'); // Red
}
