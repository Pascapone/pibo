import type { AgentSession, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";
import { syncPiPrefixNativeState } from "./prefix-native-state.js";

const resolving = new WeakMap<SessionPrefixController, Promise<void>>();

/** Only transition recovery walks ancestry, never the normal inference path. */
export async function resolvePiPrefixTransition(session: AgentSession, controller: SessionPrefixController): Promise<void> {
	const active = resolving.get(controller);
	if (active) return active;
	if (controller.transition?.state !== "pending") return;
	const result = resolvePendingTransition(session, controller);
	resolving.set(controller, result);
	try { await result; } finally { resolving.delete(controller); }
}

async function resolvePendingTransition(session: AgentSession, controller: SessionPrefixController): Promise<void> {
	const pending = controller.transition;
	if (pending?.state !== "pending") return;
	if (pending.nativeSessionId !== session.sessionId) throw new PrefixRecoveryRequiredError("pending compaction belongs to another native session");
	const manager = session.sessionManager;
	let head = manager.getLeafId();
	let compacted = false;
	let traversed = 0;
	while (head !== pending.sourceHead) {
		if (head === null || ++traversed > 10000) throw new PrefixRecoveryRequiredError("pending compaction ancestry cannot be proven");
		const entry = manager.getEntry(head);
		if (!entry) throw new PrefixRecoveryRequiredError("pending compaction ancestry is missing");
		if (entry.type === "compaction") compacted = true;
		head = entry.parentId;
	}
	// No new entries means cancellation before native mutation. Other mutations
	// without a compaction are ambiguous, not an assumed successful rollback.
	if (traversed > 0 && !compacted) throw new PrefixRecoveryRequiredError("native history changed during an unfinished compaction");
	await syncPiPrefixNativeState(session);
	await controller.finishCompaction(pending.id, compacted);
}

/** Register first: the next extension may already send a summarization request. */
export function createPiPrefixLifecycleExtension(controller: SessionPrefixController, getSession: () => AgentSession | undefined): ExtensionFactory {
	return pi => {
		pi.on("session_before_compact", async () => {
			const session = getSession();
			if (!session) return { cancel: true };
			try {
				await resolvePiPrefixTransition(session, controller);
				await syncPiPrefixNativeState(session);
				await controller.beginCompaction(session.sessionManager.getLeafId());
			} catch { return { cancel: true }; }
			return undefined;
		});
		const complete = async () => {
			const session = getSession();
			if (session) await resolvePiPrefixTransition(session, controller);
		};
		// Pi catches hook errors. The durable pending marker remains and gates
		// the next dispatch even when completion persistence fails here.
		pi.on("session_compact", complete);
		pi.on("session_compact_failed", complete);
	};
}
