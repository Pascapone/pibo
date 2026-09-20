import { existsSync } from "node:fs";
import type { PiboJsonObject } from "../../core/events.js";
import { piboHomePath } from "../../core/pibo-home.js";
import { PiboRemoteAgentStore } from "../../remote-agent/store.js";
import { effectiveRemoteInternetAccess, REMOTE_AGENT_SESSION_METADATA_KEY } from "../../remote-agent/types.js";
import type { MuseSandboxNetworkAccess } from "./process.js";

export type RemoteRoomNetworkPostureInput = {
	/** True only for sessions stamped by the remote agent (see isRemoteAgentCreatedSession). */
	createdByRemoteAgent: boolean;
	/** Room id from the router product context. */
	roomId?: string;
	/** Remote-agent store path override (tests). Defaults to the product store. */
	storePath?: string;
};

export function isRemoteAgentCreatedSession(metadata: PiboJsonObject | undefined): boolean {
	return metadata?.[REMOTE_AGENT_SESSION_METADATA_KEY] === true;
}

/**
 * Resolve the sandboxed-network posture for one Muse host from the room's
 * remote-agent config. Returns undefined for everything outside the remote
 * agent's scope (unmarked sessions, unknown/disabled rooms, missing store) or
 * when the store cannot be read, in which case the caller keeps the engine
 * default. Never creates a store file as a side effect.
 */
export function resolveRemoteRoomSandboxNetwork(input: RemoteRoomNetworkPostureInput): MuseSandboxNetworkAccess | undefined {
	if (!input.createdByRemoteAgent) return undefined;
	const roomId = input.roomId?.trim();
	if (!roomId) return undefined;
	const storePath = input.storePath ?? piboHomePath("pibo-remote-agent.sqlite");
	if (storePath !== ":memory:" && !existsSync(storePath)) return undefined;
	let store: PiboRemoteAgentStore | undefined;
	try {
		store = new PiboRemoteAgentStore(input.storePath ? { path: input.storePath } : {});
		const config = store.getRoomConfig(roomId);
		if (!config || !config.enabled) return undefined;
		return effectiveRemoteInternetAccess(config) ? "enabled" : "restricted";
	} catch (error) {
		console.error(
			`[pibo] Remote Agent internet posture unreadable for room "${roomId}", keeping the Muse default: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return undefined;
	} finally {
		store?.close();
	}
}
