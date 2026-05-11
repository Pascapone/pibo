import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adapterRef,
  adapterRefId,
  edgeAdapter,
  excludeSelection,
  extendSelection,
  fixedProfile,
  inheritSelection,
  isAdapterRef,
  isJsonPort,
  isTextPort,
  json,
  onlySelection,
  promptBuilderRef,
  promptBuilderRefId,
  isPromptBuilderRef,
  text,
} from "../index.js";
import type { AdapterNodeDefinition, JsonSchema, WorkflowPort } from "../index.js";

const articleSchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
  additionalProperties: false,
};

describe("workflow port authoring helpers", () => {
  it("creates text ports with optional descriptions", () => {
    assert.deepEqual(text(), { kind: "text" });
    assert.deepEqual(text("Plain user prompt."), {
      kind: "text",
      description: "Plain user prompt.",
    });
  });

  it("creates JSON ports with schema contracts and optional descriptions", () => {
    const port = json(articleSchema, "Article payload.");

    assert.deepEqual(port, {
      kind: "json",
      schema: articleSchema,
      description: "Article payload.",
    });
  });

  it("narrows ports by kind", () => {
    const ports: WorkflowPort[] = [text(), json(articleSchema)];

    assert.equal(isTextPort(ports[0]), true);
    assert.equal(isJsonPort(ports[0]), false);
    assert.equal(isTextPort(ports[1]), false);
    assert.equal(isJsonPort(ports[1]), true);
  });

  it("creates fixed Agent Designer profile and selection policy helpers", () => {
    assert.deepEqual(fixedProfile("pibo-agent"), { kind: "fixed", id: "pibo-agent" });
    assert.deepEqual(inheritSelection(), { kind: "inherit" });
    assert.deepEqual(onlySelection(["read", "bash"]), { kind: "only", ids: ["read", "bash"] });
    assert.deepEqual(excludeSelection(["dangerous-tool"]), { kind: "exclude", ids: ["dangerous-tool"] });
    assert.deepEqual(extendSelection(["workflow-skill"]), { kind: "extend", ids: ["workflow-skill"] });
  });

  it("creates registered TypeScript prompt builder refs for agent nodes", () => {
    const ref = promptBuilderRef("promptBuilders.articleDraft");

    assert.deepEqual(ref, {
      kind: "promptBuilder",
      language: "typescript",
      id: "promptBuilders.articleDraft",
    });
    assert.equal(isPromptBuilderRef(ref), true);
    assert.equal(isPromptBuilderRef("promptBuilders.articleDraft"), false);
    assert.equal(promptBuilderRefId(ref), "promptBuilders.articleDraft");
    assert.equal(promptBuilderRefId("promptBuilders.legacyString"), "promptBuilders.legacyString");
  });

  it("creates registered TypeScript adapter refs for edge adapters and visible adapter nodes", () => {
    const ref = adapterRef("adapters.textToArticle");

    assert.deepEqual(ref, {
      kind: "adapter",
      language: "typescript",
      id: "adapters.textToArticle",
    });
    assert.equal(isAdapterRef(ref), true);
    assert.equal(isAdapterRef("adapters.textToArticle"), false);
    assert.equal(adapterRefId(ref), "adapters.textToArticle");

    assert.deepEqual(edgeAdapter(ref, json(articleSchema)), {
      kind: "edgeAdapter",
      transform: ref,
      output: json(articleSchema),
    });

    const node: AdapterNodeDefinition = {
      kind: "adapter",
      handler: ref,
      mode: "deterministic",
      input: text(),
      output: json(articleSchema),
    };

    assert.deepEqual(node.handler, ref);
  });
});
