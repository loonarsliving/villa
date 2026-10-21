"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtCurrencyFull, fmtDate, todayISO } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import { BIAYA_TETAP_BULANAN, PAYROLL_STAF } from "@/lib/cogsStandar";
import { ASUMSI_PER_HARI_DEFAULT, GARANSI_PER_UNIT, TANGGAL_DIVIDEN, akhirBulanISO, hitungRencanaKas } from "@/lib/rencanaKas";
import type { FinanceChecklist, FinanceSummary, InvestorProfile } from "@/lib/types";

/**
 * Rencana kas bulan ini (owner 2026-10-21): uang masuk dari mana, kapan
 * cair, keluar ke dividen, dan berapa sisa di akhir bulan. Hanya di
 * halaman Finance -- investor tetap melihat rumus bagi hasil yang sebenarnya.
 *
 * Saldo rekening tidak bisa dibaca sistem, jadi diketik manual; isian
 * disimpan di browser ini saja (localStorage), bukan di server.
 */

const KUNCI = "finance_rencana_kas_v1";
/** Pemasukan tetap Bu Mega per bulan (villa_investor_terms), diakumulasi dan dibayar tiap 6 bulan (owner 2026-10-21). Hanya indikator. */
const SIMPANAN_MEGA_PER_BULAN = 7_600_000;

interface Isian {
  saldo: string;
  unit: string;
  asumsi: string;
}

