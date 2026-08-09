import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-base-900 border border-white/[0.08] rounded-md overflow-hidden ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 sm:px-5 py-3.5 border-b border-white/[0.05] flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-white/80 tracking-wide uppercase truncate">{title}</div>
        {subtitle && <div className="text-[10px] text-white/30 mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function Loading({ label = "Memuat..." }: { label?: string }) {
  return <div className="text-center py-7 text-white/30 text-xs tracking-wide">{label}</div>;
}

export function Empty({ label }: { label: string }) {
  return <div className="text-center py-7 text-white/30 text-xs tracking-wide">{label}</div>;
}

export function Badge({ tone, children }: { tone: "ok" | "pending" | "danger"; children: ReactNode }) {
  const cls = {
    ok: "bg-sage-500/15 text-sage-400",
    pending: "bg-gold-500/10 text-gold-400",
    danger: "bg-ruby-500/12 text-ruby-400",
  }[tone];
  return <span className={`inline-flex text-[9px] font-semibold px-2 py-0.5 rounded-full tracking-wide ${cls}`}>{children}</span>;
}
