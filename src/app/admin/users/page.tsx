"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError, localApi } from "@/lib/api";
import type { Properti } from "@/lib/properti";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { VillaUserRow, Role, Unit } from "@/lib/types";

/**
 * Pilihan role per properti (owner 2026-11-04: "admin jga harusnya bisa
 * menambahkan karyawan dan role untuk login berdasarkan properti").
 * Admin & finance = semua properti. Resepsionis/investor Excellent Living
 * memakai role el_* yang sudah ada; manager memakai role manager + properti.
 */
const SEMUA = "__semua__";
function pilihanRole(properti: string): { value: Role; label: string }[] {
  if (properti === SEMUA) return [{ value: "admin", label: "Admin" }, { value: "finance", label: "Finance" }];
  if (properti === "PL")
    return [
      { value: "receptionist", label: "Resepsionis" },
      { value: "manager", label: "Manager (Kesiapan Kamar)" },
      { value: "owner", label: "Investor" },
      { value: "late_night", label: "Late Night (loonars.id/late)" },
    ];
  if (properti === "EL")
    return [
      { value: "el_receptionist", label: "Resepsionis" },
      { value: "manager", label: "Manager (buka/tutup kamar)" },
      { value: "el_investor", label: "Investor" },
    ];
  return [
    { value: "manager", label: "Manager" },
    { value: "receptionist", label: "Resepsionis" },
  ];
}

const roleLabel: Record<Role, string> = { owner: "Investor", receptionist: "Resepsionis", admin: "Admin", finance: "Finance", manager: "Manager", late_night: "Late Night", el_investor: "Investor Excellent Living", el_receptionist: "Resepsionis Excellent Living" };

