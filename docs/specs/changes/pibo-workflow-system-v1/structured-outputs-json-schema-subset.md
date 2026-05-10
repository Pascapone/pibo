# Pibo Workflow V1 Structured Outputs JSON Schema Subset

**Status:** Draft  
**Created:** 2026-05-10  
**Related tasks:** `2.2`, `2.3` in `tasks.md`  
**Implementation:** `packages/workflows/src/validation/index.ts`

## Purpose

Workflow `json(...)` ports use a deliberately small JSON Schema subset aligned with OpenAI Structured Outputs / tool-calling contracts. The same subset is used for workflow input ports, workflow output ports, node input/output ports, human response schemas, edge adapter output ports, and global state field schemas.

This document defines the V1 schema contract that validators, runtime boundary checks, tests, and inspection surfaces should share. It also documents the initial workflow input value validation added for runtime start boundaries.

## Supported port kinds

```ts
text(description?)
json(schema, description?)
```

- `text` carries a plain string.
- `json` carries a JSON value validated against the V1 schema subset.
- Workflow, node, human response, and adapter JSON ports must use object-root structured schemas.
- Global state field schemas may use scalar, array, object, or nullable roots because a state field can represent a single value.

## Supported schema types

V1 supports the JSON Schema `type` values below:

- `string`
- `number`
- `integer`
- `boolean`
- `object`
- `array`
- `null`

`type` may be a single value or a non-empty array of supported values. Use arrays such as `['string', 'null']` for nullable semantics. Duplicate type names are rejected.

## Supported schema keywords

V1 allows only these schema keywords:

- `type`
- `title`
- `description`
- `enum`
- `const`
- `default`
- `properties`
- `required`
- `additionalProperties`
- `items`
- `anyOf`
- `$defs`
- `$ref`

Unsupported keywords are validation errors. `oneOf` and `allOf` are explicitly rejected even though they may appear in authored schemas during migration; flatten object schemas or use supported `anyOf` inside a property instead.

## Object schema rules

Every object schema must be strict:

```ts
{
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" }
  },
  required: ["title", "body"],
  additionalProperties: false
}
```

Rules:

1. `additionalProperties` must be exactly `false` on every object schema.
2. `properties`, when present, must be an object keyed by property name.
3. If `properties` contains fields, `required` must be present.
4. Every declared property must appear in `required`.
5. Every `required` entry must be a string and must match a declared property.
6. Optional fields should be modeled as nullable required fields, for example `{ type: ["string", "null"] }`.

## Root schema rules

For structured workflow boundaries, root schemas must be objects:

```ts
json({
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false
})
```

Do not use scalar, array, or root `anyOf` schemas for workflow/node/human/adapter ports. Wrap scalar or array values in an object property instead.

Root object enforcement applies to:

- `WorkflowDefinition.input`
- `WorkflowDefinition.output`
- node `input` and `output` ports
- human node `schema`
- edge adapter `output` ports

Global state field schemas are the exception and may use non-object roots.

## Arrays

Array schemas must declare an `items` schema:

```ts
{
  type: "array",
  items: { type: "string" }
}
```

The `items` schema is validated recursively with the same subset rules.

## anyOf

`anyOf` is supported only below the root of a structured port schema, such as inside a property or `$defs` entry:

```ts
{
  type: "object",
  properties: {
    result: {
      anyOf: [
        { type: "string" },
        { type: "null" }
      ]
    }
  },
  required: ["result"],
  additionalProperties: false
}
```

Rules:

- Root `anyOf` is rejected for structured workflow ports.
- `anyOf` must be a non-empty array.
- Each branch is validated recursively.
- Prefer nullable `type` arrays for simple nullable fields.

## Local definitions and references

V1 supports local `$defs` plus local references of the form `#/$defs/Name`:

```ts
{
  type: "object",
  properties: {
    item: { $ref: "#/$defs/Item" }
  },
  required: ["item"],
  additionalProperties: false,
  $defs: {
    Item: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false
    }
  }
}
```

Rules:

