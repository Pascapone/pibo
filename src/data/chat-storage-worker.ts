import { parentPort, workerData } from "node:worker_threads";
import { ChatRoomService } from "../apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../apps/chat/data/session-query-service.js";
import { isPiboRoomArchived } from "../apps/chat/types/rooms.js";
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
	| { type: "admit"; input: ChatEventAppendInput; session: PiboSession; text: string }
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
let active = false;
let operations = 0;
let busyRetries = 0;
let lastOperationMs = 0;

function execute(command: ChatStorageCommand): unknown {
	switch (command.type) {
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
			const existing = key ? store.eventLog.findByIdempotencyKey(key) : undefined;
			if (existing) return { event: commands.findByClientTxn(room.id, command.input.actorId, command.input.clientTxnId!)!, created: false };
			const createdAt = command.input.createdAt ?? new Date().toISOString();
			const preparedPayload = ingest.prepareUserMessagePayload(command.text, createdAt);
			return store.transaction(() => {
				const concurrent = key ? store.eventLog.findByIdempotencyKey(key) : undefined;
				if (concurrent) return { event: commands.findByClientTxn(room.id, command.input.actorId, command.input.clientTxnId!)!, created: false };
				const event = commands.appendEvent({ ...command.input, createdAt });
				sessions.upsertSession(command.session, "idle", command.session.updatedAt, { preserveRuntimeBinding: true });
				ingest.ingestUserMessageAccepted({ session: command.session, roomId: room.id, actorId: command.input.actorId ?? "", text: command.text, clientTxnId: command.input.clientTxnId, legacyEvent: event, preparedPayload });
				return { event, created: true };
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
			const row = store.db.prepare("SELECT created_at, event_id FROM event_log WHERE stream_id = ?").get(result.streamId) as { created_at: string; event_id: string | null } | undefined;
			if (!row) throw new Error(`Missing output event ${result.streamId} after ingest.`);
			return { ...result, stored: { createdAt: row.created_at, eventId: row.event_id ?? String(result.streamId) } };
		}
		case "status": return { operations, busyRetries, lastOperationMs, pid: process.pid, synchronous: store.db.prepare("PRAGMA synchronous").get(), journalMode: store.db.prepare("PRAGMA journal_mode").get() };
	}
}
function respond(request: Request, response: { value?: unknown; error?: { code: string; message: string } }) {
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
		if (domainCode === "room_not_found" || domainCode === "room_read_only" || domainCode.startsWith("storage_") || domainCode === "pibo_output_identity_collision") {
			respond(request, { error: { code: domainCode, message } });
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
	},
});