export default function AdminUsersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<VillaUserRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nama: "", email: "", password: "", role: "receptionist" as Role, unit_id: "", hp: "", properti: "PL" });
  const [properti, setProperti] = useState<Properti[]>([]);
  const namaProperti = (kode: string | null | undefined) => (kode ? (properti.find((p) => p.kode === kode)?.nama ?? kode) : null);
  const [resetTarget, setResetTarget] = useState<VillaUserRow | null>(null);
  const [resetPass, setResetPass] = useState("");
  // Bawaannya TETAP true supaya perilaku lama tidak berubah: akun investor
  // memang harus memilih passwordnya sendiri saat login pertama. Yang baru
  // hanyalah kemampuan MEMATIKANNYA -- dipakai untuk akun bersama seperti
  // resepsionis, yang passwordnya sengaja dipegang owner dan tidak boleh
  // berubah sendiri (instruksi owner 2026-09-27). Sebelum ini tombol Reset
  // selalu menyalakan "wajib ganti" tanpa cara mematikannya, sehingga
  // keputusan itu ikut terbatalkan diam-diam setiap kali password direset.
  const [resetWajibGanti, setResetWajibGanti] = useState(true);

  async function load() {
    setLoading(true);
    const [r, u] = await Promise.all([api.get<VillaUserRow[]>("/admin/users"), api.get<Unit[]>("/units")]);
    setRows(r || []);
    setUnits(u || []);
    setLoading(false);
    localApi<Properti[]>("/api/properti").then((p) => setProperti(p)).catch(() => setProperti([]));
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    if (!form.nama.trim() || !form.email.trim() || !form.password) {
      toast("⚠", "Lengkapi form", "Nama, email, dan password wajib diisi.", "ruby");
      return;
    }
    const unit = units.find((u) => u.id === form.unit_id);
    try {
      await api.post("/admin/users", {
        nama: form.nama,
        email: form.email,
        password: form.password,
        role: form.role,
        hp: form.hp || null,
        unit_id: form.role === "owner" ? form.unit_id || null : null,
        unit_nomor: form.role === "owner" ? unit?.nomor || null : null,
        property_kode: form.properti === SEMUA ? null : form.properti,
        force_password_change: true,
      });
      setOpen(false);
      setForm({ nama: "", email: "", password: "", role: "receptionist", unit_id: "", hp: "", properti: "PL" });
      toast("✓", "Pengguna dibuat", `${form.nama} berhasil ditambahkan.`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function toggleActive(u: VillaUserRow) {
    await api.patch("/admin/users", { id: u.id, is_active: !u.is_active });
    load();
  }

  async function doResetPassword() {
    // villa-api menolak di bawah 8 ('Password minimal 8 karakter'), sementara
    // layar ini dulu meloloskan 6 -- password 6-7 karakter lolos di sini lalu
    // ditolak server dengan pesan yang berbeda dari yang tertulis di layar.
    if (!resetTarget || resetPass.length < 8) {
      toast("⚠", "Password terlalu pendek", "Minimal 8 karakter.", "ruby");
      return;
    }
    try {
      await api.patch("/admin/users", {
        id: resetTarget.id,
        new_password: resetPass,
        force_password_change: resetWajibGanti,
      });
      toast(
        "✓",
        "Password direset",
        resetWajibGanti
          ? `${resetTarget.nama} wajib ganti password di login berikutnya.`
          : `Password ${resetTarget.nama} tetap seperti yang diisi — tidak diminta ganti saat login.`,
        "sage",
      );
      setResetTarget(null);
      setResetPass("");
      setResetWajibGanti(true);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  return (
    <AdminShell pageTitle="Pengguna" pageSub="Semua akun sistem villa">
      <Card>
        <CardHeader
          title="Daftar Pengguna"
          subtitle={`${rows.length} akun`}
          action={
            <button onClick={() => setOpen(true)} className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0">
              + Tambah
            </button>
          }
        />
        {loading ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px] min-w-[600px]">
              <thead>
                <tr className="bg-base-800">
                  {["Nama", "Email", "Properti", "Role", "Unit", "Status", "Password", "Aksi"].map((h) => (
                    <th key={h} className="text-left px-3.5 py-2 text-[8.5px] font-semibold tracking-wide uppercase text-ink/30 border-b border-ink/[0.08]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-base-800/50">
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] font-medium text-ink/80">{u.nama}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/50">{u.email}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/50">
                      {u.role === "admin" || u.role === "finance"
                        ? "Semua properti"
                        : namaProperti(u.property_kode) ?? (u.role.startsWith("el_") ? namaProperti("EL") : namaProperti("PL")) ?? "—"}
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-ink/50">{roleLabel[u.role]}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] text-gold-500">{u.unit_nomor || "—"}</td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05]">
                      <Badge tone={u.is_active ? "ok" : "danger"}>{u.is_active ? "Aktif" : "Nonaktif"}</Badge>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05]">
                      <Badge tone={u.must_change_password ? "pending" : "ok"}>{u.must_change_password ? "Wajib ganti" : "OK"}</Badge>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-ink/[0.05] whitespace-nowrap">
                      <button onClick={() => setResetTarget(u)} className="text-[10.5px] font-semibold text-gold-500 mr-2.5">
                        Reset Password
                      </button>
                      <button onClick={() => toggleActive(u)} className="text-[10.5px] font-semibold text-gold-500">
                        {u.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} title="Tambah Pengguna" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" onClick={createUser}>Simpan</Btn></>}>
        <Field label="Nama"><input className={inputCls} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></Field>
        <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password Sementara"><input className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="Properti">
          <select
            className={inputCls}
            value={form.properti}
            onChange={(e) => {
              const p = e.target.value;
              setForm({ ...form, properti: p, role: pilihanRole(p)[0].value, unit_id: "" });
            }}
          >
            <option value={SEMUA}>Semua properti (admin / finance)</option>
            {properti.filter((p) => p.aktif).map((p) => (
              <option key={p.kode} value={p.kode}>{p.nama}</option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {pilihanRole(form.properti).map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        {form.properti !== SEMUA && form.properti !== "PL" && form.properti !== "EL" && (
          <div className="text-[11px] text-gold-600 -mt-1 mb-2">
            Akun untuk properti ini sudah bisa dibuat, tetapi fitur operasionalnya belum aktif. Akun bisa login setelah fiturnya tersedia.
          </div>
        )}
        {form.role === "owner" && (
          <Field label="Unit">
            <select className={inputCls} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
              <option value="">Pilih unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>Unit {u.nomor}{u.owner_nama ? ` (sudah ada: ${u.owner_nama})` : ""}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="No. HP (opsional)"><input className={inputCls} value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value })} /></Field>
      </Modal>

      <Modal
        open={!!resetTarget}
        title={`Reset Password — ${resetTarget?.nama || ""}`}
        onClose={() => { setResetTarget(null); setResetPass(""); setResetWajibGanti(true); }}
        footer={<><Btn onClick={() => { setResetTarget(null); setResetPass(""); setResetWajibGanti(true); }}>Batal</Btn><Btn variant="primary" onClick={doResetPassword}>Reset</Btn></>}
      >
        <Field label="Password Baru">
          <input className={inputCls} value={resetPass} onChange={(e) => setResetPass(e.target.value)} placeholder="Minimal 8 karakter" />
        </Field>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={resetWajibGanti}
            onChange={(e) => setResetWajibGanti(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-sage-500 cursor-pointer shrink-0"
          />
          <span className="text-[10.5px] text-ink/70">Minta pengguna mengganti password ini saat login berikutnya</span>
        </label>
        <div className="text-[10.5px] text-ink/30 leading-relaxed mt-2">
          {resetWajibGanti
            ? "Password di atas sekali pakai — pengguna memilih passwordnya sendiri saat login, jadi jangan disimpan."
            : "Password di atas menetap dan bisa disimpan. Matikan centang ini hanya untuk akun bersama (mis. resepsionis) yang passwordnya dipegang manajemen."}
        </div>
      </Modal>
    </AdminShell>
  );
}
