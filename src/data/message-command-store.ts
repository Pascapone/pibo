import { createHash, randomUUID } from "node:crypto";
import type { PiboDataStore } from "./pibo-store.js";
import type { PreparedPayload } from "./payload-store.js";

export type MessageCommandState = "accepted" | "waiting_slot" | "initializing" | "session_queue" | "running" | "completed" | "failed" | "interrupted";
export type MessageReceipt = {
	id: string; sessionId: string; roomId: string; eventId: string; streamId: number;
	state: MessageCommandState; createdAt: number; updatedAt: number; error?: string;
};
export type MessageCommandClaim = MessageReceipt & { token: number; text: string; delivery: "queue" | "steer" };
type Row = {
	id: string; request_key: string; fingerprint: string; session_id: string; room_id: string;
	event_id: string; stream_id: number; payload_ref: string; payload_bytes: number;
	delivery: "queue" | "steer"; state: MessageCommandState; owner: string | null;
	token: number; lease_until: number; created_at: number; updated_at: number; error: string | null;
};
export const MESSAGE_COMMAND_SCHEMA = `
CREATE TABLE IF NOT EXISTS message_commands (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 session_id TEXT NOT NULL, room_id TEXT NOT NULL, event_id TEXT NOT NULL,
 stream_id INTEGER NOT NULL, payload_ref TEXT NOT NULL REFERENCES payloads(id), payload_bytes INTEGER NOT NULL,
 delivery TEXT NOT NULL CHECK(delivery IN ('queue','steer')),
 state TEXT NOT NULL CHECK(state IN ('accepted','waiting_slot','initializing','session_queue','running','completed','failed','interrupted')),
 owner TEXT, token INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT,
 UNIQUE(session_id,event_id)
);
CREATE INDEX IF NOT EXISTS message_commands_recent ON message_commands(session_id,stream_id DESC);
CREATE INDEX IF NOT EXISTS message_commands_pending ON message_commands(state,created_at,id);
CREATE INDEX IF NOT EXISTS message_commands_session ON message_commands(session_id,state,created_at,id);
CREATE INDEX IF NOT EXISTS message_commands_lease ON message_commands(lease_until) WHERE owner IS NOT NULL;
`;
const active = "'accepted','waiting_slot','initializing','session_queue','running'";

