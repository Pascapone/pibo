import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createChatWebApp } from "../../dist/apps/chat/web-app.js";
import { createWebHostChannel } from "../../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../../dist/sessions/store.js";

export function webOutboxPaths(directory) {
	return {
		agentStorePath: join(directory, "agents.sqlite"),
		dataStorePath: join(directory, "pibo-chat-v2.sqlite"),
		dataPayloadRootDir: join(directory, "payloads"),
		workflowStorePath: join(directory, "pibo-workflows.sqlite"),
		reliabilityStorePath: join(directory, "pibo-events.sqlite"),
	};
}

export async function startWebOutboxProcessHost({ directory, piboSessionId }) {
	mkdirSync(directory, { recursive: true });
	const paths = webOutboxPaths(directory);
	const sessions = new InMemoryPiboSessionStore();
	sessions.create({ id: piboSessionId, channel: "test", kind: "chat", profile: "base" });
	const listeners = new Set();
	const app = createChatWebApp(paths);
	const channel = createWebHostChannel({ port: 0, announce: false });
	await channel.start({
		auth: {
			name: "process-fixture-auth",
			async getSession(headers) {
				const userId = headers.get("x-test-user");
				return userId ? { identity: { userId, email: `${userId}@example.test`, provider: "test" } } : undefined;
			},
			async requireSession(headers) {
				const session = await this.getSession(headers);
				if (!session) throw new Error("Unauthenticated");
				return session;
			},
		},
		emit(event) {
			return Promise.resolve({
				type: event.type === "message" ? "message_queued" : "execution_result",
				piboSessionId: event.piboSessionId,
				eventId: event.id,
				...(event.type === "message" ? { queuedMessages: 1, text: event.text } : { action: event.action, result: { ok: true } }),
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSession(id) { return sessions.get(id); },
		createSession(input) { return sessions.create(input); },
		updateSession(id, input) { return sessions.update(id, input); },
		deleteSession(id) { return sessions.delete(id); },
		findSessions(input) { return sessions.find(input); },
		listSessions() { return sessions.list(); },
		getSessionRuntimeBinding(id) { return sessions.getRuntimeBinding(id); },
		getGatewayActions() { return []; },
		getProfiles() { return []; },
		getCapabilityCatalog() {
			return { nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [] };
		},
		getWebApps() { return [app]; },
	});
	const address = channel.getAddress();
	if (!address) throw new Error("web outbox fixture channel has no address");
	return {
		channel,
		baseURL: `http://${address.host}:${address.port}`,
		paths,
		emitOutput(event) {
			for (const listener of listeners) listener(event);
		},
	};
}
