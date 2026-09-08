import {
	modelInferenceCachedInputTokens,
	modelInferenceInputTokens,
	modelInferenceUncachedInputTokens,
	type ModelInferenceMetrics,
} from "../../../../../shared/model-inference-metrics.js";
import { cacheWarningText, type CacheObservation } from "../../../../../shared/cache-diagnostics.js";

const tokenFormatter = new Intl.NumberFormat("en-US");

function tokens(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
	return tokenFormatter.format(Math.round(value));
}

function Metric({ label, value, description, tone }: { label: string; value: number | undefined; description: string; tone: string }) {
	return (
		<span title={description} className={`inline-flex min-w-0 items-baseline gap-1.5 border-l-2 px-2 py-0.5 font-bold ${tone}`}>
			<span className="text-[9px] font-black uppercase tracking-[0.14em] opacity-80">{label}</span>
			<span className="whitespace-nowrap text-[11px]">{tokens(value)}</span>
		</span>
	);
}

export function TerminalModelInferenceMetrics({ metrics, cacheObservation }: { metrics?: ModelInferenceMetrics; cacheObservation?: CacheObservation }) {
	const warning = cacheObservation && cacheWarningText(cacheObservation);
	return (
		<>
		<div
			data-pibo-debug="model-inference-metrics"
			aria-label="Model inference metrics"
			className="ml-[1.9rem] mt-1 flex flex-wrap items-stretch gap-px border-y border-[#262626] bg-[#050505] py-px font-mono leading-[1.45] tabular-nums"
		>
			<span className="inline-flex items-center border-l-2 border-[#11a4d4] bg-[#11a4d4]/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-[#7dd3fc]">
				Model
			</span>
			<Metric
				label="In"
				value={modelInferenceInputTokens(metrics)}
				description="Total provider-reported model input tokens, including cached input when reported"
				tone="border-[#00e5ff] bg-[#00e5ff]/15 text-[#7df9ff]"
			/>
			<Metric
				label="Cached"
				value={modelInferenceCachedInputTokens(metrics)}
				description="Provider-reported input tokens read from cache; cache writes are not hits"
				tone="border-[#c084fc] bg-[#c084fc]/15 text-[#e9d5ff]"
			/>
			<Metric
				label="Uncached"
				value={modelInferenceUncachedInputTokens(metrics)}
				description="Input tokens not read from cache, including cache writes; unknown when cache-read usage is missing"
				tone="border-[#ffe600] bg-[#ffe600]/15 text-[#fff36b]"
			/>
			<Metric
				label="Out"
				value={metrics?.outputTokens}
				description="Provider-reported model output tokens"
				tone="border-[#a3ff12] bg-[#a3ff12]/15 text-[#c7ff6b]"
			/>
			{metrics?.cacheWriteTokens ? <Metric label="Cache write" value={metrics.cacheWriteTokens} description="Tokens written to cache during this request; not cache hits" tone="border-slate-500 text-slate-300" /> : null}
		</div>
		{warning && cacheObservation ? <details data-pibo-debug="cache-collapse" className="ml-[1.9rem] border-l-2 border-[#ff6b00] bg-[#ff6b00]/10 px-2 py-1 font-mono text-[11px] text-[#fdba74]">
			<summary className="cursor-pointer focus-visible:outline focus-visible:outline-[#11a4d4]">{cacheObservation.warning === "cache-collapse" ? "Cache strongly decreased" : "Possible cache collapse"}: {tokens(cacheObservation.uncachedTokens)} / {tokens(cacheObservation.inputTokens)} input tokens not read from cache</summary>
			<div className="mt-1 break-words text-slate-300">
				<div>Previous cache: {cacheObservation.previousCacheRatio === undefined ? "unknown" : `${(cacheObservation.previousCacheRatio * 100).toFixed(1)}%`} · Current: {cacheObservation.cacheRatio === undefined ? "unknown" : `${(cacheObservation.cacheRatio * 100).toFixed(1)}%`}</div>
				<div>Previous inference: {cacheObservation.previousInferenceId ?? "unknown"}</div>
				<div>Elapsed: {cacheObservation.elapsedMs === undefined ? "unknown" : `${(cacheObservation.elapsedMs / 1000).toFixed(1)}s`} · Epoch: {cacheObservation.epoch ?? "unverified"}</div>
				<div>Runtime restart: {cacheObservation.runtimeRestarted === undefined ? "unknown" : cacheObservation.runtimeRestarted ? "observed (correlation only)" : "not observed"}</div>
				<div>Evidence: {cacheObservation.causes.join(", ")}. Provider eviction cause remains unknown.</div>
			</div>
		</details> : null}
		</>
	);
}
