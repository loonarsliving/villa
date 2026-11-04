"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { useRouter } from "next/navigation";
import { propertiSiap, type Properti } from "@/lib/properti";

/**
 * Kelola properti (owner 2026-11-04: "admin itu bisa menambahkan properti
 * baru dgan mudah"). Properti baru langsung muncul di halaman Pilih
 * Properti dan di pilihan properti akun karyawan.
 */
export default function AdminPropertiPage() {
  const toast = useToast();
  const router = useRouter();
  const [daftar, setDaftar] = useState<Properti[] | null>(null);
  const [form, setForm] = useState<{ kode: string; nama: string; edit: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    localApi<Properti[]>("/api/properti").then(setDaftar).catch(() => setDaftar([]));
  }
  useEffect(load, []);

  async function kirim(fn: () => Promise<unknown>, pesan: string) {
    setBusy(true);
    try {
      await fn();
      toast("✓", "Tersimpan", pesan, "sage");
      setForm(null);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  function simpan() {
    if (!form) return;
    if (form.edit) {
      kirim(() => localApi("/api/admin/properti", { method: "PATCH", body: JSON.stringify({ kode: form.kode, nama: form.nama }) }), "Nama properti diperbarui.");
    } else {
      const kodeBaru = form.kode;
      kirim(async () => {
        await localApi("/api/admin/properti", { method: "POST", body: JSON.stringify({ kode: form.kode, nama: form.nama }) });
        // Langsung ke pengaturan: isi kunci Cloudbeds, email, QRIS, lalu aktifkan.
        router.push(`/admin/properti/${kodeBaru}`);
      }, `${form.nama} ditambahkan. Lanjutkan pengaturannya.`);
    }
  }

  return (
    <AdminShell pageTitle="Kelola Properti" pageSub="Semua properti yang dikelola sistem ini">
      <Card>
        <CardHeader
          title="Daftar Properti"
          subtitle="Properti aktif muncul di halaman Pilih Properti saat admin/finance login, dan di pilihan properti akun karyawan."
          action={<Btn variant="primary" onClick={() => setForm({ kode: "", nama: "", edit: false })}>+ Tambah Properti</Btn>}
        />
        {!daftar ? (
          <Loading />
        ) : (
          <div className="divide-y divide-ink/[0.05]">
            {daftar.map((p) => (
              <div key={p.kode} className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
                <div>
                  <div className="font-semibold text-ink">{p.nama}</div>
                  <div className="text-[11px] text-ink/40 mt-0.5 flex flex-wrap gap-2 items-center">
                    <span>Kode {p.kode}</span>
                    <Badge tone={p.aktif ? "ok" : "danger"}>{p.aktif ? "Aktif" : "Nonaktif"}</Badge>
                    {!propertiSiap(p) && <span className="text-gold-600">belum diatur — klik Atur</span>}
                  </div>
                </div>
                <span className="flex gap-2">
                  {p.kode !== "PL" && <Btn variant={propertiSiap(p) ? "ghost" : "primary"} onClick={() => router.push(`/admin/properti/${p.kode}`)}>{propertiSiap(p) ? "Pengaturan" : "Atur"}</Btn>}
                  <Btn disabled={busy} onClick={() => setForm({ kode: p.kode, nama: p.nama, edit: true })}>Ubah nama</Btn>
                  {p.kode !== "PL" && (
                    <Btn
                      disabled={busy}
                      onClick={() =>
                        kirim(
                          () => localApi("/api/admin/properti", { method: "PATCH", body: JSON.stringify({ kode: p.kode, aktif: !p.aktif }) }),
                          p.aktif ? `${p.nama} dinonaktifkan.` : `${p.nama} diaktifkan.`,
                        )
                      }
                    >
                      {p.aktif ? "Nonaktifkan" : "Aktifkan"}
                    </Btn>
                  )}
                  {/* Hapus hanya untuk properti nonaktif yang belum punya data (dicek lagi di server). */}
                  {p.kode !== "PL" && p.kode !== "EL" && !p.aktif && (
                    <Btn
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Hapus properti "${p.nama}" (${p.kode}) beserta pengaturannya? Tidak bisa dibatalkan.`)) return;
                        kirim(() => localApi(`/api/admin/properti?kode=${p.kode}`, { method: "DELETE" }), `${p.nama} dihapus.`);
                      }}
                    >
                      Hapus
                    </Btn>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!form}
        title={form?.edit ? "Ubah Nama Properti" : "Tambah Properti"}
        onClose={() => setForm(null)}
        footer={<><Btn onClick={() => setForm(null)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={simpan}>Simpan</Btn></>}
      >
        {form && (
          <>
            <Field label="Nama properti">
              <input className={inputCls} placeholder="contoh: Loonars Bali" value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
            </Field>
            {!form.edit && (
              <Field label="Kode (2-6 huruf, tidak bisa diubah)">
                <input
                  className={inputCls}
                  placeholder="contoh: LB"
                  value={form.kode}
                  maxLength={6}
                  onChange={(e) => setForm({ ...form, kode: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                />
              </Field>
            )}
            {!form.edit && (
              <div className="text-[11.5px] text-ink/50">
                Setelah ditambahkan, Anda langsung diarahkan mengisi: kunci Cloudbeds, email pembayaran BTN, dan QRIS. Kamar, harga, booking,
                Front Desk, dan finance properti ini aktif otomatis, tanpa coding. Lalu buat akun manager dan resepsionis di Pengguna &amp; Role.
              </div>
            )}
          </>
        )}
      </Modal>
    </AdminShell>
  );
}
