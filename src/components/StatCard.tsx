const accentMap = {
  neutral: "bg-white/10",
  gold: "bg-gold-500",
  sage: "bg-sage-500",
  ruby: "bg-ruby-500",
  azure: "bg-azure-500",
};

export function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: keyof typeof accentMap;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative bg-base-900 border border-white/[0.08] rounded-md p-4 overflow-hidden ${
        onClick ? "cursor-pointer hover:border-white/20 transition-colors" : ""
      }`}
    >
      <div className={`absolute left-0 top-0 w-0.5 h-full ${accentMap[accent]}`} />
      <div className="text-[9px] font-semibold tracking-[0.1em] uppercase text-white/30">{label}</div>
      <div className="font-serif text-2xl sm:text-[28px] font-light text-white leading-none mt-1.5">{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-1.5">{sub}</div>}
    </div>
  );
}
