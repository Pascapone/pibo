import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  boundedReviewLoopWorkflowFixture,
  humanWaitWorkflowFixture,
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  projectWorkflowToXStateProjection,
} from "../index.js";
import type { JsonValue, WorkflowDefinition } from "../index.js";

type ProjectionSnapshot = Record<string, JsonValue>;

const SNAPSHOT_PATH = new URL("./__snapshots__/xstate-projection.snap.json", import.meta.url);

const SNAPSHOT_FIXTURES: readonly WorkflowDefinition[] = [
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  humanWaitWorkflowFixture,
  boundedReviewLoopWorkflowFixture,
];

describe("XState projection snapshots", () => {
  it("matches deterministic machine projection snapshots for representative workflows", () => {
    const expected = readProjectionSnapshot();
    const actual = Object.fromEntries(
      SNAPSHOT_FIXTURES.map((definition) => [
        definition.id,
        normalizeForSnapshot(projectWorkflowToXStateProjection(definition)),
      ]),
    );

    assert.deepEqual(actual, expected);
  });
});

function readProjectionSnapshot(): ProjectionSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ProjectionSnapshot;
}

function normalizeForSnapshot(value: unknown): JsonValue {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSnapshot(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeForSnapshot(entryValue)]),
    );
  }

  return String(value);
}
