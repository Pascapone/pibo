import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runComposerSizingScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { resizeComposerInput } = await import("./src/apps/chat-ui/src/composer/Composer.tsx");

		globalThis.window = {
			getComputedStyle: () => ({
				lineHeight: "20px",
				borderTopWidth: "1px",
				borderBottomWidth: "1px",
				paddingTop: "8px",
				paddingBottom: "8px",
			}),
		};

		function textarea({ value, scrollHeight, selectionStart = value.length, selectionEnd = value.length }) {
			return {
				value,
				scrollHeight,
				selectionStart,
				selectionEnd,
				scrollTop: 0,
				style: { height: "40px", overflowY: "hidden" },
			};
		}

		const wrappedPlaceholder = textarea({ value: "", scrollHeight: 56 });
		resizeComposerInput(wrappedPlaceholder);
		assert.equal(wrappedPlaceholder.style.height, "58px");
		assert.equal(wrappedPlaceholder.style.overflowY, "hidden");

		const desktopPlaceholder = textarea({ value: "", scrollHeight: 38 });
		resizeComposerInput(desktopPlaceholder);
		assert.equal(desktopPlaceholder.style.height, "40px");
		assert.equal(desktopPlaceholder.style.overflowY, "hidden");

		const shortTypedText = textarea({ value: "hello", scrollHeight: 36 });
		resizeComposerInput(shortTypedText);
		assert.equal(shortTypedText.style.height, "");
		assert.equal(shortTypedText.style.overflowY, "hidden");

		const overflowingText = textarea({ value: ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join(String.fromCharCode(10)), scrollHeight: 136 });
		resizeComposerInput(overflowingText);
		assert.equal(overflowingText.style.height, "118px");
		assert.equal(overflowingText.style.overflowY, "auto");
		assert.equal(overflowingText.scrollTop, 136);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("chat composer sizes wrapped empty placeholders without changing typed-text growth limits", async () => {
	await assert.doesNotReject(runComposerSizingScenario());
});

test("chat composer uses the compact single-line placeholder", () => {
	const source = readFileSync("src/apps/chat-ui/src/composer/Composer.tsx", "utf8");
	assert.match(source, /placeholder=\{disabled \? "Select a session to message" : "Send message \.\.\."\}/);
	assert.doesNotMatch(source, /Send Message \(\/ for commands or \$ for skills\)/);
});
