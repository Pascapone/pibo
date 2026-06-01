// Temporary pre-cutover compatibility for legacy SQLite schemas that still
// contain owner_scope/principal_id columns.
//
// Do not use this module as product context. The active app context lives in
// shared-app.ts and has no owner or principal field. Later final-removal
// stories delete these callers as each schema/API becomes ownerless.
export const PRE_CUTOVER_LEGACY_OWNER_SCOPE = "shared:app" as const;

export function legacyOwnerScopeForPreCutoverSchemas(): typeof PRE_CUTOVER_LEGACY_OWNER_SCOPE {
	return PRE_CUTOVER_LEGACY_OWNER_SCOPE;
}
