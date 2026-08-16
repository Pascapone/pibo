import type { DatabaseSync } from "node:sqlite";

export type DebugRuntimeIdentity = {
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	nativeSessionId?: string;
	runtimeBindingState?: "unbound" | "bound" | "missing" | "error";
};

export function readDebugRuntimeIdentity(db: DatabaseSync, piboSessionId: string): DebugRuntimeIdentity {
	const bindingTable = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'session_runtime_bindings'").get();
	if (bindingTable) {
		const row = db.prepare(`
			SELECT runtime_instance_id, runtime_adapter_id, native_session_id, binding_state
			FROM session_runtime_bindings WHERE pibo_session_id = ?
		`).get(piboSessionId) as {
			runtime_instance_id: string;
			runtime_adapter_id: string;
			native_session_id: string | null;
			binding_state: DebugRuntimeIdentity["runtimeBindingState"];
		} | undefined;
		if (row) {
			return {
				runtimeInstanceId: row.runtime_instance_id,
				runtimeAdapterId: row.runtime_adapter_id,
				nativeSessionId: row.native_session_id ?? undefined,
				runtimeBindingState: row.binding_state,
			};
		}
	}
	const sessionsTable = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sessions'").get();
	if (!sessionsTable) return {};
	const session = db.prepare("SELECT pi_session_id FROM sessions WHERE id = ?").get(piboSessionId) as { pi_session_id: string | null } | undefined;
	if (!session) return {};
	return {
		runtimeInstanceId: "pi",
		runtimeAdapterId: "pi",
		nativeSessionId: session.pi_session_id ?? undefined,
		runtimeBindingState: session.pi_session_id ? "bound" : "unbound",
	};
}
