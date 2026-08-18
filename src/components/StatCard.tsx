import type { ReactNode } from "react";

const accentMap = {
  neutral: { tint: "bg-base-800", icon: "bg-ink/[0.06] text-ink/50" },
  gold: { tint: "bg-gold-500/10", icon: "bg-gold-500/20 text-gold-600" },
  sage: { tint: "bg-sage-500/10", icon: "bg-sage-500/20 text-sage-600" },
  ruby: { tint: "bg-ruby-500/10", icon: "bg-ruby-500/20 text-ruby-600" },
  azure: { tint: "bg-azure-500/10", icon: "bg-azure-500/20 text-azure-600" },
};

const defaultIcon: Record<keyof typeof accentMap, string> = {
  neutral: "◆",
  gold: "★",
  sage: "↑",
  ruby: "↓",
  azure: "▤",
};

export function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
  icon,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: keyof typeof accentMap;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const a = accentMap[accent];
  return (
    <div
      onClick={onClick}
      className={`relative ${a.tint} rounded-2xl p-4 overflow-hidden ${
        onClick ? "cursor-pointer hover:brightness-95 transition active:scale-[0.98]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[10px] font-semibold tracking-[0.06em] text-ink/45">{label}</div>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${a.icon}`}>
          {icon ?? defaultIcon[accent]}
        </div>
      </div>
      <div className="font-serif text-xl sm:text-2xl font-medium leading-none text-ink">{value}</div>
      {sub && <div className="text-[10px] text-ink/40 mt-2">{sub}</div>}
    </div>
  );
}
