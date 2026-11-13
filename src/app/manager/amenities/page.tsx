"use client";

import { useEffect, useState } from "react";
import { ManagerShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { RingkasanMalam, tampilQty } from "@/components/AmenitiesRingkasan";
import type { AmenityItem, AmenityKitItem, AmenityRingkasan, AmenityUsageLog } from "@/lib/types";

interface DataAmenitiesManager {
  items: AmenityItem[];
  kit: AmenityKitItem[];
  log: AmenityUsageLog[];
  ringkasan: AmenityRingkasan | null;
}

// Manager boleh melihat stok dan MENAMBAH stok (restock); ubah katalog/kit
// tetap di Admin (owner 2026-11-13).
export default function ManagerAmenitiesPage() {
  const toast = useToast();
  const [data, setData] = useState<DataAmenitiesManager | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [restock, setRestock] = useState<AmenityItem | null>(null);
  const [qty, setQty] = useState("");
  const [menyimpan, setMenyimpan] = useState(false);

  async function load() {
    try {
      setData(await api.get<DataAmenitiesManager>("/manager/amenities"));
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat amenities");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function simpanRestock() {
    if (!restock) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      toast("⚠", "Jumlah tidak valid", "Isi jumlah barang yang masuk (lebih dari 0).", "ruby");
      return;
    }
    setMenyimpan(true);
    try {
      await api.post("/manager/amenities/restock", { id: restock.id, qty: n });
      toast("✓", "Stock ditambah", `${restock.nama} +${n} ${restock.satuan}.`, "sage");
      setRestock(null);
      setQty("");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setMenyimpan(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <ManagerShell pageTitle="Amenities" pageSub="Stock amenities kamar & restock">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Stock berkurang <b>otomatis setiap malam (23.30 WIB)</b>: 1 amenities untuk setiap kamar yang ditempati tamu. Saat barang baru
        datang, tekan <b>Restock</b> dan isi jumlahnya — stock langsung bertambah dan tercatat atas nama Anda.
      </div>

      {galat && <div className="text-xs text-ruby-400 mb-3.5">{galat}</div>}

      <RingkasanMalam ringkasan={data?.ringkasan ?? null} items={items} kit={data?.kit ?? []} />

      <Card className="mb-3.5">
        <CardHeader title="Stock Saat Ini" />
        {!data ? (
          <Loading />
        ) : items.length === 0 ? (
          <Loading label="Belum ada item amenities (minta Admin menambahkan)" />
        ) : (
          items.map((it) => {
            const low = it.stock <= it.stock_minimum;
            return (
              <div key={it.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-ink/80">{it.nama}</div>
                  <div className="text-[10px] text-ink/30 mt-0.5">Minimum {it.stock_minimum} {it.satuan}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-xs font-semibold ${low ? "text-ruby-400" : "text-ink/80"}`}>
                    {it.stock} {it.satuan}
                  </div>
                  {low && <Badge tone="danger">Stock rendah</Badge>}
                </div>
                <button
                  onClick={() => {
                    setRestock(it);
                    setQty("");
                  }}
                  className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
                >
                  Restock
                </button>
              </div>
            );
          })
        )}
      </Card>

      <Card>
        <CardHeader title="Riwayat Stock" subtitle="Pemakaian per malam (−) dan restock (+)" />
        {!data ? (
          <Loading />
        ) : data.log.length === 0 ? (
          <Loading label="Belum ada riwayat" />
        ) : (
          data.log.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{l.amenity_nama || "—"}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {l.unit_nomor ? `Unit ${l.unit_nomor}` : l.created_by || "Stok masuk"} · {fmtDateTime(l.created_at)}
                </div>
              </div>
              <div className={`text-xs shrink-0 ${l.qty < 0 ? "text-sage-500" : "text-ruby-400"}`}>{tampilQty(l.qty)}</div>
            </div>
          ))
        )}
      </Card>

      <Modal
        open={restock !== null}
        title={`Restock — ${restock?.nama || ""}`}
        onClose={() => setRestock(null)}
        footer={
          <>
            <Btn onClick={() => setRestock(null)}>Batal</Btn>
            <Btn variant="primary" onClick={simpanRestock} disabled={menyimpan}>
              {menyimpan ? "Menyimpan…" : "Tambah Stock"}
            </Btn>
          </>
        }
      >
        <Field label={`Jumlah barang masuk (stock saat ini: ${restock?.stock ?? 0} ${restock?.satuan ?? ""})`}>
          <input type="number" inputMode="numeric" min={1} className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="mis. 100" />
        </Field>
      </Modal>
    </ManagerShell>
  );
}
