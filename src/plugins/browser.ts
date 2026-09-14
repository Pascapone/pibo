import type * as React from "react";
import type * as sdk from "./sdk.js";
import type { PluginHookDescriptor, PluginHookResult } from "./contributions.js";
import type {
	PluginArtifactEnvelope,
	PluginJsonObject,
	PluginJsonValue,
	PluginQualifiedId,
	PluginTabInstance,
} from "./manifest.js";

/** Public props for a session-owned plugin view. */
export type PluginViewProps = {
	tab: PluginTabInstance;
	piboSessionId: string;
	agentId?: string;
	roomId?: string;
	active: boolean;
	signal: AbortSignal;
	state: PluginJsonObject;
	updateState: (state: PluginJsonObject) => void;
	request: <T>(path: string, init?: RequestInit) => Promise<T>;
	openView: (viewId: PluginQualifiedId, subviewId?: string, state?: PluginJsonObject) => void;
	createSession?: (profile: string) => Promise<void>;
	registerBeforeLeave: (handler: () => Promise<void>) => () => void;
};

export type PluginRendererProps = {
	envelope: PluginArtifactEnvelope;
	piboSessionId: string;
	openView: PluginViewProps["openView"];
};

export type PluginComposerHook = {
	descriptor: PluginHookDescriptor;
	run(value: PluginJsonValue, context: { piboSessionId: string; signal: AbortSignal }): Promise<PluginHookResult> | PluginHookResult;
};

/** Same-origin browser module setup contract; React is supplied by the host. */
export type PluginBrowserSetup = {
	React: typeof React;
	sdk: typeof sdk;
	scope: sdk.PluginScope;
	piboSessionId: string;
	registerRenderer: (id: PluginQualifiedId, schemaVersion: number, component: React.ComponentType<PluginRendererProps>) => void;
	registerHook: (hook: PluginComposerHook) => void;
	registerShell: (id: PluginQualifiedId, component: React.ComponentType<{ children: React.ReactNode; piboSessionId: string }>) => void;
};

export type PluginBrowserModule = Record<string, unknown> & {
	setup?: (host: PluginBrowserSetup) => void | sdk.PluginDisposer | Promise<void | sdk.PluginDisposer>;
};
