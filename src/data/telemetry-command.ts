import type { PiboOutputEvent } from "../core/events.js";
import type { RuntimeTelemetryContext, PiProviderEventSummary, ProviderEventTelemetryMode } from "../core/runtime-telemetry.js";
import type { ProviderTelemetryModel, ProviderResponseSummary, ProviderRequestStartOptions, ProviderMessageEndOptions, ProviderAssistantMessage } from "../core/provider-telemetry.js";
import type { PiboSession } from "../sessions/store.js";
export type RuntimeTelemetryCommand =
 | {kind:"output";event:PiboOutputEvent;context:RuntimeTelemetryContext}
 | {kind:"pi";piboSessionId:string;summary:PiProviderEventSummary;context:RuntimeTelemetryContext}
 | {kind:"interrupted";messages:Array<{piboSessionId:string;eventId:string}>;context:RuntimeTelemetryContext;reason:string};
export type ProviderTelemetryCommand =
 | {kind:"start";payload:unknown;options:ProviderRequestStartOptions}
 | {kind:"response";input:ProviderResponseSummary}
 | {kind:"end";message:ProviderAssistantMessage;options:ProviderMessageEndOptions}
 | {kind:"shutdown";at:string;reason:string};
export type TelemetryCommand =
 | {recorder:"runtime";command:RuntimeTelemetryCommand;providerEventMode:ProviderEventTelemetryMode;progressFlushIntervalMs:number}
 | {recorder:"provider";command:ProviderTelemetryCommand;session:PiboSession;model?:ProviderTelemetryModel};
export function isTelemetryProgress(input:TelemetryCommand):boolean {
 return input.recorder === "runtime" && (input.command.kind === "pi" || (input.command.kind === "output" && ["assistant_delta","thinking_delta","tool_execution_updated"].includes(input.command.event.type)));
}
