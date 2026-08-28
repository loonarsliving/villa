"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { AmenityItem, AmenityKitItem, AmenityUsageLog } from "@/lib/types";

export default function AdminAmenitiesPage() {
  const toast = useToast();
  const [items, setItems] = useState<AmenityItem[]>([]);
  const [kit, setKit] = useState<AmenityKitItem[]>([]);
  const [log, setLog] = useState<AmenityUsageLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState({ nama: "", satuan: "pcs", stock: "0", stock_minimum: "0" });

  const [restockOpen, setRestockOpen] = useState<AmenityItem | null>(null);
  const [restockQty, setRestockQty] = useState("");

  const [kitOpen, setKitOpen] = useState(false);
  const [kitForm, setKitForm] = useState({ amenity_id: "", qty: "1" });

  async function load() {
    setLoading(true);
    const [i, k, l] = await Promise.all([
      api.get<AmenityItem[]>("/amenities"),
      api.get<AmenityKitItem[]>("/amenities/kit"),
      api.get<AmenityUsageLog[]>("/amenities/usage-log"),
    ]);
    setItems(i || []);
    setKit(k || []);
    setLog(l || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createItem() {
    if (!itemForm.nama.trim()) {
      toast("⚠", "Nama wajib diisi", "Isi nama item amenities dulu.", "ruby");
      return;
    }
    try {
      await api.post("/amenities", {
        nama: itemForm.nama.trim(),
        satuan: itemForm.satuan.trim() || "pcs",
        stock: Number(itemForm.stock) || 0,
        stock_minimum: Number(itemForm.stock_minimum) || 0,
      });
      setItemOpen(false);
      setItemForm({ nama: "", satuan: "pcs", stock: "0", stock_minimum: "0" });
      toast("✓", "Tersimpan", "Item amenities berhasil ditambahkan.", "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function doRestock() {
    if (!restockOpen) return;
    const qty = Number(restockQty);
    if (!qty || qty <= 0) {
      toast("⚠", "Jumlah tidak valid", "Isi jumlah restock lebih dari 0.", "ruby");
      return;
    }
    try {
      await api.patch("/amenities", { id: restockOpen.id, restock_qty: qty });
      toast("✓", "Stock ditambah", `${restockOpen.nama} +${qty} ${restockOpen.satuan}.`, "sage");
      setRestockOpen(null);
      setRestockQty("");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function deleteItem(id: string) {
    await api.delete(`/amenities?id=${id}`);
    load();
  }

  async function saveKitItem() {
    if (!kitForm.amenity_id || !Number(kitForm.qty)) {
      toast("⚠", "Lengkapi form", "Pilih item dan isi jumlah per kamar.", "ruby");
      return;
    }
    try {
      await api.post("/amenities/kit", { amenity_id: kitForm.amenity_id, qty: Number(kitForm.qty) });
      setKitOpen(false);
      setKitForm({ amenity_id: "", qty: "1" });
      toast("✓", "Tersimpan", "Kit standar diperbarui.", "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function deleteKitItem(id: string) {
    await api.delete(`/amenities/kit?id=${id}`);
    load();
  }

  const itemsInKit = new Set(kit.map((k) => k.amenity_id));

  return (
    <AdminShell pageTitle="Amenities" pageSub="Katalog stock, kit standar kamar, dan riwayat pemakaian">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Saat housekeeping menandai tugas <b>&quot;lengkapi amenities&quot;</b> selesai (dibuat otomatis tiap ada booking OTA baru), stock item di
        bawah ini otomatis berkurang sesuai <b>Kit Standar</b> — tanpa perlu input manual. Reception hanya bisa lihat halaman ini, tidak bisa ubah
        stock; ubah stock/kit hanya lewat halaman admin ini.
      </div>

      <Card className="mb-3.5">
        <CardHeader
          title="Katalog & Stock"
          action={
            <button
              onClick={() => setItemOpen(true)}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
            >
              + Item Baru
            </button>
          }
        />
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
                  <div className="text-xs text-ink/80 flex items-center gap-1.5">
                    {it.nama}
                    {itemsInKit.has(it.id) && <span className="text-[9px] text-gold-400">· dalam kit</span>}
                  </div>
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
                    setRestockOpen(it);
                    setRestockQty("");
                  }}
                  className="text-[10.5px] text-gold-500 shrink-0"
                >
                  Restock
                </button>
                <button onClick={() => deleteItem(it.id)} className="text-[10.5px] text-ruby-400 shrink-0">
                  Hapus
                </button>
              </div>
            );
          })
        )}
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="Kit Standar per Kamar"
          subtitle="Jumlah tiap item yang otomatis dikurangi saat 1 tugas amenities selesai"
          action={
            <button
              onClick={() => setKitOpen(true)}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
            >
              + Atur Item
            </button>
          }
        />
        {kit.length === 0 ? (
          <Loading label="Belum ada kit standar diatur" />
        ) : (
          kit.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0 text-xs text-ink/80">{k.amenities?.nama || "—"}</div>
              <div className="text-xs text-gold-500 shrink-0">
                {k.qty} {k.amenities?.satuan || "pcs"} / kamar
              </div>
              <button onClick={() => deleteKitItem(k.id)} className="text-[10.5px] text-ruby-400 shrink-0">
                Hapus
              </button>
            </div>
          ))
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
                  Unit {l.unit_nomor || "—"} · {fmtDate(l.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {l.created_by ? ` · ${l.created_by}` : ""}
                </div>
              </div>
              <div className="text-xs text-ruby-400 shrink-0">-{l.qty}</div>
            </div>
          ))
        )}
      </Card>

      <Modal
        open={itemOpen}
        title="Item Amenities Baru"
        onClose={() => setItemOpen(false)}
        footer={
          <>
            <Btn onClick={() => setItemOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={createItem}>Simpan</Btn>
          </>
        }
      >
        <Field label="Nama Item">
          <input className={inputCls} value={itemForm.nama} onChange={(e) => setItemForm({ ...itemForm, nama: e.target.value })} placeholder="mis. Air Mineral 600ml" />
        </Field>
        <Field label="Satuan">
          <input className={inputCls} value={itemForm.satuan} onChange={(e) => setItemForm({ ...itemForm, satuan: e.target.value })} placeholder="pcs / botol / pack" />
        </Field>
        <Field label="Stock Awal">
          <input type="number" className={inputCls} value={itemForm.stock} onChange={(e) => setItemForm({ ...itemForm, stock: e.target.value })} />
        </Field>
        <Field label="Stock Minimum (untuk peringatan)">
          <input type="number" className={inputCls} value={itemForm.stock_minimum} onChange={(e) => setItemForm({ ...itemForm, stock_minimum: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={restockOpen !== null}
        title={`Restock — ${restockOpen?.nama || ""}`}
        onClose={() => setRestockOpen(null)}
        footer={
          <>
            <Btn onClick={() => setRestockOpen(null)}>Batal</Btn>
            <Btn variant="primary" onClick={doRestock}>Tambah Stock</Btn>
          </>
        }
      >
        <Field label={`Jumlah Tambahan (stock saat ini: ${restockOpen?.stock ?? 0} ${restockOpen?.satuan ?? ""})`}>
          <input type="number" className={inputCls} value={restockQty} onChange={(e) => setRestockQty(e.target.value)} placeholder="0" />
        </Field>
      </Modal>

      <Modal
        open={kitOpen}
        title="Atur Kit Standar"
        onClose={() => setKitOpen(false)}
        footer={
          <>
            <Btn onClick={() => setKitOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={saveKitItem}>Simpan</Btn>
          </>
        }
      >
        <Field label="Item">
          <select className={inputCls} value={kitForm.amenity_id} onChange={(e) => setKitForm({ ...kitForm, amenity_id: e.target.value })}>
            <option value="">Pilih item</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{it.nama}</option>
            ))}
          </select>
        </Field>
        <Field label="Jumlah per Kamar">
          <input type="number" className={inputCls} value={kitForm.qty} onChange={(e) => setKitForm({ ...kitForm, qty: e.target.value })} />
        </Field>
      </Modal>
    </AdminShell>
  );
}
