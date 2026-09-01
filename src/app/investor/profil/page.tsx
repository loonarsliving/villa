"use client";

import { useEffect, useState } from "react";
import { InvestorShell } from "../_shell";
import { api, ApiError } from "@/lib/api";
import { Card, CardHeader, CardBody, Loading } from "@/components/Card";
import type { MyInvestorProfile } from "@/lib/types";

const labelCls = "block text-[10px] font-medium text-ink/40 tracking-[0.15em] uppercase mb-2";
const inputCls =
  "w-full py-2.5 px-3 border border-ink/10 rounded-lg bg-base-800 text-sm text-ink outline-none focus:border-gold-500 transition-colors mb-5 placeholder:text-ink/20";

export default function InvestorProfilPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [nama, setNama] = useState("");
  const [hp, setHp] = useState("");
  const [bankNama, setBankNama] = useState("");
  const [noRekening, setNoRekening] = useState("");
  const [namaPemilikRekening, setNamaPemilikRekening] = useState("");

  useEffect(() => {
    api
      .get<MyInvestorProfile>("/me/investor-profile")
      .then((p) => {
        setNama(p.nama || "");
        setHp(p.hp || "");
        setBankNama(p.bank_nama || "");
        setNoRekening(p.no_rekening || "");
        setNamaPemilikRekening(p.nama_pemilik_rekening || "");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError("");
    setSuccess(false);
    if (!nama.trim() || !hp.trim()) {
      setError("Nama dan nomor HP wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/me/investor-profile", {
        nama: nama.trim(),
        hp: hp.trim(),
        bank_nama: bankNama.trim() || undefined,
        no_rekening: noRekening.trim() || undefined,
        nama_pemilik_rekening: namaPemilikRekening.trim() || undefined,
      });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal menyimpan profil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <InvestorShell pageTitle="Profil & Rekening" pageSub="Data investor dan rekening tujuan dividen">
      <Card>
        <CardHeader
          title="Rekening Dividen"
          subtitle="Diisi/diperbarui kapan saja — dipakai setiap tanggal 25 untuk transfer bagian dividen bulanan Anda"
        />
        <CardBody>
          {loading ? (
            <Loading />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
            >
              <label className={labelCls}>Nama Lengkap</label>
              <input type="text" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama sesuai identitas" className={inputCls} />

              <label className={labelCls}>Nomor HP / WhatsApp</label>
              <input type="text" value={hp} onChange={(e) => setHp(e.target.value)} placeholder="+62 8xx-xxxx-xxxx" className={inputCls} />

              <label className={labelCls}>Nama Bank</label>
              <input type="text" value={bankNama} onChange={(e) => setBankNama(e.target.value)} placeholder="mis. BCA, Mandiri, BNI" className={inputCls} />

              <label className={labelCls}>Nomor Rekening</label>
              <input type="text" value={noRekening} onChange={(e) => setNoRekening(e.target.value)} placeholder="Nomor rekening tujuan" className={inputCls} />

              <label className={labelCls}>Nama Pemilik Rekening</label>
              <input
                type="text"
                value={namaPemilikRekening}
                onChange={(e) => setNamaPemilikRekening(e.target.value)}
                placeholder="Kosongkan kalau sama dengan Nama Lengkap"
                className={`${inputCls} mb-6`}
              />

              <button
                type="submit"
                disabled={saving}
                className="py-3 px-5 bg-gold-500 hover:opacity-90 disabled:opacity-60 text-base-950 rounded font-semibold text-[11.5px] tracking-[0.08em] uppercase transition-opacity"
              >
                {saving ? "Menyimpan..." : "Simpan"}
              </button>

              {error && <div className="text-xs text-ruby-400 mt-3.5 tracking-wide">{error}</div>}
              {success && !error && <div className="text-xs text-sage-400 mt-3.5 tracking-wide">Tersimpan.</div>}
            </form>
          )}
        </CardBody>
      </Card>
    </InvestorShell>
  );
}
