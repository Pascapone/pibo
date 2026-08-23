#!/usr/bin/env node
/**
 * Fake OMP `--mode rpc` process used by Pibo adapter tests.
 *
 * Speaks the OMP JSON-lines-over-stdio protocol: emits `ready` on startup,
 * answers `negotiate_protocol`, and responds to scripted commands. Drives the
 * minimal interaction surface the OmpRpcClient/turn controller need:
 * get_state, prompt (agent invoking + local-only slash), steer, abort, abort
 * control, get_available_models, get_login_providers, compact, bash.
 *
 * Real OMP reads JSON from stdin and writes JSON to stdout; this fixture uses
 * the exact same line framing so the Pibo client is exercised against the real
 * wire shape.
 */
import readline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
	process.stdout.write("omp 17.3.5-fake\n");
	process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

// Test hook: emit a credential-looking line on stderr so the client's
// diagnostic redaction can be observed end-to-end.
if (process.env.OMP_FAKE_SECRET_ECHO) {
	process.stderr.write(`provider key: ${process.env.OMP_FAKE_SECRET_ECHO}\n`);
	process.stderr.write(`Bearer ${process.env.OMP_FAKE_SECRET_ECHO}\n`);
}
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

// Startup handshake
write({
	type: "ready",
	protocolVersion: 1,
	supportedProtocolVersions: [1, 2],
	maxFrameBytes: 1024 * 1024,
	maxReassembledFrameBytes: 64 * 1024 * 1024,
});

let streaming = false;
const hangAfterPrompt = process.env.OMP_FAKE_HANG_AFTER_PROMPT === "1";
let turnStarted = false;
const emitTurn = (message) => {
	if (streaming) return;
	streaming = true;
	if (hangAfterPrompt) {
		// Emit a non-terminal agent_start-ish stream and never conclude, so the
		// client's stream deadline is the only thing that can resolve the turn.
		write({ type: "turn_start" });
		write({ type: "message_start", message: { role: "assistant", content: "" } });
		write({
			type: "message_update",
			message: { role: "assistant", content: "stalled" },
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "stalled", partial: { role: "assistant", content: "stalled" } },
		});
		return; // never emit agent_end
	}
	// user msg
	write({ type: "message_start", message: { role: "user", content: message } });
	write({ type: "turn_start" });
	// assistant stream
	write({ type: "message_start", message: { role: "assistant", content: "" } });
	write({
		type: "message_update",
		message: { role: "assistant", content: "Hel" },
		assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { role: "assistant", content: "" } },
	});
	write({
		type: "message_update",
		message: { role: "assistant", content: "Hello there" },
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello there", partial: { role: "assistant", content: "Hello there" } },
	});
	write({
		type: "message_update",
		message: { role: "assistant", content: "Hello there" },
		assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hello there", partial: { role: "assistant", content: "Hello there" } },
	});
	write({ type: "message_end", message: { role: "assistant", content: "Hello there" } });
	write({
		type: "tool_execution_start",
		toolCallId: "tool-intent-1",
		toolName: "read",
		args: { path: "README.md" },
		intent: "  Reviewing project documentation  ",
	});
	write({ type: "tool_execution_end", toolCallId: "tool-intent-1", toolName: "read", result: "ok", isError: false });
	write({ type: "turn_end", message: { role: "assistant", content: "Hello there" }, toolResults: [] });
	write({ type: "agent_end", messages: [], isTerminal: true });
	streaming = false;
	turnStarted = false;
};

rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;
	let cmd;
	try {
		cmd = JSON.parse(trimmed);
	} catch {
		write({ id: undefined, type: "response", command: "parse", success: false, error: "parse error" });
		return;
	}
	const id = cmd.id;
	switch (cmd.type) {
		case "negotiate_protocol":
			write({ id, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } });
			break;
		case "get_state":
			write({
				id,
				type: "response",
				command: "get_state",
				success: true,
				data: {
					sessionId: "fake-session-1",
					sessionName: "Fake OMP session",
					sessionFile: "/tmp/fake/session.jsonl",
					isStreaming: streaming,
					isCompacting: false,
					messageCount: 3,
					model: { provider: "fake", id: "fake-model", name: "Fake Model" },
					thinkingLevel: "medium",
					autoCompactionEnabled: true,
					fastModeEnabled: false,
					fastModeActive: false,
					steeringMode: "all",
					followUpMode: "all",
					interruptMode: "immediate",
					contextUsage: { tokens: 1200, contextWindow: 200000, percent: 0.6 },
				},
			});
			break;
		case "prompt": {
			// Local-only slash command: no agent stream (MUST-FIX #4).
			if (cmd.message.startsWith("/")) {
				write({ id, type: "response", command: "prompt", success: true, data: { agentInvoked: false } });
				write({ id, type: "prompt_result", agentInvoked: false });
				break;
			}
			write({ id, type: "response", command: "prompt", success: true, data: { agentInvoked: true } });
			setTimeout(() => emitTurn(cmd.message), 5);
			break;
		}
		case "steer":
			write({ id, type: "response", command: "steer", success: true });
			break;
		case "follow_up":
			write({ id, type: "response", command: "follow_up", success: true });
			break;
		case "abort":
			streaming = false;
			turnStarted = false;
			write({ id, type: "response", command: "abort", success: true });
			break;
		case "compact":
			write({ id, type: "response", command: "compact", success: true, data: { summary: "compacted" } });
			break;
		case "get_available_models":
			write({
				id,
				type: "response",
				command: "get_available_models",
				success: true,
				data: {
					models: [
						{ provider: "fake", id: "fake-model", name: "Fake Model", reasoning: true, thinking: true, contextWindow: 200000 },
						{ provider: "fake", id: "fake-small", name: "Fake Small", reasoning: false },
					],
				},
			});
			break;
		case "set_model":
			write({ id, type: "response", command: "set_model", success: true, data: { provider: cmd.provider, id: cmd.modelId, name: cmd.modelId } });
			break;
		case "set_thinking_level":
			write({ id, type: "response", command: "set_thinking_level", success: true });
			break;
		case "set_fast_mode":
			write({ id, type: "response", command: "set_fast_mode", success: true, data: { enabled: Boolean(cmd.enabled), active: Boolean(cmd.enabled) } });
			break;
		case "switch_session":
			write({ id, type: "response", command: "switch_session", success: true, data: { cancelled: false, sessionPath: cmd.sessionPath } });
			break;
		case "get_branch_messages":
			write({
				id,
				type: "response",
				command: "get_branch_messages",
				success: true,
				data: {
					messages: [
						{ entryId: "fork-1", text: "hi" },
						{ entryId: "fork-2", text: "hello" },
					],
				},
			});
			break;
		case "get_login_providers":
			write({
				id,
				type: "response",
				command: "get_login_providers",
				success: true,
				data: {
					providers: [
						{ id: "openai", name: "OpenAI", available: true, authenticated: true },
						{ id: "anthropic", name: "Anthropic", available: true, authenticated: false },
					],
				},
			});
			break;
		case "login":
			write({ id, type: "response", command: "login", success: true, data: { providerId: cmd.providerId } });
			break;
		case "get_available_commands":
			write({
				id,
				type: "response",
				command: "get_available_commands",
				success: true,
				data: {
					commands: [
						{ name: "compact", description: "Compact the session", source: "builtin" },
						{ name: "model", description: "Switch model", source: "builtin" },
						{ name: "branch", description: "Branch", source: "builtin" },
					],
				},
			});
			break;
		case "bash":
			write({ id, type: "response", command: "bash", success: true, data: { output: "done", exitCode: 0 } });
			break;
		case "get_messages_page":
			write({ id, type: "response", command: "get_messages_page", success: true, data: { messages: [{ role: "user", content: "hi" }], totalMessages: 1 } });
			break;
		case "set_host_tools": {
			const invalid = cmd.tools.find((tool) => !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters));
			if (invalid) {
				write({
					id,
					type: "response",
					command: "set_host_tools",
					success: false,
					error: `Host tool "${invalid.name}" must provide a JSON Schema object`,
				});
				break;
			}
			write({
				id,
				type: "response",
				command: "set_host_tools",
				success: true,
				data: { toolNames: cmd.tools.map((tool) => tool.name) },
			});
			break;
		}
		default:
			write({ id, type: "response", command: cmd.type, success: true });
			break;
	}
});