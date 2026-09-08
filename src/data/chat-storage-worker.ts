import { MessageCommandStore, type MessageCommandState } from "./message-command-store.js";
import { parentPort, workerData } from "node:worker_threads";
import { ChatRoomService } from "../apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../apps/chat/data/session-query-service.js";
import { isPiboRoomArchived } from "../apps/chat/types/rooms.js";
import type { PiboCompactionStats } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";
import { PiboDataStore } from "./pibo-store.js";
import { ChatEventCommandService, chatClientTransactionKey } from "../apps/chat/data/event-command-service.js";
import type { ChatEventAppendInput } from "../apps/chat/types/event-store.js";
import { ChatDataIngestService, type UserMessageAcceptedIngestInput, type OutputEventIngestInput } from "./ingest-service.js";
import { boundedMessageBytes } from "./bounded-worker-client.js";

export type ChatStorageCommand =
	| { type: "append"; input: ChatEventAppendInput }
	| { type: "find"; roomId: string; actorId: string; clientTxnId: string }
	| { type: "ingestUser"; input: UserMessageAcceptedIngestInput }
	| { type: "ingestOutput"; input: OutputEventIngestInput }
	| { type: "resolveRoom"; roomId?: string; required?: boolean }
	| { type: "admit"; input: ChatEventAppendInput; session: PiboSession; text: string; durableCommand?: { eventId: string; delivery: "queue" | "steer" } }
	| { type: "cancelPendingCommands"; sessionId: string }
	| { type: "commandReceipt"; id: string }
	| { type: "commandReceipts"; sessionId: string }
	| { type: "commandReceiptPage"; sessionId: string }
	| { type: "claimCommand"; owner: string; leaseMs: number }
	| { type: "transitionCommand"; id: string; owner: string; token: number; state: MessageCommandState; error?: string }
	| { type: "heartbeatCommand"; id: string; owner: string; token: number; leaseMs: number }
	| { type: "durableQueueHealth" }
	| { type: "status" };

type Configuration = { path: string; payloadRootDir: string };
type Request = { id: number; command: ChatStorageCommand; deadline: number; maxResultBytes: number };
const port = parentPort;
if (!port) throw new Error("Chat storage requires a dedicated worker.");
const config = workerData as Configuration;
const store = new PiboDataStore(config.path, { payloadRootDir: config.payloadRootDir });
// Lock waiting is bounded independently of SQL execution; retries yield this worker.
store.db.exec("PRAGMA busy_timeout=10");
const commands = new ChatEventCommandService(store);
const ingest = new ChatDataIngestService(store);
const rooms = new ChatRoomService(store);
const sessions = new ChatSessionQueryService(store);
const messageCommands = new MessageCommandStore(store);
// Startup repair is bounded and conservative: terminal evidence may settle a receipt,
// but ambiguous work is retained and never replayed. A damaged row must not stop the worker.
let startupReconciliation: ReturnType<MessageCommandStore["reconcileInterrupted"]> | { error: string };
try { startupReconciliation = messageCommands.reconcileInterrupted(); }
catch (error) { startupReconciliation = { error: error instanceof Error ? error.message.slice(0,500) : "Unknown reconciliation error" }; }
let active = false;
let operations = 0;
let busyRetries = 0;
let lastOperationMs = 0;

