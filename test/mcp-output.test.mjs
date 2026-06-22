import assert from "node:assert/strict";
import { test } from "node:test";
import {
	TOOL_DESCRIPTION_TRUNCATE_LENGTH,
	formatSearchResults,
	formatServerDetails,
	formatServerList,
	truncateToolDescription,
} from "../dist/mcp/output.js";

const noColor = { ...process.env, NO_COLOR: "1" };

test("truncateToolDescription returns undefined for missing or empty input", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		assert.equal(truncateToolDescription(undefined), undefined);
		assert.equal(truncateToolDescription(""), undefined);
		assert.equal(truncateToolDescription("   \n  "), undefined);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("truncateToolDescription keeps short descriptions unchanged", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		assert.equal(
			truncateToolDescription("Echo text back to the caller."),
			"Echo text back to the caller.",
		);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("truncateToolDescription truncates long descriptions with an ellipsis", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const long = "a".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50);
		const result = truncateToolDescription(long);
		assert.ok(result);
		assert.ok(result.endsWith("…"));
		assert.ok(result.length <= TOOL_DESCRIPTION_TRUNCATE_LENGTH);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("truncateToolDescription collapses whitespace before measuring length", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const multi = "First line.\n\n  Second line.\n\tThird line.";
		const result = truncateToolDescription(multi);
		assert.equal(result, "First line. Second line. Third line.");
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerList shows truncated tool descriptions by default", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const output = formatServerList(
			[
				{
					name: "demo",
					tools: [
						{
							name: "short",
							description: "Short description.",
							inputSchema: { type: "object", properties: {} },
						},
						{
							name: "long",
							description:
								"a".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50),
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			],
			false,
		);

		assert.match(output, /• short - Short description\./);
		assert.match(output, /• long - a{99}…/);
		assert.doesNotMatch(
			output,
			new RegExp("a".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 10)),
		);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerList shows full tool descriptions when -d is enabled", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const long = "b".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50);
		const output = formatServerList(
			[
				{
					name: "demo",
					tools: [
						{
							name: "long",
							description: long,
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			],
			true,
		);

		assert.match(output, new RegExp(`• long - b{${long.length}}`));
		assert.doesNotMatch(output, /…/);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerList renders tools without descriptions as plain names", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const output = formatServerList(
			[
				{
					name: "demo",
					tools: [
						{
							name: "noDesc",
							inputSchema: { type: "object", properties: {} },
						},
					],
				},
			],
			false,
		);

		assert.match(output, /• noDesc\b/);
		assert.doesNotMatch(output, /• noDesc -/);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatSearchResults shows truncated descriptions by default and full ones with -d", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const long = "c".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50);
		const results = [
			{
				server: "demo",
				tool: {
					name: "long",
					description: long,
					inputSchema: { type: "object", properties: {} },
				},
			},
		];

		const compact = formatSearchResults(results, false);
		assert.match(compact, new RegExp(`c{99}…`));
		assert.doesNotMatch(compact, new RegExp(`c{${long.length}}`));

		const full = formatSearchResults(results, true);
		assert.match(full, new RegExp(`c{${long.length}}`));
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerDetails surfaces the pibo.description in the header", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const output = formatServerDetails(
			"unity",
			{
				url: "http://localhost:8080/mcp",
				pibo: {
					description: "Bridge to the local Unity Editor.",
					descriptionSource: "user",
				},
			},
			[],
			false,
			undefined,
		);

		assert.match(output, /Server: unity/);
		assert.match(output, /Transport: HTTP/);
		assert.match(output, /URL: http:\/\/localhost:8080\/mcp/);
		assert.match(output, /Description:\n\s+Bridge to the local Unity Editor\./);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerDetails shows truncated tool descriptions by default", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const long = "d".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50);
		const output = formatServerDetails(
			"demo",
			{ command: "node" },
			[
				{
					name: "long",
					description: long,
					inputSchema: { type: "object", properties: {} },
				},
			],
			false,
			undefined,
		);

		assert.match(output, /d{99}…/);
		assert.doesNotMatch(
			output,
			new RegExp("d".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 10)),
		);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerDetails shows full tool descriptions with -d", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const long = "e".repeat(TOOL_DESCRIPTION_TRUNCATE_LENGTH + 50);
		const output = formatServerDetails(
			"demo",
			{ command: "node" },
			[
				{
					name: "long",
					description: long,
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "On-disk path to read.",
							},
						},
						required: ["path"],
					},
				},
			],
			true,
			undefined,
		);

		assert.match(output, new RegExp(`e{${long.length}}`));
		assert.match(output, /• path \(string, required\) - On-disk path to read\./);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});

test("formatServerDetails omits parameter descriptions without -d", () => {
	const previous = process.env.NO_COLOR;
	process.env.NO_COLOR = "1";
	try {
		const output = formatServerDetails(
			"demo",
			{ command: "node" },
			[
				{
					name: "read",
					description: "Read a file.",
					inputSchema: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description: "On-disk path to read.",
							},
						},
						required: ["path"],
					},
				},
			],
			false,
			undefined,
		);

		assert.match(output, /• path \(string, required\)$/m);
		assert.doesNotMatch(output, /On-disk path to read/);
	} finally {
		if (previous === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previous;
	}
});
