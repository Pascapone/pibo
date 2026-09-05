import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const source = async (path) =>
	(await readFile(new URL(`../src/apps/chat-ui/src/${path}`, import.meta.url), "utf8"))
		.replaceAll("\r\n", "\n");

async function runDeliveryKeyboardScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import { adjacentMessageDeliveryChoice } from "./src/apps/chat-ui/src/message-delivery-keyboard.ts";

		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "ArrowRight" }), "steer");
		assert.equal(adjacentMessageDeliveryChoice("steer", { key: "ArrowLeft" }), "queue");
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "ArrowLeft" }), "steer");
		assert.equal(adjacentMessageDeliveryChoice("steer", { key: "ArrowRight" }), "queue");
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "Enter" }), null);
		assert.equal(adjacentMessageDeliveryChoice("steer", { key: " " }), null);
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "Tab" }), null);
		assert.equal(adjacentMessageDeliveryChoice("steer", { key: "Escape" }), null);
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "ArrowRight", altKey: true }), null);
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "ArrowRight", ctrlKey: true }), null);
		assert.equal(adjacentMessageDeliveryChoice("queue", { key: "ArrowRight", metaKey: true }), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
}

test("message delivery choices wrap with Left and Right Arrow without consuming activation or dialog keys", async () => {
	await assert.doesNotReject(runDeliveryKeyboardScenario());
});

test("message delivery dialog wires arrow focus movement while preserving modal focus and ARIA behavior", async () => {
	const [pane, dialogShell] = await Promise.all([
		source("session-trace-pane.tsx"),
		source("components/DialogShell.tsx"),
	]);

	assert.match(pane, /<DialogShell[\s\S]*title="Session is running"[\s\S]*description="Choose how this message should be delivered\."[\s\S]*initialFocusRef=\{queueButtonRef\}/);
	assert.match(pane, /ref=\{queueButtonRef\}[\s\S]*onClick=\{\(\) => void chooseDelivery\("queue"\)\}[\s\S]*onKeyDown=\{\(event\) => moveDeliveryChoiceFocus\("queue", event\)\}/);
	assert.match(pane, /ref=\{steerButtonRef\}[\s\S]*onClick=\{\(\) => void chooseDelivery\("steer"\)\}[\s\S]*onKeyDown=\{\(event\) => moveDeliveryChoiceFocus\("steer", event\)\}/);
	assert.match(pane, /adjacentMessageDeliveryChoice\(currentDelivery, event\)[\s\S]*event\.preventDefault\(\);[\s\S]*nextDelivery === "queue" \? queueButtonRef : steerButtonRef/);
	assert.match(pane, /import \{ getSessionForkCandidates, getSessionStatus, type ChatMessageDelivery \} from "\.\/api-chat-sessions";/);
	assert.match(pane, /queryFn: \(\{ signal \}\) => getSessionForkCandidates\(selectedBackendPiboSessionId!, \{ signal \}\)/);
	assert.match(pane, /message-delivery-queue[\s\S]*message-delivery-steer/);
	assert.match(pane, /focus-visible:ring-2 focus-visible:ring-\[#11a4d4\]\/50/);
	assert.match(pane, /focus-visible:ring-2 focus-visible:ring-amber-400\/50/);

	assert.match(dialogShell, /role="dialog"/);
	assert.match(dialogShell, /aria-modal="true"/);
	assert.match(dialogShell, /aria-labelledby=\{titleId\}/);
	assert.match(dialogShell, /aria-describedby=\{descriptionId\}/);
	assert.match(dialogShell, /initialFocusRef\?\.current/);
	assert.match(dialogShell, /event\.key === "Escape"/);
	assert.match(dialogShell, /event\.key !== "Tab"/);
	assert.match(dialogShell, /previouslyFocused\?\.isConnected/);
});
