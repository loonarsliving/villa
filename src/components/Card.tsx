import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group/card spot glow-border relative anim-fade-up bg-base-900 border border-ink/[0.06] rounded-2xl shadow-sm shadow-ink/[0.04] overflow-hidden transition-shadow duration-300 hover:shadow-md hover:shadow-ink/[0.07] ${className}`}
    >
      {children}
    </div>
  );
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
    <div className="px-4 sm:px-5 py-3.5 border-b border-ink/[0.05] flex items-center justify-between gap-3">
      <div className="min-w-0">
        {/* Judul kartu berhuruf serif ala loonars.id (sebelumnya huruf kecil KAPITAL). */}
        <div className="font-serif text-[1.2rem] leading-tight text-ink truncate">{title}</div>
        {/* Garis terakota yang tumbuh saat kartu disentuh/diarahkan kursor (tanpa transform pada kartu). */}
        <span aria-hidden className="mt-1.5 block h-px w-6 origin-left bg-gold-500/60 transition-[width,background-color] duration-500 ease-out group-hover/card:w-14 group-hover/card:bg-gold-500" />
        {subtitle && <div className="text-[11px] text-ink/55 mt-0.5">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function Loading({ label = "Memuat..." }: { label?: string }) {
  // Banyak halaman lama memakai <Loading label="Belum ada ..."> sebagai keadaan
  // KOSONG. Kerangka berkilau hanya untuk yang benar-benar sedang memuat --
  // kalau tidak, layar kosong akan terlihat seperti memuat tanpa henti.
  if (!/^(memuat|menghitung|mengambil|menyusun|memproses)/i.test(label.trim())) return <Empty label={label} />;
  return (
    <div role="status" aria-live="polite" className="anim-fade flex flex-col items-center gap-3 py-7 text-ink/40 text-xs tracking-wide">
      <div className="w-full max-w-[220px] space-y-2" aria-hidden>
        <div className="skeleton h-2.5 w-full" />
        <div className="skeleton h-2.5 w-4/5 mx-auto" />
        <div className="skeleton h-2.5 w-3/5 mx-auto" />
      </div>
      <div className="flex items-center gap-2">
        <span className="typing-dots text-gold-500" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {label}
      </div>
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="anim-fade-up flex flex-col items-center gap-2 py-8 text-ink/55 text-xs tracking-wide">
      <span className="anim-float w-10 h-10 rounded-full bg-ink/[0.04] flex items-center justify-center text-base text-ink/50" aria-hidden>
        ◌
      </span>
      {label}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "ok" | "pending" | "danger"; children: ReactNode }) {
  const cls = {
    ok: "bg-sage-500/15 text-sage-400",
    pending: "bg-gold-500/10 text-gold-400",
    danger: "bg-ruby-500/12 text-ruby-400",
  }[tone];
  return <span className={`anim-pop inline-flex text-[9px] font-semibold px-2 py-0.5 rounded-full tracking-wide ${cls}`}>{children}</span>;
}
