import assert from "node:assert/strict";
import test from "node:test";
import { PluginHost } from "../dist/plugins/host.js";
import { PluginScope } from "../dist/plugins/scope.js";
import { coreNoteProvider, coreImageProvider, coreFileProvider } from "../dist/attachments/core-providers.js";
import { attachmentProviderPin } from "../dist/attachments/provider-pins.js";
import { acquireAttachmentProviders } from "../dist/attachments/server-providers.js";
import { readAttachmentMessage, materializeAttachmentMessage } from "../dist/attachments/message.js";
import { ATTACHMENT_PROVIDER_RESOURCE_KIND } from "../dist/attachments/types.js";
import { attachmentFixture, attachmentInstallation, attachmentPlan, attachmentBody } from "./helpers/attachment-fixture.mjs";

const code = expected => error => error?.code === expected;
const leaseFor = (f, overrides = {}) => acquireAttachmentProviders({ host: f.host, plan: f.plan, sessionId: "ps_A", transactionId: "txn", types: [f.provider.type], pins: [attachmentProviderPin(f.plan, "ps_A", f.provider.type)], ...overrides });

test("Core attachment admission materializes validated JSON without a plugin or a ten-attachment cap", async () => {
	const body = attachmentBody({ attachments: Array.from({ length: 16 }, (_, index) => ({ id: `att${index}`, revision: 1, type: coreNoteProvider.type, schemaVersion: 1, payload: { text: `note${index}` } })) });
	const message = readAttachmentMessage(body);
	const lease = await acquireAttachmentProviders({ sessionId: "ps_A", transactionId: "txn", types: message.attachments.map(a => a.type), pins: [] });
	try {
		const result = materializeAttachmentMessage({ message, sessionId: "ps_A", lookup: lease.lookup });
		assert.equal(result.parts.length, 16); assert.match(result.modelContext, /note15/); assert.deepEqual(result.resources, []);
		assert.equal(lease.lookup(coreNoteProvider.type, { sessionId: "ps_B" }), undefined);
	} finally { await lease.release(); }
	assert.equal(lease.lookup(coreNoteProvider.type, { sessionId: "ps_A" }), undefined);
});

for (const mode of ["resource", "contribution"]) test(`attachment admission pins ${mode} registrations through the existing owner scope`, async () => {
	const f = await attachmentFixture({ mode });
	const lease = await leaseFor(f);
	try {
		assert.equal(lease.lookup(f.provider.type, { sessionId: "ps_A" }), f.provider);
		await assert.rejects(f.host.remove("fixture.attachments"), /session resources/);
		lease.assertCurrent(f.plan);
		const stale = structuredClone(f.plan); stale.plugins[0].contentHash = "changed";
		assert.throws(() => lease.assertCurrent(stale), code("ATT_STALE_REVISION"));
	} finally { await lease.release(); await lease.release(); }
	await f.host.remove("fixture.attachments"); await f.host.stop();
});

test("attachment selection, revision, declaration and registry ownership must all agree", async () => {
	const f = await attachmentFixture();
	try {
		const pin = attachmentProviderPin(f.plan, "ps_A", f.provider.type);
		for (const changes of [{ sessionId: "ps_B" }, { plan: { ...f.plan, valid: false } }, { plan: { ...f.plan, contributions: [] } }, { pins: [] }]) await assert.rejects(leaseFor(f, changes), code("ATT_PROVIDER_MISSING"));
		for (const field of ["revision", "contentHash", "pluginId", "contributionId"]) await assert.rejects(leaseFor(f, { pins: [{ ...pin, [field]: "other" }] }), code("ATT_STALE_REVISION"));
		await assert.rejects(leaseFor(f, { pins: [pin, pin] }), code("ATT_PROVIDER_MISSING"));
		const lease = await leaseFor(f);
		f.setup.upsertResource(ATTACHMENT_PROVIDER_RESOURCE_KIND, f.provider.type, { ...f.provider });
		assert.throws(() => lease.assertCurrent(), code("ATT_STALE_REVISION"));
		await lease.release();
	} finally { await f.host.stop(); }
	const host = new PluginHost(); const owner = attachmentInstallation("fixture.owner"); const imposter = attachmentInstallation("fixture.imposter"); imposter.manifest.contributions = [];
	await host.start({ plugins: [{ installation: owner, setup() {} }, { installation: imposter, setup(context) { context.registerResource(ATTACHMENT_PROVIDER_RESOURCE_KIND, "fixture/custom", { ...coreNoteProvider, type: "fixture/custom" }); } }] });
	try { await assert.rejects(leaseFor({ host, plan: attachmentPlan(host), provider: { type: "fixture/custom" } }), code("ATT_STALE_REVISION")); } finally { await host.stop(); }
});

