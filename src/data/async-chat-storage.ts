import type { PiboRoom } from "../apps/chat/types/rooms.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatEventAppendInput, StoredChatEvent } from "../apps/chat/types/event-store.js";
import type { UserMessageAcceptedIngestInput, UserMessageAcceptedIngestResult, OutputEventIngestInput, OutputEventIngestResult } from "./ingest-service.js";
import { BoundedWorkerClient, type BoundedWorkerOptions } from "./bounded-worker-client.js";

export type AsyncOutputIngestResult = OutputEventIngestResult & {
	stored: { createdAt: string; eventId: string };
};

/** Admission/output writer; bulk reads must use a separate worker connection. */
export class AsyncChatStorage {
	private readonly writer: BoundedWorkerClient;
	private reader?: BoundedWorkerClient;
	private readonly workerUrl: URL;
	private readonly workerOptions: BoundedWorkerOptions;
	constructor(path: string, payloadRootDir: string, options: BoundedWorkerOptions = {}) {
		if (path === ":memory:") throw new Error("Worker storage requires a file-backed database.");
		this.workerOptions = { ...options, workerOptions: { ...options.workerOptions, workerData: { path, payloadRootDir } } };
		this.workerUrl = new URL("./chat-storage-worker.js", import.meta.url);
		this.writer = new BoundedWorkerClient(this.workerUrl, this.workerOptions);
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
		this.reader ??= new BoundedWorkerClient(this.workerUrl, this.workerOptions);
		return this.reader.request({ type: "find", roomId, actorId, clientTxnId }, { priority: "admission" });
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
		return { ready: writer.ready && (!reader || reader.ready), closed: writer.closed && (!reader || reader.closed), writer, reader };
	}
	async close(): Promise<void> { await Promise.all([this.writer.close(), this.reader?.close()]); }
}
