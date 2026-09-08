import {BoundedWorkerClient} from "./bounded-worker-client.js";
import type {TelemetryMaintenanceStatus} from "./telemetry-maintenance.js";
export class AsyncTelemetryMaintenance {
 private readonly client:BoundedWorkerClient;
 constructor(path:string){this.client=new BoundedWorkerClient(new URL("./telemetry-maintenance-worker.js",import.meta.url),{maxPending:8,maxPendingBytes:64*1024,maxMessageBytes:16*1024,maxAgeMs:2000,workerOptions:{workerData:{path}}});}
 command(action:"start"|"status"|"pause"|"resume"|"cancel",cutoff?:string):Promise<TelemetryMaintenanceStatus|null>{return this.client.request({action,cutoff},{priority:"control"});}
 preview(cutoff:string):Promise<import("./telemetry-retention.js").TelemetryPruneResult[]>{return this.client.request({action:"preview",cutoff},{priority:"background"});}
 status(){return this.client.status();}
 close(){return this.client.close();}
}
