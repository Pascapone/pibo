import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Copy, ExternalLink, Eye, EyeOff, Key, Loader2, Lock, Trash2 } from "lucide-react";
import { postAction } from "../api";

type AuthMethod = "oauth" | "api_key";

type ProviderDef = {
	id: string;
	name: string;
	authMethod: AuthMethod;
};

const PROVIDERS: ProviderDef[] = [
	{ id: "openai-codex", name: "OpenAI (ChatGPT Plus/Pro)", authMethod: "oauth" },
	{ id: "openai", name: "OpenAI (API Key)", authMethod: "api_key" },
	{ id: "anthropic", name: "Anthropic (Claude)", authMethod: "oauth" },
	{ id: "github-copilot", name: "GitHub Copilot", authMethod: "oauth" },
	{ id: "kimi-coding", name: "Kimi for Coding", authMethod: "api_key" },
	{ id: "google", name: "Google (Gemini)", authMethod: "api_key" },
	{ id: "groq", name: "Groq", authMethod: "api_key" },
	{ id: "ollama", name: "Ollama", authMethod: "api_key" },
	{ id: "minimax", name: "MiniMax", authMethod: "api_key" },
	{ id: "minimax-cn", name: "MiniMax (China)", authMethod: "api_key" },
	{ id: "glm", name: "GLM (Z.ai)", authMethod: "api_key" },
];

type ProviderStatus = {
	id?: string;
	provider?: string;
	configured: boolean;
};

type ActionEnvelope = {
	type?: string;
	result?: unknown;
};

type ProviderRowState =
	| { type: "collapsed" }
	| { type: "oauth_starting" }
	| { type: "oauth_flow"; url: string; state?: string; userCode?: string; instructions?: string; flow?: string }
	| { type: "api_key" };

