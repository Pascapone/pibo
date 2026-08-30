import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("composer keeps IME text until composition ends and preserves ordinary Enter controls", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { useState } from "react";
		import TestRenderer, { act } from "react-test-renderer";
		import { Composer } from "./src/apps/chat-ui/src/composer/Composer.tsx";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.requestAnimationFrame = () => 1;
		globalThis.cancelAnimationFrame = () => {};
		globalThis.document = { addEventListener() {}, removeEventListener() {} };
		const noop = () => {};

		function Harness({ initialValue, sends }) {
			const [value, setValue] = useState(initialValue);
			return React.createElement(Composer, {
				sessionId: "ps-ime-test",
				commands: [],
				skills: [],
				value,
				focusSignal: 0,
				selectedWebAnnotations: [],
				selectedUploadAttachments: [],
				onValueChange: setValue,
				onCommand: async () => false,
				onDetachWebAnnotation: noop,
				onClearWebAnnotations: noop,
				onAttachUploadedFiles: noop,
				onDetachUploadAttachment: noop,
				onClearUploadAttachments: noop,
				onSend: async (text) => { sends.push(text); },
			});
		}

		const keyEvent = ({ shiftKey = false, isComposing = false, keyCode = 13 } = {}) => {
			const calls = { preventDefault: 0 };
			return {
				key: "Enter",
				shiftKey,
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				keyCode,
				nativeEvent: { isComposing, keyCode },
				preventDefault: () => { calls.preventDefault += 1; },
				stopPropagation: noop,
				calls,
			};
		};

		const compositionSends = [];
		let compositionRenderer;
		await act(async () => {
			compositionRenderer = TestRenderer.create(React.createElement(Harness, {
				initialValue: "未確定",
				sends: compositionSends,
			}));
		});
		let input = compositionRenderer.root.findByType("textarea");
		const composingEnter = keyEvent({ isComposing: true });
		await act(async () => { input.props.onKeyDown(composingEnter); });
		assert.equal(composingEnter.calls.preventDefault, 0);
		assert.deepEqual(compositionSends, []);
		assert.equal(compositionRenderer.root.findByType("textarea").props.value, "未確定");

		const legacyImeEnter = keyEvent({ keyCode: 229 });
		await act(async () => { compositionRenderer.root.findByType("textarea").props.onKeyDown(legacyImeEnter); });
		assert.equal(legacyImeEnter.calls.preventDefault, 0);
		assert.deepEqual(compositionSends, []);
		assert.equal(compositionRenderer.root.findByType("textarea").props.value, "未確定");

		input = compositionRenderer.root.findByType("textarea");
		await act(async () => { input.props.onChange({ target: { value: "確定済み", selectionStart: 4 } }); });
		const ordinaryEnter = keyEvent();
		await act(async () => { compositionRenderer.root.findByType("textarea").props.onKeyDown(ordinaryEnter); });
		assert.equal(ordinaryEnter.calls.preventDefault, 1);
		assert.deepEqual(compositionSends, ["確定済み"]);
		assert.equal(compositionRenderer.root.findByType("textarea").props.value, "");

		const multilineSends = [];
		let multilineRenderer;
		await act(async () => {
			multilineRenderer = TestRenderer.create(React.createElement(Harness, {
				initialValue: "first line",
				sends: multilineSends,
			}));
		});
		const shiftEnter = keyEvent({ shiftKey: true });
		await act(async () => { multilineRenderer.root.findByType("textarea").props.onKeyDown(shiftEnter); });
		assert.equal(shiftEnter.calls.preventDefault, 0);
		assert.deepEqual(multilineSends, []);
		await act(async () => {
			multilineRenderer.root.findByType("textarea").props.onChange({
				target: { value: "first line\\nsecond line", selectionStart: 22 },
			});
		});
		assert.equal(multilineRenderer.root.findByType("textarea").props.value, "first line\\nsecond line");
		assert.deepEqual(multilineSends, []);
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
