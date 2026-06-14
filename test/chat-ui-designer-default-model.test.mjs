import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const designerUiPath = resolve(here, "../src/apps/chat-ui/src/agents/designer-ui.tsx");
const source = readFileSync(designerUiPath, "utf8");

// Locate the provider <select> onChange handler in the ModelSelector component.
// We scan for the block that mutates providerId + modelId and verify it also
// notifies the parent when the user picks the empty (Default) option.
function findProviderSelectOnChange(source) {
	const marker = "value={providerId}";
	const idx = source.indexOf(marker);
	if (idx < 0) throw new Error("provider <select> not found in designer-ui.tsx");
	const slice = source.slice(idx, idx + 600);
	return slice;
}

function findModelSelectOnChange(source) {
	const marker = "value={modelId}";
	const idx = source.indexOf(marker);
	if (idx < 0) throw new Error("model <select> not found in designer-ui.tsx");
	const slice = source.slice(idx, idx + 700);
	return slice;
}

test("designer provider <select> propagates Default selection to the parent (regression: agent save lost cleared model)", () => {
	const providerHandler = findProviderSelectOnChange(source);
	assert.match(
		providerHandler,
		/if\s*\(\s*!nextProviderId\s*\)\s*onChange\(undefined\)/,
		"provider <select> onChange must call onChange(undefined) when the user picks the empty (Default) option, otherwise the agent save loses the cleared model",
	);
});

test("designer model <select> propagates cleared selection to the parent (regression: agent save lost cleared model)", () => {
	const modelHandler = findModelSelectOnChange(source);
	assert.match(
		modelHandler,
		/if\s*\(\s*!nextModelId\s*\)/,
		"model <select> onChange must distinguish the cleared case from the picked case",
	);
	assert.match(
		modelHandler,
		/onChange\(undefined\)/,
		"model <select> onChange must call onChange(undefined) when the user clears the model",
	);
});

test("designer Unset button still resets the parent value to undefined", () => {
	// Sanity check that the existing Unset button wiring did not regress.
	assert.match(
		source,
		/setProviderId\(""\);\s*setModelId\(""\);\s*onChange\(undefined\)/,
		"Unset button must reset internal state and call onChange(undefined)",
	);
});
