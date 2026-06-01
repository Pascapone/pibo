// App context for the one product space behind web auth.
//
// Auth gates access to this app context. The context is not a user, tenant,
// principal, role, account, tenant, or storage partition.
export type PiboAppContext = {
	kind: "app-context";
	id: "app";
};

export const PIBO_APP_CONTEXT: PiboAppContext = Object.freeze({
	kind: "app-context",
	id: "app",
});