function execute(command: ChatStorageCommand): unknown {
	switch (command.type) {
		case "cancelPendingCommands": return messageCommands.cancelPending(command.sessionId);
		case "commandReceiptPage": return {receipts:messageCommands.list(command.sessionId),queue:messageCommands.queueStatus(command.sessionId)};
		case "commandReceipts": return messageCommands.list(command.sessionId);
		case "commandReceipt": return messageCommands.get(command.id);
		case "claimCommand": return messageCommands.claim(command.owner,command.leaseMs);
		case "transitionCommand": return messageCommands.transition(command.id,command.owner,command.token,command.state,command.error);
		case "heartbeatCommand": return messageCommands.heartbeat(command.id,command.owner,command.token,command.leaseMs);
		case "durableQueueHealth": return messageCommands.health();
		case "resolveRoom": {
			const room = command.roomId ? rooms.getRoom(command.roomId) : undefined;
			if (room) return room;
			if (command.required) throw Object.assign(new Error("Room not found"), { code: "room_not_found" });
			return store.transaction(() => rooms.ensureDefaultRoom());
		}
		case "admit": {
			const room = command.input.roomId ? rooms.getRoom(command.input.roomId) : undefined;
			if (!room) throw Object.assign(new Error("Room not found"), { code: "room_not_found" });
			if (isPiboRoomArchived(room)) throw Object.assign(new Error("Archived rooms are read-only"), { code: "room_read_only" });
			const key = command.input.clientTxnId ? chatClientTransactionKey(room.id, command.input.actorId, command.input.clientTxnId) : undefined;
			const commandInput = command.durableCommand ? { sessionId:command.session.id,roomId:room.id,text:command.text,delivery:command.durableCommand.delivery } : undefined;
			const receipt = key && commandInput ? messageCommands.find(key,messageCommands.fingerprint(commandInput)) : undefined;
			const existing = key ? store.eventLog.findByIdempotencyKey(key) : undefined;
			if (existing && commandInput && !receipt) throw Object.assign(new Error("Transaction belongs to the legacy admission contract."), { code:"command_conflict" });
			if (existing) return { event: commands.findByClientTxn(room.id, command.input.actorId, command.input.clientTxnId!)!, created: false, receipt };
			const preparedCommand = commandInput ? messageCommands.prepare(commandInput) : undefined;
			const createdAt = command.input.createdAt ?? new Date().toISOString();
			const preparedPayload = ingest.prepareUserMessagePayload(command.text, createdAt);
			return store.transaction(() => {
				const concurrent = key ? store.eventLog.findByIdempotencyKey(key) : undefined;
				if (concurrent) {
					const receipt = preparedCommand ? messageCommands.find(key!,preparedCommand.fingerprint) : undefined;
					if (preparedCommand && !receipt) throw Object.assign(new Error("Transaction belongs to the legacy admission contract."), { code:"command_conflict" });
					return { event: commands.findByClientTxn(room.id, command.input.actorId, command.input.clientTxnId!)!, created: false, receipt };
				}
				const event = commands.appendEvent({ ...command.input, createdAt });
				sessions.upsertSession(command.session, command.durableCommand ? sessions.getSession(command.session.id)?.status ?? "idle" : "idle", command.session.updatedAt, { preserveRuntimeBinding: true });
				ingest.ingestUserMessageAccepted({ session: command.session, roomId: room.id, actorId: command.input.actorId ?? "", text: command.text, clientTxnId: command.input.clientTxnId, eventId: command.durableCommand?.eventId, legacyEvent: event, preparedPayload });
				const receipt = preparedCommand && command.durableCommand ? messageCommands.insert({ key:key ?? `chat:command:${command.durableCommand.eventId}`, ...preparedCommand,sessionId:command.session.id,roomId:room.id,eventId:command.durableCommand.eventId,streamId:event.streamId,delivery:command.durableCommand.delivery }) : undefined;
				return { event, created: true, receipt };
			});
		}
		case "append": return store.transaction(() => {
			const key = command.input.clientTxnId
				? chatClientTransactionKey(command.input.roomId, command.input.actorId, command.input.clientTxnId)
				: command.input.eventId ? `chat:event:${command.input.eventId}` : undefined;
			const existing = key ? store.eventLog.findByIdempotencyKey(key) : undefined;
			const event = commands.appendEvent(command.input);
			return { event, created: !existing };
		});
		case "find": return commands.findByClientTxn(command.roomId, command.actorId, command.clientTxnId);
		case "ingestUser": return ingest.ingestUserMessageAccepted(command.input);
		case "ingestOutput": {
			const result = ingest.ingestOutputEvent(command.input);
			messageCommands.recordOutput(command.input.session.id,"eventId" in command.input.event ? command.input.event.eventId : undefined,command.input.event.type);
			const row = store.db.prepare("SELECT created_at, event_id, attributes_json FROM event_log WHERE stream_id = ?").get(result.streamId) as { created_at: string; event_id: string | null; attributes_json: string } | undefined;
			if (!row) throw new Error(`Missing output event ${result.streamId} after ingest.`);
			const attributes = JSON.parse(row.attributes_json) as { compactionStats?: PiboCompactionStats };
			const enrichment = command.input.event.type === "compaction_end" && attributes.compactionStats
				? { compactionStats: attributes.compactionStats }
				: undefined;
			return { ...result, stored: { createdAt: row.created_at, eventId: row.event_id ?? String(result.streamId) }, enrichment };
		}
		case "status": return { operations, busyRetries, lastOperationMs, pid: process.pid, synchronous: store.db.prepare("PRAGMA synchronous").get(), journalMode: store.db.prepare("PRAGMA journal_mode").get() };
	}
}
function respond(request: Request, response: { value?: unknown; error?: { code: string; message: string; details?: Record<string,unknown> } }) {
	port!.postMessage({ id: request.id, ...response, worker: workerStatus() });
	active = false;
}
function workerStatus() {
	return { pid: process.pid, operations, busyRetries, lastOperationMs, busyTimeoutMs: 10 };
}
function attempt(request: Request) {
	if (performance.now() >= request.deadline) { respond(request, { error: { code: "storage_deadline", message: "Storage execution deadline elapsed before commit." } }); return; }
	const start = performance.now();
	try {
		const value = execute(request.command);
		lastOperationMs = performance.now() - start;
		operations++;
		boundedMessageBytes(value, request.maxResultBytes);
		respond(request, { value });
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (/database is (?:locked|busy)/i.test(message) && performance.now() + 15 < request.deadline) {
			busyRetries++;
			setTimeout(() => attempt(request), 5 + Math.floor(Math.random() * 10));
			return;
		}
		const domainCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
		if (domainCode === "room_not_found" || domainCode === "room_read_only" || (domainCode.startsWith("storage_") || domainCode.startsWith("command_")) || domainCode === "pibo_output_identity_collision") {
			const source=error as Record<string,unknown>;
			const details=Object.fromEntries(["retryable","scope","blockingCommandId","blockedSince","oldestWaitAgeMs","nextAction"].flatMap(key=>source[key]===undefined?[]:[[key,source[key]]]));
			respond(request, { error: { code: domainCode, message, ...(Object.keys(details).length?{details}:{}) } });
			return;
		}
		respond(request, { error: { code: /database is (?:locked|busy)/i.test(message) ? "storage_busy" : "storage_operation_failed", message: "Storage operation failed; reconcile the transaction ID before retrying." } });
	}
}
port.on("message", (request: Request) => {
	if (active) { port.postMessage({ id: request.id, error: { code: "storage_overloaded", message: "Storage worker already owns a request." } }); return; }
	active = true;
	attempt(request);
});
port.postMessage({
	ready: true,
	worker: {
		...workerStatus(),
		journalMode: store.db.prepare("PRAGMA journal_mode").get(),
		synchronous: store.db.prepare("PRAGMA synchronous").get(),
		startupReconciliation,
	},
});
