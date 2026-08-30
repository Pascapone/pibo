import { ChatSessionQueryService } from "../../dist/apps/chat/data/session-query-service.js";
import { ChatDataIngestService } from "../../dist/data/ingest-service.js";
import { PiboReliabilityStore } from "../../dist/reliability/store.js";
import { startWebOutboxProcessHost } from "./web-outbox-process-harness.mjs";

const [directory, crashBoundary, piboSessionId, targetEventId] = process.argv.slice(2);
if (!directory || !crashBoundary || !piboSessionId || !targetEventId) throw new Error("missing web outbox crash fixture arguments");

const hardCrash = () => process.kill(process.pid, "SIGKILL");
const originalIngest = ChatDataIngestService.prototype.ingestOutputEvent;
const originalAppendOnce = PiboReliabilityStore.prototype.appendOnce;
const originalRecordEvent = ChatSessionQueryService.prototype.recordEvent;
const originalRecordReceipt = PiboReliabilityStore.prototype.recordDeliveryReceipt;

ChatDataIngestService.prototype.ingestOutputEvent = function(input) {
	if (input.event.eventId === targetEventId && crashBoundary === "before-v2-write") hardCrash();
	const result = originalIngest.call(this, input);
	if (input.event.eventId === targetEventId && crashBoundary === "after-v2-write") hardCrash();
	return result;
};
PiboReliabilityStore.prototype.appendOnce = function(input) {
	const result = originalAppendOnce.call(this, input);
	if (input.topic === "pibo.output" && input.payload?.eventId === targetEventId && crashBoundary === "after-reliability-append") hardCrash();
	return result;
};
ChatSessionQueryService.prototype.recordEvent = function(event, session, streamId, createdAt) {
	const result = originalRecordEvent.call(this, event, session, streamId, createdAt);
	if (event.eventId === targetEventId && crashBoundary === "during-projection") hardCrash();
	return result;
};
PiboReliabilityStore.prototype.recordDeliveryReceipt = function(deliveryId, projection, deliveredAt) {
	if (deliveryId.includes(targetEventId) && crashBoundary === "after-live-send-before-receipt") hardCrash();
	const result = originalRecordReceipt.call(this, deliveryId, projection, deliveredAt);
	if (deliveryId.includes(targetEventId) && crashBoundary === "after-receipt-before-checkpoint") hardCrash();
	return result;
};

const host = await startWebOutboxProcessHost({ directory, piboSessionId });
const trigger = await fetch(`${host.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
if (!trigger.ok) throw new Error(`fixture bootstrap failed with ${trigger.status}`);
if (crashBoundary === "after-live-send-before-receipt" || crashBoundary === "after-receipt-before-checkpoint") {
	const controller = new AbortController();
	const response = await fetch(`${host.baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(piboSessionId)}&mode=live&since=0`, {
		headers: { "x-test-user": "user-1" },
		signal: controller.signal,
	});
	if (!response.ok) throw new Error(`fixture event stream failed with ${response.status}`);
	await response.body.getReader().read();
}
process.stdout.write(`${JSON.stringify({ armed: true, crashBoundary, pid: process.pid })}\n`);
host.emitOutput({
	type: "assistant_message",
	piboSessionId,
	eventId: targetEventId,
	assistantIndex: 0,
	text: `durable ${crashBoundary}`,
	renderSequence: 71,
});
setTimeout(() => {
	process.stderr.write(`crash boundary ${crashBoundary} was not reached\n`);
	process.exit(2);
}, 2_000);
