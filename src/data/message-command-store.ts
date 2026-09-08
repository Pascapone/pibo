import { createHash, randomUUID } from "node:crypto";
import type { PiboDataStore } from "./pibo-store.js";
import type { PreparedPayload } from "./payload-store.js";

export type MessageCommandState = "accepted" | "waiting_slot" | "initializing" | "session_queue" | "running" | "completed" | "failed" | "interrupted";
export type MessageReceipt = {
	id: string; sessionId: string; roomId: string; eventId: string; streamId: number;
	state: MessageCommandState; createdAt: number; updatedAt: number; error?: string;
};
export type MessageCommandClaim = MessageReceipt & { token: number; text: string; delivery: "queue" | "steer" };
export type MessageCommandTerminalEvidence = { streamId: number; type: "message_finished" | "session_error" | "message_steered"; state: "completed" | "failed" };
export type DurableMessageQueueHealth = {
	status: "healthy" | "degraded";
	storage: { available: true };
	counts: Array<{ state: MessageCommandState; delivery: "queue" | "steer"; count: number; bytes: number }>;
	interruptedPredecessors: number;
	blockedSuccessors: number;
	expiredOwnedLeases: number;
	oldestDispatchableWaitMs: number;
	oldestBlockedWaitMs: number;
	affectedScopes: Array<{ sessionId: string; roomId: string; blockingCommandId: string; blockedSince: number; blockedSuccessors: number }>;
	limits: typeof MESSAGE_COMMAND_LIMITS;
	degradedReasons: string[];
	admissionCapacity: {
		global: Array<{delivery:"queue"|"steer";count:number;bytes:number;oldestDispatchableWaitMs:number;available:boolean;degradedReasons:string[]}>;
		rooms: Array<{roomId:string;delivery:"queue"|"steer";count:number;bytes:number;oldestDispatchableWaitMs:number;available:boolean;degradedReasons:string[]}>;
		sessions: Array<{sessionId:string;roomId:string;delivery:"queue"|"steer";count:number;bytes:number;oldestDispatchableWaitMs:number;available:boolean;degradedReasons:string[]}>;
	};
	bounded: { scopeLimit: number; activeRowsLimit:number; activeRowsTruncated:boolean; affectedScopesTruncated:boolean };
};
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
CREATE INDEX IF NOT EXISTS message_commands_dispatch_order ON message_commands(session_id,state,stream_id,delivery);
CREATE INDEX IF NOT EXISTS message_commands_recent ON message_commands(session_id,stream_id DESC);
CREATE INDEX IF NOT EXISTS message_commands_pending ON message_commands(state,created_at,id);
CREATE INDEX IF NOT EXISTS message_commands_session ON message_commands(session_id,state,created_at,id);
CREATE INDEX IF NOT EXISTS message_commands_lease ON message_commands(lease_until) WHERE owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_commands_health_scope ON message_commands(state,delivery,room_id,session_id,stream_id,created_at);
CREATE INDEX IF NOT EXISTS event_log_message_command_terminal ON event_log(session_id,event_id,type,stream_id)
 WHERE event_id IS NOT NULL AND type IN ('message_finished','session_error','message_steered');
CREATE TABLE IF NOT EXISTS message_command_stats (
 state TEXT NOT NULL, delivery TEXT NOT NULL, command_count INTEGER NOT NULL, payload_bytes INTEGER NOT NULL,
 PRIMARY KEY(state,delivery)
);
CREATE TRIGGER IF NOT EXISTS message_command_stats_insert AFTER INSERT ON message_commands BEGIN
 INSERT INTO message_command_stats(state,delivery,command_count,payload_bytes) VALUES(NEW.state,NEW.delivery,1,NEW.payload_bytes)
 ON CONFLICT(state,delivery) DO UPDATE SET command_count=command_count+1,payload_bytes=payload_bytes+NEW.payload_bytes;
END;
CREATE TRIGGER IF NOT EXISTS message_command_stats_delete AFTER DELETE ON message_commands BEGIN
 UPDATE message_command_stats SET command_count=command_count-1,payload_bytes=payload_bytes-OLD.payload_bytes WHERE state=OLD.state AND delivery=OLD.delivery;
