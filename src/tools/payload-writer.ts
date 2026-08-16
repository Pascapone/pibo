import type { PayloadStore } from "../data/payload-store.js";
import type { PiboToolPayloadWriter } from "./mcp-bridge.js";

/** Adapt the shared durable PayloadStore for large portable tool results. */
export function createPiboToolPayloadWriter(store: PayloadStore): PiboToolPayloadWriter {
	return {
		write(input) {
			const payload = store.writePayload({
				value: input.value,
				contentType: input.contentType,
				retentionClass: "tool_result",
			});
			return {
				ref: payload.id,
				byteLength: payload.byteSize,
				...(payload.previewText ? { preview: payload.previewText } : {}),
			};
		},
	};
}
