export type FirstPartySubview = { id: string; title: string; description: string };

export function FirstPartySubviewNavigation({ label, activeId, items, onSelect }: { label: string; activeId: string; items: readonly FirstPartySubview[]; onSelect: (id: string) => void }) {
	return <nav aria-label={`${label} sections`} className="space-y-1 p-2" data-pibo-sidebar-navigation>
		<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
		{items.map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? "page" : undefined} onClick={() => onSelect(item.id)} className={`block w-full border p-2 text-left ${activeId === item.id ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<span className="block truncate text-sm text-slate-200">{item.title}</span>
			<span className="block truncate font-mono text-[10px] text-slate-500">{item.description}</span>
		</button>)}
	</nav>;
}
