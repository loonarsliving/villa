"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError, localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { CloudbedsMapping, CloudbedsLogRow, Unit } from "@/lib/types";

interface LiveCloudbedsRoom {
  roomID: string;
  roomName: string;
  roomTypeName?: string;
}

export default function AdminCloudbedsPage() {
  const toast = useToast();
  const [mapping, setMapping] = useState<CloudbedsMapping[]>([]);
  const [log, setLog] = useState<CloudbedsLogRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ room_id: "", room_name: "", unit_id: "" });
  const [liveRooms, setLiveRooms] = useState<LiveCloudbedsRoom[]>([]);
  const [liveRoomsError, setLiveRoomsError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [syncingRates, setSyncingRates] = useState(false);
  const [runningAiPricing, setRunningAiPricing] = useState(false);

  async function load() {
    setLoading(true);
    const [m, l, u] = await Promise.all([
      api.get<CloudbedsMapping[]>("/admin/cloudbeds/mapping"),
      api.get<CloudbedsLogRow[]>("/admin/cloudbeds/log"),
      api.get<Unit[]>("/units"),
    ]);
    setMapping(m || []);
    setLog(l || []);
    setUnits(u || []);
    setLoading(false);
  }

  async function loadLiveRooms() {
    setTesting(true);
    try {
      const body = await localApi<{ rooms?: LiveCloudbedsRoom[] }>("/api/admin/cloudbeds/rooms");
      setLiveRooms(body?.rooms || []);
      setLiveRoomsError(null);
    } catch (e) {
      setLiveRoomsError(e instanceof Error ? e.message : "Gagal memuat daftar room Cloudbeds");
      setLiveRooms([]);
    } finally {
      setTesting(false);
      setLastChecked(new Date());
    }
  }

  useEffect(() => {
    load();
    loadLiveRooms();
  }, []);

  async function createMapping() {
    if (!form.room_id.trim() || !form.unit_id) {
      toast("⚠", "Lengkapi form", "Room ID dan unit wajib diisi.", "ruby");
      return;
    }
    try {
      await api.post("/admin/cloudbeds/mapping", {
        cloudbeds_room_id: form.room_id.trim(),
        cloudbeds_room_name: form.room_name.trim() || null,
        unit_id: form.unit_id,
      });
      setOpen(false);
      setForm({ room_id: "", room_name: "", unit_id: "" });
      toast("✓", "Tersimpan", "Pemetaan room berhasil disimpan.", "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function deleteMapping(id: string) {
    await api.delete(`/admin/cloudbeds/mapping?id=${id}`);
    load();
  }

  async function runBackfill() {
    setBackfilling(true);
    try {
      const body = await localApi<{
        fetched_total: number;
        fetched_active: number;
        matched: number;
        inserted: number;
        skipped_unmapped: number;
        unmapped_room_ids: string[];
        errors: string[];
      }>("/api/admin/cloudbeds/backfill", { method: "POST" });
      const unmappedNote = body.unmapped_room_ids.length ? ` Room ID belum dipetakan: ${body.unmapped_room_ids.join(", ")}.` : "";
      toast(
        "✓",
        "Selesai",
        `${body.fetched_total} reservasi total di Cloudbeds, ${body.fetched_active} aktif, ${body.inserted} berhasil masuk ke kalender villa (${body.skipped_unmapped} room belum dipetakan).${unmappedNote}`,
        "sage",
      );
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setBackfilling(false);
    }
  }

  async function runWebhookSetup() {
    setSubscribing(true);
    try {
      const body = await localApi<{
        endpoint_url: string;
        already_registered_before: number;
        attempts: Array<{ object: string; action: string; success: boolean; subscriptionID?: string; error?: string }>;
      }>("/api/admin/cloudbeds/webhook-setup", { method: "POST" });
      const okCount = body.attempts.filter((a) => a.success).length;
      const failed = body.attempts.filter((a) => !a.success);
      if (failed.length === 0) {
        toast("✓", "Webhook terdaftar", `${okCount} event Cloudbeds berhasil terdaftar ke villa.`, "sage");
      } else {
        toast(
          "⚠",
          "Sebagian gagal",
          `${okCount} berhasil, ${failed.length} gagal: ${failed.map((f) => `${f.object}.${f.action} (${f.error})`).join("; ")}`,
          "ruby",
        );
      }
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setSubscribing(false);
    }
  }

  async function runSyncRates() {
    setSyncingRates(true);
    try {
      const body = await localApi<{
        room_types_synced: number;
        results: Array<{
          villa_room_type_code: string;
          dates_synced: number;
          today_rate: number | null;
          today_rate_clamped: number | null;
          tarif_harian_updated_units: number;
          error?: string;
        }>;
      }>("/api/admin/cloudbeds/sync-rates", { method: "POST" });
      const failed = body.results.filter((r) => r.error);
      const okSummary = body.results
        .filter((r) => !r.error)
        .map((r) => `${r.villa_room_type_code}: Rp${(r.today_rate_clamped ?? 0).toLocaleString("id-ID")} (${r.tarif_harian_updated_units} unit diupdate)`)
        .join(", ");
      if (failed.length === 0) {
        toast("✓", "Harga disinkronkan", okSummary || "Tidak ada room type untuk disinkronkan.", "sage");
      } else {
        toast("⚠", "Sebagian gagal", `${okSummary ? okSummary + " — " : ""}Gagal: ${failed.map((f) => `${f.villa_room_type_code} (${f.error})`).join("; ")}`, "ruby");
      }
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setSyncingRates(false);
    }
  }

  async function runAiPricing(push: boolean) {
    if (push && !confirm("Harga hasil hitungan akan DIKIRIM ke Cloudbeds dan langsung berlaku di semua OTA. Lanjutkan?")) return;
    setRunningAiPricing(true);
    try {
      const body = await localApi<{
        push_requested: boolean;
        results: Array<{
          villa_room_type_code: string;
          anchor_rate: number;
          competitor_refresh: { refreshed: boolean; rows_inserted?: number; skipped_reason?: string; error?: string };
          today_decided_rate: number | null;
          pushed_to_cloudbeds: boolean;
          verification: { matched_dates: number; mismatched: Array<{ date: string; expected: number; actual: number | null }> } | null;
          error?: string;
        }>;
      }>("/api/admin/cloudbeds/run-ai-pricing", { method: "POST", body: JSON.stringify({ push }) });

      const failed = body.results.filter((r) => r.error);
      const mismatch = body.results.filter((r) => r.verification && r.verification.mismatched.length > 0);
      const okSummary = body.results
        .filter((r) => !r.error)
        .map((r) => `${r.villa_room_type_code}: Rp${(r.today_decided_rate ?? 0).toLocaleString("id-ID")}${r.pushed_to_cloudbeds ? " ✓terkirim" : ""}`)
        .join(", ");
      const riset = body.results
        .map((r) => r.competitor_refresh?.error && `${r.villa_room_type_code}: riset AI gagal (${r.competitor_refresh.error})`)
        .filter(Boolean)
        .join("; ");

      if (failed.length > 0) {
        toast("⚠", "Sebagian gagal", `${okSummary ? okSummary + " — " : ""}Gagal: ${failed.map((f) => `${f.villa_room_type_code} (${f.error})`).join("; ")}`, "ruby");
      } else if (mismatch.length > 0) {
        toast(
          "⚠",
          "Perlu dicek",
          `Terkirim, tapi harga di Cloudbeds belum cocok untuk ${mismatch[0].verification!.mismatched.length} tanggal (mis. ${mismatch[0].verification!.mismatched[0].date}: dikirim Rp${mismatch[0].verification!.mismatched[0].expected.toLocaleString("id-ID")}, terbaca Rp${(mismatch[0].verification!.mismatched[0].actual ?? 0).toLocaleString("id-ID")}). Bisa jadi hanya proses antrean Cloudbeds belum selesai.`,
          "ruby",
        );
      } else {
        toast(
          "✓",
          push ? "Terkirim & terverifikasi" : "Hitungan selesai (belum dikirim)",
          `${okSummary || "Tidak ada tipe unit untuk diproses."}${riset ? ` — ${riset}` : ""}`,
          "sage",
        );
      }
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setRunningAiPricing(false);
    }
  }

  return (
    <AdminShell pageTitle="Cloudbeds" pageSub="Pemetaan room & log event">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Webhook Cloudbeds: arahkan ke <code className="text-gold-400">https://living.haluoleo.id/api/webhooks/cloudbeds</code> dengan header{" "}
        <code className="text-gold-400">x-cloudbeds-secret</code> sesuai nilai <code className="text-gold-400">CLOUDBEDS_WEBHOOK_SECRET</code> di Vercel env variable project ini. Ditangani langsung di sini — bukan lagi lewat Supabase.
      </div>

      <Card className="mb-3.5">
        <CardHeader
          title="Daftarkan Webhook Otomatis (sinkron live)"
          action={
            <button
              onClick={runWebhookSetup}
              disabled={subscribing}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
            >
              {subscribing ? "Mendaftar…" : "Daftarkan Sekarang"}
            </button>
          }
        />
        <div className="px-4 sm:px-5 py-3.5 text-[11px] text-ink/50 leading-relaxed">
          Mendaftarkan webhook Cloudbeds secara otomatis lewat API mereka — tidak perlu buka dashboard Cloudbeds manual. Setelah berhasil, setiap reservasi baru/berubah di Cloudbeds otomatis masuk live ke kalender villa. Aman diklik berkali-kali (tidak dobel jika sudah terdaftar).
        </div>
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="Sinkron Harga dari Cloudbeds"
          action={
            <button
              onClick={runSyncRates}
              disabled={syncingRates}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
            >
              {syncingRates ? "Menyinkron…" : "Sinkron Sekarang"}
            </button>
          }
        />
        <div className="px-4 sm:px-5 py-3.5 text-[11px] text-ink/50 leading-relaxed">
          Menarik harga live per room type dari Cloudbeds (harga yang sama yang sudah tersebar ke semua OTA) dan langsung menjadikannya tarif harian unit villa hari ini — tidak perlu approve manual, sesuai instruksi. Otomatis berjalan tiap hari jam 00:05 WITA; tombol ini untuk sinkron langsung sekarang.
        </div>
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="AI Dynamic Pricing → Cloudbeds"
          action={
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => runAiPricing(false)}
                disabled={runningAiPricing}
                className="text-[10.5px] font-semibold text-ink/60 border border-ink/15 rounded px-3 py-1.5 disabled:opacity-50"
              >
                {runningAiPricing ? "Memproses…" : "Hitung Saja"}
              </button>
              <button
                onClick={() => runAiPricing(true)}
                disabled={runningAiPricing}
                className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 disabled:opacity-50"
              >
                Hitung + Kirim
              </button>
            </div>
          }
        />
        <div className="px-4 sm:px-5 py-3.5 text-[11px] text-ink/50 leading-relaxed">
          Menghitung harga dari <strong>harga dasar tetap</strong> tiap tipe unit (bukan dari harga hasil hitungan sebelumnya, supaya tidak beranak-pinak), memakai okupansi + riset AI kompetitor sekitar + high season, dan selalu dijepit ke batas min/max Anda.
          <br />
          <strong>Hitung Saja</strong> hanya menyimpan usulan harga untuk Anda lihat di Kalender Harga — tidak ada harga yang berubah. <strong>Hitung + Kirim</strong> mengirim ke Cloudbeds (berlaku ke semua OTA) lalu membaca ulang untuk memastikan harga benar-benar tersimpan di tanggal yang tepat.
          <br />
          Cron harian jam 22:58 WIB <strong>hanya menghitung</strong> selama sakelar <code className="text-gold-400">ai_autopush_enabled</code> masih mati — harga yang berlaku tetap mengikuti Cloudbeds.
        </div>
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="Tes Koneksi Cloudbeds"
          action={
            <button
              onClick={loadLiveRooms}
              disabled={testing}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
            >
              {testing ? "Menguji…" : "Tes Ulang"}
            </button>
          }
        />
        <div className="px-4 sm:px-5 py-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <Badge tone={testing ? "pending" : liveRoomsError ? "danger" : "ok"}>
              {testing ? "Menguji…" : liveRoomsError ? "Tidak terhubung" : "Terhubung"}
            </Badge>
            {lastChecked && (
              <span className="text-[10px] text-ink/30">
                Dicek {fmtDate(lastChecked.toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
          {liveRoomsError ? (
            <div className="text-[11px] text-ink/50 leading-relaxed">
              Gagal menghubungi Cloudbeds API: <code className="text-ruby-400">{liveRoomsError}</code>
              <br />
              Kemungkinan penyebab: <code className="text-gold-400">CLOUDBEDS_API_KEY</code> belum diset (atau salah nama) di Vercel env
              variable project villa, key sudah dihapus/kedaluwarsa di sisi Cloudbeds, atau{" "}
              <code className="text-gold-400">CLOUDBEDS_PROPERTY_ID</code> perlu diisi karena akun ini mengelola lebih dari satu properti.
              Pemetaan manual di bawah tetap bisa dipakai sementara.
            </div>
          ) : (
            <div className="text-[11px] text-ink/50 leading-relaxed">
              Endpoint <code className="text-gold-400">GET /getRooms</code> merespons normal — {liveRooms.length} room tersedia untuk dipetakan
              langsung dari daftar live di bawah.
            </div>
          )}
        </div>
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="Tarik Reservasi Aktif dari Cloudbeds"
          action={
            <button
              onClick={runBackfill}
              disabled={backfilling}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
            >
              {backfilling ? "Menarik…" : "Tarik Sekarang"}
            </button>
          }
        />
        <div className="px-4 sm:px-5 py-3.5 text-[11px] text-ink/50 leading-relaxed">
          Menarik reservasi yang statusnya masih aktif/akan datang (belum checkout) dari Cloudbeds untuk semua room yang sudah dipetakan, lalu memasukkannya ke kalender booking villa. Aman dijalankan berkali-kali — tidak akan membuat data duplikat.
        </div>
      </Card>

      <Card className="mb-3.5">
        <CardHeader
          title="Pemetaan Room → Unit"
          action={
            <button
              onClick={() => {
                setManualEntry(liveRoomsError !== null || liveRooms.length === 0);
                setOpen(true);
              }}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
            >
              + Petakan Room
            </button>
          }
        />
        {loading ? (
          <Loading />
        ) : mapping.length === 0 ? (
          <Loading label="Belum ada pemetaan" />
        ) : (
          mapping.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{m.cloudbeds_room_id}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">{m.cloudbeds_room_name || "—"}</div>
              </div>
              <div className="text-xs text-gold-500 shrink-0">{m.units ? `Unit ${m.units.nomor}` : "—"}</div>
              <button onClick={() => deleteMapping(m.id)} className="text-[10.5px] text-ruby-400 shrink-0">
                Hapus
              </button>
            </div>
          ))
        )}
      </Card>

      <Card>
        <CardHeader title="Log Event Cloudbeds Terbaru" />
        {log.length === 0 ? (
          <Loading label="Belum ada event" />
        ) : (
          log.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink/80">{l.event_type}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {l.reservation_id || "—"} · {fmtDate(l.created_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <Badge tone={l.matched ? "ok" : "danger"}>{l.matched ? "Matched" : "Tidak matched"}</Badge>
            </div>
          ))
        )}
      </Card>

      <Modal open={open} title="Petakan Room Cloudbeds" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Batal</Btn><Btn variant="primary" onClick={createMapping}>Simpan</Btn></>}>
        {!liveRoomsError && liveRooms.length > 0 && !manualEntry ? (
          <>
            <Field label="Room Cloudbeds (live)">
              <select
                className={inputCls}
                value={form.room_id}
                onChange={(e) => {
                  const room = liveRooms.find((r) => r.roomID === e.target.value);
                  setForm({ ...form, room_id: e.target.value, room_name: room?.roomName || "" });
                }}
              >
                <option value="">Pilih room</option>
                {liveRooms.map((r) => (
                  <option key={r.roomID} value={r.roomID}>
                    {r.roomName} {r.roomTypeName ? `— ${r.roomTypeName}` : ""} ({r.roomID})
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" onClick={() => setManualEntry(true)} className="text-[10.5px] text-gold-500 mb-3">
              Input manual sebagai gantinya
            </button>
          </>
        ) : (
          <>
            <Field label="Cloudbeds Room ID"><input className={inputCls} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })} placeholder="ID room dari Cloudbeds" /></Field>
            <Field label="Nama Room di Cloudbeds (opsional)"><input className={inputCls} value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></Field>
            {!liveRoomsError && liveRooms.length > 0 && (
              <button type="button" onClick={() => setManualEntry(false)} className="text-[10.5px] text-gold-500 mb-3">
                Pilih dari daftar live sebagai gantinya
              </button>
            )}
          </>
        )}
        <Field label="Unit Villa">
          <select className={inputCls} value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })}>
            <option value="">Pilih unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>Unit {u.nomor} (Blok {u.blok})</option>
            ))}
          </select>
        </Field>
      </Modal>
    </AdminShell>
  );
}
