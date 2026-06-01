// Shared-app context for the one product space behind web auth.
//
// Auth gates access to this app context. The context is not a user, tenant,
// principal, role, owner, or storage partition.
export type PiboSharedAppContext = {
	kind: "shared-app";
	id: "shared-app";
};

export const SHARED_APP_CONTEXT: PiboSharedAppContext = Object.freeze({
	kind: "shared-app",
	id: "shared-app",
});
