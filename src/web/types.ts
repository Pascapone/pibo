import type { PiboChannelContext } from "../channels/types.js";
import type { PiboAuthSession } from "../auth/types.js";
import type { PiboSharedAppContext } from "../shared-app.js";

export type PiboWebSession = {
	authSession: PiboAuthSession;
	appContext: PiboSharedAppContext;
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
