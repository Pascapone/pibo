import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("composer suggestions expose their popup, active option, status, and keyboard selection", async () => {
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
		const changes = [];

		function Harness({ initialValue = "/", skills = [] }) {
			const [value, setValue] = useState(initialValue);
			return React.createElement(Composer, {
				sessionId: "ps-test",
				commands: [
					{ slash: "/status", description: "Return status." },
					{ slash: "/compact", description: "Compact context." },
				],
				skills,
				value,
				focusSignal: 0,
				selectedWebAnnotations: [],
				selectedUploadAttachments: [],
				onValueChange: (next) => { changes.push(next); setValue(next); },
				onCommand: async () => false,
				onDetachWebAnnotation: noop,
				onClearWebAnnotations: noop,
				onAttachUploadedFiles: noop,
				onDetachUploadAttachment: noop,
				onClearUploadAttachments: noop,
				onSend: async () => {},
			});
		}

		const keyEvent = (key) => ({
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			preventDefault: noop,
			stopPropagation: noop,
		});

		let commandRenderer;
		await act(async () => { commandRenderer = TestRenderer.create(React.createElement(Harness)); });
		let commandInput = commandRenderer.root.findByType("textarea");
		assert.equal(commandInput.props["aria-autocomplete"], "list");
		assert.equal(commandInput.props["aria-controls"], "composer-command-suggestions");
		assert.equal(commandInput.props["aria-activedescendant"], "composer-command-suggestion-0");
		let commandListbox = commandRenderer.root.findByProps({ id: "composer-command-suggestions" });
		assert.equal(commandListbox.props.role, "listbox");
		assert.equal(commandListbox.props["aria-label"], "Command suggestions");
		let commandOptions = commandRenderer.root.findAllByProps({ role: "option" });
		assert.deepEqual(commandOptions.map((option) => [option.props.id, option.props["aria-selected"]]), [
			["composer-command-suggestion-0", true],
			["composer-command-suggestion-1", false],
		]);
		let status = commandRenderer.root.findByProps({ role: "status" });
		assert.equal(status.children.join(""), "2 command suggestions available. /status selected, 1 of 2.");

		await act(async () => { commandInput.props.onKeyDown(keyEvent("ArrowDown")); });
		commandInput = commandRenderer.root.findByType("textarea");
		assert.equal(commandInput.props["aria-activedescendant"], "composer-command-suggestion-1");
		commandOptions = commandRenderer.root.findAllByProps({ role: "option" });
		assert.deepEqual(commandOptions.map((option) => option.props["aria-selected"]), [false, true]);
		status = commandRenderer.root.findByProps({ role: "status" });
		assert.equal(status.children.join(""), "2 command suggestions available. /compact selected, 2 of 2.");

		await act(async () => { commandInput.props.onKeyDown(keyEvent("Enter")); });
		assert.equal(changes.at(-1), "/compact");
		assert.equal(commandRenderer.root.findAllByProps({ role: "listbox" }).length, 0);
		commandInput = commandRenderer.root.findByType("textarea");
		assert.equal(commandInput.props["aria-controls"], undefined);
		assert.equal(commandInput.props["aria-activedescendant"], undefined);
		assert.equal(commandRenderer.root.findByProps({ role: "status" }).children.join(""), "Suggestions closed.");

		let escapeRenderer;
		await act(async () => { escapeRenderer = TestRenderer.create(React.createElement(Harness)); });
		let escapeInput = escapeRenderer.root.findByType("textarea");
		await act(async () => { escapeInput.props.onKeyDown(keyEvent("Escape")); });
		escapeInput = escapeRenderer.root.findByType("textarea");
		assert.equal(escapeRenderer.root.findAllByProps({ role: "listbox" }).length, 0);
		assert.equal(escapeInput.props["aria-controls"], undefined);
		assert.equal(escapeInput.props["aria-activedescendant"], undefined);
		assert.equal(escapeRenderer.root.findByProps({ role: "status" }).children.join(""), "Suggestions closed.");

		let skillRenderer;
		await act(async () => {
			skillRenderer = TestRenderer.create(React.createElement(Harness, {
				initialValue: "",
				skills: [
					{ name: "alpha", description: "Alpha skill" },
					{ name: "beta", description: "Beta skill" },
				],
			}));
		});
		let skillInput = skillRenderer.root.findByType("textarea");
		await act(async () => { skillInput.props.onChange({ target: { value: "$", selectionStart: 1 } }); });
		skillInput = skillRenderer.root.findByType("textarea");
		assert.equal(skillInput.props["aria-controls"], "composer-skill-suggestions");
		assert.equal(skillInput.props["aria-activedescendant"], "composer-skill-suggestion-0");
		const skillListbox = skillRenderer.root.findByProps({ id: "composer-skill-suggestions" });
		assert.equal(skillListbox.props.role, "listbox");
		assert.equal(skillListbox.props["aria-label"], "Skill suggestions");
		assert.equal(skillRenderer.root.findByProps({ role: "status" }).children.join(""), "2 skill suggestions available. $alpha selected, 1 of 2.");
	`;

	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