/** Durable receipts are independent of optional trace/telemetry retention. Only the storage worker owns this store. */
export class MessageCommandStore {
	constructor(private readonly store: PiboDataStore) {}
	fingerprint(input: { sessionId: string; roomId: string; text: string; delivery: "queue" | "steer" }): string {
		if (Buffer.byteLength(input.text) > 1024 * 1024) throw domainError("command_too_large", "Message exceeds the durable command byte limit.");
		return createHash("sha256").update(JSON.stringify(input)).digest("hex");
	}
	prepare(input: { sessionId: string; roomId: string; text: string; delivery: "queue" | "steer" }) {
		return {
			fingerprint: this.fingerprint(input),
			payload: this.store.payloads.preparePayload({ value: input.text, contentType: "text/plain", retentionClass: "message_command" }),
		};
	}
	find(key: string, fingerprint?: string): MessageReceipt | undefined {
		const row = this.store.db.prepare("SELECT * FROM message_commands WHERE request_key = ?").get(key) as Row | undefined;
		if (row && fingerprint && row.fingerprint !== fingerprint) throw domainError("command_conflict", "Client transaction ID is already bound to different message content, delivery, or session.");
		return row && receipt(row);
	}
	list(sessionId: string): MessageReceipt[] {
		return (this.store.db.prepare("SELECT * FROM message_commands WHERE session_id=? ORDER BY stream_id DESC LIMIT 64").all(sessionId) as Row[]).map(receipt);
	}
	get(id: string): MessageReceipt | undefined {
		const row = this.store.db.prepare("SELECT * FROM message_commands WHERE id = ?").get(id) as Row | undefined;
		return row && receipt(row);
	}
	insert(input: { key: string; fingerprint: string; payload: PreparedPayload; sessionId: string; roomId: string; eventId: string; streamId: number; delivery: "queue" | "steer" }): MessageReceipt {
		const prior = this.find(input.key, input.fingerprint);
		if (prior) return prior;
		const rows = this.store.db.prepare(`SELECT session_id, room_id, payload_bytes FROM message_commands WHERE state IN (${active}) LIMIT 1001`).all() as Array<{ session_id: string; room_id: string; payload_bytes: number }>;
		if (rows.length >= 1000 || rows.filter(r => r.session_id === input.sessionId).length >= 64 || rows.filter(r => r.room_id === input.roomId).length >= 256 || rows.reduce((n, r) => n + r.payload_bytes, input.payload.byteSize) > 64 * 1024 * 1024) {
			throw domainError("command_overloaded", "Durable message queue capacity reached; retry the same transaction later.");
		}
		const id = `cmd_${randomUUID()}`;
		const payload = this.store.payloads.commitPreparedPayload(input.payload);
		const now = Date.now();
		this.store.db.prepare(`INSERT INTO message_commands (id,request_key,fingerprint,session_id,room_id,event_id,stream_id,payload_ref,payload_bytes,delivery,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'accepted',?,?)`).run(id,input.key,input.fingerprint,input.sessionId,input.roomId,input.eventId,input.streamId,payload.id,payload.byteSize,input.delivery,now,now);
		return this.get(id)!;
	}
	claim(owner: string, leaseMs: number): MessageCommandClaim | undefined {
		const candidateSql = `SELECT c.* FROM message_commands c WHERE c.state='accepted' AND NOT EXISTS (SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state IN (${active},'interrupted') AND p.stream_id<c.stream_id AND (c.delivery='queue' OR p.delivery='steer')) ORDER BY c.stream_id LIMIT 1`;
		// Idle polling must not take the SQLite writer lock. The claim transaction rechecks.
		if (!this.store.db.prepare(candidateSql).get() && !this.store.db.prepare("SELECT 1 FROM message_commands WHERE owner IS NOT NULL AND lease_until <= ? LIMIT 1").get(Date.now())) return undefined;
		const row = this.store.transaction(() => {
			const now = Date.now();
			// Never replay an expired command that may already have reached a provider or tool.
			this.store.db.prepare(`UPDATE message_commands SET state=CASE WHEN state='waiting_slot' THEN 'accepted' ELSE 'interrupted' END, error=CASE WHEN state='waiting_slot' THEN NULL ELSE 'Runtime ownership expired; execution requires reconciliation.' END, owner=NULL,lease_until=0,updated_at=? WHERE id IN (SELECT id FROM message_commands WHERE owner IS NOT NULL AND lease_until <= ? ORDER BY lease_until LIMIT 100)`).run(now,now);
			const candidate = this.store.db.prepare(candidateSql).get() as Row | undefined;
			if (!candidate) return undefined;
			this.store.db.prepare("UPDATE message_commands SET state='waiting_slot',owner=?,token=token+1,lease_until=?,updated_at=? WHERE id=?").run(owner,now+leaseMs,now,candidate.id);
			return this.store.db.prepare("SELECT * FROM message_commands WHERE id=?").get(candidate.id) as Row;
		});
		if (!row) return undefined;
		try {
			const text = Buffer.from(this.store.payloads.readPayloadBytesBounded(row.payload_ref,1024*1024)).toString("utf8");
			return { ...receipt(row), token: row.token, text, delivery: row.delivery };
		} catch {
			this.transition(row.id,owner,row.token,"failed", "Durable message payload is unavailable or corrupt.");
			return undefined;
		}
	}
	transition(id: string, owner: string, token: number, state: MessageCommandState, error?: string): boolean {
		return Number(this.store.db.prepare(`UPDATE message_commands SET state=?,error=?,updated_at=?,owner=CASE WHEN ? IN ('completed','failed','interrupted') THEN NULL ELSE owner END WHERE id=? AND owner=? AND token=? AND lease_until>? AND state IN (${active})`).run(state,error?.slice(0,500)??null,Date.now(),state,id,owner,token,Date.now()).changes) === 1;
	}
	heartbeat(id: string, owner: string, token: number, leaseMs: number): boolean {
		return Number(this.store.db.prepare(`UPDATE message_commands SET lease_until=? WHERE id=? AND owner=? AND token=? AND lease_until>? AND state IN (${active})`).run(Date.now()+leaseMs,id,owner,token,Date.now()).changes) === 1;
	}
	recordOutput(sessionId: string, eventId: string | undefined, type: string): void {
		if (!eventId) return;
		const states: Record<string, MessageCommandState> = { message_queued: "session_queue", message_started: "running", message_finished: "completed", session_error: "failed", message_steered: "completed" };
		const state = states[type];
		if (!state) return;
		const eligible = state === "session_queue" ? "'initializing','waiting_slot'" : state === "running" ? "'initializing','waiting_slot','session_queue'" : `${active},'interrupted'`;
		this.store.db.prepare(`UPDATE message_commands SET state=?,error=NULL,updated_at=?,owner=CASE WHEN ? IN ('completed','failed') THEN NULL ELSE owner END WHERE session_id=? AND event_id=? AND state IN (${eligible})`).run(state,Date.now(),state,sessionId,eventId);
	}
}
function receipt(row: Row): MessageReceipt {
	return { id:row.id,sessionId:row.session_id,roomId:row.room_id,eventId:row.event_id,streamId:row.stream_id,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,...(row.error?{error:row.error}:{}) };
}
function domainError(code: string, message: string): Error { return Object.assign(new Error(message),{code}); }
