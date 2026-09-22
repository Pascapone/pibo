import assert from "node:assert/strict";
import test from "node:test";
import { PiboCapabilityHost } from "../dist/core/capability-host.js";
import { PluginHost } from "../dist/plugins/host.js";
import { ATTACHMENT_PROVIDER_RESOURCE_KIND } from "../dist/attachments/types.js";
import { coreNoteProvider } from "../dist/attachments/core-providers.js";
import { assertValidAttachmentProvider, assertValidSchemaDeclaration, createProviderRegistryClient, validateAgainstSchema } from "../dist/attachments/providers.js";

function installation(pluginId) {
	return {
		pluginId, revision: `sha256:${"a".repeat(64)}`, version: "1.0.0", contentHash: `sha256:${"a".repeat(64)}`,
		state: "active", enabled: true, stateRevision: 1, source: { kind: "local", path: "/unused-fixture" }, createdAt: "2026-09-22T00:00:00Z",
		manifest: { schemaVersion: 1, id: pluginId, name: pluginId, version: "1.0.0", sdk: "^1.0.0", contributions: [] },
	};
}
const errorCode = code => error => error?.code === code;

test("attachment providers use the existing backend resource projection and owning scope", async (t) => {
	const host = new PluginHost();
	const capabilities = PiboCapabilityHost.create({ host });
	const provider = { ...coreNoteProvider, type: "fixture/note" };
	const client = createProviderRegistryClient((type) => capabilities.getAttachmentProvider(type), { sessionId: "ps_A" });
	assert.throws(() => client.require(provider.type), errorCode("ATT_PROVIDER_MISSING"));
	await host.start({ plugins: [{ installation: installation("fixture.notes"), setup(context) {
		context.registerResource(ATTACHMENT_PROVIDER_RESOURCE_KIND, provider.type, provider);
	} }] });
	t.after(() => host.stop());
	assert.equal(client.require(provider.type), provider);
	client.validatePayload(provider.type, 1, { text: "retained" });
	assert.throws(() => client.validatePayload(provider.type, 2, { text: "retained" }), errorCode("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => client.validatePayload(provider.type, 1, { text: 4 }), errorCode("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => client.validatePayload(provider.type, 1, { text: " " }), errorCode("ATT_INVALID_JSON"));
	await host.remove("fixture.notes");
	assert.equal(capabilities.getAttachmentProvider(provider.type), undefined);
	assert.throws(() => client.require(provider.type), errorCode("ATT_PROVIDER_MISSING"));
});

test("duplicate resource registration rolls back only the new provider owner", async (t) => {
	const host = new PluginHost();
	const capabilities = PiboCapabilityHost.create({ host });
	const original = { ...coreNoteProvider, type: "fixture/note" };
	const definition = (id, provider) => ({ installation: installation(id), setup(context) {
		context.registerResource(ATTACHMENT_PROVIDER_RESOURCE_KIND, provider.type, provider);
	} });
	await host.start({ plugins: [definition("fixture.first", original)] });
	t.after(() => host.stop());
	await assert.rejects(host.add({ plugins: [definition("fixture.second", { ...original })] }), /already|duplicate/i);
	assert.equal(capabilities.getAttachmentProvider(original.type), original);
	await host.remove("fixture.first");
	assert.equal(capabilities.getAttachmentProvider(original.type), undefined);
});

test("provider client binds its scope and rejects mismatched lookup identities", () => {
	const scope = { sessionId: "ps_A" };
	const seen = [];
	const client = createProviderRegistryClient((type, bound) => { seen.push(bound.sessionId); return coreNoteProvider; }, scope);
	scope.sessionId = "ps_B";
	assert.equal(client.require(coreNoteProvider.type), coreNoteProvider);
	assert.throws(() => client.require("other/type"), errorCode("ATT_PROVIDER_MISSING"));
	assert.deepEqual(seen, ["ps_A", "ps_A"]);
});

test("provider schema declarations fail closed on unsupported, cyclic and malformed rules", () => {
	for (const schema of [{ additionalProperties: false }, { minLength: -1 }, { maxLength: 1.5 }, { minimum: 4, maximum: 2 }, { enum: [] }]) {
		assert.throws(() => assertValidSchemaDeclaration(schema, "fixture"), errorCode("ATT_SCHEMA_MISMATCH"));
	}
	const cyclic = { type: "array" }; cyclic.items = cyclic;
	assert.throws(() => assertValidSchemaDeclaration(cyclic, "fixture"), errorCode("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => assertValidAttachmentProvider({ ...coreNoteProvider, schemaVersions: [1, 1] }), errorCode("ATT_SCHEMA_MISMATCH"));
	assert.throws(() => assertValidAttachmentProvider({ ...coreNoteProvider, snapshot: undefined }), errorCode("ATT_SCHEMA_MISMATCH"));
	const shared = { type: "string" };
	assert.doesNotThrow(() => assertValidSchemaDeclaration({ properties: { a: shared, b: shared } }, "fixture"));
	assert.throws(() => validateAgainstSchema({ type: "object", required: ["toString"] }, {}, "payload"), errorCode("ATT_SCHEMA_MISMATCH"));
});

test("provider instances are executable objects, not restricted to JSON object prototypes", () => {
	class NoteProvider { constructor() { Object.assign(this, coreNoteProvider); } }
	assert.doesNotThrow(() => assertValidAttachmentProvider(new NoteProvider()));
});

test("schema literals compare JSON structurally and string bounds count Unicode code points", () => {
	assert.doesNotThrow(() => validateAgainstSchema({ const: { a: [1, { b: 2 }], c: true } }, { c: true, a: [1, { b: 2 }] }, "payload"));
	assert.doesNotThrow(() => validateAgainstSchema({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }, "payload"));
	assert.throws(() => validateAgainstSchema({ const: [1, 2] }, [2, 1], "payload"), errorCode("ATT_SCHEMA_MISMATCH"));
	assert.doesNotThrow(() => validateAgainstSchema({ type: "string", maxLength: 1 }, "😀", "payload"));
	assert.throws(() => validateAgainstSchema({ type: "string", minLength: 2 }, "😀", "payload"), errorCode("ATT_SCHEMA_MISMATCH"));
});
