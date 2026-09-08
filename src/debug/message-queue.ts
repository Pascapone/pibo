import { PiboDataStore } from "../data/pibo-store.js";
import { MessageCommandStore, type MessageCommandState } from "../data/message-command-store.js";

const ACTIVE_STATES=new Set<MessageCommandState>(["accepted","waiting_slot","initializing","session_queue","running"]);
type CommandRow={id:string;request_key:string;session_id:string;room_id:string;event_id:string;stream_id:number;delivery:"queue"|"steer";state:MessageCommandState;owner:string|null;token:number;lease_until:number;created_at:number;updated_at:number;error:string|null};
export type MessageQueueInspection={
	generatedAt:string;
	sessionId?:string;
	commands:Array<{id:string;context:"active"|"recent_terminal";sessionId:string;roomId:string;eventId:string;streamId:number;delivery:string;state:MessageCommandState;owner?:string;lease:{until:number;fresh:boolean};createdAt:number;updatedAt:number;error?:string;previousCommandId?:string;nextCommandId?:string;blockedBy?:string;blocks:string[];blocksTruncated:boolean;terminalOutcome:"completed"|"failed"|"ambiguous";terminalEvidence:ReturnType<MessageCommandStore["terminalEvidence"]>}>;
	health:ReturnType<MessageCommandStore["health"]>;
	truncated:boolean;
	pagination:{active:{returned:number;truncated:boolean;afterStreamId:number;nextAfterStreamId?:number};terminalContext:{returned:number;truncated:boolean;beforeStreamId?:number;nextBeforeStreamId?:number}};
	nextCommands:string[];
};
export type ReconcileDecision="mark-failed"|"confirm-completed";
export type ReconcileOptions={
	commandId:string;
	decision:ReconcileDecision;
	apply?:boolean;
	confirmWithoutEvidence?:string;
	cancelSuccessors?:boolean;
	cancelSuccessorIds?:string[];
	expected?:{state:MessageCommandState;token:number;updatedAt:number};
	actor?:string;
	now?:number;
	beforeAudit?:()=>void;
};

const commandColumns="id,request_key,session_id,room_id,event_id,stream_id,delivery,state,owner,token,lease_until,created_at,updated_at,error";

