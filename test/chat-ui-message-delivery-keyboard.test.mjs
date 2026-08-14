import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runDeliveryKeyboardScenario() {
	const script = String.raw`
		import assert from "node:assert/strict";
		import { adjacentMessageDeliveryChoice } from "./src/apps/chat-ui/src/message-delivery-keyboard.ts";

		assert.equal(adjacentMessageDeliveryChoice("queue", "ArrowRight"), "steer");
		assert.equal(adjacentMessageDeliveryChoice("steer", "ArrowLeft"), "queue");
		assert.equal(adjacentMessageDeliveryChoice("queue", "ArrowLeft"), "steer");
		assert.equal(adjacentMessageDeliveryChoice("steer", "ArrowRight"), "queue");
		assert.equal(adjacentMessageDeliveryChoice("queue", "Enter"), null);
		assert.equal(adjacentMessageDeliveryChoice("steer", "Tab"), null);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
}

test("message delivery choices wrap with Left and Right Arrow without consuming Enter or Tab", async () => {
	await assert.doesNotReject(runDeliveryKeyboardScenario());
});

test("message delivery buttons wire arrow focus navigation and retain native button activation", () => {
	const source = fs.readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	assert.match(source, /ref=\{queueButtonRef\}[\s\S]*onClick=\{\(\) => void chooseDelivery\("queue"\)\}[\s\S]*onKeyDown=\{\(event\) => moveDeliveryChoiceFocus\("queue", event\)\}/);
	assert.match(source, /ref=\{steerButtonRef\}[\s\S]*onClick=\{\(\) => void chooseDelivery\("steer"\)\}[\s\S]*onKeyDown=\{\(event\) => moveDeliveryChoiceFocus\("steer", event\)\}/);
	assert.match(source, /if \(event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey\) return;/);
	assert.match(source, /nextDelivery === "queue" \? queueButtonRef : steerButtonRef/);
});
