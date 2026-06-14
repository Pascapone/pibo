import test from "node:test";
import assert from "node:assert/strict";

import {
	getWslInfo,
	isWsl,
	parseDistroFromOsRelease,
	parseWslRelease,
	parseWslVersion,
} from "../dist/core/wsl.js";

test("parseWslRelease detects WSL2 kernel strings", () => {
	assert.equal(parseWslRelease("5.15.90.1-microsoft-standard-WSL2"), true);
	assert.equal(parseWslRelease("5.15.0-1054-azure-wsl2"), true);
});

test("parseWslRelease detects WSL1 kernel strings", () => {
	assert.equal(parseWslRelease("4.4.0-19041-Microsoft"), true);
	assert.equal(parseWslRelease("3.10.0-1062.1.1.el7.x86_64.microsoft"), true);
});

test("parseWslRelease is case insensitive and tolerates whitespace", () => {
	assert.equal(parseWslRelease("  5.15.0-MICROSOFT-STANDARD-WSL2\n"), true);
	assert.equal(parseWslRelease("Linux 6.1.0-13-amd64"), false);
});

test("parseWslRelease returns false for missing or empty input", () => {
	assert.equal(parseWslRelease(undefined), false);
	assert.equal(parseWslRelease(""), false);
});

test("parseWslVersion reports 2 for WSL2 strings and 1 for WSL1 strings", () => {
	assert.equal(parseWslVersion("5.15.90.1-microsoft-standard-WSL2"), 2);
	assert.equal(parseWslVersion("5.15.0-1054-azure-wsl2"), 2);
	assert.equal(parseWslVersion("4.4.0-19041-Microsoft"), 1);
});

test("parseWslVersion returns undefined for non-WSL hosts", () => {
	assert.equal(parseWslVersion("6.1.0-13-amd64"), undefined);
	assert.equal(parseWslVersion(undefined), undefined);
});

test("parseDistroFromOsRelease extracts PRETTY_NAME", () => {
	const ubuntu = 'NAME="Ubuntu"\nVERSION="22.04.3 LTS (Jammy Jellyfish)"\nID=ubuntu\nPRETTY_NAME="Ubuntu 22.04.3 LTS"\n';
	assert.equal(parseDistroFromOsRelease(ubuntu), "Ubuntu 22.04.3 LTS");
});

test("parseDistroFromOsRelease handles unquoted and single-quoted names", () => {
	assert.equal(parseDistroFromOsRelease("PRETTY_NAME=Debian GNU/Linux\n"), "Debian GNU/Linux");
	assert.equal(parseDistroFromOsRelease("PRETTY_NAME='Alpine Linux'\n"), "Alpine Linux");
});

test("parseDistroFromOsRelease returns undefined for missing or malformed input", () => {
	assert.equal(parseDistroFromOsRelease(undefined), undefined);
	assert.equal(parseDistroFromOsRelease("NAME=Ubuntu\nID=ubuntu\n"), undefined);
	assert.equal(parseDistroFromOsRelease("PRETTY_NAME=\n"), undefined);
});

test("isWsl returns a boolean on the current host", () => {
	assert.equal(typeof isWsl(), "boolean");
});

test("getWslInfo returns the documented shape on the current host", () => {
	const info = getWslInfo();
	assert.equal(typeof info.isWsl, "boolean");
	assert.ok([undefined, 1, 2].includes(info.version));
	assert.ok(typeof info.distro === "string" || info.distro === undefined);
	assert.equal(typeof info.hasWindowsMount, "boolean");

	if (!info.isWsl) {
		assert.equal(info.version, undefined);
		assert.equal(info.distro, undefined);
		assert.equal(info.hasWindowsMount, false);
	}
});
