import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { captureMessageRequestBody, createMessageContentBinding, sameMessageContentBinding } from "../dist/shared/message-content-binding.js";

const body = () => ({ admissionVersion: 2, contentBindingVersion: 1, piboSessionId: "ps_test", clientTxnId: "txn", text: "hi 🦊", attachments: [{ id: "a", payload: { z: null, a: "é" } }] });
const bind = value => createMessageContentBinding({ sessionId: "ps_test", delivery: "queue", body: value });

test("content binding has a canonical JSON/UTF-8 vector matching native SHA-256", () => {
	const canonical = '{"body":{"admissionVersion":2,"attachments":[{"id":"a","payload":{"a":"é","z":null}}],"clientTxnId":"txn","contentBindingVersion":1,"piboSessionId":"ps_test","text":"hi 🦊"},"delivery":"queue","domain":"pibo.message-content.v1","sessionId":"ps_test"}';
	assert.deepEqual(bind(body()), { version: 1, sha256: createHash("sha256").update(canonical).digest("hex") });
	const reordered = Object.fromEntries(Object.entries(body()).reverse());
	reordered.attachments[0].payload = { a: "é", z: null };
	assert.deepEqual(bind(reordered), bind(body()));
});

test("wire capture is independent and binds all extensions, frozen revisions and resource references", () => {
	const original = body();
	original.extensions = { nested: [1, undefined, null], absent: undefined };
	const captured = captureMessageRequestBody(original);
	assert.deepEqual(captured.extensions, { nested: [1, null, null] });
	original.extensions.nested[0] = 99;
	assert.equal(captured.extensions.nested[0], 1);
	for (const mutate of [
		value => { value.text += " "; },
		value => { value.attachments[0].revision = 2; },
		value => { value.attachments[0].payload.a = "other"; },
		value => { value.uploads = [{ path: "/opaque/server/handle" }]; },
		value => { value.extensionInput = { enabled: true }; },
		value => { value.clientTxnId = "other"; },
	]) {
		const changed = body(); mutate(changed);
		assert.notDeepEqual(bind(changed), bind(body()));
	}
	const steer = { ...body(), delivery: "steer" };
	assert.notDeepEqual(createMessageContentBinding({ sessionId: "ps_test", delivery: "steer", body: steer }), bind(body()));
});

test("unsupported protocols, targets, delivery values and malformed proofs fail closed", () => {
	for (const changes of [{ admissionVersion: 1 }, { contentBindingVersion: 2 }, { clientTxnId: " " }, { piboSessionId: "other" }, { text: 3 }, { delivery: null }, { delivery: "auto" }]) {
		assert.throws(() => bind({ ...body(), ...changes }), { code: "command_invalid_content_binding" });
	}
	assert.throws(() => createMessageContentBinding({ sessionId: 7, delivery: "queue", body: { ...body(), piboSessionId: 7 } }), { code: "command_invalid_content_binding" });
	const cyclic = {}; cyclic.self = cyclic;
	for (const value of [undefined, null, [], cyclic, { n: 2n }]) assert.throws(() => captureMessageRequestBody(value), { code: "command_invalid_content_binding" });
	const proof = bind(body());
	assert.equal(sameMessageContentBinding(proof, { ...proof }), true);
	for (const other of [undefined, {}, { ...proof, version: 2 }, { ...proof, sha256: proof.sha256 + "\n" }, { ...proof, sha256: "x".repeat(64) }]) assert.equal(sameMessageContentBinding(proof, other), false);
});

test("content binding stays browser-safe and has no server or plugin registry dependencies", async () => {
	const result = await build({ entryPoints: ["src/shared/message-content-binding.ts"], bundle: true, write: false, platform: "browser", format: "esm", metafile: true, logLevel: "silent" });
	assert.deepEqual(Object.keys(result.metafile.inputs).sort(), ["src/shared/deterministic-digest.ts", "src/shared/message-content-binding.ts"]);
});
