import assert from "node:assert/strict";
import test from "node:test";
import { getRalphJobTemplate, listRalphJobTemplates } from "../dist/ralph/templates.js";

test("built-in Ralph job templates are discoverable and editable copies", () => {
	const templates = listRalphJobTemplates();
	assert.ok(templates.length >= 3);
	assert.ok(templates.some((template) => template.id === "prd-single-story-standard"));
	assert.ok(templates.some((template) => template.id === "prd-batch-stories"));
	assert.ok(templates.some((template) => template.id === "single-run-objective"));

	const standard = getRalphJobTemplate("prd-single-story-standard");
	assert.ok(standard);
	assert.match(standard.job.prompt, /Pick the highest-priority user story/);
	assert.match(standard.job.prompt, /XML completion marker/);
	assert.doesNotMatch(standard.job.prompt, /<promise>COMPLETE<\/promise>/);
	assert.equal(standard.job.stopPolicy?.conditions[0]?.type, "pibo.ralph.promise-complete");

	standard.job.name = "changed locally";
	assert.notEqual(getRalphJobTemplate("prd-single-story-standard")?.job.name, "changed locally");
});

test("non-PRD objective template uses max-iteration stop policy", () => {
	const template = getRalphJobTemplate("single-run-objective");
	assert.ok(template);
	assert.equal(template.category, "general");
	assert.equal(template.job.maxIterations, 1);
	assert.equal(template.job.stopPolicy?.conditions[0]?.type, "pibo.ralph.max-iterations");
	assert.doesNotMatch(template.job.prompt, /Read the PRD JSON files/);
});
