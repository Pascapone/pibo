import { PiboDataStore } from "../data/pibo-store.js";
import { MessageCommandStore, type MessageCommandState } from "../data/message-command-store.js";

const ACTIVE_STATES=new Set<MessageCommandState>(["accepted","waiting_slot","initializing","session_queue","running"]);
type CommandRow={id:string;request_key:string;session_id:string;room_id:string;event_id:string;stream_id:number;delivery:"queue"|"steer";state:MessageCommandState;owner:string|null;token:number;lease_until:number;created_at:number;updated_at:number;error:string|null};
export type MessageQueueInspection={
	generatedAt:string;
	sessionId?:string;
	commands:Array<{id:string;fifo:number;sessionId:string;roomId:string;eventId:string;streamId:number;delivery:string;state:MessageCommandState;owner?:string;lease:{until:number;fresh:boolean};createdAt:number;updatedAt:number;error?:string;blockedBy?:string;blocks:string[];terminalEvidence:ReturnType<MessageCommandStore["terminalEvidence"]>}>;
	health:ReturnType<MessageCommandStore["health"]>;
	truncated:boolean;
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

function commandRows(store:PiboDataStore,sessionId?:string,limit=200):CommandRow[]{
	const bounded=Math.max(1,Math.min(500,limit));
	return (sessionId
		?store.db.prepare("SELECT id,request_key,session_id,room_id,event_id,stream_id,delivery,state,owner,token,lease_until,created_at,updated_at,error FROM message_commands WHERE session_id=? ORDER BY stream_id LIMIT ?").all(sessionId,bounded)
		:store.db.prepare("SELECT id,request_key,session_id,room_id,event_id,stream_id,delivery,state,owner,token,lease_until,created_at,updated_at,error FROM message_commands WHERE state IN ('accepted','waiting_slot','initializing','session_queue','running','interrupted') ORDER BY created_at,id LIMIT ?").all(bounded)) as CommandRow[];
}

export function inspectMessageQueue(store:PiboDataStore,input:{sessionId?:string;limit?:number;now?:number}={}):MessageQueueInspection{
	const now=input.now??Date.now(),limit=Math.max(1,Math.min(500,input.limit??200));
	const rows=commandRows(store,input.sessionId,limit+1),selected=rows.slice(0,limit),commands=new MessageCommandStore(store);
	const bySession=new Map<string,CommandRow[]>();for(const row of selected){const list=bySession.get(row.session_id)??[];list.push(row);bySession.set(row.session_id,list);}
	return {generatedAt:new Date(now).toISOString(),sessionId:input.sessionId,commands:selected.map((row,index)=>{
		const siblings=bySession.get(row.session_id)??[];
		const blocker=siblings.find(candidate=>candidate.state==="interrupted"&&candidate.stream_id<row.stream_id);
		const blocks=siblings.filter(candidate=>row.state==="interrupted"&&ACTIVE_STATES.has(candidate.state)&&candidate.stream_id>row.stream_id).map(candidate=>candidate.id);
		return {id:row.id,fifo:index+1,sessionId:row.session_id,roomId:row.room_id,eventId:row.event_id,streamId:row.stream_id,delivery:row.delivery,state:row.state,...(row.owner?{owner:row.owner}:{}),lease:{until:row.lease_until,fresh:Boolean(row.owner&&row.lease_until>now)},createdAt:row.created_at,updatedAt:row.updated_at,...(row.error?{error:row.error}:{}),...(blocker?{blockedBy:blocker.id}:{}),blocks,terminalEvidence:commands.terminalEvidence(row.session_id,row.event_id)};
	}),health:commands.health(now),truncated:rows.length>limit,nextCommands:input.sessionId?[`pibo debug message-queue reconcile <command-id> --mark-failed --dry-run`,`pibo debug message-queue reconcile <command-id> --mark-failed --apply`]:["pibo debug message-queue inspect --session <pibo-session-id>"]};
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
	return store.transaction(()=>{
		const row=readCommand(store,options.commandId);if(!row)throw new Error(`Unknown durable message command "${options.commandId}".`);
		const desired:MessageCommandState=options.decision==="mark-failed"?"failed":"completed";
		if(row.state===desired){return {applied:false,alreadyApplied:true,decision:options.decision,command:projection(row,desired,row.error),successors:[],auditEventId:undefined,health:commands.health(now),nextAction:`pibo debug message-queue inspect --session ${row.session_id}`};}
		if(options.expected&&(row.state!==options.expected.state||row.token!==options.expected.token||row.updated_at!==options.expected.updatedAt))throw Object.assign(new Error("Command changed after inspection; inspect again before applying."),{code:"command_snapshot_changed"});
		if(row.state!=="interrupted")throw new Error(`Command ${row.id} is ${row.state}; only an interrupted command may be reconciled.`);
		if(row.owner&&row.lease_until>now)throw Object.assign(new Error(`Command ${row.id} still has a live owner lease; reconciliation refused.`),{code:"command_live_lease"});
		const evidence=commands.terminalEvidence(row.session_id,row.event_id),authoritativeCompleted=evidence.length>0&&evidence.every(item=>item.state==="completed");
		if(options.decision==="confirm-completed"&&!authoritativeCompleted&&options.confirmWithoutEvidence!==row.id)throw new Error(`No unambiguous completed terminal evidence exists. To explicitly confirm side effects, add --confirm-without-evidence ${row.id}.`);
		const candidates=successorRows(store,row),selected=options.cancelSuccessors?candidates:options.cancelSuccessorIds?.length?options.cancelSuccessorIds.map(id=>{const found=candidates.find(item=>item.id===id);if(!found)throw new Error(`Successor ${id} is not an unstarted FIFO successor of ${row.id}.`);return found;}):[];
		const resultError=desired==="failed"?"Operator marked interrupted durable message failed; command was not replayed.":null;
		const plan={applied:false,alreadyApplied:false,decision:options.decision,command:projection(row,desired,resultError),successors:selected.map(item=>projection(item,"failed","Cancelled during explicit predecessor reconciliation; command was never dispatched.")),evidence,healthBefore:commands.health(now),nextAction:`pibo debug message-queue inspect --session ${row.session_id}`};
		if(!options.apply)return plan;
		const changed=Number(store.db.prepare("UPDATE message_commands SET state=?,error=?,owner=NULL,lease_until=0,updated_at=? WHERE id=? AND state='interrupted' AND token=? AND updated_at=?").run(desired,resultError,now,row.id,row.token,row.updated_at).changes);
		if(changed!==1)throw Object.assign(new Error("Command changed during reconciliation; transaction rolled back."),{code:"command_snapshot_changed"});
		for(const item of selected){const successorChanged=Number(store.db.prepare("UPDATE message_commands SET state='failed',error='Cancelled during explicit predecessor reconciliation; command was never dispatched.',owner=NULL,lease_until=0,updated_at=? WHERE id=? AND state IN ('accepted','waiting_slot') AND token=? AND updated_at=?").run(now,item.id,item.token,item.updated_at).changes);if(successorChanged!==1)throw Object.assign(new Error(`Successor ${item.id} changed during reconciliation; transaction rolled back.`),{code:"command_snapshot_changed"});}
		const iso=new Date(now).toISOString(),sessionStatus=desired==="failed"?"error":"idle";
		store.db.prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?").run(sessionStatus,iso,row.session_id);
		store.db.prepare("UPDATE session_navigation SET status=?,updated_at=? WHERE session_id=?").run(sessionStatus,iso,row.session_id);
		store.db.prepare("UPDATE telemetry_turns SET status=?,current_phase='reconciled',completed_at=COALESCE(completed_at,?),last_progress_at=?,updated_at=? WHERE pibo_session_id=? AND event_id=? AND status NOT IN ('completed','failed')").run(desired,iso,iso,iso,row.session_id,row.event_id);
		options.beforeAudit?.();
		const actor=(options.actor??process.env.USER??"operator").replace(/[^A-Za-z0-9_.@-]/g,"_").slice(0,100)||"operator";
		const audit=store.eventLog.appendEvent({sessionId:row.session_id,roomId:row.room_id,topic:"pibo.audit",type:"durable_message_command.reconciled",source:"pibo-debug-cli",actorType:"operator",actorId:actor,eventId:`reconcile:${row.id}:${row.token}:${row.updated_at}`,idempotencyKey:`message-command-reconcile:${row.id}:${row.token}:${row.updated_at}:${options.decision}`,retentionClass:"audit_event",previewText:`Durable command ${options.decision}`,attributes:{commandId:row.id,eventId:row.event_id,decision:options.decision,priorState:row.state,resultingState:desired,evidenceStreamIds:evidence.map(item=>item.streamId),affectedSuccessorIds:selected.map(item=>item.id),actor,source:"pibo-debug-cli",occurredAt:iso,replay:false}});
		return {...plan,applied:true,auditEventId:audit.eventId,health:commands.health(now)};
	});
}

export function formatMessageQueueInspection(result:MessageQueueInspection):string{
	const lines=["Durable message queue",`  status: ${result.health.status}`,`  interrupted: ${result.health.interruptedPredecessors}`,`  FIFO blocked: ${result.health.blockedSuccessors}`,`  expired leases: ${result.health.expiredOwnedLeases}`];
	for(const row of result.commands){lines.push(`  ${row.fifo}. ${row.id} state=${row.state} delivery=${row.delivery} session=${row.sessionId} event=${row.eventId} owner=${row.owner??"-"} lease=${row.lease.fresh?"fresh":"stale/none"}${row.blockedBy?` blockedBy=${row.blockedBy}`:""}`);if(row.terminalEvidence.length)lines.push(`     evidence: ${row.terminalEvidence.map(item=>`${item.type}@${item.streamId}`).join(", ")}`);if(row.blocks.length)lines.push(`     blocks: ${row.blocks.join(", ")}`);}
	lines.push("Next:",...result.nextCommands.map(command=>`  ${command}`));return lines.join("\n");
}

export function formatMessageQueueReconciliation(result:ReturnType<typeof reconcileMessageCommand>):string{
	const mode="alreadyApplied" in result&&result.alreadyApplied?"already applied":result.applied?"applied":"dry-run";
	return [`Durable message reconciliation (${mode})`,`  command: ${result.command.id}`,`  transition: ${result.command.priorState} -> ${result.command.resultingState}`,`  successors: ${result.successors.map(item=>item.id).join(", ")||"none"}`,`  replay: never`,...("auditEventId" in result&&result.auditEventId?[`  audit event: ${result.auditEventId}`]:[]),`  next: ${result.nextAction}`].join("\n");
}
