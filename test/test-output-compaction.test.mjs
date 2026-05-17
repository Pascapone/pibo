import assert from "node:assert/strict";
import test from "node:test";
import { compactValidationOutput } from "../dist/core/test-output-compaction.js";

test("successful validation output is hidden by default", () => {
	const output = Array.from({ length: 30 }, (_, index) => `PASS test-${index}`).join("\n");
	const result = compactValidationOutput({ command: "npm test", output, isError: false });

	assert.ok(result);
	assert.match(result.text, /Command succeeded/);
	assert.match(result.text, /Successful test output hidden/);
	assert.doesNotMatch(result.text, /PASS test-29/);
	assert.equal(result.details.originalLines, 30);
	assert.equal(result.details.fullOutput, output);
});

test("failed validation output keeps error context and omits passing spam", () => {
	const output = [
		...Array.from({ length: 20 }, (_, index) => `PASS passing-${index}`),
		"src/example.test.ts",
		"  expected 1 to equal 2",
		"FAIL example test",
		"Command exited with code 1",
	].join("\n");
	const result = compactValidationOutput({ command: "npm run test", output, isError: true });

	assert.ok(result);
	assert.match(result.text, /Command failed/);
	assert.match(result.text, /expected 1 to equal 2/);
	assert.match(result.text, /Command exited with code 1/);
	assert.doesNotMatch(result.text, /PASS passing-0/);
	assert.equal(result.details.isError, true);
	assert.equal(result.details.omittedLines > 0, true);
});

test("short successful validation output remains unchanged", () => {
	const result = compactValidationOutput({ command: "npm test", output: "PASS one\nPASS two", isError: false });
	assert.equal(result, undefined);
});