export function inspectMessageQueue(store:PiboDataStore,input:{sessionId?:string;limit?:number;now?:number;afterStreamId?:number;beforeTerminalStreamId?:number}={}):MessageQueueInspection{
	const now=input.now??Date.now(),activeLimit=Math.max(1,Math.min(500,input.limit??200)),terminalLimit=Math.min(20,activeLimit),after=Math.max(0,Math.trunc(input.afterStreamId??0));
	const activeRows=(input.sessionId
		?store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE session_id=? AND state IN ('accepted','waiting_slot','initializing','session_queue','running','interrupted') AND stream_id>? ORDER BY stream_id LIMIT ?`).all(input.sessionId,after,activeLimit+1)
		:store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE state IN ('accepted','waiting_slot','initializing','session_queue','running','interrupted') AND stream_id>? ORDER BY stream_id LIMIT ?`).all(after,activeLimit+1)) as CommandRow[];
	const terminalBefore=input.beforeTerminalStreamId;
	const terminalRows=(input.sessionId
		?terminalBefore===undefined
			?store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE session_id=? AND state IN ('completed','failed') ORDER BY stream_id DESC LIMIT ?`).all(input.sessionId,terminalLimit+1)
			:store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE session_id=? AND state IN ('completed','failed') AND stream_id<? ORDER BY stream_id DESC LIMIT ?`).all(input.sessionId,terminalBefore,terminalLimit+1)
		:terminalBefore===undefined
			?store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE state IN ('completed','failed') ORDER BY stream_id DESC LIMIT ?`).all(terminalLimit+1)
			:store.db.prepare(`SELECT ${commandColumns} FROM message_commands WHERE state IN ('completed','failed') AND stream_id<? ORDER BY stream_id DESC LIMIT ?`).all(terminalBefore,terminalLimit+1)) as CommandRow[];
	const activeTruncated=activeRows.length>activeLimit,terminalTruncated=terminalRows.length>terminalLimit,active=activeRows.slice(0,activeLimit),terminal=terminalRows.slice(0,terminalLimit);
	const contextById=new Map<string,"active"|"recent_terminal">([...terminal.map(row=>[row.id,"recent_terminal"] as const),...active.map(row=>[row.id,"active"] as const)]);
	const selected=[...new Map([...terminal,...active].map(row=>[row.id,row])).values()].sort((a,b)=>a.stream_id-b.stream_id),commands=new MessageCommandStore(store);
	const projected=selected.map(row=>{
		const previous=store.db.prepare("SELECT id FROM message_commands WHERE session_id=? AND stream_id<? ORDER BY stream_id DESC LIMIT 1").get(row.session_id,row.stream_id) as {id:string}|undefined;
		const next=store.db.prepare("SELECT id FROM message_commands WHERE session_id=? AND stream_id>? ORDER BY stream_id LIMIT 1").get(row.session_id,row.stream_id) as {id:string}|undefined;
		const blocker=ACTIVE_STATES.has(row.state)||row.state==="interrupted"?store.db.prepare(`SELECT id FROM message_commands WHERE session_id=? AND stream_id<? AND state IN ('accepted','waiting_slot','initializing','session_queue','running','interrupted') AND (?='queue' OR delivery='steer') ORDER BY stream_id LIMIT 1`).get(row.session_id,row.stream_id,row.delivery) as {id:string}|undefined:undefined;
		const blockingRows=row.state==="interrupted"?store.db.prepare(`SELECT id FROM message_commands WHERE session_id=? AND stream_id>? AND state IN ('accepted','waiting_slot','initializing','session_queue','running') AND (delivery='queue' OR ?='steer') ORDER BY stream_id LIMIT 201`).all(row.session_id,row.stream_id,row.delivery) as Array<{id:string}>:[];
		return {id:row.id,context:contextById.get(row.id)??"recent_terminal",sessionId:row.session_id,roomId:row.room_id,eventId:row.event_id,streamId:row.stream_id,delivery:row.delivery,state:row.state,...(row.owner?{owner:row.owner}:{}),lease:{until:row.lease_until,fresh:Boolean(row.owner&&row.lease_until>now)},createdAt:row.created_at,updatedAt:row.updated_at,...(row.error?{error:row.error}:{}),...(previous?{previousCommandId:previous.id}:{}),...(next?{nextCommandId:next.id}:{}),...(blocker&&blocker.id!==row.id?{blockedBy:blocker.id}:{}),blocks:blockingRows.slice(0,200).map(item=>item.id),blocksTruncated:blockingRows.length>200,terminalOutcome:commands.terminalOutcome(row.session_id,row.event_id)??("ambiguous" as const),terminalEvidence:commands.terminalEvidence(row.session_id,row.event_id)};
	});
	const nextCommands=input.sessionId?[`pibo debug message-queue reconcile <command-id> --mark-failed --dry-run`,`pibo debug message-queue reconcile <command-id> --mark-failed --apply`]:["pibo debug message-queue inspect --session <pibo-session-id>"];
	if(activeTruncated&&active.length)nextCommands.push(`pibo debug message-queue inspect --session ${input.sessionId??"<pibo-session-id>"} --after-stream ${active.at(-1)!.stream_id}`);
	if(terminalTruncated&&terminal.length)nextCommands.push(`pibo debug message-queue inspect --session ${input.sessionId??"<pibo-session-id>"} --before-terminal-stream ${Math.min(...terminal.map(row=>row.stream_id))}`);
	return {generatedAt:new Date(now).toISOString(),sessionId:input.sessionId,commands:projected,health:commands.health(now),truncated:activeTruncated||terminalTruncated,pagination:{active:{returned:active.length,truncated:activeTruncated,afterStreamId:after,...(activeTruncated&&active.length?{nextAfterStreamId:active.at(-1)!.stream_id}:{})},terminalContext:{returned:terminal.length,truncated:terminalTruncated,...(terminalBefore!==undefined?{beforeStreamId:terminalBefore}:{}),...(terminalTruncated&&terminal.length?{nextBeforeStreamId:Math.min(...terminal.map(row=>row.stream_id))}:{})}},nextCommands};
}

function readCommand(store:PiboDataStore,id:string):CommandRow|undefined{
	return store.db.prepare("SELECT id,request_key,session_id,room_id,event_id,stream_id,delivery,state,owner,token,lease_until,created_at,updated_at,error FROM message_commands WHERE id=?").get(id) as CommandRow|undefined;
}
function successorRows(store:PiboDataStore,row:CommandRow):CommandRow[]{
	return store.db.prepare("SELECT id,request_key,session_id,room_id,event_id,stream_id,delivery,state,owner,token,lease_until,created_at,updated_at,error FROM message_commands WHERE session_id=? AND stream_id>? AND state IN ('accepted','waiting_slot') ORDER BY stream_id LIMIT 200").all(row.session_id,row.stream_id) as CommandRow[];
}
function projection(row:CommandRow,state:MessageCommandState,error?:string|null){return {id:row.id,sessionId:row.session_id,eventId:row.event_id,priorState:row.state,resultingState:state,error:error??undefined,token:row.token,updatedAt:row.updated_at};}

export function reconcileMessageCommand(store:PiboDataStore,options:ReconcileOptions){
	if(!/^cmd_[A-Za-z0-9-]+$/.test(options.commandId))throw new Error("Reconciliation requires one exact command ID (cmd_...).");
	const now=options.now??Date.now(),commands=new MessageCommandStore(store);
	const action=()=>{
		const row=readCommand(store,options.commandId);if(!row)throw new Error(`Unknown durable message command "${options.commandId}".`);
		const desired:MessageCommandState=options.decision==="mark-failed"?"failed":"completed";
		if(row.state===desired){
			const priorAudit=store.eventLog.findByIdempotencyKey(`message-command-reconcile:${row.id}:${options.decision}`);
			if(!priorAudit)throw new Error(`Command ${row.id} is already ${row.state}, but no matching reconciliation audit exists; inspect the current state.`);
			return {applied:false,alreadyApplied:true,decision:options.decision,command:projection(row,desired,row.error),successors:[],auditEventId:priorAudit.eventId,health:commands.health(now),nextAction:`pibo debug message-queue inspect --session ${row.session_id}`};
		}
		if(options.expected&&(row.state!==options.expected.state||row.token!==options.expected.token||row.updated_at!==options.expected.updatedAt))throw Object.assign(new Error("Command changed after inspection; inspect again before applying."),{code:"command_snapshot_changed"});
		if(row.state!=="interrupted")throw new Error(`Command ${row.id} is ${row.state}; only an interrupted command may be reconciled.`);
		if(row.owner&&row.lease_until>now)throw Object.assign(new Error(`Command ${row.id} still has a live owner lease; reconciliation refused.`),{code:"command_live_lease"});
		const evidence=commands.terminalEvidence(row.session_id,row.event_id),authoritativeCompleted=commands.terminalOutcome(row.session_id,row.event_id)==="completed";
		if(options.decision==="confirm-completed"&&!authoritativeCompleted&&options.confirmWithoutEvidence!==row.id)throw new Error(`No unambiguous completed terminal evidence exists. To explicitly confirm side effects, add --confirm-without-evidence ${row.id}.`);
		const candidates=successorRows(store,row),selected=options.cancelSuccessors?candidates:options.cancelSuccessorIds?.length?options.cancelSuccessorIds.map(id=>{const found=candidates.find(item=>item.id===id);if(!found)throw new Error(`Successor ${id} is not an unstarted FIFO successor of ${row.id}.`);return found;}):[];
		const liveSuccessor=selected.find(item=>Boolean(item.owner&&item.lease_until>now));
		if(liveSuccessor)throw Object.assign(new Error(`Selected successor ${liveSuccessor.id} still has a live owner lease; the entire reconciliation was refused.`),{code:"command_successor_live_lease",blockingCommandId:liveSuccessor.id,leaseUntil:liveSuccessor.lease_until});
		const resultError=desired==="failed"?"Operator marked interrupted durable message failed; command was not replayed.":null;
		const plan={applied:false,alreadyApplied:false,decision:options.decision,command:projection(row,desired,resultError),successors:selected.map(item=>projection(item,"failed","Cancelled during explicit predecessor reconciliation; command was never dispatched.")),evidence,healthBefore:commands.health(now),nextAction:`pibo debug message-queue inspect --session ${row.session_id}`};
		if(!options.apply)return plan;
		const changed=Number(store.db.prepare("UPDATE message_commands SET state=?,error=?,owner=NULL,lease_until=0,updated_at=? WHERE id=? AND state='interrupted' AND token=? AND updated_at=?").run(desired,resultError,now,row.id,row.token,row.updated_at).changes);
		if(changed!==1)throw Object.assign(new Error("Command changed during reconciliation; transaction rolled back."),{code:"command_snapshot_changed"});
		for(const item of selected){const successorChanged=Number(store.db.prepare("UPDATE message_commands SET state='failed',error='Cancelled during explicit predecessor reconciliation; command was never dispatched.',owner=NULL,lease_until=0,updated_at=? WHERE id=? AND state IN ('accepted','waiting_slot') AND token=? AND updated_at=?").run(now,item.id,item.token,item.updated_at).changes);if(successorChanged!==1)throw Object.assign(new Error(`Successor ${item.id} changed during reconciliation; transaction rolled back.`),{code:"command_snapshot_changed"});}
		const iso=new Date(now).toISOString();
		// Session/navigation status is owned by current runtime and terminal product output.
		// Reconciling a historical receipt must not overwrite a newer turn or live steer.
		store.db.prepare("UPDATE telemetry_turns SET status=?,current_phase='reconciled',completed_at=COALESCE(completed_at,?),last_progress_at=?,updated_at=? WHERE pibo_session_id=? AND event_id=? AND status NOT IN ('completed','failed')").run(desired,iso,iso,iso,row.session_id,row.event_id);
		options.beforeAudit?.();
		const actor=(options.actor??process.env.USER??"operator").replace(/[^A-Za-z0-9_.@-]/g,"_").slice(0,100)||"operator";
		const audit=store.eventLog.appendEvent({sessionId:row.session_id,roomId:row.room_id,topic:"pibo.audit",type:"durable_message_command.reconciled",source:"pibo-debug-cli",actorType:"operator",actorId:actor,eventId:`reconcile:${row.id}:${options.decision}`,idempotencyKey:`message-command-reconcile:${row.id}:${options.decision}`,retentionClass:"audit_event",previewText:`Durable command ${options.decision}`,attributes:{commandId:row.id,eventId:row.event_id,decision:options.decision,priorState:row.state,resultingState:desired,evidenceStreamIds:evidence.map(item=>item.streamId),affectedSuccessorIds:selected.map(item=>item.id),actor,source:"pibo-debug-cli",occurredAt:iso,replay:false}});
		return {...plan,applied:true,auditEventId:audit.eventId,health:commands.health(now)};
	};
	return options.apply?store.transaction(action):action();
}

export function formatMessageQueueInspection(result:MessageQueueInspection):string{
	const lines=["Durable message queue",`  status: ${result.health.status}`,`  interrupted: ${result.health.interruptedPredecessors}`,`  FIFO blocked: ${result.health.blockedSuccessors}`,`  expired leases: ${result.health.expiredOwnedLeases}`];
	for(const row of result.commands){lines.push(`  stream=${row.streamId} ${row.id} context=${row.context} state=${row.state} delivery=${row.delivery} session=${row.sessionId} event=${row.eventId} owner=${row.owner??"-"} lease=${row.lease.fresh?"fresh":"stale/none"}${row.previousCommandId?` previous=${row.previousCommandId}`:""}${row.nextCommandId?` next=${row.nextCommandId}`:""}${row.blockedBy?` blockedBy=${row.blockedBy}`:""}`);if(row.terminalEvidence.length)lines.push(`     evidence: outcome=${row.terminalOutcome??"ambiguous"} ${row.terminalEvidence.map(item=>`${item.type}@${item.streamId}`).join(", ")}`);if(row.blocks.length)lines.push(`     blocks: ${row.blocks.join(", ")}`);}
	lines.push("Next:",...result.nextCommands.map(command=>`  ${command}`));return lines.join("\n");
}

export function formatMessageQueueReconciliation(result:ReturnType<typeof reconcileMessageCommand>):string{
	const mode="alreadyApplied" in result&&result.alreadyApplied?"already applied":result.applied?"applied":"dry-run";
	return [`Durable message reconciliation (${mode})`,`  command: ${result.command.id}`,`  transition: ${result.command.priorState} -> ${result.command.resultingState}`,`  successors: ${result.successors.map(item=>item.id).join(", ")||"none"}`,`  replay: never`,...("auditEventId" in result&&result.auditEventId?[`  audit event: ${result.auditEventId}`]:[]),`  next: ${result.nextAction}`].join("\n");
}
