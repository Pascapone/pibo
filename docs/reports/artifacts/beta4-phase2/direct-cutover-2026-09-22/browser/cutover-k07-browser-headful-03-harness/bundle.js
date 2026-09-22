// src/attachments/errors.ts
var ATTACHMENT_ERROR_CODES = Object.freeze([
  "ATT_INVALID_JSON",
  "ATT_SCHEMA_MISMATCH",
  "ATT_STALE_REVISION",
  "ATT_PROVIDER_MISSING",
  "ATT_ACCESS_DENIED",
  "ATT_NOT_PORTABLE",
  "ATT_BYTES_MISSING",
  "ATT_STORAGE_FAILED",
  "ATT_MATERIALIZE_FAILED",
  "ATT_ACCEPTANCE_UNKNOWN",
  "ATT_LIMIT_EXCEEDED"
]);
var AttachmentDraftError = class extends Error {
  code;
  retryable;
  constructor(error) {
    super(error.message);
    this.name = "AttachmentDraftError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
};

// src/attachments/json.ts
function isPlainJsonObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function invalidJson(message) {
  return new AttachmentDraftError({ code: "ATT_INVALID_JSON", message, retryable: false });
}
function assertJsonLeaf(value, label) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw invalidJson(`${label} must be finite JSON numbers.`);
  }
  if (Array.isArray(value) || isPlainJsonObject(value)) return;
  throw invalidJson(`${label} must be plain JSON (no functions, undefined, BigInt, symbols, or class instances).`);
}
function jsonChildKeys(container) {
  if (Array.isArray(container)) {
    const keys = [];
    for (let index = 0; index < container.length; index++) keys.push(index);
    return keys;
  }
  return Object.keys(container);
}
function assertJsonValue(value, label) {
  try {
    assertJsonLeaf(value, label);
    if (!Array.isArray(value) && !isPlainJsonObject(value)) return;
    const root = value;
    const ancestors = /* @__PURE__ */ new Set([root]);
    const stack = [{ container: root, keys: jsonChildKeys(root), index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.keys.length) {
        stack.pop();
        ancestors.delete(frame.container);
        continue;
      }
      const key = frame.keys[frame.index++];
      const child = Array.isArray(frame.container) ? frame.container[key] : frame.container[key];
      assertJsonLeaf(child, label);
      if (!Array.isArray(child) && !isPlainJsonObject(child)) continue;
      if (ancestors.has(child)) {
        throw invalidJson(`${label} must not contain cycles.`);
      }
      const container = child;
      ancestors.add(container);
      stack.push({ container, keys: jsonChildKeys(container), index: 0 });
    }
  } catch (error) {
    if (error instanceof AttachmentDraftError) throw error;
    throw invalidJson(`${label} could not be read as plain JSON.`);
  }
}
function toJsonText(value, label) {
  try {
    return JSON.stringify(value);
  } catch {
    throw invalidJson(`${label} could not be serialized as JSON.`);
  }
}
function cloneJson(value) {
  if (value === void 0) return value;
  try {
    return JSON.parse(toJsonText(value, "Value"));
  } catch (error) {
    if (error instanceof AttachmentDraftError) throw error;
    throw invalidJson("Value could not be cloned as JSON.");
  }
}

// src/shared/deterministic-digest.ts
function deterministicDigest(value) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}
function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object") return "null";
  const record = value;
  const entries = Object.keys(record).filter((key) => record[key] !== void 0).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}
function sha256Hex(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 4294967296);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high);
  view.setUint32(paddedLength - 4, low);
  const constants = [];
  const hash = [];
  for (let candidate = 2; constants.length < 64; candidate += 1) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
      if (candidate % divisor === 0) {
        prime = false;
        break;
      }
    }
    if (!prime) continue;
    if (hash.length < 8) hash.push(fractionalBits(Math.sqrt(candidate)));
    const cubeRoot = Math.cbrt ? Math.cbrt(candidate) : candidate ** (1 / 3);
    constants.push(fractionalBits(cubeRoot));
  }
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ left >>> 3;
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ right >>> 10;
      words[index] = words[index - 16] + sigma0 + words[index - 7] + sigma1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = e & f ^ ~e & g;
      const temporary1 = h + sum1 + choice + constants[index] + words[index] >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = a & b ^ a & c ^ b & c;
      const temporary2 = sum0 + majority >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temporary1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temporary1 + temporary2 >>> 0;
    }
    hash[0] = hash[0] + a >>> 0;
    hash[1] = hash[1] + b >>> 0;
    hash[2] = hash[2] + c >>> 0;
    hash[3] = hash[3] + d >>> 0;
    hash[4] = hash[4] + e >>> 0;
    hash[5] = hash[5] + f >>> 0;
    hash[6] = hash[6] + g >>> 0;
    hash[7] = hash[7] + h >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
function fractionalBits(value) {
  return Math.floor((value - Math.floor(value)) * 4294967296) >>> 0;
}
function rotateRight(value, bits) {
  return value >>> bits | value << 32 - bits;
}

// src/shared/message-content-binding.ts
var MESSAGE_CONTENT_BINDING_VERSION = 1;
function invalidBinding() {
  return Object.assign(new Error("Content-bound admission requires an unchanged JSON request, an explicit session and transaction, and durable admission version 2."), { code: "command_invalid_content_binding" });
}
function captureMessageRequestBody(value) {
  try {
    const body = JSON.parse(JSON.stringify(value));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidBinding();
    return body;
  } catch {
    throw invalidBinding();
  }
}
function createMessageContentBinding(input) {
  try {
    const body = captureMessageRequestBody(input.body);
    if (body.admissionVersion !== 2 || body.contentBindingVersion !== MESSAGE_CONTENT_BINDING_VERSION || typeof input.sessionId !== "string" || !input.sessionId || body.piboSessionId !== input.sessionId || typeof body.clientTxnId !== "string" || !body.clientTxnId.trim() || typeof body.text !== "string" || input.delivery !== "queue" && input.delivery !== "steer" || (body.delivery === void 0 ? "queue" : body.delivery) !== input.delivery) throw invalidBinding();
    return {
      version: MESSAGE_CONTENT_BINDING_VERSION,
      sha256: deterministicDigest({ domain: "pibo.message-content.v1", sessionId: input.sessionId, delivery: input.delivery, body })
    };
  } catch {
    throw invalidBinding();
  }
}
function isMessageContentBinding(value) {
  if (!value || typeof value !== "object") return false;
  const binding = value;
  return binding.version === MESSAGE_CONTENT_BINDING_VERSION && typeof binding.sha256 === "string" && binding.sha256.length === 64 && /^[0-9a-f]+$/.test(binding.sha256);
}
function sameMessageContentBinding(left, right) {
  return isMessageContentBinding(left) && isMessageContentBinding(right) && left.sha256 === right.sha256;
}

