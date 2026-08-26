import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
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
	dispose?(): Promise<void> | void;
	matchesHost?(hostname: string): boolean;
	handleNodeRequest?(
		request: IncomingMessage,
		response: ServerResponse,
		context: PiboWebAppContext,
		requestURL: URL,
	): Promise<void> | void;
	handleUpgrade?(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		context: PiboWebAppContext,
		requestURL: URL,
	): Promise<void> | void;
	handleRequest(request: Request, context: PiboWebAppContext): Promise<Response | undefined> | Response | undefined;
};
