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
    description: "Nested tool name for grep slash-boundary checks. Error Responses: 400: Bad request",
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

async function withFixtureConfig(run, options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-fixture-server-"));
  try {
    const serverPath = join(cwd, "fixture-mcp-server.mjs");
    const configPath = join(cwd, "mcp_servers.json");
    await writeFile(serverPath, fixtureServerSource);
    const fixtureServer = {
      command: process.execPath,
      args: [serverPath],
    };
    if (options.piboDescription) {
      fixtureServer.pibo = {
        description: options.piboDescription,
        descriptionSource: "user",
      };
    }
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { fixture: fixtureServer } }),
    );

    const env = {
      ...process.env,
      MCP_NO_DAEMON: "1",
      MCP_TIMEOUT: "5",
      MCP_CONFIG_PATH: configPath,
      NO_COLOR: "1",
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

test("pibo mcp shows truncated tool descriptions by default without -d", async () => {
  await withFixtureConfig(async ({ cwd, env }) => {
    const list = await execFileAsync("node", [cliPath, "mcp"], { cwd, env });
    // Default should already surface the tool summary without needing -d.
    assert.match(list.stdout, /• echo - Echo text content back to the caller\./);

    const info = await execFileAsync("node", [cliPath, "mcp", "info", "fixture"], { cwd, env });
    assert.match(info.stdout, /Server: fixture/);
    // Tool summary appears by default; parameter descriptions stay hidden until -d.
    assert.match(info.stdout, /\becho\n\s+Echo text content back to the caller\./);
    assert.match(info.stdout, /nested\/read\n\s+Nested tool name for grep slash-boundary checks\./);
    assert.match(info.stdout, /nested\/read[\s\S]*?Parameters:\n\s+No parameters/);
    assert.doesNotMatch(info.stdout, /Text to echo\./);
    assert.doesNotMatch(info.stdout, /Error Responses/);

    const full = await execFileAsync("node", [cliPath, "mcp", "info", "fixture", "-d"], { cwd, env });
    assert.match(full.stdout, /Text to echo\./);
  });
});

test("pibo mcp info surfaces the configured pibo.description in the header", async () => {
  await withFixtureConfig(
    async ({ cwd, env }) => {
      const info = await execFileAsync("node", [cliPath, "mcp", "info", "fixture"], { cwd, env });
      assert.match(info.stdout, /Server: fixture/);
      assert.match(info.stdout, /Description:\n\s+Bridge to the Unity Editor\./);
    },
    { piboDescription: "Bridge to the Unity Editor." },
  );
});

test("pibo mcp reports only valid options in unknown-option errors", async () => {
  await withFixtureConfig(async ({ cwd, env }) => {
    await assert.rejects(
      execFileAsync("node", [cliPath, "mcp", "--bogus"], { cwd, env }),
      (error) => {
        assert.match(error.stderr, /Valid options: -c\/--config, -d\/--with-descriptions/);
        assert.doesNotMatch(error.stderr, /--json/);
        assert.doesNotMatch(error.stderr, /--raw/);
        return true;
      },
    );
  });
});

test("pibo mcp call reports available tools when the fixture rejects an unknown tool", async () => {
  await withFixtureConfig(async ({ cwd, env }) => {
    await assert.rejects(
      execFileAsync("node", [cliPath, "mcp", "call", "fixture", "missing", "{}"], { cwd, env }),
      (error) => {
        assert.equal(error.code, 2);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /TOOL_NOT_FOUND/);
        assert.match(error.stderr, /Tool "missing" not found in server "fixture"/);
        assert.match(error.stderr, /Available tools: echo, nested\/read/);
        return true;
      },
    );
  });
});

test("pibo mcp call rejects invalid JSON before contacting the fixture server", async () => {
  await withFixtureConfig(async ({ cwd, env }) => {
    await assert.rejects(
      execFileAsync("node", [cliPath, "mcp", "call", "fixture", "echo", '{"text":'], { cwd, env }),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /INVALID_JSON_ARGUMENTS/);
        assert.match(error.stderr, /Invalid JSON in tool arguments/);
        assert.match(error.stderr, /Parse error:/);
        assert.match(error.stderr, /Use valid JSON/);
        return true;
      },
    );
  });
});

test("pibo mcp info reports connection failures for an unreachable configured server", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-unreachable-server-"));
  try {
    const configPath = join(cwd, "mcp_servers.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          unreachable: {
            command: "/path/does/not/exist",
            args: [],
          },
        },
      }),
    );

    await assert.rejects(
      execFileAsync("node", [cliPath, "mcp", "info", "unreachable"], {
        cwd,
        env: {
          ...process.env,
          MCP_NO_DAEMON: "1",
          MCP_TIMEOUT: "2",
          MCP_CONFIG_PATH: configPath,
        },
      }),
      (error) => {
        assert.equal(error.code, 3);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /SERVER_CONNECTION_FAILED/);
        assert.match(error.stderr, /Failed to connect to server "unreachable"/);
        assert.match(error.stderr, /spawn \/path\/does\/not\/exist ENOENT/);
        assert.match(error.stderr, /Command not found/);
        return true;
      },
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
