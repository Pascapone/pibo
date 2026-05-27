import type { EdgePayloadReader, WorkflowValue } from "../types/index.js";

export function createEdgePayloadReader(payloads: Record<string, WorkflowValue>): EdgePayloadReader {
  return {
    get(edgeId) {
      return payloads[edgeId];
    },
    all() {
      return { ...payloads };
    },
  };
}
