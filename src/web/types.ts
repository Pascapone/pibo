import type { PiboChannelContext } from "../channels/types.js";
import type { PiboAuthSession } from "../auth/types.js";
import type { PiboAppContext } from "../app-context.js";

export type PiboWebSession = {
	authSession: PiboAuthSession;
	appContext: PiboAppContext;
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
