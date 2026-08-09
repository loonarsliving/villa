"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, CardBody, Loading } from "@/components/Card";
import { Btn } from "@/components/Modal";
import type { IntegrationSetting } from "@/lib/types";

export default function AdminSettingsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<IntegrationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const r = await api.get<IntegrationSetting[]>("/admin/settings");
    setRows(r || []);
    const d: Record<string, string> = {};
    (r || []).forEach((row) => (d[row.key] = JSON.stringify(row.value, null, 2)));
    setDrafts(d);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(key: string) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(drafts[key] || "{}");
    } catch {
      toast("⚠", "JSON tidak valid", "Periksa format sebelum menyimpan.", "ruby");
      return;
    }
    setSaving(key);
    try {
      await api.post("/admin/settings", { key, value: parsed });
      toast("✓", "Tersimpan", `Pengaturan "${key}" berhasil diperbarui.`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal menyimpan", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setSaving(null);
    }
  }

  const known: Record<string, { title: string; hint: string }> = {
    vercel_bridge: { title: "Jembatan WhatsApp (mkhsistem)", hint: "base_url + secret ke endpoint /api/wa/send di mkhsistem" },
    cloudbeds: { title: "Cloudbeds", hint: "Kredensial channel manager Cloudbeds — tempel di sini saat integrasi diaktifkan" },
    cron: { title: "Cron / Job Terjadwal", hint: "Secret untuk endpoint yang dipanggil pg_cron" },
    finance: { title: "Formula Keuangan", hint: "marketing_pct dan opex_pct (contoh: 0.25 = 25%)" },
  };

  return (
    <AdminShell pageTitle="Pengaturan Integrasi" pageSub="Kredensial & konfigurasi eksternal">
      {loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <Card key={row.key}>
              <CardHeader
                title={known[row.key]?.title || row.key}
                subtitle={known[row.key]?.hint || `Diperbarui ${row.updated_at ? new Date(row.updated_at).toLocaleString("id-ID") : "—"}`}
              />
              <CardBody>
                <textarea
                  value={drafts[row.key] || ""}
                  onChange={(e) => setDrafts({ ...drafts, [row.key]: e.target.value })}
                  rows={5}
                  className="w-full bg-base-800 border border-white/10 rounded p-3 font-mono text-[11px] text-white/80 outline-none focus:border-gold-500"
                  spellCheck={false}
                />
                <div className="text-[10px] text-white/30 mt-2 mb-3">
                  Nilai yang sudah tersimpan disamarkan (••••) — ketik nilai baru untuk mengganti, atau biarkan field lain apa adanya untuk tidak mengubahnya.
                </div>
                <Btn variant="primary" onClick={() => save(row.key)}>
                  {saving === row.key ? "Menyimpan..." : "Simpan"}
                </Btn>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