function bacaIsian(): Partial<Isian> {
  try {
    return JSON.parse(window.localStorage.getItem(KUNCI) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function simpanIsian(v: Isian) {
  try {
    window.localStorage.setItem(KUNCI, JSON.stringify(v));
  } catch {
    /* penyimpanan browser diblokir: isian tetap jalan, hanya tidak diingat */
  }
}

const angka = (s: string) => {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function Baris({ label, sub, nilai, tone, tebal }: { label: string; sub?: string; nilai: number; tone?: "keluar" | "hasil"; tebal?: boolean }) {
  const warna = tone === "keluar" ? "text-ruby-500" : tone === "hasil" ? (nilai >= 0 ? "text-sage-600" : "text-ruby-500") : "text-ink/80";
  return (
    <div className={`flex items-start justify-between gap-3 py-2 ${tebal ? "font-semibold" : ""}`}>
      <div>
        <div className={tebal ? "text-ink" : "text-ink/70"}>{label}</div>
        {sub && <div className="text-[10px] text-ink/40 font-normal">{sub}</div>}
      </div>
      <div className={`shrink-0 text-right ${warna}`}>
        {tone === "keluar" ? "− " : ""}
        {fmtCurrencyFull(tone === "keluar" ? Math.abs(nilai) : nilai)}
      </div>
    </div>
  );
}

function Isi({ label, nilai, onChange, sub }: { label: string; nilai: string; onChange: (v: string) => void; sub?: string }) {
  return (
    <label className="block">
      <div className="text-[9.5px] text-ink/40 uppercase tracking-wide">{label}</div>
      <input
        inputMode="numeric"
        className="w-full py-2 border-0 border-b border-ink/15 bg-transparent text-[13px] text-ink outline-none focus:border-gold-500"
        value={nilai ? angka(nilai).toLocaleString("id-ID") : ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {sub && <div className="text-[10px] text-ink/35 mt-1">{sub}</div>}
    </label>
  );
}

export function RencanaKas() {
  const hariIni = todayISO();
  const awalBulan = `${hariIni.slice(0, 7)}-01`;
  const akhirBulan = akhirBulanISO(hariIni);
  // Settlement bulan lalu (mis. Agoda 30 hari setelah checkout) masih bisa jatuh bulan ini.
  const dari = useMemo(() => {
    const [y, m] = hariIni.split("-").map(Number);
    const t = y * 12 + (m - 1) - 2;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
  }, [hariIni]);

  const [checklist, setChecklist] = useState<FinanceChecklist | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [unitLunas, setUnitLunas] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);
  const [isian, setIsian] = useState<Isian>({ saldo: "", unit: "", asumsi: String(ASUMSI_PER_HARI_DEFAULT) });

  useEffect(() => {
    const t = bacaIsian();
    setIsian((p) => ({ saldo: t.saldo ?? p.saldo, unit: t.unit ?? p.unit, asumsi: t.asumsi ?? p.asumsi }));
  }, []);

  useEffect(() => {
    setLoading(true);
    setGalat(null);
    Promise.all([
      api.get<FinanceChecklist>(`/finance/checklist-dana?from=${dari}&to=${akhirBulan}`),
      api.get<FinanceSummary>(`/finance/summary?from=${awalBulan}&to=${akhirBulan}`),
      // Hanya admin yang boleh membaca daftar investor; akun finance tanpa
      // akses tetap melihat modul ini dan mengisi jumlah unit sendiri.
      api
        .get<InvestorProfile[]>("/admin/investors")
        .then((rows) => rows.filter((r) => r.unit_id && (r.lunas_pembayaran ?? true)).length)
        .catch(() => null),
    ])
      .then(([c, s, u]) => {
        setChecklist(c);
        setSummary(s);
        setUnitLunas(u);
      })
      .catch((e) => setGalat(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [dari, awalBulan, akhirBulan]);

  function ubah(k: keyof Isian, v: string) {
    const baru = { ...isian, [k]: v };
    setIsian(baru);
    simpanIsian(baru);
  }

  const unitDividen = isian.unit !== "" ? angka(isian.unit) : (unitLunas ?? 0);

  const r = useMemo(() => {
    if (!checklist || !summary) return null;
    return hitungRencanaKas({
      hariIni,
      items: checklist.items,
      pipeline: summary.pipeline?.amount ?? 0,
      netBulanIni: summary.net_revenue,
      saldo: angka(isian.saldo),
      unitDividen,
      asumsiPerHari: angka(isian.asumsi),
    });
  }, [checklist, summary, hariIni, isian.saldo, isian.asumsi, unitDividen]);

  if (loading) return <Loading label="Memuat rencana kas..." />;
  if (galat) return <div className="text-ruby-500 text-xs px-1 py-3 mb-4">Gagal memuat rencana kas: {galat}</div>;
  if (!r) return null;

  const bulanLabel = new Date(`${hariIni}T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
  const cukup = r.selisihDividen >= 0;
  const saldoKosong = angka(isian.saldo) === 0;
  const gajiTotal = PAYROLL_STAF.reduce((s, p) => s + p.orang * p.gajiPerOrang, 0);

  return (
    <div className="mb-6">
      <div className="mb-3">
        <div className="font-serif text-lg text-ink">Rencana Kas — {bulanLabel}</div>
        <div className="text-[10px] text-ink/40">
          Per {fmtDate(hariIni)} · uang sudah di mana, kapan cair, dan ke mana. Gaji dan biaya tetap hanya indikator, tidak dikurangkan.
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader title="Isian" subtitle="Tersimpan di browser ini saja" />
        <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Isi label="Saldo rekening hari ini (Rp)" nilai={isian.saldo} onChange={(v) => ubah("saldo", v)} sub="Sistem tidak bisa membaca bank; ketik dari mutasi." />
          <Isi
            label={`Unit yang dibayar dividen (garansi ${fmtCurrencyFull(GARANSI_PER_UNIT)}/unit)`}
            nilai={isian.unit}
            onChange={(v) => ubah("unit", v)}
            sub={
              isian.unit === ""
                ? unitLunas != null
                  ? `Sekarang ${unitLunas} unit, dari centang lunas di Admin → Investor. Ketik untuk mengganti.`
                  : "Ketik jumlah unit yang dibayar bulan ini."
                : "Diisi manual."
            }
          />
          <Isi
            label="Asumsi pemasukan per hari (Rp, setelah potongan OTA)"
            nilai={isian.asumsi}
            onChange={(v) => ubah("asumsi", v)}
            sub={`Rata-rata nyata bulan ini sampai hari ini: ${fmtCurrencyFull(r.rataRataHarianNyata)}/hari.`}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Sudah cair bulan ini" value={fmtCurrencyFull(r.sudahCairBulanIni)} accent="sage" sub="Yang sudah ditandai diterima" />
        <StatCard label={`Akan cair s/d ${fmtDate(r.akhirBulan)}`} value={fmtCurrencyFull(r.akanCair)} accent="azure" sub={`Sampai tgl ${TANGGAL_DIVIDEN}: ${fmtCurrencyFull(r.akanCairSampaiDividen)}`} />
        <StatCard label={`Dividen garansi (${unitDividen} unit)`} value={fmtCurrencyFull(r.dividen)} accent="gold" sub={`Batas transfer tgl ${TANGGAL_DIVIDEN}, 20.00 WIB`} />
        <StatCard
          label="Sisa kas akhir bulan"
          value={fmtCurrencyFull(r.sisaKasPasti)}
          accent={r.sisaKasPasti >= 0 ? "sage" : "ruby"}
          sub={saldoKosong ? "Isi saldo rekening dulu" : "Saldo + akan cair − dividen"}
        />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`Cukup untuk dividen tanggal ${TANGGAL_DIVIDEN}?`}
          action={saldoKosong ? <Badge tone="pending">ISI SALDO</Badge> : <Badge tone={cukup ? "ok" : "danger"}>{cukup ? "CUKUP" : "KURANG"}</Badge>}
        />
        <div className="px-4 sm:px-5 pb-4 text-[12px] divide-y divide-ink/5">
          <Baris label="Saldo rekening hari ini" nilai={angka(isian.saldo)} />
          <Baris label={`Cair sebelum atau tanggal ${TANGGAL_DIVIDEN}`} nilai={hariIni > r.tanggalDividen ? 0 : r.akanCairSampaiDividen} />
          <Baris label="Tersedia saat transfer dividen" nilai={r.tersediaSaatDividen} tebal />
          <Baris label={`Dividen garansi ${unitDividen} unit × ${fmtCurrencyFull(GARANSI_PER_UNIT)}`} nilai={r.dividen} tone="keluar" />
          <Baris label={cukup ? "Sisa setelah dividen" : "Kekurangan"} nilai={r.selisihDividen} tone="hasil" tebal />
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Akan cair sampai akhir bulan" subtitle="Menurut jadwal settlement per channel" />
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-ink/40 border-b border-ink/10">
                <th className="px-4 py-2">Perkiraan cair</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2 text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {r.akanCairPerBaris.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-5 text-center text-ink/30">
                    Tidak ada pencairan terjadwal sampai akhir bulan.
                  </td>
                </tr>
              )}
              {r.akanCairPerBaris.map((b) => (
                <tr key={`${b.sumber}-${b.tanggal}`} className="border-b border-ink/5">
                  <td className="px-4 py-2">{fmtDate(b.tanggal)}</td>
                  <td className="px-3 py-2">{b.sumber}</td>
                  <td className="px-3 py-2">{b.booking}</td>
                  <td className="px-3 py-2 text-right">{fmtCurrencyFull(b.jumlah)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.lewatTempoBooking > 0 && (
          <div className="px-4 py-3 text-[10.5px] text-gold-700 leading-relaxed">
            Tidak dihitung di atas: {r.lewatTempoBooking} booking senilai {fmtCurrencyFull(r.lewatTempo)} sudah lewat tanggal perkiraan cair (atau dibayar langsung lewat website)
            tapi belum ditandai diterima. Kemungkinan besar sudah ada di saldo rekening; tandai di Checklist Dana supaya angkanya rapi.
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title="Dana yang menyusul" subtitle="Belum jadi kas bulan ini" />
        <div className="px-4 sm:px-5 pb-4 text-[12px] divide-y divide-ink/5">
          {r.tertahanPerChannel.map((c) => (
            <Baris
              key={c.sumber}
              label={`Tertahan di ${c.sumber}`}
              sub={`${c.booking} booking, cair ${c.paling_awal ? fmtDate(c.paling_awal) : "—"} s/d ${c.paling_akhir ? fmtDate(c.paling_akhir) : "—"}`}
              nilai={c.jumlah}
            />
          ))}
          {r.tanpaJadwal > 0 && <Baris label="Tanpa jadwal cair" sub="Aturan settlement channel ini belum diisi" nilai={r.tanpaJadwal} />}
          <Baris
            label={`Potensi pemasukan ${r.sisaHari} hari terakhir`}
            sub={`Asumsi ${fmtCurrencyFull(angka(isian.asumsi))}/hari = ${fmtCurrencyFull(r.potensiAsumsi)}; sudah terbooking ${fmtCurrencyFull(r.potensiTerbooking)}, masih dicari ${fmtCurrencyFull(r.potensiTambahan)}. Sebagian besar baru cair bulan depan.`}
            nilai={r.potensiTotal}
          />
          <Baris label="Sisa kas akhir bulan" nilai={r.sisaKasPasti} />
          <Baris label="Posisi total termasuk dana yang menyusul" nilai={r.posisiTotal} tone="hasil" tebal />
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Indikator kewajiban bulan ini" subtitle="Hanya pengingat, tidak dikurangkan dari sisa kas" />
        <div className="px-4 sm:px-5 pb-4 text-[12px] divide-y divide-ink/5">
          <Baris label={`Gaji staf (${PAYROLL_STAF.reduce((s, p) => s + p.orang, 0)} orang)`} nilai={gajiTotal} />
          {BIAYA_TETAP_BULANAN.map((k) => (
            <Baris key={k.key} label={k.label} nilai={k.nominal} />
          ))}
          <Baris label="Simpanan Bu Mega (diakumulasi, dibayar tiap 6 bulan)" nilai={SIMPANAN_MEGA_PER_BULAN} />
        </div>
        <div className="px-4 sm:px-5 pb-4 text-[10px] text-ink/40 leading-relaxed">
          Selama masa garansi, dividen dihitung Rp5.000.000 per unit tetap dan didahulukan dari rumus bagi hasil. Tampilan ini hanya untuk Finance; investor tetap melihat laporan
          bagi hasil yang sebenarnya. Pemasukan 22 s/d akhir bulan di atas adalah asumsi, bukan angka dari booking.
        </div>
      </Card>
    </div>
  );
}
