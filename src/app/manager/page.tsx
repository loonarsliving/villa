"use client";

import { useCallback, useEffect, useState } from "react";
import { ManagerShell } from "./_shell";
import { LABEL_CHECKLIST, tambahHari } from "./_checklist";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { KamarKesiapan, KesiapanKamarResponse } from "@/lib/types";

/**
 * Kesiapan Kamar -- modul satu-satunya role manager.
 *
 * Kamar TERBUKA secara bawaan (keputusan owner 2026-10-02). Manager mengecek
 * 10 poin lalu memilih:
 *   - "Kamar Maintenance": kamar ditutup di Cloudbeds (room block
 *     out_of_service), jadi tidak tampil di OTA, dan tidak dijual di
 *     loonars.id maupun walk-in;
 *   - "Kamar Siap": kamar dibuka lagi / tetap dijual.
 */
export default function KesiapanKamarPage() {
  const toast = useToast();
  const [data, setData] = useState<KesiapanKamarResponse | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pilih, setPilih] = useState<KamarKesiapan | null>(null);

  const muat = useCallback(async () => {
    try {
      setData(await api.get<KesiapanKamarResponse>("/manager/kamar"));
      setGalat(null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Gagal memuat data kamar");
    }
  }, []);

  useEffect(() => {
    muat();
  }, [muat]);

  const tertutup = data?.kamar.filter((k) => k.maintenance && !k.maintenance.berakhir) ?? [];
  const tutupCb = data?.kamar.filter((k) => !tertutup.includes(k) && blokHariIni(k, data.hari_ini)) ?? [];

  return (
    <ManagerShell pageTitle="Kesiapan Kamar" pageSub="Checklist kamar & buka-tutup penjualan di Cloudbeds">
      {galat && <div className="mb-4 rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-4 py-3 text-[12px] text-ruby-400">{galat}</div>}
      {!data && !galat ? (
        <Loading />
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Card className="px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-ink/40">Dijual</div>
              <div className="font-serif text-2xl text-sage-500">{data.kamar.length - tertutup.length - tutupCb.length}</div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-ink/40">Maintenance</div>
              <div className="font-serif text-2xl text-ruby-400">{tertutup.length}</div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-ink/40">Ditutup di Cloudbeds</div>
              <div className="font-serif text-2xl text-gold-500">{tutupCb.length}</div>
            </Card>
          </div>
          {!data.cloudbeds_terbaca && (
            <div className="mb-4 text-[11px] text-ink/40">Blokir di Cloudbeds tidak terbaca saat ini — kamar yang ditutup langsung di Cloudbeds mungkin tidak tertandai.</div>
          )}

          <Card>
            <CardHeader title="Semua Kamar" subtitle="Ketuk kamar untuk mengecek" />
            {data.kamar.map((k) => (
              <BarisKamar key={k.unit_id} kamar={k} hariIni={data.hari_ini} onClick={() => setPilih(k)} />
            ))}
          </Card>
        </>
      ) : null}

      {pilih && data && (
        <ModalCek
          kamar={pilih}
          hariIni={data.hari_ini}
          checklist={data.checklist}
          maksMalam={data.maks_malam}
          onClose={() => setPilih(null)}
          onSelesai={(pesan, ok) => {
            toast(ok ? "✓" : "⚠", ok ? "Tersimpan" : "Gagal", pesan, ok ? "sage" : "ruby");
            if (ok) setPilih(null);
            muat();
          }}
        />
      )}
    </ManagerShell>
  );
}

/** Blok Cloudbeds (di luar modul ini) yang menutup kamar pada hari ini. */
function blokHariIni(kamar: KamarKesiapan, hariIni: string) {
  return kamar.blok_cloudbeds_lain.find((b) => (b.startDate ?? "") <= hariIni && hariIni <= (b.endDate ?? ""));
}

