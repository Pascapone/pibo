import type { PiboRoom } from "../apps/chat/types/rooms.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatEventAppendInput, StoredChatEvent } from "../apps/chat/types/event-store.js";
import type { UserMessageAcceptedIngestInput, UserMessageAcceptedIngestResult, OutputEventIngestInput, OutputEventIngestResult } from "./ingest-service.js";
import { BoundedWorkerClient, StorageUnavailableError, type BoundedWorkerOptions } from "./bounded-worker-client.js";

export type AsyncOutputIngestResult = OutputEventIngestResult & {
	stored: { createdAt: string; eventId: string };
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
		this.workerOptions = { ...options, workerOptions: { ...options.workerOptions, workerData: { path, payloadRootDir } } };
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
	admit(input: ChatEventAppendInput, session: PiboSession, text: string): Promise<{ event: StoredChatEvent; created: boolean }> {
		return this.writer.request({ type: "admit", input, session, text });
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
	ingestOutput(input: OutputEventIngestInput): Promise<AsyncOutputIngestResult> {
		return this.writer.request({ type: "ingestOutput", input }, { priority: "output" });
	}
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
