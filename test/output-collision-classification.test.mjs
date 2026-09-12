import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutputCollision } from '../dist/core/output-collision-classification.js';
import { outputIdentityFingerprint, legacyOutputIdentityFingerprint } from '../dist/core/output-render-sequence.js';

const canonical = { type: 'assistant_message', piboSessionId: 'ps_child', eventId: 'turn', assistantIndex: 0, text: 'complete answer', provenance: { kind: 'subagent', parentPiboSessionId: 'ps_parent', agentId: 'ps_child' } };
const failed = { type: 'assistant_message', piboSessionId: 'ps_child', eventId: 'turn', contentIndex: 0, text: 'complete answer', renderSequence: 42 };
const stored = (event = canonical, version = 2) => ({ event, identityFingerprint: version === 1 ? legacyOutputIdentityFingerprint(event) : outputIdentityFingerprint(event), identityFingerprintVersion: version });

test('provenance-only legacy collision is proven from the independently reconstructed canonical event', () => {
 for (const version of [1, 2]) {
  const before = JSON.stringify([canonical, failed]);
  const decision = classifyOutputCollision({ incoming: failed, existing: stored(canonical, version) });
  assert.equal(decision.classification, version === 1 ? 'equivalent-legacy' : 'equivalent-v2');
  assert.equal(decision.bodyCompared, true);assert.equal(decision.repairable, true);assert.equal(decision.fingerprintVersion, 2);
  assert.equal(JSON.stringify([canonical, failed]), before);
 }
 const legacy = stored(canonical, 1);delete legacy.identityFingerprintVersion;
 assert.equal(classifyOutputCollision({ incoming: failed, existing: legacy }).classification, 'equivalent-legacy');
});

test('incoming text or a preview cannot substitute for a canonical legacy fingerprint proof', () => {
 const original = stored(canonical, 1);
 for (const incomplete of [{ ...failed }, { ...canonical, text: 'complete' }]) {
  const decision = classifyOutputCollision({ incoming: failed, existing: { ...original, event: incomplete } });
  assert.equal(decision.classification, 'insufficient-evidence');assert.equal(decision.repairable, false);
 }
 const mismatch = classifyOutputCollision({ incoming: failed, existing: { ...original, identityFingerprintVersion: 2 } });
 assert.equal(mismatch.classification, 'insufficient-evidence');
});

test('changed text, source, session, turn and part remain semantic conflicts', () => {
 for (const change of [{ text: 'different private content' }, { source: 'service' }, { piboSessionId: 'ps_other' }, { eventId: 'other' }, { contentIndex: 1 }]) {
  const decision = classifyOutputCollision({ incoming: { ...failed, ...change }, existing: stored() });
  assert.equal(decision.classification, 'semantic-conflict');assert.equal(decision.repairable, false);
  assert.equal(JSON.stringify(decision).includes('private content'), false);
 }
});

test('terminal delivery equality is independent of an assistant delivery decision', () => {
 const terminal = { type: 'message_finished', piboSessionId: 'ps_child', eventId: 'turn', source: 'user', provenance: canonical.provenance, renderSequence: 50 };
 const replay = { ...terminal, provenance: undefined, renderSequence: 51 };
 assert.equal(classifyOutputCollision({ incoming: replay, existing: stored(terminal, 1) }).repairable, true);
 assert.equal(classifyOutputCollision({ incoming: { ...replay, source: 'service' }, existing: stored(terminal) }).classification, 'semantic-conflict');
});

test('unsupported versions and incomplete events cannot be labeled repairable', () => {
 assert.equal(classifyOutputCollision({ incoming: failed, existing: { ...stored(), identityFingerprintVersion: 99 } }).classification, 'unsupported-version');
 for (const event of [{ ...canonical, text: undefined }, { ...canonical, eventId: undefined }, { ...canonical, assistantIndex: -1 }, { ...canonical, type: 'unknown_future_output' }]) {
  assert.equal(classifyOutputCollision({ incoming: event, existing: stored() }).repairable, false);
 }
});

test('classification bounds hostile structures without invoking accessors or returning bodies', () => {
 const oversized = { ...failed, text: 'private'.repeat(10000) };
 assert.equal(classifyOutputCollision({ incoming: oversized, existing: stored(), maxBytes: 1000 }).classification, 'budget-exceeded');
 let getterCalls = 0;const accessor = { ...failed };
 Object.defineProperty(accessor, 'text', { enumerable: true, get() { getterCalls++;return 'complete answer'; } });
 assert.equal(classifyOutputCollision({ incoming: accessor, existing: stored() }).classification, 'insufficient-evidence');
 assert.equal(getterCalls, 0);
 const circular = { ...failed };circular.provenance = circular;
 assert.equal(classifyOutputCollision({ incoming: circular, existing: stored() }).classification, 'insufficient-evidence');
 let nested = {};for (let i=0;i<70;i++)nested={ nested };
 assert.equal(classifyOutputCollision({ incoming: { ...failed, provenance: nested }, existing: stored() }).classification, 'budget-exceeded');
 assert.equal(classifyOutputCollision({ incoming: failed, existing: stored(), maxBytes: Infinity }).classification, 'budget-exceeded');
});