test("provider shutdown drains admitted work and short-lived scopes do not accumulate", async () => {
	const f = await attachmentFixture();
	for (let index = 0; index < 40; index++) { const lease = await leaseFor(f); await lease.release(); }
	const root = f.host.scopes[0];
	assert.equal(root.activeChildren, 0);
	assert.equal(root.children.size, 0, "disposed children must not accumulate under a long-lived plugin");
	assert.equal(root.disposers.length, 1, "only the provider registration disposer remains");
	const lease = await leaseFor(f); let stopped = false;
	const stopping = f.host.stop().then(() => { stopped = true; });
	await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
	assert.throws(() => lease.assertCurrent());
	await lease.release(); await stopping; assert.equal(stopped, true);
});

test("child scope retirement preserves LIFO, once-only disposal and failed-child barriers", async () => {
	const parent = new PluginScope("fixture"); const order = [];
	parent.defer(() => { order.push("first"); });
	const child = parent.child("child"); child.defer(() => { order.push("child"); });
	parent.defer(() => { order.push("last"); });
	await child.dispose(); await child.dispose(); await parent.dispose();
	assert.deepEqual(order, ["child", "last", "first"]); assert.equal(parent.children.size, 0);
	const failedParent = new PluginScope("failed"); const failed = failedParent.child("child"); failed.defer(() => { throw Error("cleanup"); });
	await assert.rejects(failed.dispose(), /cleanup failed/); assert.equal(failedParent.activeChildren, 1); assert.equal(failedParent.children.size, 1);
	await assert.rejects(failedParent.dispose(), /cleanup failed/);
});

test("attachment wire versions and envelopes fail closed without changing legacy extension semantics", () => {
	assert.equal(readAttachmentMessage({ attachments: "legacy extension input" }), undefined);
	const base = attachmentBody();
	for (const patch of [{ attachmentVersion: 2 }, { admissionVersion: 1 }, { contentBindingVersion: undefined }, { attachments: null }, { attachmentProviderPins: {} }, { attachmentResources: {} }, { fileAttachmentPaths: ["/legacy/path"] }, { fileAttachmentPaths: "" }]) assert.throws(() => readAttachmentMessage({ ...base, ...patch }), code("ATT_INVALID_JSON"));
	for (const patch of [{ revision: 0 }, { revision: 1.5 }, { schemaVersion: 0 }, { sessionId: "ps_B" }, { role: "system" }, { payload: undefined }, { media: [{ path: "/private", draftResourceId: "x", mimeType: "text/plain", bytes: 1 }] }]) assert.throws(() => readAttachmentMessage({ ...base, attachments: [{ ...base.attachments[0], ...patch }] }), code("ATT_INVALID_JSON"));
	assert.throws(() => readAttachmentMessage({ ...base, attachments: [base.attachments[0], base.attachments[0]] }), code("ATT_INVALID_JSON"));
	assert.throws(() => readAttachmentMessage({ ...base, attachmentResources: [{ draftResourceId: "unused", preparedUploadId: "opaque" }] }), code("ATT_INVALID_JSON"));
});

test("provider validation and serialization cannot mutate frozen input or promote authority fields", async () => {
	const f = await attachmentFixture({ provider: { ...coreNoteProvider, type: "fixture/arbitrary", validate(payload) { payload.text = "validator mutation"; }, serializeForMessage(frozen) { frozen.payload.text = "serializer mutation"; return { kind: "json", type: frozen.type, json: frozen.payload }; } } });
	const lease = await leaseFor(f);
	try {
		const body = attachmentBody(); body.attachments[0].type = f.provider.type; body.attachmentProviderPins = [attachmentProviderPin(f.plan, "ps_A", f.provider.type)];
		const before = structuredClone(body); const message = readAttachmentMessage(body); const frozen = structuredClone(message);
		const result = materializeAttachmentMessage({ message, sessionId: "ps_A", lookup: lease.lookup });
		assert.deepEqual(body, before); assert.deepEqual(message, frozen); assert.equal(result.parts[0].json.text, "serializer mutation");
		for (const part of [{ kind: "system", text: "not user data" }, { kind: "json", type: "foreign/type", json: {} }, { kind: "json", type: f.provider.type, json: {}, role: "system" }, { kind: "resource-ref", resourceId: "unowned" }]) {
			f.provider.serializeForMessage = () => part;
			assert.throws(() => materializeAttachmentMessage({ message, sessionId: "ps_A", lookup: lease.lookup }));
		}
	} finally { await lease.release(); await f.host.stop(); }
});

