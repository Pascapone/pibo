import { createUnauthenticatedError, type PiboAuthSession } from "../auth/types.js";
import type { PiboChannelContext } from "../channels/types.js";
import { PIBO_APP_CONTEXT } from "../app-context.js";
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
		appContext: PIBO_APP_CONTEXT,
	};
}
