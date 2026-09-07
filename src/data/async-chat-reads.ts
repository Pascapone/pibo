import { BoundedWorkerClient } from "./bounded-worker-client.js";
import type { ChatTimelineQueryService } from "../apps/chat/data/timeline-query-service.js";
import type { ChatHistoryQueryService } from "../apps/chat/data/history-query-service.js";
export const CHAT_READ_METHODS = {
 timeline: ["listEvents", "listSessionEvents", "listAllSessionEvents", "listMessageTurnTimings", "scanMessageTurnTimings", "listTraceEvents", "isPayloadAttachedToTraceNode", "countEventsByType", "getLatestEventSequence", "getLatestStreamId"],
 history: ["listProductHistoryEntries", "getProductHistoryCoverage"],
} as const;
type AsyncMethods<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never };
/** Read traffic owns a separate connection and queue from admission and output commits. */
export class AsyncChatReadQueries {
 private readonly client: BoundedWorkerClient;
 readonly timeline: AsyncMethods<Pick<ChatTimelineQueryService, typeof CHAT_READ_METHODS.timeline[number]>>;
 readonly history: AsyncMethods<Pick<ChatHistoryQueryService, typeof CHAT_READ_METHODS.history[number]>>;
 constructor(path: string, payloadRootDir: string) {
  this.client = new BoundedWorkerClient(new URL("./chat-read-worker.js", import.meta.url), {maxPending:64,reservedControlRequests:2,reservedControlBytes:16384,maxPendingBytes:1024*1024,maxMessageBytes:4*1024*1024,maxAgeMs:2000,workerOptions:{workerData:{path,payloadRootDir}}});
  const group = (name: keyof typeof CHAT_READ_METHODS) => Object.fromEntries(CHAT_READ_METHODS[name].map(method => [method, (...args: unknown[]) => this.client.request({group:name,method,args},{priority:"background",fairnessKey:typeof args[0] === "string" ? args[0] : (args[0] as {piboSessionId?:string})?.piboSessionId})]));
  this.timeline = group("timeline") as typeof this.timeline;
  this.history = group("history") as typeof this.history;
 }
 maintenance(action:"status"|"pause"|"resume") { return this.client.request({group:"maintenance",method:action,args:[]},{priority:"control"}); }
 status() { return this.client.status(); }
 async close(): Promise<void> { await this.client.close(); }
}