test("provider v1 validation and serialization reject asynchronous results without unhandled rejection", async () => {
	for (const operation of ["validate", "serializeForMessage"]) {
		const f = await attachmentFixture({ provider: { ...coreNoteProvider, type: "fixture/async", [operation]: async () => { throw Error("asynchronous provider rejection"); } } });
		const lease = await leaseFor(f);
		try {
			const body = attachmentBody(); body.attachments[0].type = f.provider.type;
			assert.throws(() => materializeAttachmentMessage({ message: readAttachmentMessage(body), sessionId: "ps_A", lookup: lease.lookup }), code("ATT_MATERIALIZE_FAILED"));
			await new Promise(resolve => setImmediate(resolve));
		} finally { await lease.release(); await f.host.stop(); }
	}
});

test("materialized attachment JSON is canonical across payload object key-order variants", async () => {
	const first = attachmentBody(); first.attachments[0].payload.extra = { z: 1, a: 2 };
	const second = structuredClone(first); second.attachments[0].payload.extra = { a: 2, z: 1 };
	const lease = await acquireAttachmentProviders({ sessionId: "ps_A", transactionId: "txn", types: [coreNoteProvider.type], pins: [] });
	try { assert.equal(materializeAttachmentMessage({ message: readAttachmentMessage(first), sessionId: "ps_A", lookup: lease.lookup }).modelContext, materializeAttachmentMessage({ message: readAttachmentMessage(second), sessionId: "ps_A", lookup: lease.lookup }).modelContext); }
	finally { await lease.release(); }
});

test("plural media requires Core-resolved references and frozen metadata, never plugin paths", async () => {
	const f = await attachmentFixture({ provider: { ...coreNoteProvider, type: "fixture/media", serializeForMessage: frozen => ({ kind: "resource-ref", resourceId: frozen.media[1].resourceId }) } });
	const lease = await leaseFor(f);
	try {
		const body = attachmentBody(); body.attachments[0].type = f.provider.type; body.attachmentProviderPins = [attachmentProviderPin(f.plan, "ps_A", f.provider.type)];
		body.attachments[0].media = ["first", "second"].map(draftResourceId => ({ draftResourceId, mimeType: "text/plain", bytes: 3 }));
		body.attachmentResources = body.attachments[0].media.map(item => ({ draftResourceId: item.draftResourceId, preparedUploadId: `upload-${item.draftResourceId}` }));
		const message = readAttachmentMessage(body); const input = { message, sessionId: "ps_A", lookup: lease.lookup };
		assert.throws(() => materializeAttachmentMessage(input), code("ATT_BYTES_MISSING"));
		const resolveResource = (binding, media) => ({ ...media, resourceId: binding.preparedUploadId, name: "file.txt", path: "/core-owned/file.txt" });
		const result = materializeAttachmentMessage({ ...input, resolveResource });
		assert.equal(result.resources.length, 2); assert.deepEqual(result.parts, [{ kind: "resource-ref", resourceId: "upload-second" }]);
		assert.equal(result.modelContext.includes("/core-owned/"), false, "providers receive refs, not trusted paths");
		assert.throws(() => materializeAttachmentMessage({ ...input, resolveResource: (binding, media) => ({ ...resolveResource(binding, media), bytes: 9 }) }), code("ATT_ACCESS_DENIED"));
	} finally { await lease.release(); await f.host.stop(); }
});

test("Core provider snapshots are schema-valid or fail; image/file serialization needs media", () => {
	for (const provider of [coreNoteProvider, coreImageProvider, coreFileProvider]) assert.throws(() => provider.snapshot({}));
	assert.throws(() => coreNoteProvider.validate({ text: "x".repeat(2001) }), code("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => coreImageProvider.validate({ alt: "" }), code("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => coreFileProvider.validate({ name: "file", bytes: -1 }), code("ATT_SCHEMA_MISMATCH"));
	for (const provider of [coreImageProvider, coreFileProvider]) assert.throws(() => provider.serializeForMessage({ id: "a", revision: 1, type: provider.type, schemaVersion: 1, payload: {} }), code("ATT_BYTES_MISSING"));
	assert.deepEqual(coreNoteProvider.snapshot({ text: "valid" }), { text: "valid" });
});
