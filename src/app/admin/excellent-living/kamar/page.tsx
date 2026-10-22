"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { ElRoom, ElRoomType } from "@/lib/types";

type FormKamar = { id?: string; nomor: string; room_type_id: string; catatan: string; sort_order: number; active: boolean };
type FormTipe = { id?: string; kode: string; nama: string; deskripsi: string; kapasitas: string; active: boolean };

/** Atur 31 kamar Loonars Excellent Living (owner: "biarkan saya bisa mengaturnya di halaman admin"). */
export default function ElKamarAdminPage() {
  const toast = useToast();
  const [rooms, setRooms] = useState<ElRoom[] | null>(null);
  const [types, setTypes] = useState<ElRoomType[]>([]);
  const [kamar, setKamar] = useState<FormKamar | null>(null);
  const [tipe, setTipe] = useState<FormTipe | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<ElRoom[]>("/el/rooms").then(setRooms).catch(() => setRooms([]));
    api.get<ElRoomType[]>("/el/room-types").then(setTypes).catch(() => setTypes([]));
  }
  useEffect(load, []);

  async function kirim(fn: () => Promise<unknown>, pesan: string, tutup: () => void) {
    setBusy(true);
    try {
      await fn();
      toast("✓", "Tersimpan", pesan, "sage");
      tutup();
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  function simpanKamar() {
    if (!kamar) return;
    if (!kamar.nomor.trim() || !kamar.room_type_id) {
      toast("⚠", "Lengkapi form", "Nomor dan tipe kamar wajib diisi.", "ruby");
      return;
    }
    const body = { nomor: kamar.nomor, room_type_id: kamar.room_type_id, catatan: kamar.catatan || null, sort_order: kamar.sort_order, active: kamar.active };
    kirim(() => (kamar.id ? api.patch("/el/admin/rooms", { id: kamar.id, ...body }) : api.post("/el/admin/rooms", body)), `Kamar ${kamar.nomor}`, () => setKamar(null));
  }

  function simpanTipe() {
    if (!tipe) return;
    if (!tipe.kode.trim() || !tipe.nama.trim()) {
      toast("⚠", "Lengkapi form", "Kode dan nama tipe wajib diisi.", "ruby");
      return;
    }
    const body = { kode: tipe.kode.trim(), nama: tipe.nama.trim(), deskripsi: tipe.deskripsi || null, kapasitas: tipe.kapasitas ? Number(tipe.kapasitas) : null, active: tipe.active };
    kirim(() => (tipe.id ? api.patch("/el/admin/room-types", { id: tipe.id, ...body }) : api.post("/el/admin/room-types", body)), tipe.nama, () => setTipe(null));
  }

  const jumlahPerTipe = (id: string) => (rooms ?? []).filter((r) => r.room_type_id === id && r.active).length;

  return (
    <AdminShell pageTitle="Atur Kamar Excellent Living" pageSub="Nomor, tipe, dan status kamar">
      <Card className="mb-5">
        <CardHeader
          title="Tipe Kamar"
          action={<Btn onClick={() => setTipe({ kode: "", nama: "", deskripsi: "", kapasitas: "", active: true })}>+ Tipe</Btn>}
        />
        <div className="p-4 flex flex-wrap gap-2.5">
          {types.map((t) => (
            <button
              key={t.id}
              onClick={() => setTipe({ id: t.id, kode: t.kode, nama: t.nama, deskripsi: t.deskripsi ?? "", kapasitas: t.kapasitas?.toString() ?? "", active: t.active })}
              className="text-left border border-ink/10 rounded-xl px-3.5 py-2.5 hover:bg-ink/[0.03]"
            >
              <div className="text-[12.5px] font-semibold text-ink">{t.nama}{!t.active && " (nonaktif)"}</div>
              <div className="text-[10.5px] text-ink/40">{t.kode} · {jumlahPerTipe(t.id)} kamar aktif</div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Kamar"
          subtitle={rooms ? `${rooms.filter((r) => r.active).length} kamar aktif` : undefined}
          action={<Btn variant="primary" onClick={() => setKamar({ nomor: "", room_type_id: types[0]?.id ?? "", catatan: "", sort_order: 0, active: true })}>+ Kamar</Btn>}
        />
        {!rooms ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                  <th className="px-3.5 py-2.5">Nomor</th>
                  <th className="px-3.5 py-2.5">Tipe</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Catatan</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className={`border-t border-ink/[0.05] ${r.active ? "" : "opacity-40"}`}>
                    <td className="px-3.5 py-2.5 font-semibold text-ink">{r.nomor}</td>
                    <td className="px-3.5 py-2.5 text-ink/60">{r.el_room_types?.nama ?? "—"}</td>
                    <td className="px-3.5 py-2.5">{r.active ? <Badge tone="ok">{r.status}</Badge> : <Badge tone="danger">nonaktif</Badge>}</td>
                    <td className="px-3.5 py-2.5 text-ink/50">{r.catatan ?? ""}</td>
                    <td className="px-3.5 py-2.5 text-right">
                      <Btn onClick={() => setKamar({ id: r.id, nomor: r.nomor, room_type_id: r.room_type_id, catatan: r.catatan ?? "", sort_order: r.sort_order, active: r.active })}>Ubah</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!kamar}
        title={kamar?.id ? `Ubah Kamar ${kamar.nomor}` : "Tambah Kamar"}
        onClose={() => setKamar(null)}
        footer={<><Btn onClick={() => setKamar(null)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpanKamar}>Simpan</Btn></>}
      >
        {kamar && (
          <>
            <Field label="Nomor / Nama Kamar"><input className={inputCls} value={kamar.nomor} onChange={(e) => setKamar({ ...kamar, nomor: e.target.value })} /></Field>
            <Field label="Tipe">
              <select className={inputCls} value={kamar.room_type_id} onChange={(e) => setKamar({ ...kamar, room_type_id: e.target.value })}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
              </select>
            </Field>
            <Field label="Urutan Tampil"><input type="number" className={inputCls} value={kamar.sort_order} onChange={(e) => setKamar({ ...kamar, sort_order: Number(e.target.value) })} /></Field>
            <Field label="Catatan (opsional)"><input className={inputCls} value={kamar.catatan} onChange={(e) => setKamar({ ...kamar, catatan: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[12px] text-ink/60">
              <input type="checkbox" checked={kamar.active} onChange={(e) => setKamar({ ...kamar, active: e.target.checked })} />
              Kamar aktif (tampil di front desk dan dihitung okupansi)
            </label>
          </>
        )}
      </Modal>

      <Modal
        open={!!tipe}
        title={tipe?.id ? `Ubah Tipe ${tipe.nama}` : "Tambah Tipe Kamar"}
        onClose={() => setTipe(null)}
        footer={<><Btn onClick={() => setTipe(null)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpanTipe}>Simpan</Btn></>}
      >
        {tipe && (
          <>
            <Field label="Kode"><input className={inputCls} value={tipe.kode} onChange={(e) => setTipe({ ...tipe, kode: e.target.value })} /></Field>
            <Field label="Nama"><input className={inputCls} value={tipe.nama} onChange={(e) => setTipe({ ...tipe, nama: e.target.value })} /></Field>
            <Field label="Kapasitas Tamu (opsional)"><input type="number" min={1} className={inputCls} value={tipe.kapasitas} onChange={(e) => setTipe({ ...tipe, kapasitas: e.target.value })} /></Field>
            <Field label="Deskripsi (opsional)"><input className={inputCls} value={tipe.deskripsi} onChange={(e) => setTipe({ ...tipe, deskripsi: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[12px] text-ink/60">
              <input type="checkbox" checked={tipe.active} onChange={(e) => setTipe({ ...tipe, active: e.target.checked })} />
              Tipe aktif
            </label>
          </>
        )}
      </Modal>
    </AdminShell>
  );
}
