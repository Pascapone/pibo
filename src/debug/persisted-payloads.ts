import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { PayloadStore } from "../data/payload-store.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { eventAttributes, type DebugEventRow } from "./payloads.js";

export function createDebugPayloadStore(
	db: DatabaseSync,
	store: ResolvedPiboDebugStore,
): PayloadStore | undefined {
	const table = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'payloads'").get();
	if (!table) return undefined;
	return new PayloadStore(db, join(dirname(store.path), "payloads"));
}

export function hydrateDebugEventRow(
	row: DebugEventRow,
	payloadStore: PayloadStore | undefined,
): DebugEventRow {
	if (!row.payload_ref || !payloadStore) return row;
	const attributes = eventAttributes(row);
	if (attributes.inlinePayload !== undefined) return row;
	try {
		const metadata = payloadStore.getPayload(row.payload_ref);
		if (!metadata) return row;
		const inlinePayload = metadata.contentType.includes("json")
			? payloadStore.readPayloadJson(row.payload_ref)
			: payloadStore.readPayloadText(row.payload_ref);
		return {
			...row,
			attributes_json: JSON.stringify({ ...attributes, inlinePayload }),
		};
	} catch {
		return row;
	}
}
