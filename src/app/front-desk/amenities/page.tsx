"use client";

import { useEffect, useState } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import type { AmenityItem, AmenityKitItem, AmenityRingkasan, AmenityUsageLog } from "@/lib/types";
import { RingkasanMalam } from "@/components/AmenitiesRingkasan";

export default function FrontDeskAmenitiesPage() {
  const [items, setItems] = useState<AmenityItem[]>([]);
  const [log, setLog] = useState<AmenityUsageLog[]>([]);
  const [kit, setKit] = useState<AmenityKitItem[]>([]);
  const [ringkasan, setRingkasan] = useState<AmenityRingkasan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<AmenityItem[]>("/amenities"),
      api.get<AmenityUsageLog[]>("/amenities/usage-log"),
      api.get<AmenityKitItem[]>("/amenities/kit").catch(() => []),
      api.get<AmenityRingkasan>("/amenities/ringkasan").catch(() => null),
    ]).then(([i, l, k, r]) => {
      setItems(i || []);
      setLog(l || []);
      setKit(k || []);
      setRingkasan(r || null);
      setLoading(false);
    });
  }, []);

  const lowStockCount = items.filter((it) => it.stock <= it.stock_minimum).length;

  return (
    <FrontDeskShell pageTitle="Amenities" pageSub="Stock item kamar (lihat saja)">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Stock berkurang <b>otomatis setiap malam (23.30 WIB)</b> untuk setiap kamar yang sedang ditempati tamu. Untuk tambah stock (restock)
        atau ubah kit standar, hubungi Admin.
      </div>

      <RingkasanMalam ringkasan={ringkasan} items={items} kit={kit} />

      <Card className="mb-3.5">
        <CardHeader title="Stock Saat Ini" action={lowStockCount > 0 ? <Badge tone="danger">{lowStockCount} stock rendah</Badge> : undefined} />
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <Loading label="Belum ada item amenities" />
        ) : (
          items.map((it) => {
            const low = it.stock <= it.stock_minimum;
            return (
              <div key={it.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ink/80">{it.nama}</div>
                  <div className="text-[10px] text-ink/30 mt-0.5">Minimum {it.stock_minimum} {it.satuan}</div>
                </div>
                <div className={`text-xs font-semibold shrink-0 ${low ? "text-ruby-400" : "text-ink/80"}`}>
                  {it.stock} {it.satuan}
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card>
        <CardHeader title="Riwayat Pemakaian Terbaru" />
        {log.length === 0 ? (
          <Loading label="Belum ada riwayat" />
        ) : (
          log.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{l.amenity_nama || "—"}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  Unit {l.unit_nomor || "—"} · {fmtDateTime(l.created_at)}
                </div>
              </div>
              <div className="text-xs text-ruby-400 shrink-0">-{l.qty}</div>
            </div>
          ))
        )}
      </Card>
    </FrontDeskShell>
  );
}
