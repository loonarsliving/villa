"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api } from "@/lib/api";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";

/**
 * Promo (permintaan owner 2026-09-12).
 *
 * Yang perlu dipahami sebelum mengubah halaman ini: promo di sistem ini
 * TIDAK menyimpan angka diskon. Ia mengaktifkan batas bawah harga yang sudah
 * ada di tipe kamar (villa_room_types.min_rate) -- instruksi owner: "ai akn
 * akan memakai harga paling bawah kita, nah bisa pakai seolah2 sedang ada
 * promo untuk mngaktifkan harga bawah itu".
 *
 * Karena itu "Harga tetap" di bawah pun tetap dijepit villa-api supaya tidak
 * pernah turun di bawah min_rate. Kolom itu untuk harga promo yang lebih
 * TINGGI dari batas bawah, bukan pintu belakang untuk menembusnya.
 */

interface Promo {
  id: string;
  kode: string;
  nama: string;
  deskripsi: string | null;
  mode_harga: "batas_bawah" | "harga_tetap";
  harga_per_malam: number | null;
  room_type_id: string | null;
  pesan_dari: string | null;
  pesan_sampai: string | null;
  menginap_dari: string | null;
  menginap_sampai: string | null;
  min_malam: number;
  kuota: number | null;
  terpakai: number;
  aktif: boolean;
  created_at: string;
}

interface RoomType {
  id: string;
  code: string;
  name: string;
  min_rate: number | null;
}

const KOSONG = {
  kode: "",
  nama: "",
  deskripsi: "",
  mode_harga: "batas_bawah" as "batas_bawah" | "harga_tetap",
  harga_per_malam: "",
  room_type_id: "",
  pesan_dari: "",
  pesan_sampai: "",
  menginap_dari: "",
  menginap_sampai: "",
  min_malam: "1",
  kuota: "",
};

