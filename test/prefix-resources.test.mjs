import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { capturePrefixResources, PrefixResourceBundleStore } from "../dist/sessions/prefix-resources.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PI_AGENT_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/pi/adapter.js";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-frozen-resources-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, "source");
	await mkdir(join(source, "references"), { recursive: true });
	await writeFile(join(source, "SKILL.md"), "---\nname: probe\ndescription: Probe\n---\nOriginal skill\r\n");
	await writeFile(join(source, "references", "guide.bin"), Buffer.from([0, 255, 10, 13]));
	await writeFile(join(source, "run.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const skills = [{ contributionId: "skill:probe", name: "probe", kind: "plugin", required: true, sourcePath: join(source, "SKILL.md") }];
	const context = [{ id: "context:probe", kind: "context-file", source: "profile", intent: "developer", label: "Probe", required: true, order: 0, content: "Original context\r\n" }];
	const capsules = new PrefixCapsuleStore(join(root, "capsules"));
	return { root, source, skills, context, capsules, store: new PrefixResourceBundleStore(capsules) };
}

test("opaque resources preserve bytes and stable paths after source deletion and delivery reconstruction", async t => {
	const f = await fixture(t);
	const bundle = await capturePrefixResources(f.context, f.skills);
	const { reference, resources } = await f.store.put("pi", bundle);
	await rm(f.source, { recursive: true });
	const resumed = await new PrefixResourceBundleStore(f.capsules).restore(reference);
	assert.deepEqual(resumed, resources);
	assert.match(await readFile(resumed.skills[0].sourcePath, "utf8"), /Original skill\r\n/);
	assert.deepEqual(await readFile(join(dirname(resumed.skills[0].sourcePath), "references", "guide.bin")), Buffer.from([0, 255, 10, 13]));
	assert.equal(await readFile(resumed.context[0].materializedPath, "utf8"), "Original context\r\n");
	await rm(join(f.capsules.root, "resources", reference.digest), { recursive: true });
	assert.deepEqual(await f.store.restore(reference), resources, "missing delivery cache is reconstructed only from the original capsule");
});

test("resource publication is concurrent and corruption fails closed", async t => {
	const f = await fixture(t);
	const bundle = await capturePrefixResources(f.context, f.skills);
	const [a, b] = await Promise.all([f.store.put("pi", bundle), f.store.put("pi", bundle)]);
	assert.deepEqual(a, b);
	const executable = join(dirname(a.resources.skills[0].sourcePath), "run.sh");
	await chmod(executable, 0o400);
	await assert.rejects(f.store.restore(a.reference), /resource executable mode changed/);
	await chmod(executable, 0o500);
	const unexpected = join(dirname(a.resources.skills[0].sourcePath), "unexpected.md");
	await writeFile(unexpected, "not captured");
	await assert.rejects(f.store.restore(a.reference), /unexpected entry/);
	await rm(unexpected);
	await chmod(a.resources.skills[0].sourcePath, 0o600);
	await writeFile(a.resources.skills[0].sourcePath, "corrupted");
	await assert.rejects(f.store.restore(a.reference), /recovery required/);
});

test("resource symlink escapes, cycles, unsupported entries and traversal are rejected", async t => {
	const f = await fixture(t);
	await writeFile(join(f.root, "outside"), "outside");
	await symlink(join(f.root, "outside"), join(f.source, "escape"));
	await assert.rejects(capturePrefixResources(f.context, f.skills), /escapes/);
	await rm(join(f.source, "escape"));
	await symlink(f.source, join(f.source, "cycle"));
	await assert.rejects(capturePrefixResources(f.context, f.skills), /cycle/);
	await rm(join(f.source, "cycle"));
	const bundle = await capturePrefixResources(f.context, f.skills);
	bundle.files[0].path = "../escape";
	await assert.rejects(f.store.put("pi", bundle), /invalid resource entry/);
});

test("resource service resumes the durable selection without current source discovery and preserves it on disposal", async t => {
	const f = await fixture(t);
	const sessions = new SqlitePiboSessionStore(join(f.root, "sessions.sqlite"));
	t.after(() => sessions.close());
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	const makeController = () => {
		let binding = sessions.get(session.id).runtimeBinding;
		return new SessionPrefixController({ store: f.capsules, getBinding: () => binding,
			persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	};
	const service = new PiboRuntimeResourceService({ rootDir: join(f.root, "generations") });
	t.after(() => service.dispose());
	const contextPath = join(f.root, "context.md");
	await writeFile(contextPath, "Original selected context");
	const profile = new InitialSessionContextBuilder("frozen").withAutoContextFiles(false)
		.addContextFile({ path: contextPath }).addSkill({ name: "probe", path: f.skills[0].sourcePath }).createSession();
	const open = (generation, selected = profile) => service.createSession({ piboSessionId: session.id, runtimeInstanceId: "pi", adapterId: "pi",
		sessionGeneration: generation, profile: selected, cwd: f.root, capabilities: PI_AGENT_RUNTIME_CAPABILITIES, prefixController: makeController() });
	const first = await open("first");
	const paths = first.getSkillPaths();
	const context = first.getContextContributions();
	await first.dispose();
	await rm(f.source, { recursive: true });
	await rm(contextPath);
	const changed = new InitialSessionContextBuilder("changed").withAutoContextFiles(false)
		.addContextFile({ path: "does-not-exist.md" }).addSkill({ name: "changed", path: "missing/SKILL.md" }).createSession();
	const resumed = await open("second", changed);
	assert.deepEqual(resumed.getSkillPaths(), paths);
	assert.deepEqual(resumed.getContextContributions(), context);
	await resumed.dispose();
	assert.match(await readFile(paths[0], "utf8"), /Original skill/);
	const binding = sessions.get(session.id).runtimeBinding;
	await assert.rejects(makeController().sealResources(async () => { throw new Error("must not recapture"); }).then(result => {
		assert.equal(result.skills[0].sourcePath, paths[0]);
		return sessions.updateRuntimeBinding(session.id, { ...binding, metadata: {} }, { expectedRevision: binding.revision });
	}), /frozen resources require/);
});

test("competing resource captures commit only one binding and restart never invokes capture", async t => {
	const f = await fixture(t);
	const sessions = new SqlitePiboSessionStore(join(f.root, "sessions.sqlite"));
	t.after(() => sessions.close());
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	const controller = () => {
		let binding = sessions.get(session.id).runtimeBinding;
		return new SessionPrefixController({ store: f.capsules, getBinding: () => binding,
			persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	};
	const a = controller();
	const b = controller();
	const results = await Promise.allSettled([
		a.sealResources(() => capturePrefixResources(f.context, f.skills)),
		b.sealResources(() => capturePrefixResources([{ ...f.context[0], content: "competing context" }], f.skills)),
	]);
	assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
	assert.match(results.find(item => item.status === "rejected").reason.message, /changed concurrently/);
	const winner = results.find(item => item.status === "fulfilled").value;
	const resumed = await controller().sealResources(async () => { throw new Error("must not read current sources"); });
	assert.deepEqual(resumed, winner);
	const binding = sessions.get(session.id).runtimeBinding;
	const reference = binding.metadata.piboSessionPrefixResources;
	await rm(f.capsules.path(reference));
	await assert.rejects(controller().sealResources(async () => { throw new Error("must not fall back"); }), /recovery required/);
});
