import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import { DEFAULT_REMOTE_AGENT_HOST, DEFAULT_REMOTE_AGENT_PORT, type RemoteAgentResponseFrame } from "./protocol.js";
import { RemoteAgentSessionClient } from "./session-client.js";

export type RemoteAgentClientOptions = {
	host?: string;
	port?: number;
	sessionName?: string;
	profile?: string;
};

type RemoteAgentRenderState = {
	sawAssistantDelta: boolean;
};

function isSessionStatus(value: unknown): value is PiboSessionStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { sessionKey?: unknown; queuedMessages?: unknown; processing?: unknown };
	return (
		typeof candidate.sessionKey === "string" &&
		typeof candidate.queuedMessages === "number" &&
		typeof candidate.processing === "boolean"
	);
}

function printResponse(frame: RemoteAgentResponseFrame): void {
	if (frame.ok) return;
	console.error(`\nerror: ${frame.error?.message ?? "request failed"}`);
}

function printExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): void {
	if (event.action === "status" && isSessionStatus(event.result)) {
		console.error(
			`status: session=${event.result.sessionKey} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`,
		);
		return;
	}

	if (event.action === "clear_queue" && event.result && typeof event.result === "object") {
		const cleared = (event.result as { cleared?: unknown }).cleared;
		console.error(`clear: removed ${typeof cleared === "number" ? cleared : 0} queued message(s)`);
		return;
	}

	console.error(`${event.action}: ${JSON.stringify(event.result)}`);
}

function printEvent(event: PiboOutputEvent, state: RemoteAgentRenderState): void {
	if (event.type === "assistant_delta") {
		state.sawAssistantDelta = true;
		output.write(event.text);
		return;
	}
	if (event.type === "assistant_message") {
		if (!state.sawAssistantDelta) {
			output.write(event.text);
		}
		state.sawAssistantDelta = false;
		output.write("\n");
		return;
	}
	if (event.type === "message_started") {
		state.sawAssistantDelta = false;
		output.write("assistant> ");
		return;
	}
	if (event.type === "session_error") {
		console.error(`\nsession error: ${event.error}`);
		return;
	}
	if (event.type === "execution_result") {
		printExecutionResult(event);
	}
}

export async function runRemoteAgentClient(options: RemoteAgentClientOptions = {}): Promise<void> {
	const resolvedOptions: Required<RemoteAgentClientOptions> = {
		host: options.host ?? DEFAULT_REMOTE_AGENT_HOST,
		port: options.port ?? DEFAULT_REMOTE_AGENT_PORT,
		sessionName: options.sessionName ?? "default",
		profile: options.profile ?? "pibo-minimal",
	};
	const client = await RemoteAgentSessionClient.connect(resolvedOptions);
	const slashCommands = client.getSlashCommands();
	console.error(`connected to pibo remote agent at ${resolvedOptions.host}:${resolvedOptions.port}`);
	console.error(`session: ${client.binding.sessionKey}`);
	console.error(`profile: ${client.binding.originalProfile}`);
	console.error(`commands: ${[...slashCommands.keys(), "/quit"].join(", ")}`);

	const renderState: RemoteAgentRenderState = { sawAssistantDelta: false };
	client.onEvent((event) => printEvent(event, renderState));

	const rl = readline.createInterface({ input, output });
	try {
		while (true) {
			const text = (await rl.question("remote> ")).trim();
			if (!text) continue;
			if (text === "/quit" || text === "/exit") break;

			const action = slashCommands.get(text);
			if (action) {
				client.sendExecution(action).then(printResponse).catch((error) => console.error(`\nerror: ${error.message}`));
				continue;
			}

			client.sendMessage(text).then(printResponse).catch((error) => console.error(`\nerror: ${error.message}`));
		}
	} finally {
		rl.close();
		client.close();
	}
}