function BarisKamar({ kamar, hariIni, onClick }: { kamar: KamarKesiapan; hariIni: string; onClick: () => void }) {
  const mt = kamar.maintenance;
  const aktif = mt && !mt.berakhir;
  const blokCb = !aktif ? blokHariIni(kamar, hariIni) : undefined;
  const cek = kamar.cek_terakhir;
  const menginap = kamar.booking_mendatang.find((b) => b.sedang_menginap);
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 hover:bg-base-800"
    >
      <div className="w-11 h-11 shrink-0 rounded-lg bg-base-800 border border-ink/10 flex items-center justify-center font-serif text-[15px] text-ink">
        {kamar.nomor}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {aktif ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-ruby-500/15 text-ruby-400">
              MAINTENANCE s/d {fmtDate(mt.tutup_sampai)}
            </span>
          ) : blokCb ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gold-500/15 text-gold-500">
              DITUTUP DI CLOUDBEDS{blokCb.endDate ? ` s/d ${fmtDate(blokCb.endDate)}` : ""}
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sage-500/15 text-sage-500">DIJUAL</span>
          )}
          {menginap && <span className="text-[10px] text-ink/40">ada tamu menginap</span>}
          {!kamar.cloudbeds_terpetakan && <span className="text-[10px] text-ruby-400">belum terhubung Cloudbeds</span>}
        </div>
        <div className="text-[11px] text-ink/40 mt-1 truncate">
          {kamar.tipe ?? "—"}
          {aktif && ` · ${mt.alasan}`}
          {blokCb && ` · ditutup langsung di Cloudbeds${blokCb.alasan ? ` (${blokCb.alasan})` : ""}`}
          {!aktif && cek && ` · cek terakhir ${fmtDateTime(cek.created_at)}${cek.dicek_oleh_nama ? ` oleh ${cek.dicek_oleh_nama}` : ""}`}
          {!aktif && !cek && " · belum pernah dicek"}
        </div>
      </div>
      <span className="text-ink/20 text-sm">›</span>
    </button>
  );
}

