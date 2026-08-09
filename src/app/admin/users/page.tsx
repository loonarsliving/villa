"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { VillaUserRow, Role, Unit } from "@/lib/types";

const roleLabel: Record<Role, string> = { owner: "Investor", receptionist: "Resepsionis", admin: "Admin" };

export default function AdminUsersPage() {
  const toast = useToast();
  const [rows, setRows] = useState<VillaUserRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nama: "", email: "", password: "", role: "owner" as Role, unit_id: "", hp: "" });
  const [resetTarget, setResetTarget] = useState<VillaUserRow | null>(null);
  const [resetPass, setResetPass] = useState("");

  async function load() {
    setLoading(true);
    const [r, u] = await Promise.all([api.get<VillaUserRow[]>("/admin/users"), api.get<Unit[]>("/units")]);
    setRows(r || []);
    setUnits(u || []);
    setLoading(false);
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
        force_password_change: true,
      });
      setOpen(false);
      setForm({ nama: "", email: "", password: "", role: "owner", unit_id: "", hp: "" });
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
    if (!resetTarget || resetPass.length < 6) {
      toast("⚠", "Password terlalu pendek", "Minimal 6 karakter.", "ruby");
      return;
    }
    try {
      await api.patch("/admin/users", { id: resetTarget.id, new_password: resetPass });
      toast("✓", "Password direset", `${resetTarget.nama} wajib ganti password di login berikutnya.`, "sage");
      setResetTarget(null);
      setResetPass("");
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
                  {["Nama", "Email", "Role", "Unit", "Status", "Password", "Aksi"].map((h) => (
                    <th key={h} className="text-left px-3.5 py-2 text-[8.5px] font-semibold tracking-wide uppercase text-white/30 border-b border-white/[0.08]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-base-800/50">
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] font-medium text-white/80">{u.nama}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-white/50">{u.email}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-white/50">{roleLabel[u.role]}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] text-gold-500">{u.unit_nomor || "—"}</td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05]">
                      <Badge tone={u.is_active ? "ok" : "danger"}>{u.is_active ? "Aktif" : "Nonaktif"}</Badge>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05]">
                      <Badge tone={u.must_change_password ? "pending" : "ok"}>{u.must_change_password ? "Wajib ganti" : "OK"}</Badge>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-white/[0.05] whitespace-nowrap">
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
        <Field label="Role">
          <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="owner">Investor</option>
            <option value="receptionist">Resepsionis</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
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
        onClose={() => { setResetTarget(null); setResetPass(""); }}
        footer={<><Btn onClick={() => { setResetTarget(null); setResetPass(""); }}>Batal</Btn><Btn variant="primary" onClick={doResetPassword}>Reset</Btn></>}
      >
        <Field label="Password Baru">
          <input className={inputCls} value={resetPass} onChange={(e) => setResetPass(e.target.value)} placeholder="Minimal 6 karakter" />
        </Field>
        <div className="text-[10.5px] text-white/30 leading-relaxed">
          Pengguna akan wajib ganti password ini saat login berikutnya.
        </div>
      </Modal>
    </AdminShell>
  );
}
