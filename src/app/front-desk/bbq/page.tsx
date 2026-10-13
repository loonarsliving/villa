"use client";

import { useCallback, useEffect, useState } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";

// Pesanan BBQ terpisah dari loonars.id/bbq (tabel addon_orders, villa-api
// GET /addon-orders). Pemesan bisa siapa saja (owner 2026-10-13, pilihan A):
// resepsionis mencocokkan "Menginap" dengan tamu yang benar-benar menginap.
type AddonOrder = {
  id: string;
  kode: string;
  item: string;
  qty: number;
  harga: number;
  total_bayar: number;
  guest_nama: string;
  hp: string;
  tanggal: string;
  info_menginap: string | null;
  catatan: string | null;
  status: "menunggu_pembayaran" | "lunas" | "batal";
  kedaluwarsa: boolean;
  invoice_no: string | null;
  paid_at: string | null;
  created_at: string;
};

type Filter = "lunas" | "menunggu" | "semua";

const FILTERS: { key: Filter; label: string; sub: string }[] = [
  { key: "lunas", label: "Perlu Disiapkan", sub: "Sudah lunas, mulai hari ini" },
  { key: "menunggu", label: "Menunggu Bayar", sub: "Belum lunas, < 24 jam" },
  { key: "semua", label: "Semua", sub: "30 hari terakhir dan ke depan" },
];

function hariIniWIB(offsetHari = 0): string {
  const d = new Date(Date.now() + offsetHari * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function waLink(hp: string): string {
  const d = hp.replace(/[^0-9]/g, "");
  return `https://wa.me/${d.startsWith("0") ? `62${d.slice(1)}` : d}`;
}

export default function FrontDeskBbqPage() {
  const [filter, setFilter] = useState<Filter>("lunas");
  const [orders, setOrders] = useState<AddonOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    const dari = f === "lunas" ? hariIniWIB() : f === "semua" ? hariIniWIB(-30) : "";
    const qs = new URLSearchParams({ filter: f, ...(dari ? { dari } : {}) });
    try {
      const data = await api.get<AddonOrder[]>(`/addon-orders?${qs}`);
      setOrders(data || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat pesanan");
    }
  }, []);

  useEffect(() => {
    let aktif = true;
    const jalan = () => { if (aktif) load(filter); };
    jalan();
    const t = setInterval(jalan, 60000);
    return () => { aktif = false; clearInterval(t); };
  }, [filter, load]);

  const hariIni = hariIniWIB();
  const besok = hariIniWIB(1);
  const totalPaket = (orders ?? []).filter((o) => o.status === "lunas").reduce((a, o) => a + Number(o.qty), 0);

  return (
    <FrontDeskShell pageTitle="Pesanan BBQ" pageSub="Dari loonars.id/bbq">
      <div className="flex flex-wrap gap-2 mb-3.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setOrders(null); setFilter(f.key); }}
            className={`px-3 py-2 rounded-lg border text-left transition ${
              filter === f.key ? "border-gold-500 bg-gold-500/10" : "border-ink/10 hover:border-ink/20"
            }`}
          >
            <div className="text-[11.5px] font-semibold text-ink/80">{f.label}</div>
            <div className="text-[9.5px] text-ink/40">{f.sub}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${FILTERS.find((f) => f.key === filter)?.label}${orders ? ` · ${orders.length} pesanan` : ""}${filter === "lunas" && orders ? ` · ${totalPaket} paket` : ""}`} />
        {error ? (
          <div className="px-5 py-6 text-[11.5px] text-ruby-500">{error}</div>
        ) : orders === null ? (
          <Loading label="Memuat pesanan…" />
        ) : orders.length === 0 ? (
          <Loading label="Belum ada pesanan BBQ" />
        ) : (
          orders.map((o) => {
            const label = `${o.item}${o.qty > 1 ? ` x${o.qty}` : ""}`;
            const kapan = o.tanggal === hariIni ? "Hari ini" : o.tanggal === besok ? "Besok" : null;
            const statusTone =
              o.status === "lunas"
                ? "text-sage-700 bg-sage-500/15 border-sage-500/30"
                : o.status === "batal" || o.kedaluwarsa
                  ? "text-ink/40 bg-ink/5 border-ink/10"
                  : "text-gold-700 bg-gold-500/15 border-gold-500/30";
            const statusLabel = o.status === "lunas" ? "Lunas" : o.status === "batal" ? "Batal" : o.kedaluwarsa ? "Kedaluwarsa" : "Menunggu bayar";
            return (
              <div key={o.id} className="px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
                <div className="flex items-start gap-3">
                  <div className="text-xl leading-none mt-0.5">🔥</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-ink/85">
                      {fmtDate(o.tanggal, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                      {kapan && (
                        <span className="ml-1.5 text-[8.5px] font-semibold uppercase tracking-wide text-ruby-500 bg-ruby-500/10 border border-ruby-500/30 rounded px-1.5 py-0.5">{kapan}</span>
                      )}
                      <span className={`ml-1.5 text-[8.5px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5 ${statusTone}`}>{statusLabel}</span>
                    </div>
                    <div className="text-[11.5px] text-ink/70 mt-0.5">
                      <b>{label}</b> · {o.guest_nama} ·{" "}
                      <a href={waLink(o.hp)} target="_blank" rel="noopener noreferrer" className="underline">{o.hp}</a>
                    </div>
                    <div className="text-[11px] text-ink/50 mt-0.5">Menginap: {o.info_menginap || "—"}</div>
                    {o.catatan && <div className="text-[11px] text-ink/50">Catatan: {o.catatan}</div>}
                    <div className="text-[9.5px] text-ink/30 mt-1">
                      Kode {o.kode} · dipesan {fmtDateTime(o.created_at)}
                      {o.paid_at ? ` · lunas ${fmtDateTime(o.paid_at)}` : ""}
                      {o.invoice_no ? ` · ${o.invoice_no}` : ""}
                    </div>
                  </div>
                  <div className="text-[11px] text-ink/60 shrink-0 text-right">{fmtCurrencyFull(o.total_bayar)}</div>
                </div>
              </div>
            );
          })
        )}
      </Card>
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mt-3.5">
        Pesanan BBQ dari loonars.id/bbq bisa dibuat siapa saja. Cocokkan kolom &quot;Menginap&quot; dengan tamu yang benar-benar menginap,
        dan hubungi pemesan lewat WA bila ada yang tidak cocok. Pembayaran yang belum terkonfirmasi otomatis bisa dikonfirmasi owner dengan
        membalas &quot;LUNAS &lt;kode&gt;&quot;.
      </div>
    </FrontDeskShell>
  );
}
