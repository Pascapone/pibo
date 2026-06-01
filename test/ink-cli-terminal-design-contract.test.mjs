import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const contractPath = "docs/legacy/specs/changes/ink-cli-terminal-rendering-parity/terminal-design-contract.md";

test("Ink terminal design contract records non-negotiable rendering rules", () => {
	const contract = fs.readFileSync(contractPath, "utf8");
	for (const phrase of [
		"Transcript is primary",
		"Chronological command/runtime results",
		"Overlays are temporary",
		"Chrome is compact",
		"Rows are dense",
		"Secret redaction before rendering",
		"Missing data is explicit",
		"Color is signal",
	]) {
		assert.match(contract, new RegExp(escapeRegExp(phrase)), `${phrase} rule should be explicit`);
	}
	assert.match(contract, /Forbidden uses:[\s\S]*Slash command results[\s\S]*Runtime status/, "state.message forbidden-result policy should be concrete");
	assert.match(contract, /Allowed renderer differences[\s\S]*Ink may use text progress bars[\s\S]*Web may use DOM progress bars/, "renderer-specific differences should be allowed without sharing DOM components");
	assert.match(contract, /Forbidden parity claims[\s\S]*only evidence[\s\S]*src\/session-ui/, "shared data alone must not be enough to claim parity");
});

test("Ink terminal visual evidence gate is reusable and linked from PRD catalog", () => {
	const contract = fs.readFileSync(contractPath, "utf8");
	const readme = fs.readFileSync("docs/legacy/specs/changes/ink-cli-terminal-rendering-parity/prds/README.md", "utf8");
	for (const phrase of [
		"Story id(s)",
		"Design rules checked",
		"PTY command",
		"Artifact directory",
		"Evidence tier",
		"Observed screen result",
		"Remaining gaps",
		"Web impact",
		"Redaction check",
		"Gate commands",
		"installed/global `pibo tui:sessions` PTY smoke",
	]) {
		assert.match(contract, new RegExp(escapeRegExp(phrase)), `${phrase} should be required by the visual evidence gate`);
	}
	assert.match(readme, /terminal-design-contract\.md#visual-evidence-checklist/, "PRD catalog should point Ralph agents to the gate before later PRDs");
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
