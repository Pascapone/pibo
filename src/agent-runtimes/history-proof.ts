import type { AgentRuntimeHistoryReconciliationProof } from "../agent-runtime/history.js";
import { isCodexNativeBuiltInHistoryReconciliationProof } from "./codex-native/adapter.js";
import { isOmpBuiltInHistoryReconciliationProof } from "./omp/adapter.js";
import { isPiBuiltInHistoryReconciliationProof } from "./pi/adapter.js";

export function isBuiltInHistoryReconciliationProof(
	proof: AgentRuntimeHistoryReconciliationProof | undefined,
): boolean {
	return proof !== undefined && (
		isPiBuiltInHistoryReconciliationProof(proof)
		|| isOmpBuiltInHistoryReconciliationProof(proof)
		|| isCodexNativeBuiltInHistoryReconciliationProof(proof)
	);
}