END;
CREATE TRIGGER IF NOT EXISTS message_command_stats_update AFTER UPDATE OF state,delivery,payload_bytes ON message_commands
 WHEN OLD.state<>NEW.state OR OLD.delivery<>NEW.delivery OR OLD.payload_bytes<>NEW.payload_bytes BEGIN
 UPDATE message_command_stats SET command_count=command_count-1,payload_bytes=payload_bytes-OLD.payload_bytes WHERE state=OLD.state AND delivery=OLD.delivery;
 INSERT INTO message_command_stats(state,delivery,command_count,payload_bytes) VALUES(NEW.state,NEW.delivery,1,NEW.payload_bytes)
 ON CONFLICT(state,delivery) DO UPDATE SET command_count=command_count+1,payload_bytes=payload_bytes+NEW.payload_bytes;
END;
CREATE TABLE IF NOT EXISTS message_dispatch_clock (id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL);
INSERT OR IGNORE INTO message_dispatch_clock VALUES (1,0);
CREATE TABLE IF NOT EXISTS message_dispatch_rooms (room_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
INSERT INTO message_command_stats(state,delivery,command_count,payload_bytes)
 SELECT state,delivery,count(*),COALESCE(sum(payload_bytes),0) FROM message_commands
 WHERE NOT EXISTS (SELECT 1 FROM message_command_stats) GROUP BY state,delivery;
`;
export const MESSAGE_COMMAND_LIMITS = Object.freeze({
 queue: { count: 1000, roomCount: 256, sessionCount: 64, bytes: 64*1024*1024, roomBytes: 16*1024*1024, sessionBytes: 4*1024*1024, ageMs: 60*60*1000, roomAgeMs: 15*60*1000, sessionAgeMs: 10*60*1000 },
 steer: { count: 64, roomCount: 16, sessionCount: 4, bytes: 4*1024*1024, roomBytes: 1024*1024, sessionBytes: 1024*1024, ageMs: 60*1000, roomAgeMs: 60*1000, sessionAgeMs: 60*1000 },
 dispatch: { queue: 10, roomQueue: 5, steer: 2, roomSteer: 1 },
});
const active = "'accepted','waiting_slot','initializing','session_queue','running'";
const unstarted = "'accepted','waiting_slot'";
const terminalEvidenceSql = `(SELECT CASE
	WHEN count(DISTINCT CASE WHEN e.type='session_error' THEN 'failed' ELSE 'completed' END)=1
	THEN max(CASE WHEN e.type='session_error' THEN 'failed' ELSE 'completed' END) END
 FROM event_log e WHERE e.session_id=message_commands.session_id AND e.event_id=message_commands.event_id
 AND e.type IN ('message_finished','session_error','message_steered'))`;

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
		const pending=this.store.db.prepare(`SELECT * FROM message_commands WHERE session_id=? AND state IN (${active},'interrupted') ORDER BY stream_id DESC LIMIT 70`).all(sessionId) as Row[];
		const terminal=this.store.db.prepare("SELECT * FROM message_commands WHERE session_id=? AND state IN ('completed','failed') ORDER BY stream_id DESC LIMIT 64").all(sessionId) as Row[];
		return [...pending,...terminal].sort((a,b)=>b.stream_id-a.stream_id).map(receipt);
	}
	queueStatus(sessionId: string) {
		const rows=this.store.db.prepare(`SELECT state,delivery,payload_bytes,created_at FROM message_commands WHERE session_id=? AND state IN (${active}) LIMIT 69`).all(sessionId) as Array<Pick<Row,"state"|"delivery"|"payload_bytes"|"created_at">>;
		const blocker=this.store.db.prepare("SELECT id,created_at FROM message_commands WHERE session_id=? AND state='interrupted' ORDER BY stream_id LIMIT 1").get(sessionId) as {id:string;created_at:number}|undefined;
		const summarize=(delivery:"queue"|"steer")=>{
			const scoped=rows.filter(row=>row.delivery===delivery), limits=MESSAGE_COMMAND_LIMITS[delivery];
			return {count:scoped.length,bytes:scoped.reduce((sum,row)=>sum+row.payload_bytes,0),oldestWaitMs:Math.max(0,...scoped.filter(row=>row.state === "accepted" || row.state === "waiting_slot").map(row=>Date.now()-row.created_at)),limits:{count:limits.sessionCount,bytes:limits.sessionBytes,waitMs:limits.sessionAgeMs}};
		};
		return {queue:summarize("queue"),steer:summarize("steer"),...(blocker?{reconciliation:{required:true,retryable:false,scope:"session",blockingCommandId:blocker.id,blockedSince:blocker.created_at,nextAction:`pibo debug message-queue inspect --session ${sessionId}`}}:{})};
	}
	get(id: string): MessageReceipt | undefined {
		const row = this.store.db.prepare("SELECT * FROM message_commands WHERE id = ?").get(id) as Row | undefined;
		return row && receipt(row);
	}
	terminalOutcome(sessionId:string,eventId:string):"completed"|"failed"|undefined{
		const row=this.store.db.prepare(`SELECT CASE WHEN count(DISTINCT CASE WHEN type='session_error' THEN 'failed' ELSE 'completed' END)=1 THEN max(CASE WHEN type='session_error' THEN 'failed' ELSE 'completed' END) END state FROM event_log WHERE session_id=? AND event_id=? AND type IN ('message_finished','session_error','message_steered')`).get(sessionId,eventId) as {state?:"completed"|"failed"}|undefined;
		return row?.state;
	}
	terminalEvidence(sessionId: string, eventId: string): MessageCommandTerminalEvidence[] {
		return (this.store.db.prepare(`SELECT stream_id,type,CASE WHEN type='session_error' THEN 'failed' ELSE 'completed' END state FROM event_log
		 WHERE session_id=? AND event_id=? AND type IN ('message_finished','session_error','message_steered') ORDER BY stream_id LIMIT 8`).all(sessionId,eventId) as Array<{stream_id:number;type:MessageCommandTerminalEvidence["type"];state:MessageCommandTerminalEvidence["state"]}>)
			.map(row=>({streamId:row.stream_id,type:row.type,state:row.state}));
	}
	assertAdmissionUnblocked(sessionId:string,delivery:"queue"|"steer",beforeStreamId=Number.MAX_SAFE_INTEGER):void{
		if(delivery!=="queue")return;
		const blocker=this.store.db.prepare("SELECT id,created_at FROM message_commands WHERE session_id=? AND state='interrupted' AND stream_id<? ORDER BY stream_id LIMIT 1").get(sessionId,beforeStreamId) as {id:string;created_at:number}|undefined;
		if(blocker)throw domainError("command_reconciliation_required","A previous interrupted message requires operator review before this session can accept more messages.",{retryable:false,scope:"session",blockingCommandId:blocker.id,blockedSince:blocker.created_at,oldestWaitAgeMs:Math.max(0,Date.now()-blocker.created_at),nextAction:`pibo debug message-queue inspect --session ${sessionId}`});
	}
	insert(input: { key: string; fingerprint: string; payload: PreparedPayload; sessionId: string; roomId: string; eventId: string; streamId: number; delivery: "queue" | "steer" }): MessageReceipt {
		const prior = this.find(input.key, input.fingerprint);
		if (prior) return prior;
		this.assertAdmissionUnblocked(input.sessionId,input.delivery,input.streamId);
		const limit = MESSAGE_COMMAND_LIMITS[input.delivery];
		const rows = this.store.db.prepare(`SELECT c.session_id,c.room_id,c.payload_bytes,c.created_at,c.state,
		 NOT EXISTS(SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state='interrupted' AND p.stream_id<c.stream_id) dispatchable
		 FROM message_commands c WHERE c.state IN (${active}) AND c.delivery=? LIMIT ?`).all(input.delivery,limit.count+1) as Array<Pick<Row,"session_id"|"room_id"|"payload_bytes"|"created_at"|"state">&{dispatchable:number}>;
		const now = Date.now();
		const exceeds = (scope: typeof rows, count: number, bytes: number, ageMs: number) => scope.length >= count
			|| scope.reduce((n,r)=>n+r.payload_bytes,input.payload.byteSize)>bytes
			|| scope.some(r=>r.dispatchable===1 && (r.state === "accepted" || r.state === "waiting_slot") && now-r.created_at>=ageMs);
		if (exceeds(rows,limit.count,limit.bytes,limit.ageMs)
			|| exceeds(rows.filter(r=>r.room_id===input.roomId),limit.roomCount,limit.roomBytes,limit.roomAgeMs)
			|| exceeds(rows.filter(r=>r.session_id===input.sessionId),limit.sessionCount,limit.sessionBytes,limit.sessionAgeMs)) {
			throw domainError("command_overloaded", "Durable message queue count, byte or dispatchable wait-age capacity reached; retry the same transaction later.",{retryable:true});
		}
		const id = `cmd_${randomUUID()}`;
		const payload = this.store.payloads.commitPreparedPayload(input.payload);
		this.store.db.prepare(`INSERT INTO message_commands (id,request_key,fingerprint,session_id,room_id,event_id,stream_id,payload_ref,payload_bytes,delivery,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'accepted',?,?)`).run(id,input.key,input.fingerprint,input.sessionId,input.roomId,input.eventId,input.streamId,payload.id,payload.byteSize,input.delivery,now,now);
		return this.get(id)!;
	}
	private terminalizeBlockedSuccessors(now: number, limit=100): number {
		const bounded=Math.max(1,Math.min(1000,Math.trunc(limit)||1));
		return Number(this.store.db.prepare(`UPDATE message_commands SET state='failed',error='Not dispatched: an earlier interrupted message requires reconciliation.',owner = NULL,lease_until=0,updated_at=?
		 WHERE id IN (SELECT c.id FROM message_commands c WHERE c.state IN (${unstarted}) AND c.delivery='queue' AND c.owner IS NULL AND EXISTS(
		 SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state='interrupted' AND p.stream_id<c.stream_id
		 ) ORDER BY c.created_at,c.id LIMIT ?)`).run(now,bounded).changes);
	}
	/** Bounded, idempotent startup repair. Ambiguous rows cannot starve later evidence-backed rows. */
	reconcileInterrupted(limit=1000): { examined:number; reconciled:number; blockedSuccessorsFailed:number; ambiguous:number; errors:number } {
		const bounded=Math.max(1,Math.min(1000,Math.trunc(limit)||1));
		let rows:Array<{id:string}>=[];
		try{rows=this.store.db.prepare(`SELECT id FROM message_commands WHERE state='interrupted' AND ${terminalEvidenceSql} IN ('completed','failed') ORDER BY updated_at,id LIMIT ?`).all(bounded) as Array<{id:string}>;}
		catch{return {examined:0,reconciled:0,blockedSuccessorsFailed:0,ambiguous:0,errors:1};}
		let reconciled=0,errors=0;
		for(const row of rows){
			try{reconciled+=this.store.transaction(()=>Number(this.store.db.prepare(`UPDATE message_commands SET state=${terminalEvidenceSql},error=NULL,owner = NULL,lease_until=0,updated_at=? WHERE id=? AND state='interrupted' AND ${terminalEvidenceSql} IN ('completed','failed')`).run(Date.now(),row.id).changes));}
			catch{errors++;}
		}
		let blockedSuccessorsFailed=0;try{blockedSuccessorsFailed=this.store.transaction(()=>this.terminalizeBlockedSuccessors(Date.now(),bounded));}catch{errors++;}
		const ambiguous=Number((this.store.db.prepare("SELECT count(*) n FROM message_commands WHERE state='interrupted'").get() as {n:number}).n);
		return {examined:rows.length,reconciled,blockedSuccessorsFailed,ambiguous,errors};
	}
	private recoverExpiredLeasesInTransaction(now:number, afterSelection?:()=>void): number {
		const rows=this.store.db.prepare("SELECT id FROM message_commands WHERE owner IS NOT NULL AND lease_until<=? ORDER BY lease_until,id LIMIT 100").all(now) as Array<{id:string}>;
		afterSelection?.();
		let changed=0;
		for(const row of rows){
			changed+=Number(this.store.db.prepare(`UPDATE message_commands SET
			 state=CASE WHEN ${terminalEvidenceSql} IN ('completed','failed') THEN ${terminalEvidenceSql} WHEN state='waiting_slot' THEN 'accepted' ELSE 'interrupted' END,
			 error=CASE WHEN ${terminalEvidenceSql} IN ('completed','failed') OR state='waiting_slot' THEN NULL ELSE 'Runtime ownership expired; execution requires reconciliation.' END,
			 owner = NULL,lease_until=0,updated_at=? WHERE id=? AND owner IS NOT NULL AND lease_until<=? AND state IN (${active})`).run(now,row.id,now).changes);
		}
		this.terminalizeBlockedSuccessors(now);
		return changed;
	}
	/** Public for deterministic recovery tests; production callers use claim(). */
	recoverExpiredLeases(now=Date.now(), barrier?:()=>void): number {
		return this.store.transaction(()=>this.recoverExpiredLeasesInTransaction(now,barrier));
	}
	claim(owner: string, leaseMs: number): MessageCommandClaim | undefined {
		const limits = MESSAGE_COMMAND_LIMITS.dispatch;
		const candidateSql = `WITH occupied AS (
		 SELECT room_id,delivery FROM message_commands WHERE owner IS NOT NULL AND state IN (${active})
		) SELECT c.* FROM message_commands c LEFT JOIN message_dispatch_rooms r ON r.room_id=c.room_id
		 WHERE c.state='accepted'
		 AND (SELECT count(*) FROM occupied o WHERE o.delivery=c.delivery) < CASE c.delivery WHEN 'steer' THEN ${limits.steer} ELSE ${limits.queue} END
		 AND (SELECT count(*) FROM occupied o WHERE o.delivery=c.delivery AND o.room_id=c.room_id) < CASE c.delivery WHEN 'steer' THEN ${limits.roomSteer} ELSE ${limits.roomQueue} END
		 AND NOT EXISTS (SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state IN (${active},'interrupted') AND p.stream_id<c.stream_id AND (c.delivery='queue' OR p.delivery='steer'))
		 ORDER BY CASE c.delivery WHEN 'steer' THEN 0 ELSE 1 END,COALESCE(r.sequence,0),c.stream_id LIMIT 1`;
		if (!this.store.db.prepare(candidateSql).get() && !this.store.db.prepare("SELECT 1 FROM message_commands WHERE owner IS NOT NULL AND lease_until <= ? LIMIT 1").get(Date.now())) return undefined;
		const row = this.store.transaction(() => {
			const now = Date.now();
			this.recoverExpiredLeasesInTransaction(now);
			const candidate = this.store.db.prepare(candidateSql).get() as Row | undefined;
			if (!candidate) return undefined;
			this.store.db.prepare("UPDATE message_dispatch_clock SET sequence=sequence+1 WHERE id=1").run();
			this.store.db.prepare("INSERT INTO message_dispatch_rooms(room_id,sequence) SELECT ?,sequence FROM message_dispatch_clock WHERE id=1 ON CONFLICT(room_id) DO UPDATE SET sequence=excluded.sequence").run(candidate.room_id);
			this.store.db.prepare("UPDATE message_commands SET state='waiting_slot',owner = ?,token=token+1,lease_until=?,updated_at=? WHERE id=?").run(owner,now+leaseMs,now,candidate.id);
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
	cancelPending(sessionId: string): number {
		return Number(this.store.db.prepare("UPDATE message_commands SET state='failed',error='Cancelled before runtime dispatch.',owner = NULL,lease_until=0,updated_at=? WHERE session_id=? AND state IN ('accepted','waiting_slot')").run(Date.now(),sessionId).changes);
	}
	transition(id: string, owner: string, token: number, state: MessageCommandState, error?: string): boolean {
		return Number(this.store.db.prepare(`UPDATE message_commands SET state=?,error=?,updated_at=?,owner = CASE WHEN ? IN ('completed','failed','interrupted') THEN NULL ELSE owner END,lease_until=CASE WHEN ? IN ('completed','failed','interrupted') THEN 0 ELSE lease_until END WHERE id=? AND owner = ? AND token=? AND lease_until>? AND state IN (${active})`).run(state,error?.slice(0,500)??null,Date.now(),state,state,id,owner,token,Date.now()).changes) === 1;
	}
	heartbeat(id: string, owner: string, token: number, leaseMs: number): boolean {
		return Number(this.store.db.prepare(`UPDATE message_commands SET lease_until=? WHERE id=? AND owner = ? AND token=? AND lease_until>? AND state IN (${active})`).run(Date.now()+leaseMs,id,owner,token,Date.now()).changes) === 1;
	}
	recordOutput(sessionId: string, eventId: string | undefined, type: string): void {
		if (!eventId) return;
		const states: Record<string, MessageCommandState> = { message_queued: "session_queue", message_started: "running", message_finished: "completed", session_error: "failed", message_steered: "completed" };
		const state = states[type];
		if (!state) return;
		const eligible = state === "session_queue" ? "'initializing','waiting_slot'" : state === "running" ? "'initializing','waiting_slot','session_queue'" : `${active},'interrupted'`;
		this.store.db.prepare(`UPDATE message_commands SET state=?,error=NULL,updated_at=?,owner = CASE WHEN ? IN ('completed','failed') THEN NULL ELSE owner END,lease_until=CASE WHEN ? IN ('completed','failed') THEN 0 ELSE lease_until END WHERE session_id=? AND event_id=? AND state IN (${eligible})`).run(state,Date.now(),state,state,sessionId,eventId);
	}
	health(now=Date.now(),scopeLimit=20): DurableMessageQueueHealth {
		const bounded=Math.max(1,Math.min(100,Math.trunc(scopeLimit)||20));
		const activeRowsLimit=MESSAGE_COMMAND_LIMITS.queue.count+MESSAGE_COMMAND_LIMITS.steer.count+1;
		const counts=(this.store.db.prepare("SELECT state,delivery,command_count count,payload_bytes bytes FROM message_command_stats WHERE command_count>0 ORDER BY state,delivery").all() as Array<{state:MessageCommandState;delivery:"queue"|"steer";count:number;bytes:number}>);
		const interrupted=Number((this.store.db.prepare("SELECT count(*) n FROM message_commands WHERE state='interrupted'").get() as {n:number}).n);
		const expired=Number((this.store.db.prepare("SELECT count(*) n FROM message_commands WHERE owner IS NOT NULL AND lease_until<=?").get(now) as {n:number}).n);
		const blockedRows=this.store.db.prepare(`SELECT c.session_id,c.room_id,c.created_at,p.id blocking_id,p.created_at blocked_since
		 FROM message_commands c JOIN message_commands p ON p.id=(SELECT p2.id FROM message_commands p2 WHERE p2.session_id=c.session_id AND p2.state='interrupted' AND p2.stream_id<c.stream_id ORDER BY p2.stream_id LIMIT 1)
		 WHERE c.state IN (${unstarted}) AND c.delivery='queue' ORDER BY c.created_at,c.id LIMIT ?`).all(bounded) as Array<{session_id:string;room_id:string;created_at:number;blocking_id:string;blocked_since:number}>;
		const blockedCount=Number((this.store.db.prepare(`SELECT count(*) n FROM message_commands c WHERE c.state IN (${unstarted}) AND c.delivery='queue' AND EXISTS(SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state='interrupted' AND p.stream_id<c.stream_id)`).get() as {n:number}).n);
		const oldestDispatchable=this.store.db.prepare(`SELECT created_at FROM message_commands c WHERE c.state IN (${unstarted}) AND NOT EXISTS(SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state='interrupted' AND p.stream_id<c.stream_id) ORDER BY created_at LIMIT 1`).get() as {created_at:number}|undefined;
		const scopes=new Map<string,{sessionId:string;roomId:string;blockingCommandId:string;blockedSince:number;blockedSuccessors:number}>();
		for(const row of blockedRows){const prior=scopes.get(row.session_id);if(prior)prior.blockedSuccessors++;else scopes.set(row.session_id,{sessionId:row.session_id,roomId:row.room_id,blockingCommandId:row.blocking_id,blockedSince:row.blocked_since,blockedSuccessors:1});}
		if(interrupted>0){
			for(const row of this.store.db.prepare("SELECT session_id,room_id,id,created_at FROM message_commands WHERE state='interrupted' ORDER BY created_at LIMIT ?").all(bounded) as Array<{session_id:string;room_id:string;id:string;created_at:number}>){if(!scopes.has(row.session_id))scopes.set(row.session_id,{sessionId:row.session_id,roomId:row.room_id,blockingCommandId:row.id,blockedSince:row.created_at,blockedSuccessors:0});}
		}
		const activeRows=this.store.db.prepare(`SELECT session_id,room_id,delivery,payload_bytes,created_at,state,NOT EXISTS(SELECT 1 FROM message_commands p WHERE p.session_id=c.session_id AND p.state='interrupted' AND p.stream_id<c.stream_id) dispatchable FROM message_commands c WHERE state IN (${active}) ORDER BY created_at,id LIMIT ?`).all(activeRowsLimit) as Array<Pick<Row,"session_id"|"room_id"|"delivery"|"payload_bytes"|"created_at"|"state">&{dispatchable:number}>;
		const capacityReasons:string[]=[];
		const activeStates=new Set<MessageCommandState>(["accepted","waiting_slot","initializing","session_queue","running"]);
		const globalTotals=(delivery:"queue"|"steer")=>counts.filter(row=>row.delivery===delivery&&activeStates.has(row.state)).reduce((total,row)=>({count:total.count+row.count,bytes:total.bytes+row.bytes}),{count:0,bytes:0});
		const summarizeCapacity=(rows:typeof activeRows,delivery:"queue"|"steer",scope:"global"|"room"|"session")=>{const selected=rows.filter(row=>row.delivery===delivery),limits=MESSAGE_COMMAND_LIMITS[delivery],countLimit=scope==="global"?limits.count:scope==="room"?limits.roomCount:limits.sessionCount,byteLimit=scope==="global"?limits.bytes:scope==="room"?limits.roomBytes:limits.sessionBytes,ageLimit=scope==="global"?limits.ageMs:scope==="room"?limits.roomAgeMs:limits.sessionAgeMs,totals=scope==="global"?globalTotals(delivery):{count:selected.length,bytes:selected.reduce((sum,row)=>sum+row.payload_bytes,0)},count=totals.count,bytes=totals.bytes,oldestDispatchableWaitMs=Math.max(0,...selected.filter(row=>row.dispatchable===1&&(row.state==="accepted"||row.state==="waiting_slot")).map(row=>now-row.created_at)),reasons=[...(count>=countLimit?[`count ${count}/${countLimit}`]:[]),...(bytes>=byteLimit?[`bytes ${bytes}/${byteLimit}`]:[]),...(oldestDispatchableWaitMs>=ageLimit?[`dispatchable wait ${oldestDispatchableWaitMs}ms/${ageLimit}ms`]:[])];return {delivery,count,bytes,oldestDispatchableWaitMs,available:reasons.length===0,degradedReasons:reasons};};
		const globalCapacity=(["queue","steer"] as const).map(delivery=>summarizeCapacity(activeRows,delivery,"global"));
		const roomKeys=[...new Set(activeRows.map(row=>row.room_id))],sessionKeys=[...new Set(activeRows.map(row=>row.session_id))];
		const roomCapacity=roomKeys.flatMap(roomId=>(["queue","steer"] as const).map(delivery=>({roomId,...summarizeCapacity(activeRows.filter(row=>row.room_id===roomId),delivery,"room")}))).filter(row=>!row.available).slice(0,bounded);
		const sessionCapacity=sessionKeys.flatMap(sessionId=>(["queue","steer"] as const).map(delivery=>({sessionId,roomId:activeRows.find(row=>row.session_id===sessionId)?.room_id??"unknown",...summarizeCapacity(activeRows.filter(row=>row.session_id===sessionId),delivery,"session")}))).filter(row=>!row.available).slice(0,bounded);
		for(const row of globalCapacity.filter(row=>!row.available))capacityReasons.push(`global ${row.delivery} admission degraded: ${row.degradedReasons.join(", ")}`);
		for(const row of roomCapacity)capacityReasons.push(`room ${row.roomId} ${row.delivery} admission degraded: ${row.degradedReasons.join(", ")}`);
		for(const row of sessionCapacity)capacityReasons.push(`session ${row.sessionId} ${row.delivery} admission degraded: ${row.degradedReasons.join(", ")}`);
		const degradedReasons=[...(interrupted?[`${interrupted} interrupted predecessor(s) require reconciliation`]:[]),...(blockedCount?[`${blockedCount} successor(s) are blocked by FIFO`]:[]),...(expired?[`${expired} owned lease(s) are expired`]:[]),...capacityReasons];
		return {status:degradedReasons.length?"degraded":"healthy",storage:{available:true},counts,interruptedPredecessors:interrupted,blockedSuccessors:blockedCount,expiredOwnedLeases:expired,oldestDispatchableWaitMs:oldestDispatchable?Math.max(0,now-oldestDispatchable.created_at):0,oldestBlockedWaitMs:blockedRows.length?Math.max(...blockedRows.map(row=>Math.max(0,now-row.created_at))):0,affectedScopes:[...scopes.values()].slice(0,bounded),limits:MESSAGE_COMMAND_LIMITS,degradedReasons,admissionCapacity:{global:globalCapacity,rooms:roomCapacity,sessions:sessionCapacity},bounded:{scopeLimit:bounded,activeRowsLimit,activeRowsTruncated:activeRows.length===activeRowsLimit,affectedScopesTruncated:interrupted>bounded||scopes.size>bounded||blockedCount>blockedRows.length}};
	}
}
function receipt(row: Row): MessageReceipt {
	return { id:row.id,sessionId:row.session_id,roomId:row.room_id,eventId:row.event_id,streamId:row.stream_id,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,...(row.error?{error:row.error}:{}) };
}
function domainError(code: string, message: string, details:Record<string,unknown>={}): Error { return Object.assign(new Error(message),{code,...details}); }