function ModalCek({
  kamar,
  hariIni,
  checklist,
  maksMalam,
  onClose,
  onSelesai,
}: {
  kamar: KamarKesiapan;
  hariIni: string;
  checklist: string[];
  maksMalam: number;
  onClose: () => void;
  onSelesai: (pesan: string, ok: boolean) => void;
}) {
  const mt = kamar.maintenance && !kamar.maintenance.berakhir ? kamar.maintenance : null;
  const [centang, setCentang] = useState<Record<string, boolean>>(() => Object.fromEntries(checklist.map((k) => [k, false])));
  const [catatan, setCatatan] = useState("");
  const [mulai, setMulai] = useState(hariIni);
  const [sampai, setSampai] = useState(mt ? mt.tutup_sampai : tambahHari(hariIni, 1));
  const [kirim, setKirim] = useState<"siap" | "maintenance" | null>(null);

  const semuaBaik = checklist.every((k) => centang[k]);

  async function simpan(hasil: "siap" | "maintenance") {
    setKirim(hasil);
    try {
      const r = await api.post<{ pesan: string }>("/manager/kamar/cek", {
        unit_id: kamar.unit_id,
        hasil,
        checklist: centang,
        catatan,
        tutup_mulai: mulai,
        tutup_sampai: sampai,
      });
      onSelesai(r.pesan, true);
    } catch (e) {
      onSelesai(e instanceof Error ? e.message : "Gagal menyimpan", false);
    } finally {
      setKirim(null);
    }
  }

  return (
    <Modal
      open
      title={`Cek Unit ${kamar.nomor}`}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => simpan("maintenance")}
            disabled={kirim !== null || !catatan.trim()}
            className={`px-4 py-2 rounded text-[11.5px] font-semibold tracking-wide bg-ruby-500/15 text-ruby-400 border border-ruby-500/30 ${
              kirim !== null || !catatan.trim() ? "opacity-50 cursor-not-allowed" : "hover:bg-ruby-500/25"
            }`}
          >
            {kirim === "maintenance" ? "Menutup..." : mt ? "Perpanjang Maintenance" : "Kamar Maintenance"}
          </button>
          <Btn variant="primary" onClick={() => simpan("siap")} disabled={kirim !== null || !semuaBaik}>
            {kirim === "siap" ? "Menyimpan..." : "Kamar Siap"}
          </Btn>
        </>
      }
    >
      {!mt && kamar.blok_cloudbeds_lain.length > 0 && (
        <div className="mb-4 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2.5 text-[11.5px] text-gold-500">
          Kamar ini ditutup langsung di Cloudbeds (bukan dari halaman ini):{" "}
          {kamar.blok_cloudbeds_lain
            .map((b) => `${b.startDate ? fmtDate(b.startDate) : "?"} – ${b.endDate ? fmtDate(b.endDate) : "?"}${b.alasan ? ` (${b.alasan})` : ""}`)
            .join("; ")}
          . Pada tanggal itu kamar tidak dijual. Tekan Kamar Siap (10 poin dicentang) untuk membukanya — hanya kamar ini yang dibuka, kamar lain di blokir yang sama tetap tertutup.
        </div>
      )}

      {mt && (
        <div className="mb-4 rounded-lg border border-ruby-500/30 bg-ruby-500/10 px-3 py-2.5 text-[11.5px] text-ruby-400">
          Sedang maintenance {fmtDate(mt.tutup_mulai)} s/d {fmtDate(mt.tutup_sampai)} — {mt.alasan}
          {mt.ditutup_oleh_nama ? ` (${mt.ditutup_oleh_nama})` : ""}. Tekan <b>Kamar Siap</b> untuk menjualnya lagi.
        </div>
      )}

      <Field label="Checklist (centang kalau baik)">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {checklist.map((k) => (
            <label key={k} className="flex items-center gap-2 py-1.5 text-[12.5px] text-ink/80 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-sage-500"
                checked={!!centang[k]}
                onChange={(e) => setCentang({ ...centang, [k]: e.target.checked })}
              />
              {LABEL_CHECKLIST[k] ?? k}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCentang(Object.fromEntries(checklist.map((k) => [k, true])))}
          className="mt-2 text-[11px] text-gold-500"
        >
          Centang semua
        </button>
      </Field>

      <Field label="Catatan / kerusakan (wajib untuk maintenance)">
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          placeholder="mis. AC tidak dingin, kran wastafel bocor"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
        />
      </Field>

      <Field label={mt ? "Perpanjang tutup sampai (malam terakhir)" : "Kalau maintenance: tutup dari – sampai (malam terakhir)"}>
        <div className="flex items-center gap-2">
          <input type="date" className={inputCls} value={mulai} min={hariIni} disabled={!!mt} onChange={(e) => setMulai(e.target.value)} />
          <span className="text-ink/30 text-xs">s/d</span>
          <input
            type="date"
            className={inputCls}
            value={sampai}
            min={mulai}
            max={tambahHari(mt ? mt.tutup_mulai : mulai, maksMalam - 1)}
            onChange={(e) => setSampai(e.target.value)}
          />
        </div>
        <div className="text-[10.5px] text-ink/30 mt-1.5">
          Paling lama {maksMalam} malam sekali tutup. Kalau sudah beres lebih cepat, tekan Kamar Siap.
        </div>
      </Field>

      {kamar.booking_mendatang.length > 0 && (
        <div className="text-[11px] text-ink/40">
          Booking di kamar ini:{" "}
          {kamar.booking_mendatang
            .map((b) => `${fmtDate(b.tgl_checkin)} – ${b.tgl_checkout ? fmtDate(b.tgl_checkout) : "?"}${b.sedang_menginap ? " (sedang menginap)" : ""}`)
            .join(", ")}
          . Kamar tidak bisa ditutup pada tanggal itu.
        </div>
      )}

      {!semuaBaik && (
        <div className="text-[10.5px] text-ink/30 mt-3">Kamar Siap baru bisa ditekan kalau ke-10 poin sudah dicentang baik.</div>
      )}
    </Modal>
  );
}
