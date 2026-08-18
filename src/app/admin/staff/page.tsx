"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { StaffMember } from "@/lib/types";

const roleLabel: Record<StaffMember["role"], string> = {
  security: "Keamanan",
  cleaning_service: "Housekeeping",
  guest_greeter: "Guest Greeter",
};

export default function AdminStaffPage() {
  const toast = useToast();
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nama: "", role: "cleaning_service" as StaffMember["role"], hp: "" });

  async function load() {
    setLoading(true);
    const r = await api.get<StaffMember[]>("/admin/staff");
    setRows(r || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createStaff() {
    if (!form.nama.trim()) {
      toast("⚠", "Lengkapi form", "Nama wajib diisi.", "ruby");
      return;
    }
    try {
      await api.post("/admin/staff", form);
      setOpen(false);
      setForm({ nama: "", role: "cleaning_service", hp: "" });
      toast("✓", "Staff ditambahkan", `${form.nama} berhasil ditambahkan.`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function toggleActive(s: StaffMember) {
    await api.patch("/admin/staff", { id: s.id, nama: s.nama, hp: s.hp, is_active: !s.is_active });
    load();
  }

  return (
    <AdminShell pageTitle="Staff Operasional" pageSub="Security, housekeeping, guest greeter">
      <Card>
        <CardHeader
          title="Daftar Staff"
          subtitle={`${rows.length} staff`}
          action={
            <button onClick={() => setOpen(true)} className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0">
              + Tambah
            </button>
          }
        />
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Loading label="Belum ada staff terdaftar" />
        ) : (
          rows.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-ink/80">{s.nama}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">{roleLabel[s.role]} · {s.hp || "tanpa HP"}</div>
              </div>
              <Badge tone={s.is_active ? "ok" : "danger"}>{s.is_active ? "Aktif" : "Nonaktif"}</Badge>
              <button onClick={() => toggleActive(s)} className="text-[10.5px] font-semibold text-gold-500 shrink-0">
                {s.is_active ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </div>
          ))
        )}
      </Card>

      <Modal open={open} title="Tambah Staff" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" onClick={createStaff}>Simpan</Btn></>}>
        <Field label="Nama"><input className={inputCls} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></Field>
        <Field label="Peran">
          <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffMember["role"] })}>
            <option value="cleaning_service">Housekeeping</option>
            <option value="security">Keamanan</option>
            <option value="guest_greeter">Guest Greeter</option>
          </select>
        </Field>
        <Field label="No. HP (untuk notifikasi WA)"><input className={inputCls} value={form.hp} onChange={(e) => setForm({ ...form, hp: e.target.value })} placeholder="+62 8xx-xxxx-xxxx" /></Field>
      </Modal>
    </AdminShell>
  );
}