// src/apps/chat-ui/src/attachments/core-attachment-draft.ts
var CORE_ATTACHMENT_DRAFT_STATE_VERSION = 1;
var CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX = "pibo.chat.coreAttachments.draft.";
var CORE_ATTACHMENT_CLIENT_TXN_ID_MAX = 160;
var CORE_ATTACHMENT_ADD_ID_ATTEMPTS = 5;
function normalizeDraftClientTxnId(value) {
  if (typeof value !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "clientTxnId must be a string.",
      retryable: false
    });
  }
  const id = value.trim();
  if (!id) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "clientTxnId must be a non-empty string.",
      retryable: false
    });
  }
  if (id.length > CORE_ATTACHMENT_CLIENT_TXN_ID_MAX) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "clientTxnId is too long.",
      retryable: false
    });
  }
  return id;
}
function draftKey(sessionId) {
  return `${CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX}${sessionId}`;
}
function assertValidMedia(media) {
  if (!media || typeof media !== "object") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Media attachments must be objects.",
      retryable: false
    });
  }
  if (!media.draftResourceId || typeof media.draftResourceId !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_BYTES_MISSING",
      message: "Media attachments need a draft resource id.",
      retryable: false
    });
  }
  if (!media.mimeType || typeof media.mimeType !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Media attachments need a MIME type.",
      retryable: false
    });
  }
  if (!Number.isInteger(media.bytes) || media.bytes < 0) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Media byte size must be a non-negative integer.",
      retryable: false
    });
  }
}
function normalizeMediaInput(value) {
  if (value === void 0) return void 0;
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) assertValidMedia(entry);
  return entries.map((entry) => ({ ...entry }));
}
function assertValidPreparedUpload(upload) {
  if (!upload || typeof upload !== "object" || Array.isArray(upload)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Prepared uploads must be objects.",
      retryable: false
    });
  }
  if (!isSafePreparedBlobId(upload.blobId) || !nonEmptyString(upload.mimeType)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Prepared uploads require a URL-safe blobId string and a mimeType string.",
      retryable: false
    });
  }
  if (!isSafePreparedPath(upload.path)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Prepared upload paths must be URL-safe relative tokens without traversal.",
      retryable: false
    });
  }
  if (!Number.isInteger(upload.bytes) || upload.bytes < 0) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Prepared upload byte size must be a non-negative integer.",
      retryable: false
    });
  }
  return { blobId: upload.blobId, path: upload.path, bytes: upload.bytes, mimeType: upload.mimeType };
}
function validateStoredPreparedUpload(upload, txnId) {
  try {
    return assertValidPreparedUpload(upload);
  } catch (error) {
    throw new Error(`stored prepared uploads for ${txnId} are invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
  }
}
function assertValidAdmissionProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Admission proofs must be objects.",
      retryable: false
    });
  }
  if (!nonEmptyString(proof.fingerprint) || !nonEmptyString(proof.receiptId)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Admission proofs require string fingerprint and receiptId.",
      retryable: false
    });
  }
  return { fingerprint: proof.fingerprint, receiptId: proof.receiptId };
}
function assertValidEnvelopeInput(type, schemaVersion) {
  if (!type || typeof type !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Attachment drafts require a non-empty string type.",
      retryable: false
    });
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Attachment schemaVersion must be a finite integer >= 0.",
      retryable: false
    });
  }
}
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function isSafePreparedBlobId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[^\s/?#\\]+$/.test(value);
}
function isSafePreparedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}
function validateStoredRecord(value, sessionId, index) {
  const label = `record ${index}`;
  if (typeof value !== "object" || value === null) throw new Error(`${label} is not an object.`);
  const record = value;
  const envelope = record.envelope;
  if (!envelope || typeof envelope !== "object") throw new Error(`${label} has no envelope.`);
  if (envelope.formatVersion !== 1) throw new Error(`${label} has unsupported envelope formatVersion.`);
  if (!nonEmptyString(envelope.id)) throw new Error(`${label} has no string id.`);
  if (envelope.sessionId !== sessionId) throw new Error(`${label} belongs to a foreign session.`);
  if (!nonEmptyString(envelope.type)) throw new Error(`${label} has no string type.`);
  if (!Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 0) {
    throw new Error(`${label} has invalid schemaVersion.`);
  }
  if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 1) {
    throw new Error(`${label} has invalid revision.`);
  }
  if (!nonEmptyString(envelope.createdAt) || !nonEmptyString(envelope.updatedAt)) {
    throw new Error(`${label} has invalid timestamps.`);
  }
  if (record.status !== "ready" && record.status !== "saving" && record.status !== "error") {
    throw new Error(`${label} has invalid status.`);
  }
  if (record.status === "error") throw new Error(`${label} carries an unconfirmed error status.`);
  let media;
  try {
    assertJsonValue(record.payload, `${label} payload`);
    if (record.uiState !== void 0) assertJsonValue(record.uiState, `${label} UI state`);
    media = normalizeMediaInput(record.media);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid.`);
  }
  return {
    envelope: {
      formatVersion: 1,
      id: envelope.id,
      sessionId,
      type: envelope.type,
      schemaVersion: envelope.schemaVersion,
      revision: envelope.revision,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt
    },
    payload: cloneJson(record.payload),
    ...record.uiState !== void 0 ? { uiState: cloneJson(record.uiState) } : {},
    ...media !== void 0 ? { media } : {},
    status: "ready"
  };
}
function validateSnapshotShape(value) {
  if (typeof value !== "object" || value === null) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Send snapshots must be objects.",
      retryable: false
    });
  }
  const snapshot2 = value;
  if (typeof snapshot2.clientTxnId !== "string" || typeof snapshot2.sessionId !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Send snapshots require string clientTxnId and sessionId.",
      retryable: false
    });
  }
  if (typeof snapshot2.text !== "string" || typeof snapshot2.frozenAt !== "string") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Send snapshots require string text and frozenAt.",
      retryable: false
    });
  }
  if (!Array.isArray(snapshot2.attachments)) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Send snapshots require an attachments array.",
      retryable: false
    });
  }
  const attachments = [];
  for (const [index, entry] of snapshot2.attachments.entries()) {
    const candidate = entry;
    if (!candidate || typeof candidate !== "object") {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: `Snapshot attachment ${index} is not an object.`,
        retryable: false
      });
    }
    if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.type)) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: `Snapshot attachment ${index} requires string id and type.`,
        retryable: false
      });
    }
    if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: `Snapshot attachment ${index} has invalid revision.`,
        retryable: false
      });
    }
    if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 0) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: `Snapshot attachment ${index} has invalid schemaVersion.`,
        retryable: false
      });
    }
    assertJsonValue(candidate.payload, `Snapshot attachment ${index} payload`);
    const media = normalizeMediaInput(candidate.media);
    attachments.push({
      id: candidate.id,
      revision: candidate.revision,
      type: candidate.type,
      schemaVersion: candidate.schemaVersion,
      payload: cloneJson(candidate.payload),
      ...media !== void 0 ? { media } : {}
    });
  }
  return {
    clientTxnId: snapshot2.clientTxnId,
    sessionId: snapshot2.sessionId,
    text: snapshot2.text,
    frozenAt: snapshot2.frozenAt,
    attachments
  };
}
function validateReceiptShape(value) {
  if (typeof value !== "object" || value === null) {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Acceptance receipts must be objects.",
      retryable: false
    });
  }
  const receipt = value;
  if (typeof receipt.accepted !== "boolean") {
    throw new AttachmentDraftError({
      code: "ATT_INVALID_JSON",
      message: "Acceptance receipts require a boolean accepted flag.",
      retryable: false
    });
  }
  return { clientTxnId: normalizeDraftClientTxnId(receipt.clientTxnId), accepted: receipt.accepted };
}
function canonicalSendStructure(text, attachments) {
  return {
    text,
    attachments: attachments.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      type: entry.type,
      schemaVersion: entry.schemaVersion,
      payload: entry.payload,
      media: entry.media ?? null
    }))
  };
}
function canonicalSendValue(text, attachments) {
  return toJsonText(canonicalSendStructure(text, attachments), "Send value");
}
function canonicalSnapshot(snapshot2) {
  return toJsonText(
    {
      clientTxnId: snapshot2.clientTxnId,
      sessionId: snapshot2.sessionId,
      text: snapshot2.text,
      frozenAt: snapshot2.frozenAt,
      send: canonicalSendStructure(snapshot2.text, snapshot2.attachments)
    },
    "Send snapshot"
  );
}
function prepareSnapshotSubmission(snapshot2, value) {
  let body;
  try {
    body = captureMessageRequestBody(value);
  } catch {
    throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Submission must be a JSON body.", retryable: false });
  }
  const submitted = validateSnapshotShape({ ...snapshot2, text: body.text, attachments: body.attachments });
  if (body.piboSessionId !== snapshot2.sessionId || body.clientTxnId !== snapshot2.clientTxnId || canonicalSendValue(submitted.text, submitted.attachments) !== canonicalSendValue(snapshot2.text, snapshot2.attachments)) {
    throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Submission does not contain the frozen transaction, text and attachment revisions.", retryable: false });
  }
  try {
    const delivery = body.delivery === void 0 ? "queue" : body.delivery;
    return { body, contentBinding: createMessageContentBinding({ sessionId: snapshot2.sessionId, delivery, body }) };
  } catch {
    throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Submission requires durable content binding and a valid delivery mode.", retryable: false });
  }
}
var CoreAttachmentDraftStore = class {
  storage;
  sessionId;
  now;
  createId;
  records = [];
  openTransactions = /* @__PURE__ */ new Map();
  acceptedTransactions = /* @__PURE__ */ new Set();
  preparedUploads = /* @__PURE__ */ new Map();
  admissionProofs = /* @__PURE__ */ new Map();
  preparedSubmissions = /* @__PURE__ */ new Map();
  writerEpoch;
  storageError;
  constructor(storage, sessionId, options) {
    if (!sessionId) {
      throw new AttachmentDraftError({
        code: "ATT_ACCESS_DENIED",
        message: "Attachment drafts require a session id.",
        retryable: false
      });
    }
    this.storage = storage;
    this.sessionId = sessionId;
    this.now = options?.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.createId = options?.createId ?? (() => `att_${Date.now().toString(36)}_${Math.floor(Math.random() * 4294967295).toString(36)}`);
    this.writerEpoch = `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 4294967295).toString(36)}`;
    try {
      const loaded = this.load(draftKey(sessionId));
      this.records = loaded.records;
      this.openTransactions = loaded.openTransactions;
      this.acceptedTransactions = loaded.acceptedTransactions;
      this.preparedUploads = loaded.preparedUploads;
      this.admissionProofs = loaded.admissionProofs;
      this.preparedSubmissions = loaded.preparedSubmissions ?? /* @__PURE__ */ new Map();
    } catch (error) {
      this.records = [];
      this.openTransactions = /* @__PURE__ */ new Map();
      this.acceptedTransactions = /* @__PURE__ */ new Set();
      this.preparedUploads = /* @__PURE__ */ new Map();
      this.admissionProofs = /* @__PURE__ */ new Map();
      this.preparedSubmissions = /* @__PURE__ */ new Map();
      this.storageError = {
        code: "ATT_STORAGE_FAILED",
        message: `Stored attachment drafts could not be loaded: ${error instanceof Error ? error.message : "unknown cause"}`,
        retryable: false
      };
    }
  }
  get boundSessionId() {
    return this.sessionId;
  }
  list() {
    return this.records.map((record) => cloneJson(record));
  }
  get(id) {
    const record = this.records.find((candidate) => candidate.envelope.id === id);
    return record ? cloneJson(record) : void 0;
  }
  /** Detached read view; never exposes the engine held by a transaction. */
  view() {
    return cloneJson({
      records: this.records,
      openSnapshots: [...this.openTransactions.values()],
      acceptedTransactions: [...this.acceptedTransactions],
      preparedUploads: Object.fromEntries(this.preparedUploads),
      preparedSubmissions: Object.fromEntries(this.preparedSubmissions)
    });
  }
  executeCommand(command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) throw invalidJson("Draft command must be an object.");
    switch (command.kind) {
      case "add":
        return this.addSync(command.input);
      case "update":
        return this.updateSync(command.id, command.expectedRevision, command.next);
      case "remove":
        return this.removeSync(command.id);
      case "freeze":
        return this.freezeForSend(command.clientTxnId, command.text);
      case "accept":
        return this.applyAcceptance(command.snapshot, command.receipt);
      case "prepare":
        return this.prepareSubmission(command.snapshot, command.body);
      case "uploads":
        return this.setPreparedUploads(command.clientTxnId, command.uploads);
      case "legacyProof":
        return this.setAdmissionProof(command.clientTxnId, command.proof);
      default:
        throw invalidJson("Unknown attachment draft command.");
    }
  }
  async add(input) {
    return this.addSync(input);
  }
  addSync(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: "Attachment input must be an object.",
        retryable: false
      });
    }
    if (input.sessionId !== this.sessionId) {
      throw new AttachmentDraftError({
        code: "ATT_ACCESS_DENIED",
        message: "Attachment drafts belong to exactly one session.",
        retryable: false
      });
    }
    assertValidEnvelopeInput(input.type, input.schemaVersion);
    assertJsonValue(input.payload, "Attachment payload");
    if (input.uiState !== void 0) assertJsonValue(input.uiState, "Attachment UI state");
    const media = normalizeMediaInput(input.media);
    const timestamp = this.timestamp();
    const reserved = new Set(this.records.map((record2) => record2.envelope.id));
    for (const snapshot2 of this.openTransactions.values()) {
      for (const entry of snapshot2.attachments) reserved.add(entry.id);
    }
    let id = "";
    let attempts = 0;
    do {
      const generated = this.createId();
      if (!nonEmptyString(generated)) {
        throw new AttachmentDraftError({
          code: "ATT_INVALID_JSON",
          message: "Attachment id generator must produce a non-empty string id.",
          retryable: false
        });
      }
      id = generated;
      attempts += 1;
    } while (reserved.has(id) && attempts < CORE_ATTACHMENT_ADD_ID_ATTEMPTS);
    if (reserved.has(id)) {
      throw new AttachmentDraftError({
        code: "ATT_STORAGE_FAILED",
        message: "Attachment id generator produced only duplicate ids.",
        retryable: true
      });
    }
    const record = {
      envelope: {
        formatVersion: 1,
        id,
        sessionId: this.sessionId,
        type: input.type,
        schemaVersion: input.schemaVersion,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      payload: cloneJson(input.payload),
      ...input.uiState !== void 0 ? { uiState: cloneJson(input.uiState) } : {},
      ...media !== void 0 ? { media } : {},
      status: "ready"
    };
    this.commit({ records: [...this.records, record], openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs }, "Attachment draft could not be stored; it is not reload-proof.");
    return record.envelope.id;
  }
  async update(id, expectedRevision, next) {
    this.updateSync(id, expectedRevision, next);
  }
  updateSync(id, expectedRevision, next) {
    const record = this.records.find((candidate2) => candidate2.envelope.id === id);
    if (!record || record.envelope.revision !== expectedRevision) {
      throw new AttachmentDraftError({
        code: "ATT_STALE_REVISION",
        message: record ? `Attachment ${id} is at revision ${record.envelope.revision}, not ${expectedRevision}.` : `Attachment ${id} is unknown in this session.`,
        retryable: false
      });
    }
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: "Attachment changes must be an object.",
        retryable: false
      });
    }
    if (next.payload === void 0 && next.uiState === void 0) return;
    const touchesPayload = next.payload !== void 0;
    const nextRevision = touchesPayload ? record.envelope.revision + 1 : record.envelope.revision;
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new AttachmentDraftError({
        code: "ATT_LIMIT_EXCEEDED",
        message: "Attachment revision limit reached; the existing draft is unchanged.",
        retryable: false
      });
    }
    if (touchesPayload) assertJsonValue(next.payload, "Attachment payload");
    if (next.uiState !== void 0) assertJsonValue(next.uiState, "Attachment UI state");
    const timestamp = this.timestamp();
    const candidate = {
      ...cloneJson(record),
      payload: touchesPayload ? cloneJson(next.payload) : cloneJson(record.payload),
      ...next.uiState !== void 0 || record.uiState !== void 0 ? { uiState: cloneJson(next.uiState !== void 0 ? next.uiState : record.uiState) } : {},
      envelope: {
        ...record.envelope,
        revision: nextRevision,
        updatedAt: timestamp
      },
      status: "ready"
    };
    if (candidate.uiState === void 0) delete candidate.uiState;
    this.commit(
      {
        records: this.records.map((entry) => entry.envelope.id === id ? candidate : entry),
        openTransactions: this.openTransactions,
        acceptedTransactions: this.acceptedTransactions,
        preparedUploads: this.preparedUploads,
        admissionProofs: this.admissionProofs
      },
      "Attachment draft change could not be stored."
    );
  }
  async remove(id) {
    this.removeSync(id);
  }
  removeSync(id) {
    if (!this.records.some((candidate) => candidate.envelope.id === id)) return;
    this.commit(
      {
        records: this.records.filter((candidate) => candidate.envelope.id !== id),
        openTransactions: this.openTransactions,
        acceptedTransactions: this.acceptedTransactions,
        preparedUploads: this.preparedUploads,
        admissionProofs: this.admissionProofs
      },
      "Attachment removal could not be stored."
    );
  }
  freezeForSend(clientTxnId, text) {
    const txn = normalizeDraftClientTxnId(clientTxnId);
    if (typeof text !== "string") {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: "Send text must be a string.",
        retryable: false
      });
    }
    if (this.acceptedTransactions.has(txn)) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Accepted transaction ids are never frozen again with new content.",
        retryable: false
      });
    }
    const blocked = this.records.filter((record) => record.status !== "ready");
    if (blocked.length > 0) {
      throw new AttachmentDraftError({
        code: "ATT_MATERIALIZE_FAILED",
        message: `Attachments not ready for send: ${blocked.map((record) => record.envelope.id).join(", ")}.`,
        retryable: true
      });
    }
    const attachments = this.records.map((record) => ({
      id: record.envelope.id,
      revision: record.envelope.revision,
      type: record.envelope.type,
      schemaVersion: record.envelope.schemaVersion,
      payload: cloneJson(record.payload),
      ...record.media !== void 0 ? { media: record.media.map((entry) => ({ ...entry })) } : {}
    }));
    const sendValue = canonicalSendValue(text, attachments);
    const bound = this.openTransactions.get(txn);
    if (bound) {
      if (canonicalSendValue(bound.text, bound.attachments) === sendValue) return cloneJson(bound);
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Transaction id is already bound to a different send value.",
        retryable: false
      });
    }
    const snapshot2 = {
      clientTxnId: txn,
      sessionId: this.sessionId,
      text,
      frozenAt: this.timestamp(),
      attachments
    };
    const openTransactions = new Map(this.openTransactions);
    openTransactions.set(txn, snapshot2);
    this.commit(
      { records: this.records, openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs },
      "Send snapshot could not be stored; the transaction was not bound."
    );
    return cloneJson(snapshot2);
  }
  applyAcceptance(snapshot2, receipt) {
    const checkedReceipt = validateReceiptShape(receipt);
    const checkedSnapshot = validateSnapshotShape(snapshot2);
    if (checkedSnapshot.sessionId !== this.sessionId) {
      throw new AttachmentDraftError({
        code: "ATT_ACCESS_DENIED",
        message: "Send snapshots belong to exactly one session.",
        retryable: false
      });
    }
    if (normalizeDraftClientTxnId(checkedSnapshot.clientTxnId) !== checkedReceipt.clientTxnId) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Receipt does not match this send snapshot.",
        retryable: true
      });
    }
    const bound = this.openTransactions.get(checkedReceipt.clientTxnId);
    if (!bound) {
      if (this.acceptedTransactions.has(checkedReceipt.clientTxnId)) return { consumed: [], duplicate: true };
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Transaction was never frozen in this session.",
        retryable: true
      });
    }
    if (canonicalSnapshot(checkedSnapshot) !== canonicalSnapshot(bound)) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Snapshot does not match the bound original send.",
        retryable: false
      });
    }
    if (!checkedReceipt.accepted) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Acceptance is unknown; reconcile the receipt and retry unchanged.",
        retryable: true
      });
    }
    const consumed = [];
    const remaining = this.records.filter((record) => {
      const frozen = bound.attachments.find((candidate) => candidate.id === record.envelope.id);
      if (frozen && frozen.revision === record.envelope.revision) {
        consumed.push(record.envelope.id);
        return false;
      }
      return true;
    });
    const openTransactions = new Map(this.openTransactions);
    openTransactions.delete(checkedReceipt.clientTxnId);
    const acceptedTransactions = new Set(this.acceptedTransactions);
    acceptedTransactions.add(checkedReceipt.clientTxnId);
    const preparedUploads = new Map(this.preparedUploads);
    preparedUploads.delete(checkedReceipt.clientTxnId);
    const admissionProofs = new Map(this.admissionProofs);
    admissionProofs.delete(checkedReceipt.clientTxnId);
    this.commit(
      { records: remaining, openTransactions, acceptedTransactions, preparedUploads, admissionProofs },
      "Acceptance could not be stored; nothing was consumed."
    );
    return { consumed, duplicate: false };
  }
  load(key) {
    const raw = this.storage.readText(key);
    if (raw === null) {
      return { records: [], openTransactions: /* @__PURE__ */ new Map(), acceptedTransactions: /* @__PURE__ */ new Set(), preparedUploads: /* @__PURE__ */ new Map(), admissionProofs: /* @__PURE__ */ new Map() };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("entry is not valid JSON.");
    }
    if (Array.isArray(parsed)) {
      return {
        records: this.validateRecordArray(parsed),
        openTransactions: /* @__PURE__ */ new Map(),
        acceptedTransactions: /* @__PURE__ */ new Set(),
        preparedUploads: /* @__PURE__ */ new Map(),
        admissionProofs: /* @__PURE__ */ new Map()
      };
    }
    if (typeof parsed !== "object" || parsed === null) throw new Error("unsupported stored draft format.");
    const state = parsed;
    if (state.formatVersion !== CORE_ATTACHMENT_DRAFT_STATE_VERSION) {
      throw new Error(`unsupported stored draft formatVersion ${String(state.formatVersion)}.`);
    }
    if (state.sessionId !== this.sessionId) throw new Error("stored state belongs to a foreign session.");
    if (!Array.isArray(state.records)) throw new Error("stored state has no records array.");
    if (typeof state.openTransactions !== "object" || state.openTransactions === null || Array.isArray(state.openTransactions)) {
      throw new Error("stored state has no open-transactions object.");
    }
    if (!Array.isArray(state.acceptedTransactions)) throw new Error("stored state has no accepted-transactions array.");
    const records = this.validateRecordArray(state.records);
    const openTransactions = /* @__PURE__ */ new Map();
    for (const [keyName, entry] of Object.entries(state.openTransactions)) {
      let checked;
      try {
        checked = validateSnapshotShape(entry);
      } catch (error) {
        throw new Error(`stored open transaction is invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
      }
      if (checked.sessionId !== this.sessionId) throw new Error("stored open transaction belongs to a foreign session.");
      let normalizedKey;
      try {
        normalizedKey = normalizeDraftClientTxnId(checked.clientTxnId);
      } catch {
        throw new Error("stored open transaction has an invalid id.");
      }
      if (keyName !== normalizedKey) throw new Error("stored open transaction key mismatches its snapshot.");
      openTransactions.set(keyName, {
        clientTxnId: keyName,
        sessionId: this.sessionId,
        text: checked.text,
        frozenAt: checked.frozenAt,
        attachments: cloneJson(checked.attachments)
      });
    }
    const acceptedTransactions = /* @__PURE__ */ new Set();
    for (const entry of state.acceptedTransactions) {
      if (typeof entry !== "string" || entry !== entry.trim() || entry.length === 0 || entry.length > CORE_ATTACHMENT_CLIENT_TXN_ID_MAX) {
        throw new Error("stored accepted transaction id is invalid.");
      }
      if (acceptedTransactions.has(entry) || openTransactions.has(entry)) {
        throw new Error("stored accepted transaction id is duplicated or still open.");
      }
      acceptedTransactions.add(entry);
    }
    const preparedUploads = /* @__PURE__ */ new Map();
    if (state.preparedUploads !== void 0) {
      if (typeof state.preparedUploads !== "object" || state.preparedUploads === null || Array.isArray(state.preparedUploads)) {
        throw new Error("stored prepared uploads are invalid.");
      }
      for (const [txnId, uploads] of Object.entries(state.preparedUploads)) {
        if (!openTransactions.has(txnId)) throw new Error(`stored prepared uploads reference unknown transaction ${txnId}.`);
        if (!Array.isArray(uploads)) throw new Error(`stored prepared uploads for ${txnId} are invalid.`);
        preparedUploads.set(txnId, uploads.map((upload) => validateStoredPreparedUpload(upload, txnId)));
      }
    }
    const admissionProofs = /* @__PURE__ */ new Map();
    if (state.admissionProofs !== void 0) {
      if (typeof state.admissionProofs !== "object" || state.admissionProofs === null || Array.isArray(state.admissionProofs)) {
        throw new Error("stored admission proofs are invalid.");
      }
      for (const [txnId, proof] of Object.entries(state.admissionProofs)) {
        if (!openTransactions.has(txnId)) throw new Error(`stored admission proof references unknown transaction ${txnId}.`);
        try {
          admissionProofs.set(txnId, assertValidAdmissionProof(proof));
        } catch (error) {
          throw new Error(`stored admission proof for ${txnId} is invalid: ${error instanceof Error ? error.message : "unknown cause"}`);
        }
      }
    }
    const preparedSubmissions = /* @__PURE__ */ new Map();
    if (state.preparedSubmissions !== void 0) {
      if (!isPlainJsonObject(state.preparedSubmissions)) throw new Error("stored submissions are invalid.");
      for (const [txnId, value] of Object.entries(state.preparedSubmissions)) {
        const snapshot2 = openTransactions.get(txnId);
        if (!snapshot2 || !isPlainJsonObject(value)) throw new Error("stored submission has no open transaction.");
        const checked = prepareSnapshotSubmission(snapshot2, value.body);
        if (!sameMessageContentBinding(checked.contentBinding, value.contentBinding)) throw new Error("stored submission binding is invalid.");
        preparedSubmissions.set(txnId, checked);
      }
    }
    return { records, openTransactions, acceptedTransactions, preparedUploads, admissionProofs, preparedSubmissions };
  }
  validateRecordArray(entries) {
    const records = entries.map((entry, index) => validateStoredRecord(entry, this.sessionId, index));
    const ids = /* @__PURE__ */ new Set();
    for (const record of records) {
      if (ids.has(record.envelope.id)) throw new Error(`duplicate attachment id ${record.envelope.id}.`);
      ids.add(record.envelope.id);
    }
    return records;
  }
  timestamp() {
    const stamped = this.now();
    if (!nonEmptyString(stamped)) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: "Clock must produce a non-empty string timestamp.",
        retryable: false
      });
    }
    return stamped;
  }
  commit(candidate, failureMessage) {
    const preparedSubmissions = new Map([...candidate.preparedSubmissions ?? this.preparedSubmissions].filter(([txnId]) => candidate.openTransactions.has(txnId)));
    const text = toJsonText(
      {
        formatVersion: CORE_ATTACHMENT_DRAFT_STATE_VERSION,
        sessionId: this.sessionId,
        records: candidate.records,
        openTransactions: Object.fromEntries(candidate.openTransactions),
        acceptedTransactions: [...candidate.acceptedTransactions],
        writerEpoch: this.writerEpoch,
        preparedUploads: Object.fromEntries(candidate.preparedUploads),
        admissionProofs: Object.fromEntries(candidate.admissionProofs),
        preparedSubmissions: Object.fromEntries(preparedSubmissions)
      },
      "Draft state"
    );
    try {
      this.storage.writeText(draftKey(this.sessionId), text);
    } catch {
      const failure = { code: "ATT_STORAGE_FAILED", message: failureMessage, retryable: true };
      this.storageError = failure;
      throw new AttachmentDraftError(failure);
    }
    this.records = candidate.records;
    this.openTransactions = candidate.openTransactions;
    this.acceptedTransactions = candidate.acceptedTransactions;
    this.preparedUploads = candidate.preparedUploads;
    this.admissionProofs = candidate.admissionProofs;
    this.preparedSubmissions = preparedSubmissions;
    this.storageError = void 0;
  }
  /** Persist the exact submission before the network can accept it. Never
   * replace it under the same transaction, even after a lost response. */
  prepareSubmission(snapshot2, body) {
    const checkedSnapshot = validateSnapshotShape(snapshot2);
    const txn = normalizeDraftClientTxnId(checkedSnapshot.clientTxnId);
    const bound = this.openTransactions.get(txn);
    if (!bound || canonicalSnapshot(bound) !== canonicalSnapshot(checkedSnapshot)) {
      throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Submission requires the bound original snapshot.", retryable: false });
    }
    const checked = prepareSnapshotSubmission(bound, body);
    const prior = this.preparedSubmissions.get(txn);
    if (prior) {
      if (!sameMessageContentBinding(prior.contentBinding, checked.contentBinding)) {
        throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Transaction already has a different prepared submission; retry its original body.", retryable: false });
      }
      return cloneJson(prior);
    }
    const preparedSubmissions = new Map(this.preparedSubmissions);
    preparedSubmissions.set(txn, checked);
    this.commit({ records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs: this.admissionProofs, preparedSubmissions }, "Submission could not be stored; do not send it.");
    return cloneJson(checked);
  }
  getPreparedSubmission(clientTxnId) {
    const prepared = this.preparedSubmissions.get(normalizeDraftClientTxnId(clientTxnId));
    return prepared ? cloneJson(prepared) : void 0;
  }
  wasAccepted(clientTxnId) {
    return this.acceptedTransactions.has(normalizeDraftClientTxnId(clientTxnId));
  }
  getPreparedUploads(clientTxnId) {
    const txn = normalizeDraftClientTxnId(clientTxnId);
    return cloneJson(this.preparedUploads.get(txn) ?? []);
  }
  /**
   * Records uploads prepared at send freeze so retries reuse the same
   * frozen content and prepared resources instead of re-uploading. The
   * transaction must be open; entries are validated and persisted with the
   * same candidate→write→publish rule. Removed automatically on acceptance.
   */
  setPreparedUploads(clientTxnId, uploads) {
    const txn = normalizeDraftClientTxnId(clientTxnId);
    if (!this.openTransactions.has(txn)) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Prepared uploads require an open transaction.",
        retryable: false
      });
    }
    if (!Array.isArray(uploads)) {
      throw new AttachmentDraftError({
        code: "ATT_INVALID_JSON",
        message: "Prepared uploads must be an array.",
        retryable: false
      });
    }
    const checked = uploads.map((upload) => assertValidPreparedUpload(upload));
    if (this.preparedSubmissions.has(txn) && toJsonText(checked, "Prepared uploads") !== toJsonText(this.preparedUploads.get(txn) ?? [], "Prepared uploads")) {
      throw new AttachmentDraftError({ code: "ATT_ACCEPTANCE_UNKNOWN", message: "Prepared submission resources cannot change; retry the original body and uploads.", retryable: false });
    }
    const preparedUploads = new Map(this.preparedUploads);
    preparedUploads.set(txn, checked);
    this.commit(
      { records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads, admissionProofs: this.admissionProofs },
      "Prepared uploads could not be stored."
    );
  }
  getAdmissionProof(clientTxnId) {
    const txn = normalizeDraftClientTxnId(clientTxnId);
    const proof = this.admissionProofs.get(txn);
    return proof ? { ...proof } : void 0;
  }
  /**
   * Retains a legacy POST echo for old stored-state readability. This echo
   * is NOT evidence of the locally frozen request after a lost conflict.
   * Only prepareSubmission supplies the independently derived binding.
   * Requires an open transaction; dropped automatically on acceptance.
   */
  setAdmissionProof(clientTxnId, proof) {
    const txn = normalizeDraftClientTxnId(clientTxnId);
    if (!this.openTransactions.has(txn)) {
      throw new AttachmentDraftError({
        code: "ATT_ACCEPTANCE_UNKNOWN",
        message: "Admission proofs require an open transaction.",
        retryable: false
      });
    }
    const checked = assertValidAdmissionProof(proof);
    const admissionProofs = new Map(this.admissionProofs);
    admissionProofs.set(txn, checked);
    this.commit(
      { records: this.records, openTransactions: this.openTransactions, acceptedTransactions: this.acceptedTransactions, preparedUploads: this.preparedUploads, admissionProofs },
      "Admission proof could not be stored."
    );
  }
};

// src/apps/chat-ui/src/attachments/core-attachment-transitions.ts
function scratch(rawText, sessionId, options) {
  if (rawText !== null && typeof rawText !== "string") throw invalidJson("Stored draft text must be a string.");
  const expectedKey = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + sessionId;
  let text = rawText;
  const checkKey = (key) => {
    if (key !== expectedKey) throw invalidJson("Draft transition addressed a foreign storage key.");
  };
  const engine = new CoreAttachmentDraftStore({
    readText(key) {
      checkKey(key);
      return text;
    },
    writeText(key, value) {
      checkKey(key);
      text = value;
    },
    removeText() {
      throw invalidJson("Draft transitions cannot erase their storage entry.");
    }
  }, sessionId, options);
  if (engine.storageError) throw new AttachmentDraftError(engine.storageError);
  return { engine, text: () => text };
}
function readCoreAttachmentDraft(rawText, sessionId) {
  return scratch(rawText, sessionId).engine.view();
}
function transitionCoreAttachmentDraft(rawText, sessionId, command, options) {
  const state = scratch(rawText, sessionId, options);
  const result = state.engine.executeCommand(command);
  return { text: state.text(), result, view: state.engine.view() };
}

// src/apps/chat-ui/src/attachments/core-attachment-database.ts
var ATTACHMENT_BLOB_DB_NAME = "pibo-attachments-v1";
var ATTACHMENT_BLOB_DB_VERSION = 3;
var ATTACHMENT_BLOB_STORE_NAME = "draft-blobs";
var ATTACHMENT_BLOB_INDEX_NAME = "by-owner-session-draft";
var ATTACHMENT_BLOB_OWNER_INDEX = "by-owner";
var ATTACHMENT_COPY_STORE_NAME = "copy-buffers";
var ATTACHMENT_DRAFT_STORE_NAME = "draft-states";
var ATTACHMENT_DRAFT_OWNER_INDEX = "by-owner";
var ATTACHMENT_LEGACY_CLAIM_STORE_NAME = "legacy-claims";
var ATTACHMENT_LEGACY_BACKUP_STORE_NAME = "legacy-text-backups";
function nextAttachmentRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new AttachmentDraftError({ code: "ATT_LIMIT_EXCEEDED", message: "Attachment storage revision limit reached.", retryable: false });
  }
  return revision + 1;
}
function checkAttachmentDraftRow(value, ownerUserId, sessionId) {
  if (value.ownerUserId !== ownerUserId || value.sessionId !== sessionId || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.rawText !== null && typeof value.rawText !== "string" || typeof value.writerEpoch !== "string" || !value.writerEpoch || typeof value.updatedAt !== "string" || !value.updatedAt) {
    throw attachmentStorageFailed("Stored attachment draft scope or revision is invalid.");
  }
  return value;
}
function attachmentStorageFailed(message) {
  return new AttachmentDraftError({ code: "ATT_STORAGE_FAILED", message, retryable: true });
}
function attachmentIdbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? attachmentStorageFailed("IndexedDB request failed."));
  });
}
function openAttachmentDatabase(factory, name = ATTACHMENT_BLOB_DB_NAME) {
  return new Promise((resolve, reject) => {
    if (!factory || typeof factory.open !== "function" || typeof name !== "string" || !name) {
      reject(attachmentStorageFailed("Attachment storage factory or database name is unavailable."));
      return;
    }
    let request;
    try {
      request = factory.open(name, ATTACHMENT_BLOB_DB_VERSION);
    } catch {
      reject(attachmentStorageFailed("Attachment database could not be opened."));
      return;
    }
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      reject(attachmentStorageFailed(message));
    };
    request.onblocked = () => fail("Attachment database upgrade is blocked by another open tab. Close or reload that tab and retry.");
    request.onerror = () => fail("Attachment database could not be opened.");
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_BLOB_STORE_NAME)) {
        const store = db.createObjectStore(ATTACHMENT_BLOB_STORE_NAME, { keyPath: "blobId" });
        store.createIndex(ATTACHMENT_BLOB_INDEX_NAME, ["ownerUserId", "sessionId", "draftId"], { unique: false });
      }
      const blobs = request.transaction.objectStore(ATTACHMENT_BLOB_STORE_NAME);
      if (!blobs.indexNames.contains(ATTACHMENT_BLOB_OWNER_INDEX)) {
        blobs.createIndex(ATTACHMENT_BLOB_OWNER_INDEX, "ownerUserId", { unique: false });
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_COPY_STORE_NAME)) {
        db.createObjectStore(ATTACHMENT_COPY_STORE_NAME, { keyPath: "ownerUserId" });
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_DRAFT_STORE_NAME)) {
        const store = db.createObjectStore(ATTACHMENT_DRAFT_STORE_NAME, { keyPath: ["ownerUserId", "sessionId"] });
        store.createIndex(ATTACHMENT_DRAFT_OWNER_INDEX, "ownerUserId", { unique: false });
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_LEGACY_CLAIM_STORE_NAME)) {
        db.createObjectStore(ATTACHMENT_LEGACY_CLAIM_STORE_NAME, { keyPath: "sourceKey" });
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_LEGACY_BACKUP_STORE_NAME)) {
        db.createObjectStore(ATTACHMENT_LEGACY_BACKUP_STORE_NAME, { keyPath: ["ownerUserId", "sourceKey"] });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
async function attachmentIdbTransaction(db, names, mode, action) {
  let transaction;
  let done;
  try {
    transaction = db.transaction(names, mode);
    const active = transaction;
    done = new Promise((resolve, reject) => {
      active.oncomplete = () => resolve();
      active.onabort = () => reject(active.error ?? attachmentStorageFailed("Attachment transaction aborted."));
      active.onerror = () => reject(active.error ?? attachmentStorageFailed("Attachment transaction failed."));
    });
    void done.catch(() => void 0);
    const result = await action(names.map((name) => active.objectStore(name)));
    await done;
    return result;
  } catch (error) {
    try {
      transaction?.abort();
    } catch {
    }
    if (done) await done.catch(() => void 0);
    if (error instanceof AttachmentDraftError) throw error;
    throw attachmentStorageFailed("Attachment database operation failed; no success was confirmed.");
  }
}

// src/apps/chat-ui/src/attachments/core-attachment-persistence.ts
var ATTACHMENT_BLOB_MAX_BYTES = 15 * 1024 * 1024;
function storageFailed(message) {
  return new AttachmentDraftError({ code: "ATT_STORAGE_FAILED", message, retryable: true });
}
function mediaBlobIds(media) {
  return (media ?? []).map((entry) => entry.draftResourceId).filter((id) => typeof id === "string" && id.length > 0);
}
function collectBlobHolders(input) {
  const held = /* @__PURE__ */ new Set();
  const holders = [];
  for (const draft of input.drafts) {
    const blobIds = mediaBlobIds(draft.media);
    for (const blobId of blobIds) held.add(blobId);
    if (blobIds.length > 0) holders.push({ kind: "draft", id: draft.draftId, blobIds });
  }
  for (const snapshot2 of input.openSnapshots) {
    const blobIds = snapshot2.attachments.flatMap((entry) => mediaBlobIds(entry.media));
    for (const blobId of blobIds) held.add(blobId);
    if (blobIds.length > 0) holders.push({ kind: "snapshot", id: snapshot2.clientTxnId, blobIds });
  }
  if (input.copyBuffer) {
    const blobIds = mediaBlobIds(input.copyBuffer.media);
    for (const blobId of blobIds) held.add(blobId);
    if (blobIds.length > 0) holders.push({ kind: "copy", id: input.copyBuffer.copyId, blobIds });
  }
  return { held, holders };
}
async function readStoredBlobHolders(drafts, copies, ownerUserId) {
  const held = /* @__PURE__ */ new Set();
  const rows = await attachmentIdbRequest(drafts.index(ATTACHMENT_DRAFT_OWNER_INDEX).getAll(ownerUserId));
  for (const row of rows) {
    checkAttachmentDraftRow(row, ownerUserId, row.sessionId);
    const view = readCoreAttachmentDraft(row.rawText, row.sessionId);
    const holders = collectBlobHolders({
      drafts: view.records.map((record) => ({ draftId: record.envelope.id, media: record.media })),
      openSnapshots: view.openSnapshots
    });
    for (const id of holders.held) held.add(id);
  }
  const copy = await attachmentIdbRequest(copies.get(ownerUserId));
  if (copy) {
    if (copy.ownerUserId !== ownerUserId || !Array.isArray(copy.media) || copy.media.some((media) => !media || typeof media.draftResourceId !== "string" || !media.draftResourceId)) {
      throw storageFailed("Stored copy buffer holders could not be read.");
    }
    for (const id of mediaBlobIds(copy.media)) held.add(id);
  }
  return held;
}
function createBlobId() {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `fallback-${Date.now().toString(36)}-${Math.floor(Math.random() * 4294967295).toString(36)}`;
  return `blob_${random}`;
}
function toArrayBuffer(data) {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
function assertBlobInput(input) {
  if (!input.sessionId || !input.draftId) {
    throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Blobs belong to exactly one session draft.", retryable: false });
  }
  if (!input.mimeType || !(input.data instanceof Uint8Array)) {
    throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Blobs require a MIME type and byte data.", retryable: false });
  }
  if (input.data.byteLength > ATTACHMENT_BLOB_MAX_BYTES) {
    throw new AttachmentDraftError({
      code: "ATT_LIMIT_EXCEEDED",
      message: `Draft blob exceeds the ${ATTACHMENT_BLOB_MAX_BYTES}-byte limit.`,
      retryable: false
    });
  }
}
async function openAttachmentStores(factory, ownerUserId, databaseName) {
  if (!ownerUserId) throw storageFailed("Draft blob storage requires an owner user id.");
  if (!factory || typeof factory.open !== "function") throw storageFailed("Draft blob storage factory is unavailable.");
  const db = await openAttachmentDatabase(factory, databaseName);
  let closed = false;
  const close = () => {
    closed = true;
    db.close();
  };
  const active = () => {
    if (closed) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Attachment byte storage is closed for this login.", retryable: false });
  };
  db.addEventListener("versionchange", close);
  const withStores = async (names, mode, run) => {
    active();
    const result = await attachmentIdbTransaction(db, names, mode, run);
    active();
    return result;
  };
  const blobs = {
    ownerUserId,
    putBlob: async (input) => {
      assertBlobInput(input);
      const blobId = input.blobId ?? createBlobId();
      const record = {
        blobId,
        ownerUserId,
        sessionId: input.sessionId,
        draftId: input.draftId,
        mimeType: input.mimeType,
        size: input.data.byteLength,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        data: toArrayBuffer(input.data)
      };
      await withStores([ATTACHMENT_BLOB_STORE_NAME], "readwrite", async ([store]) => {
        try {
          await attachmentIdbRequest(store.add(record));
        } catch (error) {
          if (error instanceof DOMException && error.name === "ConstraintError") {
            throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Blob ids are immutable and cannot be replaced.", retryable: false });
          }
          throw error;
        }
      });
      return { blobId, bytes: record.size };
    },
    getBlob: async (blobId) => {
      return withStores([ATTACHMENT_BLOB_STORE_NAME], "readonly", async ([store]) => {
        const found = await attachmentIdbRequest(store.get(blobId));
        if (!found || found.ownerUserId !== ownerUserId) return void 0;
        return { mimeType: found.mimeType, data: new Uint8Array(found.data) };
      });
    },
    deleteBlob: async (blobId) => {
      return withStores([ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store, drafts, copies]) => {
        const found = await attachmentIdbRequest(store.get(blobId));
        if (!found || found.ownerUserId !== ownerUserId) return false;
        if ((await readStoredBlobHolders(drafts, copies, ownerUserId)).has(blobId)) return false;
        await attachmentIdbRequest(store.delete(blobId));
        return true;
      });
    },
    listBlobs: async (sessionId, draftId) => {
      return withStores([ATTACHMENT_BLOB_STORE_NAME], "readonly", async ([store]) => {
        const index = store.index(ATTACHMENT_BLOB_INDEX_NAME);
        const range = draftId !== void 0 ? IDBKeyRange.only([ownerUserId, sessionId, draftId]) : IDBKeyRange.bound([ownerUserId, sessionId, ""], [ownerUserId, sessionId, "\uFFFF"]);
        const rows = await attachmentIdbRequest(index.getAll(range));
        return rows.filter((row) => row.ownerUserId === ownerUserId).map((row) => ({ blobId: row.blobId, ownerUserId: row.ownerUserId, sessionId: row.sessionId, draftId: row.draftId, mimeType: row.mimeType, size: row.size, createdAt: row.createdAt }));
      });
    }
  };
  const copy = {
    ownerUserId,
    stage: async (entry) => {
      if (!entry.copyId || !entry.sourceSessionId || !entry.sourceDraftId) {
        throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Copy entries require copy, session, and draft ids.", retryable: false });
      }
      await withStores([ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store]) => {
        await attachmentIdbRequest(store.put({
          ownerUserId,
          copyId: entry.copyId,
          stagedAt: (/* @__PURE__ */ new Date()).toISOString(),
          sourceSessionId: entry.sourceSessionId,
          sourceDraftId: entry.sourceDraftId,
          sourceRevision: entry.sourceRevision,
          payload: entry.payload,
          media: entry.media
        }));
      });
    },
    load: async () => {
      return withStores([ATTACHMENT_COPY_STORE_NAME], "readonly", async ([store]) => {
        const found = await attachmentIdbRequest(store.get(ownerUserId));
        return found ?? void 0;
      });
    },
    clear: async () => {
      await withStores([ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([store]) => {
        await attachmentIdbRequest(store.delete(ownerUserId));
      });
    }
  };
  return {
    blobs,
    copy,
    close,
    // Preserve recovery text and custody; reset active data with no CAS ABA.
    clearOwner: async () => {
      await withStores([ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([blobStore, copyStore, draftStore]) => {
        const drafts = await attachmentIdbRequest(draftStore.index(ATTACHMENT_DRAFT_OWNER_INDEX).getAll(ownerUserId));
        for (const row of drafts) {
          checkAttachmentDraftRow(row, ownerUserId, row.sessionId);
          await attachmentIdbRequest(draftStore.put({ ...row, revision: nextAttachmentRevision(row.revision), rawText: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        }
        const rows = await attachmentIdbRequest(blobStore.index(ATTACHMENT_BLOB_OWNER_INDEX).getAll(ownerUserId));
        for (const row of rows) {
          if (row.ownerUserId === ownerUserId) await attachmentIdbRequest(blobStore.delete(row.blobId));
        }
        await attachmentIdbRequest(copyStore.delete(ownerUserId));
      });
    }
  };
}

// src/apps/chat-ui/src/attachments/core-attachment-indexed-draft.ts
var AttachmentDraftConflict = class extends AttachmentDraftError {
  constructor(expectedRevision, currentRevision, writerEpoch) {
    super({ code: "ATT_STALE_REVISION", message: `Draft storage is at revision ${currentRevision}, not ${expectedRevision}. Reload before changing it.`, retryable: false });
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
    this.writerEpoch = writerEpoch;
  }
  expectedRevision;
  currentRevision;
  writerEpoch;
};
function denied() {
  return new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Attachment storage is closed or belongs to another login.", retryable: false });
}
function checkExpected(expected) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw invalidJson("Expected storage revision must be a non-negative safe integer.");
}
function heldBy(view) {
  return collectBlobHolders({ drafts: view.records.map((record) => ({ draftId: record.envelope.id, media: record.media })), openSnapshots: view.openSnapshots }).held;
}
function snapshot(row, sessionId) {
  return { revision: row?.revision ?? 0, ...row ? { writerEpoch: row.writerEpoch } : {}, view: readCoreAttachmentDraft(row?.rawText ?? null, sessionId) };
}
function capturedBlobs(blobs) {
  const seen = /* @__PURE__ */ new Set();
  return blobs.map((blob) => {
    if (!blob || typeof blob.blobId !== "string" || !blob.blobId || seen.has(blob.blobId) || typeof blob.mimeType !== "string" || !blob.mimeType || !(blob.data instanceof Uint8Array)) {
      throw invalidJson("Draft byte inputs require distinct ids, MIME types and byte arrays.");
    }
    if (blob.data.byteLength > ATTACHMENT_BLOB_MAX_BYTES) {
      throw new AttachmentDraftError({ code: "ATT_LIMIT_EXCEEDED", message: "Draft blob exceeds the 15 MiB stored-byte limit.", retryable: false });
    }
    seen.add(blob.blobId);
    return { blobId: blob.blobId, mimeType: blob.mimeType, data: new Uint8Array(blob.data) };
  });
}
async function openIndexedAttachmentDraft(options) {
  const { ownerUserId, sessionId } = options;
  if (typeof ownerUserId !== "string" || !ownerUserId || typeof sessionId !== "string" || !sessionId) throw denied();
  const db = await openAttachmentDatabase(options.factory, options.databaseName);
  const writerEpoch = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  let closed = false;
  const close = () => {
    closed = true;
    db.close();
  };
  db.addEventListener("versionchange", close);
  const active = () => {
    if (closed) throw denied();
  };
  const key = [ownerUserId, sessionId];
  const readRow = async (store) => {
    const value = await attachmentIdbRequest(store.get(key));
    return value ? checkAttachmentDraftRow(value, ownerUserId, sessionId) : void 0;
  };
  const compare = (row, expected) => {
    if ((row?.revision ?? 0) !== expected) throw new AttachmentDraftConflict(expected, row?.revision ?? 0, row?.writerEpoch);
  };
  const rowFor = (rawText, revision) => ({
    ownerUserId,
    sessionId,
    revision,
    writerEpoch,
    rawText,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  const legacySourceKey = (kind) => {
    if (kind !== "unowned" && kind !== "owner-scoped") throw denied();
    const draftKey2 = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + sessionId;
    return kind === "unowned" ? draftKey2 : `pibo.attachments.owner.${ownerUserId}.${draftKey2}`;
  };
  const readBackup = async (backups, sourceKey) => {
    const backup = await attachmentIdbRequest(backups.get([ownerUserId, sourceKey]));
    if (!backup) return void 0;
    if (backup.ownerUserId !== ownerUserId || backup.sessionId !== sessionId || backup.sourceKey !== sourceKey || typeof backup.rawText !== "string" || backup.sourceDigest !== deterministicDigest({ domain: "pibo.attachment-legacy-text.v1", rawText: backup.rawText })) {
      throw attachmentStorageFailed("Legacy recovery backup is invalid; it was not changed.");
    }
    return backup;
  };
  return {
    ownerUserId,
    sessionId,
    close,
    async load() {
      active();
      const result = await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => snapshot(await readRow(store), sessionId));
      active();
      return result;
    },
    async execute(expectedRevision, value, newBlobs = []) {
      active();
      checkExpected(expectedRevision);
      if (!isPlainJsonObject(value) || typeof value.kind !== "string") throw invalidJson("Draft command must be a plain object with a kind.");
      assertJsonValue(value, "Draft command");
      let command;
      try {
        command = structuredClone(value);
      } catch {
        throw invalidJson("Draft command could not be captured.");
      }
      const blobs = capturedBlobs(newBlobs);
      if (blobs.length && command.kind !== "add") throw invalidJson("New bytes must be acquired atomically with a new draft record.");
      const outcome = await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([drafts, bytes, copies]) => {
        active();
        const current = await readRow(drafts);
        compare(current, expectedRevision);
        const before = readCoreAttachmentDraft(current?.rawText ?? null, sessionId);
        const next = transitionCoreAttachmentDraft(current?.rawText ?? null, sessionId, command);
        if (command.kind === "add") {
          const added = next.view.records.find((record) => record.envelope.id === next.result);
          for (const blob of blobs) {
            const media = added.media?.find((media2) => media2.draftResourceId === blob.blobId);
            if (!media || media.mimeType !== blob.mimeType || media.bytes !== blob.data.byteLength) throw invalidJson("New bytes must match a new attachment's frozen media descriptor.");
            const row2 = {
              blobId: blob.blobId,
              ownerUserId,
              sessionId,
              draftId: added.envelope.id,
              mimeType: blob.mimeType,
              size: blob.data.byteLength,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              data: blob.data.buffer
            };
            try {
              await attachmentIdbRequest(bytes.add(row2));
            } catch (error) {
              if (error instanceof DOMException && error.name === "ConstraintError") throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Blob id already exists; immutable bytes were not replaced.", retryable: false });
              throw error;
            }
          }
        }
        if (command.kind === "add" || command.kind === "freeze") {
          const records = command.kind === "add" ? next.view.records.filter((record) => record.envelope.id === next.result) : next.view.records;
          for (const record of records) for (const media of record.media ?? []) {
            const blob = await attachmentIdbRequest(bytes.get(media.draftResourceId));
            if (!blob || blob.ownerUserId !== ownerUserId || blob.sessionId !== sessionId || blob.draftId !== record.envelope.id || blob.mimeType !== media.mimeType || blob.size !== media.bytes || !(blob.data instanceof ArrayBuffer) || blob.data.byteLength !== blob.size) {
              throw new AttachmentDraftError({ code: "ATT_BYTES_MISSING", message: "Attachment bytes are missing or do not match this login and Session draft.", retryable: false });
            }
          }
        }
        if (next.text === (current?.rawText ?? null)) return { result: next.result, current: snapshot(current, sessionId) };
        const row = rowFor(next.text, nextAttachmentRevision(expectedRevision));
        await attachmentIdbRequest(drafts.put(row));
        const previousIds = heldBy(before);
        if (previousIds.size) {
          const held = await readStoredBlobHolders(drafts, copies, ownerUserId);
          const priorDraftIds = /* @__PURE__ */ new Set([...before.records.map((record) => record.envelope.id), ...before.openSnapshots.flatMap((snapshot2) => snapshot2.attachments.map((entry) => entry.id))]);
          for (const id of previousIds) if (!held.has(id)) {
            const blob = await attachmentIdbRequest(bytes.get(id));
            if (blob?.ownerUserId === ownerUserId && blob.sessionId === sessionId && priorDraftIds.has(blob.draftId)) await attachmentIdbRequest(bytes.delete(id));
          }
        }
        return { result: next.result, current: { revision: row.revision, writerEpoch, view: next.view } };
      });
      active();
      return outcome;
    },
    async readLegacyBackup(kind) {
      active();
      const sourceKey = legacySourceKey(kind);
      const result = await attachmentIdbTransaction(db, [ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readonly", async ([backups]) => {
        const backup = await readBackup(backups, sourceKey);
        return backup ? { rawText: backup.rawText, sourceDigest: backup.sourceDigest } : void 0;
      });
      active();
      return result;
    },
    /** Explicit text-state recovery into an absent/cleared entry, with CAS.
     * This restores metadata and proofs, NOT deleted binary bytes. Freeze
     * still checks byte availability; it cannot invent a media recovery. */
    async restoreLegacyText(expectedRevision, kind) {
      active();
      checkExpected(expectedRevision);
      const sourceKey = legacySourceKey(kind);
      const result = await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([drafts, backups]) => {
        active();
        const current = await readRow(drafts);
        compare(current, expectedRevision);
        if (current?.rawText != null) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Text recovery requires an absent or explicitly cleared draft; existing state was not replaced.", retryable: false });
        const backup = await readBackup(backups, sourceKey);
        if (!backup) throw denied();
        readCoreAttachmentDraft(backup.rawText, sessionId);
        const row = rowFor(backup.rawText, nextAttachmentRevision(expectedRevision));
        await attachmentIdbRequest(drafts.put(row));
        return snapshot(row, sessionId);
      });
      active();
      return result;
    },
    /** Explicit custody recovery only. No automatic reads, fallback, deletion
     * or claim that the current login was the original author. */
    async adoptLegacy(input) {
      active();
      if (input.confirmCustody !== true || !["unowned", "owner-scoped"].includes(input.kind)) throw denied();
      const sourceKey = legacySourceKey(input.kind);
      const outcome = await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_LEGACY_CLAIM_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([drafts, claims, backups]) => {
        active();
        const prior = await attachmentIdbRequest(claims.get(sourceKey));
        if (prior && prior.ownerUserId !== ownerUserId) throw denied();
        const existing = await readRow(drafts);
        compare(existing, 0);
        if (prior) throw attachmentStorageFailed("Legacy custody already exists; recover its retained copy instead of re-adopting changed text.");
        const rawText = input.storage.getItem(sourceKey);
        if (typeof rawText !== "string") throw attachmentStorageFailed("No recoverable legacy entry was found.");
        readCoreAttachmentDraft(rawText, sessionId);
        const sourceDigest = deterministicDigest({ domain: "pibo.attachment-legacy-text.v1", rawText });
        const claim = { sourceKey, ownerUserId, sessionId, claimedAt: (/* @__PURE__ */ new Date()).toISOString(), writerEpoch, sourceDigest };
        const backup = { sourceKey, ownerUserId, sessionId, sourceDigest, rawText };
        const row = rowFor(rawText, 1);
        await attachmentIdbRequest(claims.add(claim));
        await attachmentIdbRequest(backups.add(backup));
        await attachmentIdbRequest(drafts.add(row));
        const verified = await readRow(drafts);
        if (verified?.rawText !== rawText || (await readBackup(backups, sourceKey))?.rawText !== rawText) throw attachmentStorageFailed("Recovered draft text did not round-trip exactly.");
        return snapshot(verified, sessionId);
      });
      active();
      return outcome;
    }
  };
}

// test/fixtures/attachments/browser-persistence-lab.ts
var PREFIX = "pibo-k07-fixture-";
function assert(value, message = "assertion failed") {
  if (!value) throw new Error(message);
}
function equal(a, b, message = "values differ") {
  assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
async function rejects(promise, code) {
  try {
    await promise;
  } catch (error) {
    equal(error.code, code);
    return;
  }
  throw new Error(`Expected rejection ${code}`);
}
function safeName(name) {
  assert(name.startsWith(PREFIX) && name.length > PREFIX.length, "not an owned fixture database");
  return name;
}
function note(sessionId, text = "kept") {
  return { kind: "add", input: { sessionId, type: "pibo.core/note", schemaVersion: 1, payload: { text } } };
}
function image(sessionId, ids, bytes = 1) {
  return { kind: "add", input: { sessionId, type: "pibo.core/image", schemaVersion: 1, payload: { title: "fixture" }, media: ids.map((id) => ({ draftResourceId: id, mimeType: "image/png", bytes })) } };
}
function openDraft(name, ownerUserId = "owner", sessionId = "ps_fixture") {
  return openIndexedAttachmentDraft({ factory: indexedDB, databaseName: safeName(name), ownerUserId, sessionId });
}
async function drop(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(safeName(name));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Fixture cleanup blocked by an owned open handle"));
  });
}
async function version2(name) {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(safeName(name), 2);
    request.onupgradeneeded = () => {
      const blobs = request.result.createObjectStore(ATTACHMENT_BLOB_STORE_NAME, { keyPath: "blobId" });
      blobs.createIndex("by-owner-session-draft", ["ownerUserId", "sessionId", "draftId"]);
      request.result.createObjectStore(ATTACHMENT_COPY_STORE_NAME, { keyPath: "ownerUserId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
var nonce = crypto.randomUUID();
var peer = null;
var rpcId = 0;
var resolvePeerReady;
var peerReady = new Promise((resolve) => {
  resolvePeerReady = resolve;
});
window.addEventListener("message", (event) => {
  if (event.source === peer && event.origin === location.origin && event.data?.nonce === nonce && event.data?.ready === true) resolvePeerReady();
});
function callPeer(operation, data = {}) {
  const id = ++rpcId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("Owned peer did not respond"));
    }, 1e4);
    const listener = (event) => {
      if (event.source !== peer || event.origin !== location.origin || event.data?.nonce !== nonce || event.data?.id !== id) return;
      clearTimeout(timeout);
      window.removeEventListener("message", listener);
      resolve(event.data.result);
    };
    window.addEventListener("message", listener);
    peer.postMessage({ nonce, id, operation, ...data }, location.origin);
  });
}
async function runCases() {
  let readinessTimer;
  try {
    await Promise.race([peerReady, new Promise((_, reject) => {
      readinessTimer = setTimeout(() => reject(new Error("Owned peer did not become ready")), 1e4);
    })]);
  } finally {
    clearTimeout(readinessTimer);
  }
  const results = [];
  const run = async (label, body) => {
    const name = safeName(PREFIX + nonce + "-" + label);
    try {
      await body(name);
      results.push({ name: label, pass: true });
    } catch (error) {
      results.push({ name: label, pass: false, error: error instanceof Error ? error.stack : String(error) });
    } finally {
      try {
        await drop(name);
      } catch (error) {
        results.push({ name: label + " cleanup", pass: false, error: String(error) });
      }
    }
    document.querySelector("pre").textContent = JSON.stringify(results, null, 2);
  };
  await run("cas-scope-capture", async (name) => {
    const a = await openDraft(name), b = await openDraft(name), foreign = await openDraft(name, "foreign"), session = await openDraft(name, "owner", "ps_other");
    try {
      equal((await a.load()).revision, 0);
      const command = note("ps_fixture");
      const pending = a.execute(0, command);
      command.input.payload.text = "mutated";
      const added = await pending;
      equal(added.current.view.records[0].payload.text, "kept");
      await rejects(b.execute(0, note("ps_fixture")), "ATT_STALE_REVISION");
      equal((await b.load()).revision, 1);
      equal((await foreign.load()).revision, 0);
      equal((await session.load()).revision, 0);
      const changed = await b.execute(1, { kind: "update", id: added.result, expectedRevision: 1, next: { payload: { text: "new" } } });
      equal(changed.current.revision, 2);
      class NotJson {
        text = "no";
      }
      await rejects(a.execute(2, { ...note("ps_fixture"), input: { ...note("ps_fixture").input, payload: new NotJson() } }), "ATT_INVALID_JSON");
      a.close();
      await rejects(a.load(), "ATT_ACCESS_DENIED");
      equal((await b.load()).view.records[0].payload.text, "new");
    } finally {
      a.close();
      b.close();
      foreign.close();
      session.close();
    }
  });
  await run("atomic-bytes-and-immutable-owner", async (name) => {
    const draft = await openDraft(name), other = await openDraft(name, "other"), stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      const bytes = (blobId, data = [7]) => ({ blobId, mimeType: "image/png", data: new Uint8Array(data) });
      await rejects(draft.execute(0, image("ps_fixture", ["first", "bad"]), [bytes("first"), bytes("bad", [1, 2])]), "ATT_INVALID_JSON");
      equal((await draft.load()).revision, 0);
      equal(await stores.blobs.getBlob("first"), void 0);
      const result = await draft.execute(0, image("ps_fixture", ["immutable"]), [bytes("immutable")]);
      equal(result.current.revision, 1);
      await rejects(other.execute(0, image("ps_fixture", ["immutable"]), [bytes("immutable", [8])]), "ATT_STALE_REVISION");
      equal((await other.load()).revision, 0);
      equal([...(await stores.blobs.getBlob("immutable")).data], [7]);
      const otherStores = await openAttachmentStores(indexedDB, "other", name);
      try {
        equal(await otherStores.blobs.getBlob("immutable"), void 0);
        await rejects(otherStores.blobs.putBlob({ sessionId: "ps_fixture", draftId: "x", blobId: "immutable", mimeType: "image/png", data: new Uint8Array([9]) }), "ATT_STALE_REVISION");
      } finally {
        otherStores.close();
      }
    } finally {
      draft.close();
      other.close();
      stores.close();
    }
  });
  await run("frozen-holders-and-consumption", async (name) => {
    const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      const added = await draft.execute(0, image("ps_fixture", ["held"]), [{ blobId: "held", mimeType: "image/png", data: new Uint8Array([1]) }]);
      equal(await stores.blobs.deleteBlob("held"), false);
      const a = await draft.execute(added.current.revision, { kind: "freeze", clientTxnId: "a", text: "message" });
      const b = await draft.execute(a.current.revision, { kind: "freeze", clientTxnId: "b", text: "message" });
      const removed = await draft.execute(b.current.revision, { kind: "remove", id: added.result });
      equal(await stores.blobs.deleteBlob("held"), false);
      const acceptedA = await draft.execute(removed.current.revision, { kind: "accept", snapshot: a.result, receipt: { clientTxnId: "a", accepted: true } });
      assert(await stores.blobs.getBlob("held"), "other open snapshot lost its bytes");
      const acceptedB = await draft.execute(acceptedA.current.revision, { kind: "accept", snapshot: b.result, receipt: { clientTxnId: "b", accepted: true } });
      equal(await stores.blobs.getBlob("held"), void 0);
      const duplicate = await draft.execute(acceptedB.current.revision, { kind: "accept", snapshot: b.result, receipt: { clientTxnId: "b", accepted: true } });
      equal(duplicate.current.revision, acceptedB.current.revision);
      assert(duplicate.result.duplicate);
    } finally {
      draft.close();
      stores.close();
    }
  });
  await run("clear-tombstone-no-aba", async (name) => {
    const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      const added = await draft.execute(0, note("ps_fixture"));
      await stores.clearOwner();
      const cleared = await draft.load();
      assert(cleared.revision > added.current.revision);
      equal(cleared.view.records, []);
      await rejects(draft.execute(0, note("ps_fixture")), "ATT_STALE_REVISION");
      await rejects(draft.execute(added.current.revision, note("ps_fixture")), "ATT_STALE_REVISION");
      assert((await draft.execute(cleared.revision, note("ps_fixture"))).current.revision > cleared.revision);
    } finally {
      draft.close();
      stores.close();
    }
  });
  await run("explicit-legacy-custody-race", async (name) => {
    const session = "ps_fixture_" + nonce;
    const key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
    const raw = transitionCoreAttachmentDraft(null, session, note(session)).text;
    localStorage.setItem(key, raw);
    const a = await openDraft(name, "a", session), b = await openDraft(name, "b", session);
    let reads = 0;
    const storage = { getItem(key2) {
      reads++;
      return localStorage.getItem(key2);
    } };
    try {
      equal((await a.load()).view.records, []);
      equal((await b.load()).view.records, []);
      equal(reads, 0);
      const outcomes = await Promise.allSettled([a.adoptLegacy({ confirmCustody: true, kind: "unowned", storage }), b.adoptLegacy({ confirmCustody: true, kind: "unowned", storage })]);
      equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
      equal(reads, 1, "foreign claimant read legacy content");
      const winner = outcomes[0].status === "fulfilled" ? a : b, loser = winner === a ? b : a;
      equal(localStorage.getItem(key), raw);
      equal((await winner.readLegacyBackup("unowned")).rawText, raw);
      equal(await loser.readLegacyBackup("unowned"), void 0);
      localStorage.setItem(key, "changed later");
      equal((await winner.readLegacyBackup("unowned")).rawText, raw);
      await rejects(loser.adoptLegacy({ confirmCustody: true, kind: "unowned", storage }), "ATT_ACCESS_DENIED");
      equal(reads, 1);
      const owner = winner.ownerUserId;
      winner.close();
      await rejects(winner.load(), "ATT_ACCESS_DENIED");
      const reopened = await openDraft(name, owner, session);
      try {
        equal((await reopened.load()).view.records.length, 1);
      } finally {
        reopened.close();
      }
    } finally {
      a.close();
      b.close();
      localStorage.removeItem(key);
    }
  });
  await run("same-owner-custody-and-text-restore-cas", async (name) => {
    const session = "ps_fixture_scoped_" + nonce;
    const key = `pibo.attachments.owner.owner.${CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX}${session}`;
    const raw = transitionCoreAttachmentDraft(null, session, note(session)).text;
    localStorage.setItem(key, raw);
    const a = await openDraft(name, "owner", session), b = await openDraft(name, "owner", session);
    const stores = await openAttachmentStores(indexedDB, "owner", name), db = await openAttachmentDatabase(indexedDB, name);
    try {
      const outcomes = await Promise.allSettled([a.adoptLegacy({ confirmCustody: true, kind: "owner-scoped", storage: localStorage }), b.adoptLegacy({ confirmCustody: true, kind: "owner-scoped", storage: localStorage })]);
      equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
      const failure = outcomes.find((entry) => entry.status === "rejected");
      equal(failure.reason.code, "ATT_STALE_REVISION", "serialized loser must hit CAS, not a uniqueness violation");
      const claim = await attachmentIdbTransaction(db, [ATTACHMENT_LEGACY_CLAIM_STORE_NAME], "readonly", async ([store]) => attachmentIdbRequest(store.get(key)));
      assert(!Object.hasOwn(claim, "rawText"), "global custody metadata contains private text");
      await stores.clearOwner();
      const cleared = await a.load();
      equal((await a.readLegacyBackup("owner-scoped")).rawText, raw);
      await rejects(a.restoreLegacyText(0, "owner-scoped"), "ATT_STALE_REVISION");
      const restored = await a.restoreLegacyText(cleared.revision, "owner-scoped");
      assert(restored.revision > cleared.revision);
      equal(restored.view.records.length, 1);
      await rejects(a.restoreLegacyText(restored.revision, "owner-scoped"), "ATT_STALE_REVISION");
      equal(localStorage.getItem(key), raw);
    } finally {
      a.close();
      b.close();
      stores.close();
      db.close();
      localStorage.removeItem(key);
    }
  });
  await run("corrupt-legacy-and-backup-fail-closed", async (name) => {
    const session = "ps_fixture_corrupt_" + nonce, key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
    localStorage.setItem(key, "{corrupt");
    const a = await openDraft(name, "owner", session), b = await openDraft(name, "other", session), db = await openAttachmentDatabase(indexedDB, name);
    try {
      await rejects(a.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage }), "ATT_STORAGE_FAILED");
      equal(localStorage.getItem(key), "{corrupt");
      equal((await a.load()).revision, 0);
      equal(await attachmentIdbTransaction(db, [ATTACHMENT_LEGACY_CLAIM_STORE_NAME], "readonly", async ([store]) => attachmentIdbRequest(store.get(key))), void 0);
      const raw = transitionCoreAttachmentDraft(null, session, note(session)).text;
      localStorage.setItem(key, raw);
      await b.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage });
      equal(await a.readLegacyBackup("unowned"), void 0);
      await attachmentIdbTransaction(db, [ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([store]) => {
        const backup = await attachmentIdbRequest(store.get(["other", key]));
        await attachmentIdbRequest(store.put({ ...backup, sourceDigest: "tampered" }));
      });
      await rejects(b.readLegacyBackup("unowned"), "ATT_STORAGE_FAILED");
      equal(localStorage.getItem(key), raw);
    } finally {
      a.close();
      b.close();
      db.close();
      localStorage.removeItem(key);
    }
  });
  await run("text-restore-does-not-invent-deleted-bytes", async (name) => {
    const session = "ps_fixture_media_" + nonce, key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
    const source = transitionCoreAttachmentDraft(null, session, image(session, ["legacy-image"]));
    localStorage.setItem(key, source.text);
    const draft = await openDraft(name, "owner", session), stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      await stores.blobs.putBlob({ sessionId: session, draftId: source.result, mimeType: "image/png", blobId: "legacy-image", data: new Uint8Array([1]) });
      await draft.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage });
      await stores.clearOwner();
      const cleared = await draft.load();
      const restored = await draft.restoreLegacyText(cleared.revision, "unowned");
      equal(await stores.blobs.getBlob("legacy-image"), void 0);
      await rejects(draft.execute(restored.revision, { kind: "freeze", clientTxnId: "missing", text: "not sendable" }), "ATT_BYTES_MISSING");
      equal((await draft.load()).revision, restored.revision);
      equal((await draft.load()).view.openSnapshots, []);
    } finally {
      draft.close();
      stores.close();
      localStorage.removeItem(key);
    }
  });
  await run("corrupt-text-preserved", async (name) => {
    const db = await openAttachmentDatabase(indexedDB, name), draft = await openDraft(name);
    try {
      await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([store]) => {
        await attachmentIdbRequest(store.put({ ownerUserId: "owner", sessionId: "ps_fixture", revision: 1, writerEpoch: "fixture", updatedAt: "clock", rawText: "{broken" }));
      });
      await rejects(draft.load(), "ATT_STORAGE_FAILED");
      await rejects(draft.execute(1, note("ps_fixture")), "ATT_STORAGE_FAILED");
      const row = await attachmentIdbTransaction(db, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => attachmentIdbRequest(store.get(["owner", "ps_fixture"])));
      equal(row.rawText, "{broken");
      equal(row.revision, 1);
    } finally {
      draft.close();
      db.close();
    }
  });
  await run("injected-write-abort-not-real-quota", async (name) => {
    const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
    const original = IDBObjectStore.prototype.put;
    try {
      try {
        IDBObjectStore.prototype.put = function(...args) {
          if (this.name === ATTACHMENT_DRAFT_STORE_NAME) throw new DOMException("fixture quota failure", "QuotaExceededError");
          return original.apply(this, args);
        };
        await rejects(draft.execute(0, image("ps_fixture", ["rollback"]), [{ blobId: "rollback", mimeType: "image/png", data: new Uint8Array([1]) }]), "ATT_STORAGE_FAILED");
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      equal((await draft.load()).revision, 0);
      equal(await stores.blobs.getBlob("rollback"), void 0);
    } finally {
      draft.close();
      stores.close();
    }
  });
  await run("additive-v2-upgrade", async (name) => {
    const old = await version2(name);
    const blob = { blobId: "old", ownerUserId: "owner", sessionId: "ps_fixture", draftId: "att_old", mimeType: "image/png", size: 2, createdAt: "clock", data: new Uint8Array([3, 4]).buffer };
    const copy = { ownerUserId: "owner", copyId: "old-copy", stagedAt: "clock", sourceSessionId: "ps_fixture", sourceDraftId: "att_old", sourceRevision: 1, payload: { text: "old copy" }, media: [] };
    try {
      await attachmentIdbTransaction(old, [ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([blobs, copies]) => {
        await attachmentIdbRequest(blobs.add(blob));
        await attachmentIdbRequest(copies.add(copy));
      });
    } finally {
      old.close();
    }
    const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      equal((await draft.load()).revision, 0);
      equal([...(await stores.blobs.getBlob("old")).data], [3, 4]);
      equal(await stores.copy.load(), copy);
    } finally {
      draft.close();
      stores.close();
    }
  });
  await run("blocked-upgrade-is-not-late-success", async (name) => {
    const old = await version2(name);
    try {
      await rejects(openAttachmentDatabase(indexedDB, name), "ATT_STORAGE_FAILED");
      equal(old.version, 2);
    } finally {
      old.close();
    }
    const checked = await version2(name);
    try {
      equal(checked.version, 2);
      assert(!checked.objectStoreNames.contains(ATTACHMENT_DRAFT_STORE_NAME));
    } finally {
      checked.close();
    }
  });
  await run("closed-byte-facade-hides-pending-read", async (name) => {
    const stores = await openAttachmentStores(indexedDB, "owner", name);
    try {
      await stores.blobs.putBlob({ sessionId: "ps_fixture", draftId: "old", blobId: "retained", mimeType: "image/png", data: new Uint8Array([1]) });
      const pending = stores.blobs.getBlob("retained");
      stores.close();
      await rejects(pending, "ATT_ACCESS_DENIED");
      await rejects(stores.copy.load(), "ATT_ACCESS_DENIED");
      const reopened = await openAttachmentStores(indexedDB, "owner", name);
      try {
        equal([...(await reopened.blobs.getBlob("retained")).data], [1]);
      } finally {
        reopened.close();
      }
    } finally {
      stores.close();
    }
  });
  await run("versionchange-closes-owner-facade", async (name) => {
    const draft = await openDraft(name);
    let upgraded;
    try {
      await draft.execute(0, note("ps_fixture"));
      upgraded = await new Promise((resolve, reject) => {
        const request = indexedDB.open(safeName(name), 4);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await rejects(draft.load(), "ATT_ACCESS_DENIED");
      await rejects(draft.execute(1, note("ps_fixture")), "ATT_ACCESS_DENIED");
      const row = await attachmentIdbTransaction(upgraded, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => attachmentIdbRequest(store.get(["owner", "ps_fixture"])));
      equal(row.revision, 1);
    } finally {
      draft.close();
      upgraded?.close();
    }
  });
  await run("two-real-tabs-one-cas-winner", async (name) => {
    const parent = await openDraft(name);
    try {
      const initialized = await callPeer("init", { databaseName: name });
      assert(initialized.ok);
      equal(initialized.revision, 0);
      equal((await parent.load()).revision, 0);
      const main = parent.execute(0, note("ps_fixture", "main")).then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code }));
      const secondary = callPeer("execute", { command: note("ps_fixture", "peer") });
      const outcomes = await Promise.all([main, secondary]);
      equal(outcomes.filter((item) => item.ok).length, 1);
      const failed = outcomes.find((item) => !item.ok);
      equal(failed.code, "ATT_STALE_REVISION");
      equal((await parent.load()).revision, 1);
      equal((await parent.load()).view.records.length, 1);
    } finally {
      await callPeer("close");
      parent.close();
    }
  });
  peer?.close();
  const summary = { kind: "real-browser-persistence-modules-only", userAgent: navigator.userAgent, pass: results.filter((item) => item.pass).length, fail: results.filter((item) => !item.pass).length, results };
  window.fixtureResults = summary;
  document.querySelector("pre").textContent = JSON.stringify(summary, null, 2);
  document.querySelector("h1").textContent = summary.fail ? "Persistence fixtures FAILED" : "Persistence fixtures PASS";
}
if (location.pathname === "/peer") {
  document.body.innerHTML = "<h1>Owned second-tab fixture</h1><p>No application database is opened here.</p>";
  const expectedNonce = new URLSearchParams(location.search).get("nonce");
  let draft;
  window.addEventListener("message", async (event) => {
    if (event.source !== window.opener || event.origin !== location.origin || event.data?.nonce !== expectedNonce) return;
    const { operation, id } = event.data;
    let result;
    try {
      if (operation === "init") {
        draft = await openDraft(safeName(event.data.databaseName));
        result = { ok: true, revision: (await draft.load()).revision };
      } else if (operation === "execute") {
        await draft.execute(0, event.data.command);
        result = { ok: true };
      } else if (operation === "close") {
        draft?.close();
        result = { ok: true };
      } else throw new Error("Unknown fixture operation");
    } catch (error) {
      result = { ok: false, code: error.code, error: String(error) };
    }
    window.opener.postMessage({ nonce: expectedNonce, id, result }, location.origin);
  });
  window.opener.postMessage({ nonce: expectedNonce, ready: true }, location.origin);
} else {
  document.querySelector("button").addEventListener("click", () => {
    document.querySelector("button").disabled = true;
    peer = window.open(`/peer?nonce=${nonce}`, "_blank");
    if (!peer) throw new Error("Browser blocked the owned second fixture tab");
    void runCases().catch((error) => {
      window.fixtureFailure = String(error);
      document.querySelector("pre").textContent = String(error);
      peer?.close();
    });
  });
}
