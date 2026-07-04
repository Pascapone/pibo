import { Database, Key, Keyboard, Layers, Settings, Wrench } from "lucide-react";
import type { SettingsPanel } from "./types";

export function SettingsSidebar({
	activePanel,
	onSelect,
	piPackageCount,
	userSkillCount,
}: {
	activePanel: SettingsPanel;
	onSelect: (panel: SettingsPanel) => void;
	piPackageCount: number;
	userSkillCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Settings</div>
				<button
					type="button"
					onClick={() => onSelect("general")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "general"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Settings size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">General</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">browser + runtime</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("shortcuts")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "shortcuts"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Keyboard size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Shortcuts</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">keyboard</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("maintenance")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "maintenance"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Database size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Maintenance</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">telemetry retention</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pi-packages")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pi-packages"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pi Packages</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">runtime-packages</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{piPackageCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("skills")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "skills"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Skills</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">user-managed</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{userSkillCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("providers")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "providers"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Key size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Providers</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">auth + api keys</span>
					</div>
				</button>
			</div>
		</div>
	);
}
