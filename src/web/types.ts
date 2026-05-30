import type { PiboChannelContext } from "../channels/types.js";
import type { PiboAuthSession } from "../auth/types.js";
import type { PiboSharedAppContext, LEGACY_SHARED_APP_OWNER_SCOPE } from "../shared-app.js";

export type PiboWebSession = {
	authSession: PiboAuthSession;
	appContext: PiboSharedAppContext;
	/**
	 * @deprecated Legacy storage compatibility for owner_scope columns only.
	 * This value is pinned to the shared app and must not be derived from auth identity.
	 */
	ownerScope: typeof LEGACY_SHARED_APP_OWNER_SCOPE;
};

export type PiboWebAppContext = {
	channelContext: PiboChannelContext;
	requireSession(input: {
		request: Request;
	}): Promise<PiboWebSession>;
};

export type PiboWebApp = {
	name: string;
	mountPath: string;
	apiPrefix: string;
	handleRequest(request: Request, context: PiboWebAppContext): Promise<Response | undefined> | Response | undefined;
};