- `$defs` must be an object.
- `$ref` must be a string.
- Only local `$defs` references are supported.
- Unresolved references are validation errors.

## Rejected examples

### Scalar root for a structured port

```ts
json({ type: "string" })
```

Use an object wrapper instead.

### Missing strict object settings

```ts
{
  type: "object",
  properties: { answer: { type: "string" } }
}
```

Add `required: ["answer"]` and `additionalProperties: false`.

### Optional property omitted from required

```ts
{
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" }
  },
  required: ["title"],
  additionalProperties: false
}
```

Use a nullable required field for optional semantics:

```ts
{
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: ["string", "null"] }
  },
  required: ["title", "subtitle"],
  additionalProperties: false
}
```

### Root anyOf

```ts
{
  anyOf: [
    { type: "object", properties: {}, required: [], additionalProperties: false },
    { type: "null" }
  ]
}
```

Put the alternative inside a root object property or split the workflow contract.

## Runtime workflow input value validation

`validateWorkflowInput(definition, input)` validates a candidate workflow input before execution starts:

- `text` ports accept only string values.
- `json` ports first run schema subset validation, then validate the value against supported `type`, `required`, `additionalProperties: false`, `items`, `enum`, `const`, `anyOf`, and local `$defs`/`$ref` rules.
- Diagnostics use JSONPath-like input paths such as `$.input.topic` so callers can show precise start-boundary failures.

The reusable lower-level helpers are `validateWorkflowPortValue(port, value)` and `validateJsonValueAgainstSchema(schema, value)`.

## Diagnostic codes

The V1 validator reports structured diagnostics with `WorkflowInterfaceError.*` codes and JSONPath-like `path` values. Current schema subset diagnostics include:

- `WorkflowInterfaceError.schemaNotObject`
- `WorkflowInterfaceError.unsupportedSchemaKeyword`
- `WorkflowInterfaceError.unsupportedOneOf`
- `WorkflowInterfaceError.unsupportedAllOf`
- `WorkflowInterfaceError.invalidDefs`
- `WorkflowInterfaceError.invalidRef`
- `WorkflowInterfaceError.unresolvedRef`
- `WorkflowInterfaceError.schemaTypeMissing`
- `WorkflowInterfaceError.rootAnyOf`
- `WorkflowInterfaceError.invalidAnyOf`
- `WorkflowInterfaceError.rootMustBeObject`
- `WorkflowInterfaceError.arrayMissingItems`
- `WorkflowInterfaceError.invalidEnum`
- `WorkflowInterfaceError.emptyType`
- `WorkflowInterfaceError.unsupportedSchemaType`
- `WorkflowInterfaceError.duplicateSchemaType`
- `WorkflowInterfaceError.objectAdditionalProperties`
- `WorkflowInterfaceError.invalidProperties`
- `WorkflowInterfaceError.objectRequiredMissing`
- `WorkflowInterfaceError.objectPropertyNotRequired`
- `WorkflowInterfaceError.invalidRequiredEntry`
- `WorkflowInterfaceError.requiredUnknownProperty`
- `WorkflowInterfaceError.textValueExpected`
- `WorkflowInterfaceError.valueTypeMismatch`
- `WorkflowInterfaceError.constMismatch`
- `WorkflowInterfaceError.enumMismatch`
- `WorkflowInterfaceError.anyOfNoMatch`
- `WorkflowInterfaceError.requiredValueMissing`
- `WorkflowInterfaceError.unexpectedProperty`

## Author checklist

Before committing a new JSON port schema:

1. Use `json(schema)` only for JSON values; use `text()` for plain strings.
2. Make every workflow/node/human/adapter JSON port root an object.
3. Add `additionalProperties: false` to every object schema, including nested objects and `$defs`.
4. List every object property in `required`.
5. Use nullable types instead of omitted optional fields.
6. Add `items` to every array schema.
7. Keep `anyOf` below the root.
8. Use only local `$defs` references.
9. Run `npm --prefix packages/workflows test` after schema changes.
