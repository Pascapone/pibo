import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

const fixtureServerSource = String.raw`
const tools = [
  {
    name: "echo",
    description: "Echo text content back to the caller.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo." },
      },
      required: ["text"],
    },
  },
  {
    name: "nested/read",
    description: "Nested tool name for grep slash-boundary checks.",
    inputSchema: { type: "object", properties: {} },
  },
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newlineIndex = buffer.indexOf("\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleMessage(JSON.parse(line));
  }
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleMessage(message) {
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1.0.0" },
      instructions: "Use the fixture server for deterministic CLI tests.",
    });
    return;
  }

  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params ?? {};
    if (name !== "echo") {
      error(message.id, -32602, "unknown tool: " + name);
      return;
    }
    result(message.id, {
      content: [{ type: "text", text: "echo: " + (args.text ?? "") }],
    });
    return;
  }

  error(message.id, -32601, "method not found: " + message.method);
}
`;

async function withFixtureConfig(run) {
  const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-fixture-server-"));
  try {
    const serverPath = join(cwd, "fixture-mcp-server.mjs");
    const configPath = join(cwd, "mcp_servers.json");
    await writeFile(serverPath, fixtureServerSource);
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [serverPath],
          },
        },
      }),
    );

    const env = {
      ...process.env,
      MCP_NO_DAEMON: "1",
      MCP_TIMEOUT: "5",
      MCP_CONFIG_PATH: configPath,
    };

    return await run({ cwd, env });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("pibo mcp can discover and call a stdio fixture server", async () => {
  await withFixtureConfig(async ({ cwd, env }) => {
    const list = await execFileAsync("node", [cliPath, "mcp", "--with-descriptions"], { cwd, env });
    assert.match(list.stdout, /fixture/);
    assert.match(list.stdout, /• echo - Echo text content back to the caller\./);
    assert.match(list.stdout, /Instructions: Use the fixture server/);

    const info = await execFileAsync("node", [cliPath, "mcp", "info", "fixture", "--with-descriptions"], { cwd, env });
    assert.match(info.stdout, /Server: fixture/);
    assert.match(info.stdout, /Tools \(2\):/);
    assert.match(info.stdout, /• text \(string, required\) - Text to echo\./);

    const grep = await execFileAsync("node", [cliPath, "mcp", "grep", "*echo*"], { cwd, env });
    assert.match(grep.stdout, /fixture echo Echo text content back to the caller\./);

    const call = await execFileAsync(
      "node",
      [cliPath, "mcp", "call", "fixture", "echo", '{"text":"hi"}'],
      { cwd, env },
    );
    assert.equal(call.stdout.trim(), "echo: hi");
  });
});
