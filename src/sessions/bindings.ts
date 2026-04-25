export type PiboSessionBinding = {
	sessionKey: string;
	channel: string;
	externalId: string;
	originalProfile: string;
	currentProfile?: string;
	workspace?: string;
	createdAt: string;
	updatedAt: string;
};

export type ResolveSessionBindingInput = {
	channel: string;
	externalId: string;
	defaultProfile: string;
	sessionKey?: string;
	workspace?: string;
};

export type PiboSessionBindingStore = {
	get(sessionKey: string): PiboSessionBinding | undefined;
	resolve(input: ResolveSessionBindingInput): PiboSessionBinding;
	close?(): void;
};
