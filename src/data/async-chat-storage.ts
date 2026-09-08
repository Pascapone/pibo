import type { PiboCompactionStats } from "../core/events.js";
import type { DurableMessageQueueHealth, MessageReceipt, MessageCommandClaim, MessageCommandState, MessageCommandStore } from "./message-command-store.js";
import type { PiboRoom } from "../apps/chat/types/rooms.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatEventAppendInput, StoredChatEvent } from "../apps/chat/types/event-store.js";
import type { UserMessageAcceptedIngestInput, UserMessageAcceptedIngestResult, OutputEventIngestInput, OutputEventIngestResult } from "./ingest-service.js";
import { BoundedWorkerClient, StorageUnavailableError, type BoundedWorkerOptions } from "./bounded-worker-client.js";

export type AsyncOutputIngestResult = OutputEventIngestResult & {
	stored: { createdAt: string; eventId: string };
	enrichment?: { compactionStats: PiboCompactionStats };
};

/** Admission/output writer; bulk reads must use a separate worker connection. */
export class AsyncChatStorage {
	private writerClient: BoundedWorkerClient;
	private reader?: BoundedWorkerClient;
	private readonly workerUrl: URL;
	private readonly workerOptions: BoundedWorkerOptions;
	private closed = false;
	private writerRestarts = 0;
	private readerRestarts = 0;
	private writerRestartAfter = 0;
	private readerRestartAfter = 0;
	constructor(path: string, payloadRootDir: string, options: BoundedWorkerOptions = {}) {
		if (path === ":memory:") throw new Error("Worker storage requires a file-backed database.");
		// Admission carries the bounded message plus its event projection; account for both in IPC.
		this.workerOptions = { maxMessageBytes: 4 * 1024 * 1024, reservedControlRequests:8, reservedControlBytes:256*1024, admissionWindowMs:1, ...options, workerOptions: { ...options.workerOptions, workerData: { path, payloadRootDir } } };
		this.workerUrl = new URL("./chat-storage-worker.js", import.meta.url);
		this.writerClient = this.startWriter();
	}
	/**
	 * A crashed worker, or one that breached its execution deadline, must not disable durable
	 * admission permanently. Replacement waits for the failed worker to exit and is bounded to one
	 * per second, so two writers never own the same SQLite file. Recovery is safe without replay
	 * protection because callers reconcile the same client transaction ID and admission is
	 * idempotent by request key.
	 */
	private get writer(): BoundedWorkerClient {
		const status = this.writerClient.status();
		if (!this.closed && status.closed && status.exited && Date.now() >= this.writerRestartAfter) {
			this.writerRestarts++;
			this.writerClient = this.startWriter();
		}
		return this.writerClient;
	}
	private get readerClient(): BoundedWorkerClient {
		const status = this.reader?.status();
		if (!this.reader || (!this.closed && status!.closed && status!.exited && Date.now() >= this.readerRestartAfter)) {
			if (this.reader) this.readerRestarts++;
			this.reader = this.startReader();
		}
		return this.reader;
	}
	private startWriter(): BoundedWorkerClient {
		this.writerRestartAfter = Date.now() + 1000;
		return new BoundedWorkerClient(this.workerUrl, this.workerOptions);
	}
	private startReader(): BoundedWorkerClient {
		this.readerRestartAfter = Date.now() + 1000;
		return new BoundedWorkerClient(this.workerUrl, this.workerOptions);
	}
	resolveRoom(roomId?: string, required = false): Promise<PiboRoom> {
		return this.writer.request({ type: "resolveRoom", roomId, required });
	}
	admit(input: ChatEventAppendInput, session: PiboSession, text: string, durableCommand?: { eventId: string; delivery: "queue" | "steer" }): Promise<{ event: StoredChatEvent; created: boolean; receipt?: MessageReceipt }> {
		if (durableCommand && Buffer.byteLength(text) > 1024 * 1024) return Promise.reject(Object.assign(new Error("Message exceeds the durable command byte limit."), { code: "command_too_large" }));
		return this.writer.request({ type: "admit", input, session, text, durableCommand },{fairnessKey:input.roomId,priority:durableCommand?.delivery === "steer" ? "control" : "admission"});
	}
	append(input: ChatEventAppendInput): Promise<{ event: StoredChatEvent; created: boolean }> {
		return this.writer.request({ type: "append", input });
	}
	find(roomId: string, actorId: string, clientTxnId: string): Promise<StoredChatEvent | undefined> {
		if (this.closed) return Promise.reject(new StorageUnavailableError("storage_closed", "Storage worker is closed."));
		return this.readerClient.request({ type: "find", roomId, actorId, clientTxnId }, { priority: "admission" });
	}
	ingestUser(input: UserMessageAcceptedIngestInput): Promise<UserMessageAcceptedIngestResult> {
		return this.writer.request({ type: "ingestUser", input });
	}
	async ingestOutput(input: OutputEventIngestInput): Promise<AsyncOutputIngestResult> {
		const result = await this.writer.request<AsyncOutputIngestResult>({ type: "ingestOutput", input }, { priority: "output", fairnessKey:input.roomId });
		if (input.event.type === "compaction_end" && result.enrichment?.compactionStats) {
			input.event.compactionStats = result.enrichment.compactionStats;
		}
		return result;
	}
	cancelPendingCommands(sessionId: string): Promise<number> { return this.writer.request({ type:"cancelPendingCommands",sessionId },{priority:"control"}); }
	commandReceiptPage(sessionId: string): Promise<{receipts:MessageReceipt[];queue:ReturnType<MessageCommandStore["queueStatus"]>}> { return this.writer.request({type:"commandReceiptPage",sessionId},{priority:"control"}); }
	commandReceipts(sessionId: string): Promise<MessageReceipt[]> { return this.writer.request({ type:"commandReceipts",sessionId },{priority:"control"}); }
	commandReceipt(id: string): Promise<MessageReceipt | undefined> { return this.writer.request({ type: "commandReceipt", id },{priority:"control"}); }
	claimCommand(owner: string, leaseMs: number): Promise<MessageCommandClaim | undefined> { return this.writer.request({ type: "claimCommand", owner, leaseMs }, { priority: "background" }); }
	transitionCommand(id: string, owner: string, token: number, state: MessageCommandState, error?: string): Promise<boolean> { return this.writer.request({ type: "transitionCommand", id, owner, token, state, error },{priority:"control"}); }
	heartbeatCommand(id: string, owner: string, token: number, leaseMs: number): Promise<boolean> { return this.writer.request({ type: "heartbeatCommand", id, owner, token, leaseMs },{priority:"control"}); }
	durableQueueHealth(): Promise<DurableMessageQueueHealth> { return this.writer.request({type:"durableQueueHealth"},{priority:"control",timeoutMs:500}); }
	status() {
		const writer = this.writer.status();
		const reader = this.reader?.status();
		return { ready: writer.ready && (!reader || reader.ready), closed: writer.closed && (!reader || reader.closed), restarts: { writer: this.writerRestarts, reader: this.readerRestarts }, writer, reader };
	}
	async close(): Promise<void> {
		this.closed = true;
		await Promise.all([this.writerClient.close(), this.reader?.close()]);
	}
}
