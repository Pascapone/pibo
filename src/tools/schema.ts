import { Type } from "typebox";

/** JSON-Schema string enum helper that does not depend on a harness SDK. */
export function piboStringEnum<const TValues extends readonly string[]>(
	values: TValues,
	options: Record<string, unknown> = {},
) {
	return Type.Unsafe<TValues[number]>({
		type: "string",
		enum: [...values],
		...options,
	});
}
