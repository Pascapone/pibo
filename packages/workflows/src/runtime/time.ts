import type { DurationSpec, WorkflowWaitToken } from "../types/index.js";

export type WorkflowRuntimeNow = () => Date | string;

export function createTimestampFactory(now?: WorkflowRuntimeNow): () => string {
  return () => {
    const value = now?.() ?? new Date();
    return typeof value === "string" ? value : value.toISOString();
  };
}

export function resolveWaitTokenExpiry(
  timeout: DurationSpec | undefined,
  createdAt: string,
): Pick<WorkflowWaitToken, "expiresAt"> {
  if (!timeout) {
    return {};
  }

  const durationMs = durationSpecToMilliseconds(timeout);
  if (durationMs === undefined) {
    return {};
  }

  return { expiresAt: new Date(new Date(createdAt).getTime() + durationMs).toISOString() };
}

function durationSpecToMilliseconds(duration: DurationSpec): number | undefined {
  switch (duration.kind) {
    case "milliseconds":
      return duration.value;
    case "seconds":
      return duration.value * 1000;
    case "minutes":
      return duration.value * 60_000;
    case "iso8601":
      return parseIso8601DurationMilliseconds(duration.value);
  }
}

function parseIso8601DurationMilliseconds(value: string): number | undefined {
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export function timestampToMillis(value: Date | string): number {
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
}
