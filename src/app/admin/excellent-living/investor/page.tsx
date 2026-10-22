"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "../../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Empty } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";

interface Data {
  investors: { id: string; nama: string; email: string; hp: string | null; is_active: boolean }[];
  links: { id: string; user_id: string; loonars_unit_id: string }[];
  units: { id: string; blok: string; tipe: string | null; status: string; pembeli: string | null }[];
}

/**
 * Investor Excellent Living = akun role el_investor yang ditautkan admin ke
 * unit Loonars 2 (proyek LNR2 di Mkhsistem). Data unit & pembeliannya
 * dibaca langsung dari tabel Mkhsistem, tidak disalin.
 */
export default function ElInvestorAdminPage() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<{ user_id: string; loonars_unit_id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<Data>("/el/admin/investors").then(setData).catch((e) => toast("⚠", "Gagal memuat", e instanceof Error ? e.message : String(e), "ruby"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const unitById = new Map((data?.units ?? []).map((u) => [u.id, u]));

  async function tautkan() {
    if (!form?.user_id || !form.loonars_unit_id) {
      toast("⚠", "Lengkapi form", "Pilih investor dan unit.", "ruby");
      return;
    }
    setBusy(true);
    try {
      await api.post("/el/admin/investors/link", form);
      toast("✓", "Tertaut", "Unit ditautkan ke investor.", "sage");
      setForm(null);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  async function lepas(id: string) {
    if (!confirm("Lepas tautan unit ini dari investor?")) return;
    try {
      await api.delete(`/el/admin/investors/link?id=${encodeURIComponent(id)}`);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    }
  }

  return (
    <AdminShell pageTitle="Investor Excellent Living" pageSub="Data unit dari Mkhsistem (Loonars 2)">
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card className="mb-5">
            <CardHeader
              title="Investor"
              subtitle="Akun dibuat di menu Pengguna dengan role Investor Excellent Living"
              action={<Btn variant="primary" onClick={() => setForm({ user_id: data.investors[0]?.id ?? "", loonars_unit_id: "" })}>+ Tautkan Unit</Btn>}
            />
            {data.investors.length === 0 ? (
              <Empty label="Belum ada akun investor Excellent Living" />
            ) : (
              <div className="divide-y divide-ink/[0.05]">
                {data.investors.map((inv) => {
                  const milik = data.links.filter((l) => l.user_id === inv.id);
                  return (
                    <div key={inv.id} className="px-4 sm:px-5 py-3">
                      <div className="text-[13px] font-semibold text-ink">{inv.nama}{!inv.is_active && " (nonaktif)"}</div>
                      <div className="text-[11px] text-ink/40">{inv.email}{inv.hp ? ` · ${inv.hp}` : ""}</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {milik.length === 0 && <span className="text-[11px] text-ink/30">Belum ada unit</span>}
                        {milik.map((l) => {
                          const u = unitById.get(l.loonars_unit_id);
                          return (
                            <span key={l.id} className="inline-flex items-center gap-1.5 text-[11px] bg-gold-500/10 text-gold-600 px-2 py-1 rounded-full">
                              {u?.blok ?? "?"}
                              <button onClick={() => lepas(l.id)} className="text-ink/40 hover:text-ruby-500" aria-label="Lepas tautan">✕</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Unit Loonars 2" subtitle="Dikelola di Mkhsistem (Siteplan)" />
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[9.5px] uppercase tracking-wider text-ink/30">
                    <th className="px-3.5 py-2.5">Unit</th>
                    <th className="px-3.5 py-2.5">Tipe</th>
                    <th className="px-3.5 py-2.5">Status</th>
                    <th className="px-3.5 py-2.5">Pembeli (Mkhsistem)</th>
                    <th className="px-3.5 py-2.5">Investor Tertaut</th>
                  </tr>
                </thead>
                <tbody>
                  {data.units.map((u) => {
                    const tertaut = data.links.filter((l) => l.loonars_unit_id === u.id).map((l) => data.investors.find((i) => i.id === l.user_id)?.nama ?? "?");
                    return (
                      <tr key={u.id} className="border-t border-ink/[0.05]">
                        <td className="px-3.5 py-2.5 font-semibold text-ink">{u.blok}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{u.tipe ?? "—"}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{u.status}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{u.pembeli ?? "—"}</td>
                        <td className="px-3.5 py-2.5 text-ink/60">{tertaut.join(", ") || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="text-[11px] text-ink/40 mt-3">
            Akun investor baru: buat di <Link href="/admin/users" className="text-gold-600 underline">Pengguna</Link> dengan role &quot;Investor Excellent Living&quot;, lalu tautkan unitnya di sini.
          </div>
        </>
      )}

      <Modal
        open={!!form}
        title="Tautkan Unit ke Investor"
        onClose={() => setForm(null)}
        footer={<><Btn onClick={() => setForm(null)}>Batal</Btn><Btn variant="primary" disabled={busy} onClick={tautkan}>Simpan</Btn></>}
      >
        {form && data && (
          <>
            <Field label="Investor">
              <select className={inputCls} value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                <option value="">Pilih investor</option>
                {data.investors.map((i) => <option key={i.id} value={i.id}>{i.nama} — {i.email}</option>)}
              </select>
            </Field>
            <Field label="Unit Loonars 2">
              <select className={inputCls} value={form.loonars_unit_id} onChange={(e) => setForm({ ...form, loonars_unit_id: e.target.value })}>
                <option value="">Pilih unit</option>
                {data.units.map((u) => <option key={u.id} value={u.id}>{u.blok}{u.pembeli ? ` — pembeli: ${u.pembeli}` : ""}</option>)}
              </select>
            </Field>
          </>
        )}
      </Modal>
    </AdminShell>
  );
}
