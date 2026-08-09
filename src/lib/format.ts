export function fmtCurrency(n: number | null | undefined): string {
  if (!n) return "Rp 0";
  if (n >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(".0", "") + " Jt";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

export function fmtCurrencyFull(n: number | null | undefined): string {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", opts ?? { day: "2-digit", month: "short" });
}

export function initials(name: string | null | undefined): string {
  return (name || "?").trim().charAt(0).toUpperCase();
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export function periodLabel(): string {
  return new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
