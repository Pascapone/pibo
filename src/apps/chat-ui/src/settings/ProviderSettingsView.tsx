import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AlertCircle,
	CheckCircle,
	Clock3,
	Copy,
	ExternalLink,
	Eye,
	EyeOff,
	Key,
	Loader2,
	Lock,
	RefreshCw,
	Server,
	Trash2,
	XCircle,
} from "lucide-react";
import { getProviderAuthCatalog, postProviderAuthAction } from "../api";
import type {
	AgentRuntimeAuthCatalog,
	AgentRuntimeAuthMethodId,
	AgentRuntimeAuthState,
	AgentRuntimeAuthStatus,
	AgentRuntimeAuthTarget,
} from "../types";

type ProviderRowState = "collapsed" | "api_key";

export function ProviderSettingsView({
	piboSessionId: _piboSessionId,
	onProviderAuthChanged,
}: {
	piboSessionId?: string | null;
	onProviderAuthChanged?: () => void | Promise<void>;
}) {
	const [catalog, setCatalog] = useState<AgentRuntimeAuthCatalog | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [rowStates, setRowStates] = useState<Record<string, ProviderRowState>>({});
	const [codes, setCodes] = useState<Record<string, string>>({});
	const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const [copied, setCopied] = useState<string | null>(null);
	const [busy, setBusy] = useState<Record<string, boolean>>({});
	const polling = useRef(false);

	const refreshStatus = useCallback(async (showLoading = false) => {
		if (showLoading) setLoading(true);
		try {
			setCatalog(await getProviderAuthCatalog());
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshStatus(true);
	}, [refreshStatus]);

	const notificationFlows = useMemo(() => catalog?.targets.flatMap((target) =>
		target.providers.flatMap((provider) => provider.pending?.completion === "notification"
			? [{ target, provider, flowId: provider.pending.flowId }]
			: [])) ?? [], [catalog]);

	useEffect(() => {
		if (notificationFlows.length === 0) return;
		const poll = async () => {
			if (polling.current) return;
			polling.current = true;
			try {
				for (const { target, provider, flowId } of notificationFlows) {
					const result = await postProviderAuthAction({
						action: "complete",
						runtimeInstanceId: target.runtimeInstanceId,
						providerId: provider.id,
						flowId,
					});
					if (result.state === "connected" || result.state === "partial") {
						showSuccess(setSuccess, `${target.displayName} / ${provider.displayName ?? provider.id} is ${stateLabel(result.state).toLowerCase()}.`);
						await onProviderAuthChanged?.();
					}
				}
				await refreshStatus();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				await refreshStatus();
			} finally {
				polling.current = false;
			}
		};
		const timer = window.setInterval(() => void poll(), 1_500);
		return () => window.clearInterval(timer);
	}, [notificationFlows, onProviderAuthChanged, refreshStatus]);

	const run = useCallback(async <T,>(key: string, operation: () => Promise<T>): Promise<T | undefined> => {
		setBusy((current) => ({ ...current, [key]: true }));
		setError(null);
		setSuccess(null);
		try {
			return await operation();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
			return undefined;
		} finally {
			setBusy((current) => ({ ...current, [key]: false }));
		}
	}, []);

	const startInteractive = useCallback(async (
		target: AgentRuntimeAuthTarget,
		provider: AgentRuntimeAuthStatus,
		method: Exclude<AgentRuntimeAuthMethodId, "api_key">,
	) => {
		const key = rowKey(target, provider);
		const result = await run(key, async () => await postProviderAuthAction({
			action: "start",
			runtimeInstanceId: target.runtimeInstanceId,
			providerId: provider.id,
			method,
		}));
		if (!result) return;
		await refreshStatus();
	}, [refreshStatus, run]);

	const completeFlow = useCallback(async (
		target: AgentRuntimeAuthTarget,
		provider: AgentRuntimeAuthStatus,
		code?: string,
	) => {
		if (!provider.pending) return;
		const key = rowKey(target, provider);
		const result = await run(key, async () => await postProviderAuthAction({
			action: "complete",
			runtimeInstanceId: target.runtimeInstanceId,
			providerId: provider.id,
			flowId: provider.pending!.flowId,
			...(code ? { code } : {}),
		}));
		if (!result) return;
		if (result.state === "connected" || result.state === "partial") {
			showSuccess(setSuccess, `${target.displayName} / ${provider.displayName ?? provider.id} is ${stateLabel(result.state).toLowerCase()}.`);
			setCodes((current) => ({ ...current, [key]: "" }));
			await onProviderAuthChanged?.();
		}
		await refreshStatus();
	}, [onProviderAuthChanged, refreshStatus, run]);

	const cancelFlow = useCallback(async (target: AgentRuntimeAuthTarget, provider: AgentRuntimeAuthStatus) => {
		if (!provider.pending) return;
		const key = rowKey(target, provider);
		const result = await run(key, async () => await postProviderAuthAction({
			action: "cancel",
			runtimeInstanceId: target.runtimeInstanceId,
			providerId: provider.id,
			flowId: provider.pending!.flowId,
		}));
		if (!result) return;
		await refreshStatus();
	}, [refreshStatus, run]);

	const saveApiKey = useCallback(async (target: AgentRuntimeAuthTarget, provider: AgentRuntimeAuthStatus) => {
		const key = rowKey(target, provider);
		const apiKey = apiKeys[key]?.trim();
		if (!apiKey) return;
		const result = await run(key, async () => await postProviderAuthAction({
			action: "api_key",
			runtimeInstanceId: target.runtimeInstanceId,
			providerId: provider.id,
			apiKey,
		}));
		if (!result) return;
		setApiKeys((current) => ({ ...current, [key]: "" }));
		setShowKeys((current) => ({ ...current, [key]: false }));
		setRowStates((current) => ({ ...current, [key]: "collapsed" }));
		showSuccess(setSuccess, `${target.displayName} / ${provider.displayName ?? provider.id} API key is configured.`);
		await onProviderAuthChanged?.();
		await refreshStatus();
	}, [apiKeys, onProviderAuthChanged, refreshStatus, run]);

	const logout = useCallback(async (target: AgentRuntimeAuthTarget, provider: AgentRuntimeAuthStatus) => {
		const key = rowKey(target, provider);
		const result = await run(key, async () => await postProviderAuthAction({
			action: "logout",
			runtimeInstanceId: target.runtimeInstanceId,
			providerId: provider.id,
		}));
		if (!result) return;
		showSuccess(setSuccess, `${target.displayName} / ${provider.displayName ?? provider.id} is disconnected.`);
		await onProviderAuthChanged?.();
		await refreshStatus();
	}, [onProviderAuthChanged, refreshStatus, run]);

	const copyText = useCallback(async (key: string, value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(key);
			window.setTimeout(() => setCopied((current) => current === key ? null : current), 1_800);
		} catch {
			// Clipboard availability is browser-controlled.
		}
	}, []);

	return (
		<div className="grid gap-4">
			<div className="flex items-start justify-between gap-3 border border-slate-700 bg-[#1a262b] p-3">
				<div>
					<div className="text-xs font-bold uppercase tracking-wider text-slate-300">Runtime authentication targets</div>
					<div className="mt-1 text-[11px] leading-relaxed text-slate-500">
						Each target owns its effective account. The default runtime is marked below; credentials are never copied between runtimes.
					</div>
				</div>
				<button
					type="button"
					disabled={loading}
					onClick={() => void refreshStatus(true)}
					className="inline-flex shrink-0 items-center gap-1 border border-slate-700 bg-[#0e1116] px-2 py-1 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
				</button>
			</div>

			{error ? <Notice tone="red" icon={<AlertCircle size={14} />}>{error}</Notice> : null}
			{success ? <Notice tone="green" icon={<CheckCircle size={14} />}>{success}</Notice> : null}
			{loading && !catalog ? <Notice tone="cyan" icon={<Loader2 size={14} className="animate-spin" />}>Loading runtime authentication status...</Notice> : null}

			{catalog?.targets.map((target) => (
				<section key={target.runtimeInstanceId} className="border border-[#334155] bg-[#151f24]">
					<header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-3 py-2.5">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<Server size={14} className="text-[#11a4d4]" />
								<span className="text-sm font-medium text-slate-200">{target.displayName}</span>
								<span className="font-mono text-[10px] text-slate-500">{target.runtimeInstanceId}</span>
								{target.isDefault ? <Badge tone="cyan">Default runtime</Badge> : null}
								<StateBadge state={target.state} />
							</div>
							<div className="mt-1 text-[11px] text-slate-500">
								{target.credentialScope === "runtime-instance"
									? "Private account for this configured runtime instance."
									: "Shared adapter credential store; changes apply to Pi instances using this adapter."}
							</div>
						</div>
						<div className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{target.adapterId}</div>
					</header>

					{target.providers.length === 0 ? (
						<div className="px-3 py-3 text-xs text-slate-500">
							{target.state === "unsupported"
								? "This runtime does not expose provider authentication controls."
								: "Provider authentication status is unavailable for this runtime."}
						</div>
					) : target.providers.map((provider) => {
						const key = rowKey(target, provider);
						const rowState = rowStates[key] ?? "collapsed";
						const isBusy = busy[key] ?? false;
						const pending = provider.pending;
						return (
							<div key={provider.id} className="border-b border-slate-800 last:border-b-0">
								<div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="text-sm text-slate-200">{provider.displayName ?? provider.id}</span>
											<span className="font-mono text-[10px] text-slate-600">{provider.id}</span>
											{provider.methods.map((method) => <Badge key={method.id} tone={method.id === "api_key" ? "amber" : "purple"}>{methodLabel(method.id)}</Badge>)}
										</div>
										<div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
											<StateIcon state={provider.state} />
											<span className={stateTextClass(provider.state)}>{stateLabel(provider.state)}</span>
											{provider.details?.accountType ? <span className="text-slate-600">{accountLabel(provider.details.accountType)}</span> : null}
											{provider.details?.planType ? <span className="text-slate-600">plan: {provider.details.planType}</span> : null}
										</div>
										{provider.message ? <div className="mt-1 text-[11px] text-slate-500">{provider.message}</div> : null}
									</div>
									<div className="flex flex-wrap items-center gap-1.5">
										{provider.state !== "pending" && provider.methods.map((method) => method.id === "api_key" ? (
											<button key={method.id} type="button" disabled={isBusy || !target.available} onClick={() => {
												const closing = rowState === "api_key";
												setRowStates((current) => ({ ...current, [key]: closing ? "collapsed" : "api_key" }));
												if (closing) {
													setApiKeys((current) => ({ ...current, [key]: "" }));
													setShowKeys((current) => ({ ...current, [key]: false }));
												}
											}} className={secondaryButtonClass}>
												<Key size={12} /> {provider.configured ? "Replace key" : "API key"}
											</button>
										) : (
											<button key={method.id} type="button" disabled={isBusy || !target.available} onClick={() => void startInteractive(target, provider, method.id as "device_code" | "browser_oauth")} className={secondaryButtonClass}>
												{isBusy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} {provider.configured ? "Reconnect" : methodLabel(method.id)}
											</button>
										))}
										{(provider.configured || provider.state === "failed") && target.logoutSupported ? (
											<button type="button" disabled={isBusy} onClick={() => void logout(target, provider)} className={`${secondaryButtonClass} hover:!border-red-500 hover:!text-red-300`}>
												<Trash2 size={12} /> {provider.configured ? "Disconnect" : "Reset auth"}
											</button>
										) : null}
									</div>
								</div>

								{pending ? (
									<AuthFlowPanel
										flow={pending}
										rowKey={key}
										busy={isBusy}
										code={codes[key] ?? ""}
										onCodeChange={(value) => setCodes((current) => ({ ...current, [key]: value }))}
										onComplete={(code) => void completeFlow(target, provider, code)}
										onCancel={target.cancelSupported ? () => void cancelFlow(target, provider) : undefined}
										copied={copied}
										onCopy={copyText}
									/>
								) : rowState === "api_key" ? (
									<div className="grid gap-2 border-t border-slate-800 bg-[#10191d] px-3 py-3">
										<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">API key for {target.runtimeInstanceId}</div>
										<div className="relative">
											<input
												type={showKeys[key] ? "text" : "password"}
												value={apiKeys[key] ?? ""}
												autoComplete="off"
												spellCheck={false}
												onChange={(event) => setApiKeys((current) => ({ ...current, [key]: event.target.value }))}
												onKeyDown={(event) => { if (event.key === "Enter") void saveApiKey(target, provider); }}
												placeholder="Enter provider API key"
												className="w-full border border-slate-700 bg-[#0e1116] px-2 py-1.5 pr-8 font-mono text-[12px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-[#11a4d4]"
											/>
											<button type="button" onClick={() => setShowKeys((current) => ({ ...current, [key]: !current[key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#11a4d4]" aria-label={showKeys[key] ? "Hide API key" : "Show API key"}>
												{showKeys[key] ? <EyeOff size={14} /> : <Eye size={14} />}
											</button>
										</div>
										<div className="flex gap-2">
											<button type="button" disabled={isBusy || !(apiKeys[key] ?? "").trim()} onClick={() => void saveApiKey(target, provider)} className={secondaryButtonClass}>
												{isBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Save for this target
											</button>
											<button type="button" onClick={() => {
												setApiKeys((current) => ({ ...current, [key]: "" }));
												setShowKeys((current) => ({ ...current, [key]: false }));
												setRowStates((current) => ({ ...current, [key]: "collapsed" }));
											}} className="text-[11px] text-slate-500 hover:text-[#11a4d4]">Cancel</button>
										</div>
									</div>
								) : null}
							</div>
						);
					})}

					{target.diagnostics.some((diagnostic) => diagnostic.severity !== "info") ? (
						<div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
							{target.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message
								?? target.diagnostics.find((diagnostic) => diagnostic.severity === "warning")?.message}
						</div>
					) : null}
				</section>
			))}

			{catalog && catalog.targets.length === 0 ? (
				<div className="border border-slate-700 bg-[#1a262b] p-4 text-sm text-slate-500">No configured runtime authentication targets are available.</div>
			) : null}
		</div>
	);
}

function AuthFlowPanel({
	flow,
	rowKey,
	busy,
	code,
	onCodeChange,
	onComplete,
	onCancel,
	copied,
	onCopy,
}: {
	flow: NonNullable<AgentRuntimeAuthStatus["pending"]>;
	rowKey: string;
	busy: boolean;
	code: string;
	onCodeChange: (value: string) => void;
	onComplete: (code?: string) => void;
	onCancel?: () => void;
	copied: string | null;
	onCopy: (key: string, value: string) => Promise<void>;
}) {
	const needsCodeInput = flow.method === "browser_oauth" && !flow.userCode;
	return (
		<div className="grid gap-3 border-t border-slate-800 bg-[#10191d] px-3 py-3 text-[11px]">
			<div className="flex items-center gap-2 text-[#11a4d4]">
				{flow.completion === "notification" ? <Loader2 size={13} className="animate-spin" /> : <Clock3 size={13} />}
				{flow.completion === "notification" ? "Waiting for the runtime's completion notification..." : "Login flow is pending."}
			</div>
			{flow.verificationUrl ? (
				<div className="grid gap-1.5">
					<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Verification URL</div>
					<div className="break-all border border-slate-700 bg-[#0e1116] p-2 font-mono text-slate-300">{flow.verificationUrl}</div>
					<div className="flex flex-wrap gap-2">
						<button type="button" onClick={() => void onCopy(`${rowKey}:url`, flow.verificationUrl!)} className={secondaryButtonClass}>
							{copied === `${rowKey}:url` ? <CheckCircle size={12} /> : <Copy size={12} />} {copied === `${rowKey}:url` ? "Copied" : "Copy URL"}
						</button>
						<a href={flow.verificationUrl} target="_blank" rel="noreferrer" className={secondaryButtonClass}><ExternalLink size={12} /> Open in browser</a>
					</div>
				</div>
			) : null}
			{flow.userCode ? (
				<div className="grid gap-1.5">
					<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">One-time code</div>
					<button type="button" onClick={() => void onCopy(`${rowKey}:code`, flow.userCode!)} className="w-fit border border-[#1f4960] bg-[#0e1116] px-3 py-2 font-mono text-lg font-bold tracking-[0.2em] text-[#11a4d4] hover:border-[#11a4d4]">
						{flow.userCode} {copied === `${rowKey}:code` ? <CheckCircle size={12} className="inline" /> : null}
					</button>
				</div>
			) : null}
			{flow.instructions ? <div className="text-slate-500">{flow.instructions}</div> : null}
			{needsCodeInput ? (
				<input value={code} autoComplete="off" spellCheck={false} onChange={(event) => onCodeChange(event.target.value)} placeholder="Paste authorization code" className="border border-slate-700 bg-[#0e1116] px-2 py-1.5 font-mono text-slate-300 outline-none placeholder:text-slate-600 focus:border-[#11a4d4]" />
			) : null}
			<div className="flex flex-wrap gap-2">
				{flow.completion === "explicit" ? (
					<button type="button" disabled={busy || (needsCodeInput && !code.trim())} onClick={() => onComplete(needsCodeInput ? code.trim() : undefined)} className={secondaryButtonClass}>
						{busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Complete login
					</button>
				) : null}
				{onCancel ? <button type="button" disabled={busy} onClick={onCancel} className={`${secondaryButtonClass} hover:!border-red-500 hover:!text-red-300`}><XCircle size={12} /> Cancel flow</button> : null}
			</div>
		</div>
	);
}

const secondaryButtonClass = "inline-flex items-center gap-1 border border-slate-700 bg-[#0e1116] px-2 py-1 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50";

function rowKey(target: AgentRuntimeAuthTarget, provider: AgentRuntimeAuthStatus): string {
	return `${target.runtimeInstanceId}:${provider.id}`;
}

function methodLabel(method: AgentRuntimeAuthMethodId): string {
	if (method === "api_key") return "API key";
	if (method === "browser_oauth") return "Browser OAuth";
	return "Device code";
}

function stateLabel(state: AgentRuntimeAuthState): string {
	return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateTextClass(state: AgentRuntimeAuthState): string {
	if (state === "connected") return "text-[#0bda57]";
	if (state === "pending") return "text-[#11a4d4]";
	if (state === "partial") return "text-amber-300";
	if (state === "failed") return "text-red-300";
	return "text-slate-500";
}

function StateIcon({ state }: { state: AgentRuntimeAuthState }) {
	if (state === "connected") return <CheckCircle size={12} className="text-[#0bda57]" />;
	if (state === "pending") return <Loader2 size={12} className="animate-spin text-[#11a4d4]" />;
	if (state === "failed") return <AlertCircle size={12} className="text-red-400" />;
	if (state === "partial") return <AlertCircle size={12} className="text-amber-300" />;
	return <Lock size={12} className="text-slate-500" />;
}

function StateBadge({ state }: { state: AgentRuntimeAuthState }) {
	const tone = state === "connected" ? "green" : state === "pending" ? "cyan" : state === "partial" ? "amber" : state === "failed" ? "red" : "neutral";
	return <Badge tone={tone}>{stateLabel(state)}</Badge>;
}

function Badge({ tone, children }: { tone: "cyan" | "green" | "amber" | "purple" | "red" | "neutral"; children: React.ReactNode }) {
	const classes = tone === "cyan"
		? "border-[#11a4d4]/40 text-[#6dd7f6]"
		: tone === "green"
			? "border-[#0bda57]/40 text-[#7cf2a2]"
			: tone === "amber"
				? "border-amber-500/40 text-amber-300"
				: tone === "purple"
					? "border-purple-500/40 text-purple-300"
					: tone === "red"
						? "border-red-500/40 text-red-300"
						: "border-slate-700 text-slate-500";
	return <span className={`border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${classes}`}>{children}</span>;
}

function Notice({ tone, icon, children }: { tone: "red" | "green" | "cyan"; icon: React.ReactNode; children: React.ReactNode }) {
	const classes = tone === "red"
		? "border-red-500/30 bg-red-500/10 text-red-300"
		: tone === "green"
			? "border-[#0bda57]/30 bg-[#0bda57]/10 text-[#7cf2a2]"
			: "border-[#11a4d4]/30 bg-[#11a4d4]/10 text-[#6dd7f6]";
	return <div className={`flex items-center gap-2 border px-3 py-2 text-xs ${classes}`}>{icon}{children}</div>;
}

function accountLabel(accountType: NonNullable<AgentRuntimeAuthStatus["details"]>["accountType"]): string {
	if (accountType === "api_key") return "API key account";
	if (accountType === "chatgpt") return "ChatGPT account";
	if (accountType === "oauth") return "OAuth account";
	return "Managed account";
}

function showSuccess(setter: React.Dispatch<React.SetStateAction<string | null>>, message: string): void {
	setter(message);
	window.setTimeout(() => setter((current) => current === message ? null : current), 5_000);
}
