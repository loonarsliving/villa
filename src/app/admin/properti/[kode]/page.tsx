"use client";

import { use, useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "../../_shell";
import { localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtCurrencyFull } from "@/lib/format";
import { Card, CardBody, CardHeader, Loading, Badge } from "@/components/Card";
import { Field, inputCls, Btn } from "@/components/Modal";

interface Status {
  kode: string;
  nama: string;
  aktif: boolean;
  siap: boolean;
  cloudbeds: { terisi: boolean; via_env: boolean; property_id: string | null };
  kamar: { jumlah: number; maintenance: number };
  tipe: { code: string; name: string; jumlah: number; min_rate: number | null; max_rate: number | null }[];
  email: { terisi: boolean; user: string | null };
  qris: { terisi: boolean };
  harga: { autopush: boolean; batas_lengkap: boolean };
}

function bacaBerkas(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Gagal membaca berkas"));
    r.readAsDataURL(file);
  });
}

/** Skala gambar QRIS ke lebar maksimal 900px (JPEG) supaya kecil dan tetap terbaca. */
async function perkecilGambar(dataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Berkas bukan gambar yang bisa dibaca"));
    img.src = dataUrl;
  });
  const skala = Math.min(1, 900 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * skala);
  c.height = Math.round(img.height * skala);
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function Langkah({ no, judul, selesai, children }: { no: number; judul: string; selesai: boolean; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <CardHeader
        title={`${no}. ${judul}`}
        action={<Badge tone={selesai ? "ok" : "pending"}>{selesai ? "Selesai" : "Belum"}</Badge>}
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

/**
 * Wizard pengaturan satu properti (owner 2026-11-04: "saya tinggal memasukkan
 * api cloudbeds, email dan password"). Setiap isian diuji dulu sebelum
 * disimpan; setelah semua langkah selesai, klik Aktifkan.
 */
export default function PengaturanPropertiPage({ params }: { params: Promise<{ kode: string }> }) {
  const { kode: kodeMentah } = use(params);
  const kode = decodeURIComponent(kodeMentah).toUpperCase();
  const toast = useToast();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cb, setCb] = useState({ api_key: "", property_id: "" });
  const [em, setEm] = useState({ host: "imap.hostinger.com", port: "993", user: "", password: "" });
  const [batas, setBatas] = useState<Record<string, { min: string; max: string }>>({});
  const [hasil, setHasil] = useState<string | null>(null);

  const muat = useCallback(() => {
    localApi<Status>(`/api/admin/properti/konfigurasi?kode=${kode}`)
      .then((s) => {
        setSt(s);
        setBatas(Object.fromEntries(s.tipe.map((t) => [t.code, { min: t.min_rate ? String(t.min_rate) : "", max: t.max_rate ? String(t.max_rate) : "" }])));
        setGalat(null);
      })
      .catch((e) => setGalat(e instanceof Error ? e.message : String(e)));
  }, [kode]);
  useEffect(muat, [muat]);

  async function jalankan(nama: string, fn: () => Promise<string | void>) {
    setBusy(nama);
    setHasil(null);
    try {
      const pesan = await fn();
      if (pesan) setHasil(pesan);
      toast("✓", "Berhasil", pesan || "Tersimpan.", "sage");
      muat();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(null);
    }
  }

  const post = (body: Record<string, unknown>) => localApi<Record<string, unknown>>("/api/admin/properti/konfigurasi", { method: "POST", body: JSON.stringify({ kode, ...body }) });

  if (galat) {
    return (
      <AdminShell pageTitle="Pengaturan Properti">
        <div className="rounded-xl border border-ruby-500/30 bg-ruby-500/10 px-4 py-3 text-[12px] text-ruby-400">{galat}</div>
      </AdminShell>
    );
  }
  if (!st) {
    return (
      <AdminShell pageTitle="Pengaturan Properti">
        <Loading />
      </AdminShell>
    );
  }

  const cloudbedsOk = st.cloudbeds.terisi;
  const kamarOk = st.kamar.jumlah > 0;

  return (
    <AdminShell pageTitle={st.nama} pageSub={`Pengaturan properti · kode ${st.kode} · ${st.siap ? "SUDAH AKTIF" : "belum diaktifkan"}`}>
      <p className="text-[12px] text-ink/50 mb-4 max-w-2xl">
        Isi langkah satu per satu. Setiap isian dites dulu ke Cloudbeds / email sebelum disimpan, dan kunci atau password tidak pernah ditampilkan kembali.
        Properti baru ikut sinkron booking dan harga otomatis begitu langkah 1 selesai.
      </p>

      <Langkah no={1} judul="Cloudbeds" selesai={cloudbedsOk}>
        {cloudbedsOk && (
          <div className="text-[12px] text-ink/60 mb-3">
            Terhubung{st.cloudbeds.via_env ? " (lewat pengaturan server lama)" : st.cloudbeds.property_id ? ` (Property ID ${st.cloudbeds.property_id})` : ""}. Isi ulang di bawah hanya bila kunci diganti.
          </div>
        )}
        <Field label="API key Cloudbeds">
          <input className={inputCls} type="password" autoComplete="off" placeholder="cbat_…" value={cb.api_key} onChange={(e) => setCb({ ...cb, api_key: e.target.value })} />
        </Field>
        <Field label="Property ID (opsional — diisi otomatis bila akun hanya punya satu properti)">
          <input className={inputCls} value={cb.property_id} onChange={(e) => setCb({ ...cb, property_id: e.target.value })} />
        </Field>
        <Btn
          variant="primary"
          disabled={busy !== null || !cb.api_key.trim()}
          onClick={() =>
            jalankan("cloudbeds", async () => {
              const r = (await post({ aksi: "cloudbeds", api_key: cb.api_key, property_id: cb.property_id })) as { nama_hotel: string | null; jumlah_kamar: number; tipe: { nama: string; jumlah: number }[] };
              setCb({ api_key: "", property_id: "" });
              return `Terhubung ke ${r.nama_hotel ?? "Cloudbeds"}: ${r.jumlah_kamar} kamar (${r.tipe.map((t) => `${t.nama} ${t.jumlah}`).join(", ")}).`;
            })
          }
        >
          {busy === "cloudbeds" ? "Menguji…" : "Tes & Simpan"}
        </Btn>
      </Langkah>

      <Langkah no={2} judul="Kamar dari Cloudbeds" selesai={kamarOk}>
        <div className="text-[12px] text-ink/60 mb-3">
          {kamarOk ? `${st.kamar.jumlah} kamar terdaftar (${st.kamar.maintenance} masih maintenance — manager membukanya lewat Kesiapan Kamar).` : "Kamar dibuat otomatis dari daftar kamar di Cloudbeds. Semua kamar baru berstatus maintenance (tertutup) sampai manager membukanya."}
        </div>
        {st.tipe.length > 0 && (
          <ul className="text-[12px] text-ink/60 mb-3 list-disc pl-5">
            {st.tipe.map((t) => (
              <li key={t.code}>{t.name}: {t.jumlah} kamar</li>
            ))}
          </ul>
        )}
        <Btn
          variant="primary"
          disabled={busy !== null || !cloudbedsOk}
          onClick={() =>
            jalankan("sinkron", async () => {
              const r = (await localApi<{ kamar: { kamar_dibuat: string[]; tipe_dibuat: string[]; dipetakan: number; room_belum_dipetakan: string[] }; errors: string[] }>(`/api/admin/cloudbeds-el/sync?properti=${kode}`, { method: "POST" }));
              const bag = [`${r.kamar.kamar_dibuat.length} kamar dibuat`, `${r.kamar.tipe_dibuat.length} tipe baru`, `${r.kamar.dipetakan} dipetakan`];
              if (r.kamar.room_belum_dipetakan.length) bag.push(`belum cocok: ${r.kamar.room_belum_dipetakan.join(", ")}`);
              if (r.errors.length) bag.push(`peringatan: ${r.errors.join("; ")}`);
              return bag.join(" · ");
            })
          }
        >
          {busy === "sinkron" ? "Mengambil…" : kamarOk ? "Sinkron Ulang" : "Ambil Kamar dari Cloudbeds"}
        </Btn>
      </Langkah>

      <Langkah no={3} judul="Email notifikasi pembayaran (BTN)" selesai={st.email.terisi}>
        <div className="text-[12px] text-ink/60 mb-3">
          {st.email.terisi ? `Tersimpan untuk ${st.email.user}. ` : ""}Kotak email yang menerima notifikasi &ldquo;Payment Merchant Success&rdquo; dari QRIS BTN properti ini. Sistem membacanya tiap 5 menit untuk mengonfirmasi pembayaran booking online otomatis.
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6">
          <Field label="Server IMAP">
            <input className={inputCls} value={em.host} onChange={(e) => setEm({ ...em, host: e.target.value })} />
          </Field>
          <Field label="Port">
            <input className={inputCls} value={em.port} onChange={(e) => setEm({ ...em, port: e.target.value })} />
          </Field>
          <Field label="Alamat email">
            <input className={inputCls} type="email" autoComplete="off" value={em.user} onChange={(e) => setEm({ ...em, user: e.target.value })} />
          </Field>
          <Field label="Password email">
            <input className={inputCls} type="password" autoComplete="new-password" value={em.password} onChange={(e) => setEm({ ...em, password: e.target.value })} />
          </Field>
        </div>
        <Btn
          variant="primary"
          disabled={busy !== null || !em.user.trim() || !em.password}
          onClick={() =>
            jalankan("email", async () => {
              const r = (await post({ aksi: "email", host: em.host, port: Number(em.port) || 993, user: em.user, password: em.password })) as { notifikasi_belum_dibaca: number };
              setEm({ ...em, password: "" });
              return `Login email berhasil (${r.notifikasi_belum_dibaca} notifikasi pembayaran belum dibaca saat ini).`;
            })
          }
        >
          {busy === "email" ? "Menguji login…" : "Tes Login & Simpan"}
        </Btn>
      </Langkah>

      <Langkah no={4} judul="QRIS properti" selesai={st.qris.terisi}>
        <div className="text-[12px] text-ink/60 mb-3">Unggah gambar QRIS properti ini (PNG/JPG). Dipakai kasir Front Desk dan pembayaran booking online.</div>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy !== null}
          className="text-[12px] text-ink/70"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            jalankan("qris", async () => {
              const kecil = await perkecilGambar(await bacaBerkas(f));
              await post({ aksi: "qris", data_url: kecil });
              return "QRIS tersimpan.";
            });
          }}
        />
      </Langkah>

      <Langkah no={5} judul="Harga (dynamic pricing)" selesai={st.harga.batas_lengkap}>
        <div className="text-[12px] text-ink/60 mb-3">
          Harga dasar diambil dari harga di Cloudbeds; sistem menaik-turunkannya sesuai okupansi dalam batas bawah dan atas di bawah. Tanpa batas lengkap, harga tidak dihitung dan tidak dikirim.
        </div>
        {st.tipe.length === 0 ? (
          <div className="text-[12px] text-ink/40">Selesaikan langkah 2 dulu.</div>
        ) : (
          <div className="space-y-2 mb-3">
            {st.tipe.map((t) => (
              <div key={t.code} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="w-48 text-ink/70">{t.name}</span>
                <input className="w-28 border-b border-ink/10 bg-transparent py-1" inputMode="numeric" placeholder="batas bawah" value={batas[t.code]?.min ?? ""} onChange={(e) => setBatas({ ...batas, [t.code]: { ...(batas[t.code] ?? { min: "", max: "" }), min: e.target.value.replace(/\D/g, "") } })} />
                <input className="w-28 border-b border-ink/10 bg-transparent py-1" inputMode="numeric" placeholder="batas atas" value={batas[t.code]?.max ?? ""} onChange={(e) => setBatas({ ...batas, [t.code]: { ...(batas[t.code] ?? { min: "", max: "" }), max: e.target.value.replace(/\D/g, "") } })} />
                <Btn
                  disabled={busy !== null}
                  onClick={() =>
                    jalankan(`batas-${t.code}`, async () => {
                      await localApi(`/api/admin/el-harga-ai?properti=${kode}`, { method: "POST", body: JSON.stringify({ aksi: "batas", kode: t.code, min_rate: Number(batas[t.code]?.min), max_rate: Number(batas[t.code]?.max) }) });
                      return `Batas ${t.name} disimpan: ${fmtCurrencyFull(Number(batas[t.code]?.min))} – ${fmtCurrencyFull(Number(batas[t.code]?.max))}.`;
                    })
                  }
                >
                  Simpan
                </Btn>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <Btn
            disabled={busy !== null || !st.harga.batas_lengkap}
            onClick={() =>
              jalankan("hitung", async () => {
                await localApi(`/api/admin/el-harga-ai?properti=${kode}`, { method: "POST", body: JSON.stringify({ aksi: "jalankan" }) });
                return "Harga dihitung (belum dikirim ke Cloudbeds).";
              })
            }
          >
            Hitung Harga Sekarang
          </Btn>
          <Btn
            disabled={busy !== null || !st.harga.batas_lengkap}
            variant={st.harga.autopush ? "ghost" : "primary"}
            onClick={() =>
              jalankan("autopush", async () => {
                await localApi(`/api/admin/el-harga-ai?properti=${kode}`, { method: "POST", body: JSON.stringify({ aksi: "autopush", nilai: !st.harga.autopush }) });
                return st.harga.autopush ? "Kirim otomatis ke Cloudbeds DIMATIKAN." : "Kirim otomatis ke Cloudbeds DINYALAKAN (tiap malam, dalam batas bawah/atas).";
              })
            }
          >
            {st.harga.autopush ? "Matikan Kirim Otomatis ke Cloudbeds" : "Nyalakan Kirim Otomatis ke Cloudbeds"}
          </Btn>
          <span className="text-[11px] text-ink/40">Kirim otomatis {st.harga.autopush ? "MENYALA" : "mati"}.</span>
        </div>
      </Langkah>

      <Langkah no={6} judul="Aktifkan properti" selesai={st.siap}>
        <div className="text-[12px] text-ink/60 mb-3">
          Setelah aktif: Front Desk, Booking, Housekeeping, Chat, Kasir, Finance, dan notifikasi WA properti ini terbuka untuk akun yang Anda buat di{" "}
          <button className="underline text-gold-500" onClick={() => router.push("/admin/users")}>Pengguna &amp; Role</button>. Semua kamar tetap tertutup sampai manager menekan Kamar Siap.
          {!st.email.terisi && <div className="text-gold-600 mt-1">Catatan: email pembayaran belum diisi — booking online belum bisa dikonfirmasi otomatis.</div>}
          {!st.qris.terisi && <div className="text-gold-600 mt-1">Catatan: QRIS belum diunggah — kasir dan pembayaran online belum bisa dipakai.</div>}
        </div>
        {st.siap ? (
          <div className="flex gap-2">
            <Btn onClick={() => router.push("/pilih-properti")}>Buka Properti Ini</Btn>
            <Btn disabled={busy !== null} onClick={() => jalankan("nonaktif", async () => { await post({ aksi: "nonaktifkan" }); return "Properti dinonaktifkan (fitur operasional ditutup)."; })}>Nonaktifkan</Btn>
          </div>
        ) : (
          <Btn variant="primary" disabled={busy !== null || !cloudbedsOk || !kamarOk} onClick={() => jalankan("aktifkan", async () => { await post({ aksi: "aktifkan" }); return "Properti aktif."; })}>
            {busy === "aktifkan" ? "Mengaktifkan…" : "Aktifkan Properti"}
          </Btn>
        )}
      </Langkah>

      {hasil && <div className="mt-2 text-[12px] text-sage-400">{hasil}</div>}
    </AdminShell>
  );
}
