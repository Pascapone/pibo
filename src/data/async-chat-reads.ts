import type { ChatReadStateService } from "../apps/chat/data/read-state-service.js";
import { BoundedWorkerClient } from "./bounded-worker-client.js";
import type { ChatTimelineQueryService } from "../apps/chat/data/timeline-query-service.js";
import type { ChatHistoryQueryService } from "../apps/chat/data/history-query-service.js";
export const CHAT_READ_METHODS = {
 timeline: ["listEvents", "listSessionEvents", "listAllSessionEvents", "listMessageTurnTimings", "scanMessageTurnTimings", "listTraceEvents", "isPayloadAttachedToTraceNode", "countEventsByType", "getLatestEventSequence", "getLatestStreamId"],
 history: ["listProductHistoryEntries", "getProductHistoryCoverage"],
 navigation:["unreadCountsPage","sessionIndexPage"],
} as const;
type AsyncMethods<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never };
/** Read traffic owns a separate connection and queue from admission and output commits. */
export class AsyncChatReadQueries {
 private client: BoundedWorkerClient;
 private closed=false;private restarts=0;private restartAfter=0;
 readonly timeline: AsyncMethods<Pick<ChatTimelineQueryService, typeof CHAT_READ_METHODS.timeline[number]>>;
 readonly navigation:AsyncMethods<Pick<ChatReadStateService,"unreadCountsPage"|"sessionIndexPage">>;
 readonly history: AsyncMethods<Pick<ChatHistoryQueryService, typeof CHAT_READ_METHODS.history[number]>>;
 constructor(private readonly path: string, private readonly payloadRootDir: string) {
  this.client = this.startWorker();
  const group = (name: keyof typeof CHAT_READ_METHODS) => Object.fromEntries(CHAT_READ_METHODS[name].map(method => [method, (...args: unknown[]) => this.getClient().request({group:name,method,args},{priority:"background",fairnessKey:typeof args[0] === "string" ? args[0] : (args[0] as {piboSessionId?:string})?.piboSessionId})]));
  this.timeline = group("timeline") as typeof this.timeline;
  this.history = group("history") as typeof this.history;
  this.navigation=group("navigation") as typeof this.navigation;
 }
 private startWorker():BoundedWorkerClient {this.restartAfter=Date.now()+1000;
  return new BoundedWorkerClient(new URL("./chat-read-worker.js", import.meta.url), {maxPending:64,reservedControlRequests:2,reservedControlBytes:16384,maxPendingBytes:1024*1024,maxMessageBytes:4*1024*1024,maxAgeMs:2000,workerOptions:{workerData:{path:this.path,payloadRootDir:this.payloadRootDir}}});
 }
 private getClient():BoundedWorkerClient {if(!this.closed&&this.client.status().closed&&this.client.status().exited&&Date.now()>=this.restartAfter){this.restarts++;this.client=this.startWorker();}return this.client;}
 maintenance(action:"status"|"pause"|"resume") { return this.getClient().request({group:"maintenance",method:action,args:[]},{priority:"control"}); }
 status() { return {...this.client.status(),restarts:this.restarts}; }
 async close(): Promise<void> { this.closed=true;await this.client.close(); }
}
