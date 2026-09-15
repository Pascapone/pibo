import type { AgentRuntimeHistoryReconciliationProof } from "./history.js";
import type { AgentRuntimeAdapter } from "./types.js";

const authoritativeProofs = new WeakSet<AgentRuntimeHistoryReconciliationProof>();

/**
 * Marks a proof only after the adapter that produced it confirms its private
 * identity. This module is internal to the product/runtime composition and is
 * not exported through the public plugin package surface.
 */
export function authorizeAgentRuntimeHistoryProof(
	adapter: Pick<AgentRuntimeAdapter, "isHistoryReconciliationProof">,
	proof: AgentRuntimeHistoryReconciliationProof | undefined,
): boolean {
	if (!proof || adapter.isHistoryReconciliationProof?.(proof) !== true) return false;
	authoritativeProofs.add(proof);
	return true;
}

export function isAuthorizedAgentRuntimeHistoryProof(
	proof: AgentRuntimeHistoryReconciliationProof | undefined,
): boolean {
	return proof !== undefined && authoritativeProofs.has(proof);
}
