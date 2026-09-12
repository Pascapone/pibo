import assert from "node:assert/strict";
import test from "node:test";
import {
	getConcurrencyLimit,
	getDaemonRequestTimeoutMs,
	getDaemonTimeoutMs,
	getMaxRetries,
	getRetryDelayMs,
	getTimeoutMs,
} from "../dist/mcp/config.js";

test("MCP integer settings preserve defaults, units, and permissive decimal parsing", () => {
	const settings = [
		["MCP_TIMEOUT", getTimeoutMs, 1_800_000, 1000],
		["MCP_CONCURRENCY", getConcurrencyLimit, 5, 1],
		["MCP_MAX_RETRIES", getMaxRetries, 3, 1],
		["MCP_RETRY_DELAY", getRetryDelayMs, 1000, 1],
		["MCP_DAEMON_TIMEOUT", getDaemonTimeoutMs, 60_000, 1000],
		["MCP_DAEMON_REQUEST_TIMEOUT", getDaemonRequestTimeoutMs, 60_000, 1000],
	];
	for (const [name, read, fallback, scale] of settings) {
		const previous = process.env[name];
		const allowsZero = name === "MCP_MAX_RETRIES";
		try {
			for (const value of [undefined, "", " ", "invalid", "-1", "Infinity"]) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
				assert.equal(read(), fallback, `${name}=${String(value)}`);
			}
			for (const value of ["7", "  +7 ", "7.9", "7seconds", "7e3"]) {
				process.env[name] = value;
				assert.equal(read(), 7 * scale, `${name}=${value}`);
			}
			for (const value of ["0", "0.9", "0x10"]) {
				process.env[name] = value;
				assert.equal(read(), allowsZero ? 0 : fallback, `${name}=${value}`);
			}
			process.env[name] = "-0";
			assert.equal(read(), allowsZero ? -0 : fallback, `${name}=-0`);
			process.env[name] = "9".repeat(400);
			assert.equal(read(), Infinity, `${name} retains numeric overflow behavior`);
		} finally {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		}
	}
});