export function ProviderSettingsView({
	piboSessionId,
	onProviderAuthChanged,
}: {
	piboSessionId?: string | null;
	onProviderAuthChanged?: () => void | Promise<void>;
}) {
	const [statuses, setStatuses] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [rowStates, setRowStates] = useState<Record<string, ProviderRowState>>({});
	const [codes, setCodes] = useState<Record<string, string>>({});
	const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

	const refreshStatus = useCallback(async () => {
		if (!piboSessionId) return;
		setLoading(true);
		setError(null);
		try {
			const result = unwrapActionResult(await postAction(piboSessionId, "login.status", {})) as {
				providers?: ProviderStatus[];
			};
			const map: Record<string, boolean> = {};
			if (Array.isArray(result?.providers)) {
				for (const p of result.providers) {
					const id = p.id ?? p.provider;
					if (id) map[id] = p.configured;
				}
			}
			setStatuses(map);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, [piboSessionId]);

	useEffect(() => {
		void refreshStatus();
	}, [refreshStatus]);

	const startOAuth = useCallback(
		async (provider: string) => {
			if (!piboSessionId) return;
			setActionLoading((prev) => ({ ...prev, [provider]: true }));
			setError(null);
			setSuccess(null);
			setRowStates((prev) => ({ ...prev, [provider]: { type: "oauth_starting" } }));
			try {
				const result = unwrapActionResult(await postAction(piboSessionId, "login.start", { provider })) as {
					url?: string;
					state?: string;
					userCode?: string;
					instructions?: string;
					type?: string;
				};
				const url = result.url;
				const state = result.state;
				if (url) {
					setRowStates((prev) => ({
						...prev,
						[provider]: {
							type: "oauth_flow",
							url,
							state,
							userCode: result.userCode,
							instructions: result.instructions,
							flow: result.type,
						},
					}));
				} else {
					setError("No URL returned from login start.");
					setRowStates((prev) => ({ ...prev, [provider]: { type: "collapsed" } }));
				}
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				setRowStates((prev) => ({ ...prev, [provider]: { type: "collapsed" } }));
			} finally {
				setActionLoading((prev) => ({ ...prev, [provider]: false }));
			}
		},
		[piboSessionId],
	);

	const completeOAuth = useCallback(
		async (provider: string, code: string | undefined, state?: string) => {
			if (!piboSessionId) return;
			setActionLoading((prev) => ({ ...prev, [provider]: true }));
			setError(null);
			setSuccess(null);
			try {
				await postAction(piboSessionId, "login.complete", { provider, ...(code ? { code } : {}), state: state ?? "" });
				const name = getProviderName(provider);
				setSuccess(`${name} login completed.`);
				setStatuses((prev) => ({ ...prev, [provider]: true }));
				setRowStates((prev) => ({ ...prev, [provider]: { type: "collapsed" } }));
				setCodes((prev) => ({ ...prev, [provider]: "" }));
				await onProviderAuthChanged?.();
				window.setTimeout(() => setSuccess((current) => (current === `${name} login completed.` ? null : current)), 5000);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				setActionLoading((prev) => ({ ...prev, [provider]: false }));
			}
		},
		[onProviderAuthChanged, piboSessionId],
	);

	const saveApiKey = useCallback(
		async (provider: string, key: string) => {
			if (!piboSessionId) return;
			setActionLoading((prev) => ({ ...prev, [provider]: true }));
			setError(null);
			setSuccess(null);
			try {
				await postAction(piboSessionId, "login.apikey", { provider, apiKey: key });
				const name = getProviderName(provider);
				setSuccess(`${name} API key saved.`);
				setStatuses((prev) => ({ ...prev, [provider]: true }));
				setRowStates((prev) => ({ ...prev, [provider]: { type: "collapsed" } }));
				setApiKeys((prev) => ({ ...prev, [provider]: "" }));
				await onProviderAuthChanged?.();
				window.setTimeout(() => setSuccess((current) => (current === `${name} API key saved.` ? null : current)), 5000);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				setActionLoading((prev) => ({ ...prev, [provider]: false }));
			}
		},
		[onProviderAuthChanged, piboSessionId],
	);

	const removeProvider = useCallback(
		async (provider: string) => {
			if (!piboSessionId) return;
			setActionLoading((prev) => ({ ...prev, [provider]: true }));
			setError(null);
			setSuccess(null);
			try {
				await postAction(piboSessionId, "logout", { provider });
				setStatuses((prev) => ({ ...prev, [provider]: false }));
				await onProviderAuthChanged?.();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				setActionLoading((prev) => ({ ...prev, [provider]: false }));
			}
		},
		[onProviderAuthChanged, piboSessionId],
	);

	const copyUrl = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopiedUrl(url);
			setTimeout(() => setCopiedUrl(null), 2000);
		} catch {
			/* ignore */
		}
	};

	if (!piboSessionId) {
		return (
			<div className="border border-slate-700 bg-[#1a262b] rounded-sm p-4 text-sm text-slate-400">
				Select a chat session to manage provider authentication.
			</div>
		);
	}

	return (
		<div className="grid gap-4">
			{error ? (
				<div className="flex items-center gap-2 rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
					<AlertCircle size={14} />
					{error}
				</div>
			) : null}
			{success ? (
				<div className="flex items-center gap-2 rounded-sm border border-[#0bda57]/30 bg-[#0bda57]/10 px-3 py-2 text-xs text-[#7cf2a2]">
					<CheckCircle size={14} />
					{success}
				</div>
			) : null}
			{loading ? (
				<div className="flex items-center gap-2 text-xs text-[#11a4d4]">
					<Loader2 size={14} className="animate-spin" />
					Loading provider status...
				</div>
			) : null}
			{PROVIDERS.map((provider) => {
				const configured = statuses[provider.id] ?? false;
				const rowState = rowStates[provider.id] ?? { type: "collapsed" };
				const busy = actionLoading[provider.id] ?? false;
				return (
					<div
						key={provider.id}
						className={`border rounded-sm ${
							rowState.type !== "collapsed"
								? "border-[#11a4d4]/50 bg-[#151f24]"
								: configured
									? "border-[#0bda57]/20 bg-[#151f24]"
									: "border-[#334155] bg-[#151f24] hover:border-slate-600"
						}`}
					>
						<div className="flex items-center justify-between gap-3 p-3">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-slate-200">{provider.name}</span>
									<span
										className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
											provider.authMethod === "oauth"
												? "border-purple-500/40 text-purple-300"
												: "border-amber-500/40 text-amber-300"
										}`}
									>
										{provider.authMethod === "oauth" ? "OAuth" : "API Key"}
									</span>
								</div>
								<div className="mt-1 flex items-center gap-1.5 text-xs">
									{configured ? (
										<>
											<CheckCircle size={12} className="text-[#0bda57]" />
											<span className="text-[#0bda57]">Configured</span>
										</>
									) : (
										<>
											<Lock size={12} className="text-slate-500" />
											<span className="text-slate-500">Not configured</span>
										</>
									)}
								</div>
							</div>
							<div className="flex items-center gap-2">
								{configured ? (
									<>
										<button
											type="button"
											disabled={busy}
											onClick={() =>
												setRowStates((prev) => ({
													...prev,
													[provider.id]:
														prev[provider.id]?.type === "collapsed"
															? provider.authMethod === "oauth"
																? { type: "oauth_starting" }
																: { type: "api_key" }
														: { type: "collapsed" },
												}))
											}
											className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
										>
											{busy ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
											Reconfigure
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => void removeProvider(provider.id)}
											className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50"
										>
											<Trash2 size={12} />
											Remove
										</button>
									</>
								) : (
									<button
										type="button"
										disabled={busy}
										onClick={() =>
											provider.authMethod === "oauth"
												? void startOAuth(provider.id)
												: setRowStates((prev) => ({
														...prev,
														[provider.id]: { type: "api_key" },
													}))
										}
										className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
									>
										{busy ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
										Configure
									</button>
								)}
							</div>
						</div>

						{rowState.type !== "collapsed" ? (
							<div className="border-t border-slate-800 p-3">
								{rowState.type === "oauth_starting" ? (
									<div className="flex items-center gap-2 text-xs text-[#11a4d4]">
										<Loader2 size={14} className="animate-spin" />
										Starting OAuth flow...
									</div>
								) : rowState.type === "oauth_flow" ? (
									<div className="grid gap-3">
										<div className="grid gap-2">
											<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
												Step 1: Open URL
											</div>
											<div className="break-all rounded-sm border border-slate-700 bg-[#0e1116] p-2 font-mono text-[11px] text-slate-300">
												{rowState.url}
											</div>
											<div className="flex gap-2">
												<button
													type="button"
													onClick={() => void copyUrl(rowState.url)}
													className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"
												>
													{copiedUrl === rowState.url ? <CheckCircle size={12} /> : <Copy size={12} />}
													{copiedUrl === rowState.url ? "Copied" : "Copy URL"}
												</button>
												<a
													href={rowState.url}
													target="_blank"
													rel="noreferrer"
													className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"
												>
													<ExternalLink size={12} />
													Open in Browser
												</a>
											</div>
										</div>
										{rowState.userCode ? (
											<div className="grid gap-2">
												<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
													Step 2: Enter Code
												</div>
												<div className="rounded-sm border border-slate-700 bg-[#0e1116] p-3 text-center font-mono text-[20px] font-bold tracking-widest text-[#11a4d4]">
													{rowState.userCode}
												</div>
												{rowState.instructions ? (
													<div className="text-[11px] leading-relaxed text-slate-500">
														{rowState.instructions}
													</div>
												) : null}
												<button
													type="button"
													disabled={busy}
													onClick={() => void completeOAuth(provider.id, undefined, rowState.state)}
													className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-1.5 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
												>
													{busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
													Complete Login
												</button>
											</div>
										) : (
											<div className="grid gap-2">
												<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
													Step 2: Paste Code
												</div>
												<input
													type="text"
													value={codes[provider.id] ?? ""}
													onChange={(e) =>
														setCodes((prev) => ({ ...prev, [provider.id]: e.target.value }))
													}
													onKeyDown={(e) => {
														if (e.key === "Enter" && (codes[provider.id] ?? "").trim()) {
															void completeOAuth(
																provider.id,
																codes[provider.id]!.trim(),
																rowState.state,
															);
														}
													}}
													placeholder="Paste authorization code..."
													className="w-full rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1.5 font-mono text-[12px] text-slate-300 placeholder-slate-600 outline-none focus:border-[#11a4d4]"
												/>
												<button
													type="button"
													disabled={busy || !(codes[provider.id] ?? "").trim()}
													onClick={() =>
														void completeOAuth(
															provider.id,
															codes[provider.id]!.trim(),
															rowState.state,
														)
													}
													className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-1.5 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
												>
													{busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
													Complete Login
												</button>
											</div>
										)}
										<button
											type="button"
											onClick={() => setRowStates((prev) => ({ ...prev, [provider.id]: { type: "collapsed" } }))}
											className="text-[11px] text-slate-500 hover:text-[#11a4d4]"
										>
											← Cancel
										</button>
									</div>
								) : rowState.type === "api_key" ? (
									<div className="grid gap-3">
										<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
											Enter API Key
										</div>
										<div className="relative">
											<input
												type={showKeys[provider.id] ? "text" : "password"}
												value={apiKeys[provider.id] ?? ""}
												onChange={(e) =>
													setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
												}
												onKeyDown={(e) => {
													if (e.key === "Enter" && (apiKeys[provider.id] ?? "").trim()) {
														void saveApiKey(provider.id, apiKeys[provider.id]!.trim());
													}
												}}
												placeholder="sk-..."
												className="w-full rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1.5 pr-8 font-mono text-[12px] text-slate-300 placeholder-slate-600 outline-none focus:border-[#11a4d4]"
											/>
											<button
												type="button"
												onClick={() =>
													setShowKeys((prev) => ({
														...prev,
														[provider.id]: !prev[provider.id],
													}))
												}
												className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#11a4d4]"
												title={showKeys[provider.id] ? "Hide" : "Show"}
											>
												{showKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
											</button>
										</div>
										<button
											type="button"
											disabled={busy || !(apiKeys[provider.id] ?? "").trim()}
											onClick={() => void saveApiKey(provider.id, apiKeys[provider.id]!.trim())}
											className="inline-flex items-center gap-1 rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-1.5 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
										>
											{busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
											Save API Key
										</button>
										<button
											type="button"
											onClick={() => setRowStates((prev) => ({ ...prev, [provider.id]: { type: "collapsed" } }))}
											className="text-[11px] text-slate-500 hover:text-[#11a4d4]"
										>
											← Cancel
										</button>
									</div>
								) : null}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function unwrapActionResult(value: unknown): unknown {
	if (isActionEnvelope(value)) return value.result;
	return value;
}

function isActionEnvelope(value: unknown): value is ActionEnvelope {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as ActionEnvelope).type === "execution_result";
}

function getProviderName(providerId: string): string {
	return PROVIDERS.find((provider) => provider.id === providerId)?.name ?? providerId;
}
