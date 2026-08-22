#!/usr/bin/env node

import { copyFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

export async function preparePackageShrinkwrap(root = defaultRoot) {
	const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const packageLock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
	const lockedRoot = packageLock.packages?.[""];

	if (packageLock.name !== packageJson.name || lockedRoot?.name !== packageJson.name) {
		throw new Error("package-lock.json does not describe the package being packed");
	}

	await copyFile(resolve(root, "package-lock.json"), resolve(root, "npm-shrinkwrap.json"));
}

export async function cleanPackageShrinkwrap(root = defaultRoot) {
	await rm(resolve(root, "npm-shrinkwrap.json"), { force: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
	const action = process.argv[2];
	if (action === "prepare") {
		await preparePackageShrinkwrap();
	} else if (action === "clean") {
		await cleanPackageShrinkwrap();
	} else {
		throw new Error("Usage: node scripts/package-shrinkwrap.mjs <prepare|clean>");
	}
}
