import assert from "node:assert/strict";
import test from "node:test";
import { globToRegex } from "../dist/mcp/commands/grep.js";

test("MCP grep glob * matches tool names without crossing slash boundaries", () => {
	const pattern = globToRegex("*file*");

	assert.equal(pattern.test("read_file"), true);
	assert.equal(pattern.test("file_utils"), true);
	assert.equal(pattern.test("server/read_file"), false);
});

test("MCP grep glob server/* does not match nested slash names", () => {
	const pattern = globToRegex("server/*");

	assert.equal(pattern.test("server/tool"), true);
	assert.equal(pattern.test("server/sub/tool"), false);
});

test("MCP grep glob server/** matches nested slash names", () => {
	const pattern = globToRegex("server/**");

	assert.equal(pattern.test("server/tool"), true);
	assert.equal(pattern.test("server/sub/tool"), true);
});

test("MCP grep glob escapes regex special characters", () => {
	const pattern = globToRegex("admin.reset");

	assert.equal(pattern.test("admin.reset"), true);
	assert.equal(pattern.test("admin-reset"), false);
});

test("MCP grep glob matching is case-insensitive and ? matches one non-slash character", () => {
	const pattern = globToRegex("READ_?ile");

	assert.equal(pattern.test("read_file"), true);
	assert.equal(pattern.test("READ_File"), true);
	assert.equal(pattern.test("read_bigfile"), false);
	assert.equal(pattern.test("read_/ile"), false);
});
