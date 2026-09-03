import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const workspace = process.env.PIBO_TEST_WORKSPACE ?? process.cwd();
const sourcePath = resolve(workspace, "src/apps/chat-ui/src/MinimalWorkflowsArea.tsx");

test("workflow picker exposes and implements editable listbox keyboard interaction", async () => {
	const source = await readFile(sourcePath, "utf8");
	assert.match(source, /role="combobox"/);
	assert.match(source, /aria-autocomplete="list"/);
	assert.match(source, /aria-expanded=\{pickerOpen\}/);
	assert.match(source, /aria-controls=\{WORKFLOW_PICKER_LISTBOX_ID\}/);
	assert.match(source, /aria-activedescendant=\{pickerOpen && boundedActivePickerIndex !== undefined/);
	assert.match(source, /id=\{WORKFLOW_PICKER_LISTBOX_ID\}[\s\S]*role="listbox"/);
	assert.match(source, /id=\{workflowPickerOptionId\(index\)\}/);
	assert.match(source, /aria-selected=\{boundedActivePickerIndex !== undefined/);
	assert.match(source, /event\.key === "Escape" && pickerOpen/);
	assert.match(source, /event\.key === "Enter" && pickerOpen && boundedActivePickerIndex !== undefined/);
	assert.match(source, /event\.key !== "ArrowDown" && event\.key !== "ArrowUp"/);
	assert.match(source, /activePickerOptionRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\)/);
});
