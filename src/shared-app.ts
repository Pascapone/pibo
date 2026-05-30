// Shared-app context for the one product space behind web auth.
//
// The stored value below is retained only for legacy owner_scope columns and
// migration compatibility while active schemas are converted away from owner
// scopes. It is not a user, tenant, role, or permission boundary.
export const LEGACY_SHARED_APP_OWNER_SCOPE = "shared:app" as const;

export type PiboSharedAppContext = {
	kind: "shared-app";
	id: "shared-app";
	legacyOwnerScope: typeof LEGACY_SHARED_APP_OWNER_SCOPE;
};

export const SHARED_APP_CONTEXT: PiboSharedAppContext = Object.freeze({
	kind: "shared-app",
	id: "shared-app",
	legacyOwnerScope: LEGACY_SHARED_APP_OWNER_SCOPE,
});

export function getSharedAppLegacyOwnerScope(): typeof LEGACY_SHARED_APP_OWNER_SCOPE {
	return LEGACY_SHARED_APP_OWNER_SCOPE;
}
