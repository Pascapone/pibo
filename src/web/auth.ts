import { createUnauthenticatedError, type PiboAuthSession } from "../auth/types.js";
import type { PiboChannelContext } from "../channels/types.js";
import { SHARED_APP_CONTEXT, getSharedAppLegacyOwnerScope } from "../shared-app.js";
import type { PiboWebSession } from "./types.js";

export async function getWebAuthSession(
	context: PiboChannelContext,
	request: Request,
): Promise<PiboAuthSession | undefined> {
	return context.auth?.getSession(request.headers);
}

export async function requireWebSession(
	context: PiboChannelContext,
	request: Request,
): Promise<PiboWebSession> {
	const authSession = await getWebAuthSession(context, request);
	if (!authSession) throw createUnauthenticatedError();

	return {
		authSession,
		appContext: SHARED_APP_CONTEXT,
		ownerScope: getSharedAppLegacyOwnerScope(),
	};
}