export default function PromoPage() {
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(KOSONG);
  const [saving, setSaving] = useState(false);

  async function load() {
    setErr(null);
    try {
      const [list, rt] = await Promise.all([
        api.get<Promo[]>("/promos"),
        api.get<RoomType[]>("/room-types").catch(() => [] as RoomType[]),
      ]);
      setPromos(list);
      setRoomTypes(rt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat promo");
      setPromos([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function bukaBaru() {
    setEditId(null);
    setForm(KOSONG);
    setOpen(true);
  }

  function bukaEdit(p: Promo) {
    setEditId(p.id);
    setForm({
      kode: p.kode,
      nama: p.nama,
      deskripsi: p.deskripsi ?? "",
      mode_harga: p.mode_harga,
      harga_per_malam: p.harga_per_malam != null ? String(p.harga_per_malam) : "",
      room_type_id: p.room_type_id ?? "",
      pesan_dari: p.pesan_dari ?? "",
      pesan_sampai: p.pesan_sampai ?? "",
      menginap_dari: p.menginap_dari ?? "",
      menginap_sampai: p.menginap_sampai ?? "",
      min_malam: String(p.min_malam ?? 1),
      kuota: p.kuota != null ? String(p.kuota) : "",
    });
    setOpen(true);
  }

  async function simpan() {
    setSaving(true);
    setErr(null);
    const body = {
      ...(editId ? { id: editId } : { kode: form.kode.trim().toUpperCase() }),
      nama: form.nama.trim(),
      deskripsi: form.deskripsi.trim() || null,
      mode_harga: form.mode_harga,
      harga_per_malam: form.mode_harga === "harga_tetap" ? Number(form.harga_per_malam || 0) : null,
      room_type_id: form.room_type_id || null,
      pesan_dari: form.pesan_dari || null,
      pesan_sampai: form.pesan_sampai || null,
      menginap_dari: form.menginap_dari || null,
      menginap_sampai: form.menginap_sampai || null,
      min_malam: Number(form.min_malam || 1),
      kuota: form.kuota === "" ? null : Number(form.kuota),
    };
    try {
      if (editId) await api.patch("/promos", body);
      else await api.post("/promos", body);
      setOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan promo");
    } finally {
      setSaving(false);
    }
  }

  async function ubahAktif(p: Promo) {
    setErr(null);
    try {
      await api.patch("/promos", { id: p.id, aktif: !p.aktif });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengubah status promo");
    }
  }

  const tipeTerpilih = roomTypes.find((r) => r.id === form.room_type_id);

  return (
    <AdminShell pageTitle="Promo" pageSub="Mengaktifkan harga batas bawah untuk tamu yang membawa kode — OTA tetap harga normal">
      {err && <div className="mb-4 text-[12px] text-red-400">{err}</div>}

      <div className="mb-4 flex justify-end">
        <Btn variant="primary" onClick={bukaBaru}>
          + Promo baru
        </Btn>
      </div>

      <Card>
        <CardHeader title="Daftar promo" />
        <CardBody>
          {!promos ? (
            <Loading />
          ) : promos.length === 0 ? (
            <Empty label="Belum ada promo" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-ink/30 text-[9.5px] uppercase tracking-[0.12em]">
                    <th className="text-left py-2">Kode</th>
                    <th className="text-left py-2">Nama</th>
                    <th className="text-left py-2">Harga</th>
                    <th className="text-left py-2">Berlaku memesan</th>
                    <th className="text-left py-2">Untuk menginap</th>
                    <th className="text-right py-2">Dipakai</th>
                    <th className="text-left py-2">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p) => (
                    <tr key={p.id} className="border-t border-ink/5">
                      <td className="py-2.5 font-mono text-ink">{p.kode}</td>
                      <td className="py-2.5 text-ink/70">{p.nama}</td>
                      <td className="py-2.5 text-ink/60">
                        {p.mode_harga === "batas_bawah" ? "Batas bawah tipe kamar" : fmtCurrency(p.harga_per_malam ?? 0) + "/malam"}
                      </td>
                      <td className="py-2.5 text-ink/50">{rentang(p.pesan_dari, p.pesan_sampai)}</td>
                      <td className="py-2.5 text-ink/50">{rentang(p.menginap_dari, p.menginap_sampai)}</td>
                      <td className="py-2.5 text-right text-ink">
                        {p.terpakai}
                        {p.kuota != null && <span className="text-ink/30"> / {p.kuota}</span>}
                      </td>
                      <td className="py-2.5">{p.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="pending">Nonaktif</Badge>}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => bukaEdit(p)} className="text-[11px] text-gold-500 mr-3">
                          Ubah
                        </button>
                        <button onClick={() => void ubahAktif(p)} className="text-[11px] text-ink/40">
                          {p.aktif ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={open}
        title={editId ? "Ubah promo" : "Promo baru"}
        onClose={() => setOpen(false)}
        wide
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={() => void simpan()}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Btn>
          </>
        }
      >
        <div className="grid md:grid-cols-2 gap-x-5">
          {!editId && (
            <Field label="Kode promo">
              <input
                className={inputCls}
                value={form.kode}
                onChange={(e) => setForm({ ...form, kode: e.target.value.toUpperCase() })}
                placeholder="LOWSEASON"
              />
            </Field>
          )}
          <Field label="Nama promo">
            <input className={inputCls} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Promo Low Season" />
          </Field>
          <Field label="Tipe unit">
            <select className={inputCls} value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
              <option value="">Semua tipe</option>
              {roomTypes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cara menentukan harga">
            <select
              className={inputCls}
              value={form.mode_harga}
              onChange={(e) => setForm({ ...form, mode_harga: e.target.value as "batas_bawah" | "harga_tetap" })}
            >
              <option value="batas_bawah">Pakai batas bawah tipe kamar</option>
              <option value="harga_tetap">Harga tetap yang saya isi</option>
            </select>
          </Field>
          {form.mode_harga === "harga_tetap" && (
            <Field label="Harga per malam">
              <input
                className={inputCls}
                type="number"
                value={form.harga_per_malam}
                onChange={(e) => setForm({ ...form, harga_per_malam: e.target.value })}
                placeholder="650000"
              />
            </Field>
          )}
          <Field label="Minimal malam">
            <input className={inputCls} type="number" value={form.min_malam} onChange={(e) => setForm({ ...form, min_malam: e.target.value })} />
          </Field>
          <Field label="Kuota pemakaian (kosongkan = tanpa batas)">
            <input className={inputCls} type="number" value={form.kuota} onChange={(e) => setForm({ ...form, kuota: e.target.value })} placeholder="mis. 20" />
          </Field>
          <Field label="Boleh dipesan dari">
            <input className={inputCls} type="date" value={form.pesan_dari} onChange={(e) => setForm({ ...form, pesan_dari: e.target.value })} />
          </Field>
          <Field label="Boleh dipesan sampai">
            <input className={inputCls} type="date" value={form.pesan_sampai} onChange={(e) => setForm({ ...form, pesan_sampai: e.target.value })} />
          </Field>
          <Field label="Untuk menginap dari">
            <input className={inputCls} type="date" value={form.menginap_dari} onChange={(e) => setForm({ ...form, menginap_dari: e.target.value })} />
          </Field>
          <Field label="Untuk menginap sampai">
            <input className={inputCls} type="date" value={form.menginap_sampai} onChange={(e) => setForm({ ...form, menginap_sampai: e.target.value })} />
          </Field>
        </div>
        <Field label="Deskripsi (dipakai AI saat menyusun pesan)">
          <input className={inputCls} value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} />
        </Field>

        <div className="text-[11px] text-ink/40 leading-relaxed border-t border-ink/10 pt-3">
          {form.mode_harga === "batas_bawah" ? (
            <>
              Harga promo mengikuti batas bawah tipe kamar
              {tipeTerpilih?.min_rate ? <> — saat ini {fmtCurrency(tipeTerpilih.min_rate)}/malam.</> : " yang berlaku saat tamu memesan."}
            </>
          ) : (
            <>Harga yang Anda isi tetap dijepit tidak boleh di bawah batas bawah tipe kamarnya. Salah ketik satu nol tidak akan menjual villa di bawah lantai harga.</>
          )}{" "}
          Promo tidak pernah menaikkan harga: kalau harga normal sudah lebih murah, tamu membayar yang lebih murah. Kode ini
          hanya berlaku di loonars.id — harga di OTA tidak tersentuh.
        </div>
      </Modal>
    </AdminShell>
  );
}

function rentang(a: string | null, b: string | null): string {
  if (!a && !b) return "kapan saja";
  if (a && b) return `${fmtDate(a)} – ${fmtDate(b)}`;
  if (a) return `mulai ${fmtDate(a)}`;
  return `sampai ${fmtDate(b!)}`;
}
