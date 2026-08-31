"use client";

import { useEffect, useRef, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError, getToken } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { CctvCamera, CctvCheckpointLog, CctvDisciplinaryReport } from "@/lib/types";

const emptyForm = {
  id: "",
  nama: "",
  deskripsi: "",
  ezviz_serial: "",
  ezviz_channel_no: "1",
  ezviz_verification_code: "",
  zona: "",
  checkpoint_interval_minutes: "120",
};

const ZONA_LABEL: Record<string, string> = { satpam: "Satpam", resepsionis: "Resepsionis" };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminCctvPage() {
  const toast = useToast();
  const [cameras, setCameras] = useState<CctvCamera[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState<string | null>(null);

  const [watching, setWatching] = useState<CctvCamera | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const playerRef = useRef<{ stop: () => void } | null>(null);

  const [logs, setLogs] = useState<CctvCheckpointLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const [reports, setReports] = useState<CctvDisciplinaryReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reviewing, setReviewing] = useState<CctvDisciplinaryReport | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const c = await api.get<CctvCamera[]>("/admin/cctv/cameras");
      setCameras(c || []);
    } catch (e) {
      toast("⚠", "Gagal memuat", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const l = await api.get<CctvCheckpointLog[]>("/admin/cctv/checkpoint-log");
      setLogs(l || []);
    } catch (e) {
      toast("⚠", "Gagal memuat log checkpoint", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setLogsLoading(false);
    }
  }

  async function loadReports() {
    setReportsLoading(true);
    try {
      const r = await api.get<CctvDisciplinaryReport[]>("/admin/cctv/disciplinary-reports");
      setReports(r || []);
    } catch (e) {
      toast("⚠", "Gagal memuat laporan indisipliner", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setReportsLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadLogs();
    loadReports();
  }, []);

  function cameraName(id: string) {
    return cameras.find((c) => c.id === id)?.nama || "(kamera terhapus)";
  }

  function openAdd() {
    setForm(emptyForm);
    setFormOpen(true);
  }
  function openEdit(cam: CctvCamera) {
    setForm({
      id: cam.id,
      nama: cam.nama,
      deskripsi: cam.deskripsi || "",
      ezviz_serial: cam.ezviz_serial,
      ezviz_channel_no: String(cam.ezviz_channel_no),
      ezviz_verification_code: cam.ezviz_verification_code || "",
      zona: cam.zona || "",
      checkpoint_interval_minutes: String(cam.checkpoint_interval_minutes || 120),
    });
    setFormOpen(true);
  }

  async function saveCamera() {
    if (!form.nama.trim() || !form.ezviz_serial.trim()) {
      toast("⚠", "Lengkapi form", "Nama dan serial number EZVIZ wajib diisi.", "ruby");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nama: form.nama.trim(),
        deskripsi: form.deskripsi.trim() || null,
        ezviz_serial: form.ezviz_serial.trim(),
        ezviz_channel_no: Number(form.ezviz_channel_no) || 1,
        ezviz_verification_code: form.ezviz_verification_code.trim() || null,
        zona: form.zona || null,
        checkpoint_interval_minutes: Number(form.checkpoint_interval_minutes) || 120,
      };
      if (form.id) {
        await api.patch("/admin/cctv/cameras", { id: form.id, ...payload });
      } else {
        await api.post("/admin/cctv/cameras", payload);
      }
      toast("✓", "Tersimpan", `Kamera "${form.nama}" tersimpan.`, "sage");
      setFormOpen(false);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cam: CctvCamera) {
    try {
      await api.patch("/admin/cctv/cameras", { id: cam.id, is_active: !cam.is_active });
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function deleteCamera(cam: CctvCamera) {
    try {
      await api.delete(`/admin/cctv/cameras?id=${cam.id}`);
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    }
  }

  async function runNow(cam: CctvCamera) {
    setRunningNow(cam.id);
    try {
      const token = getToken();
      const res = await fetch(`/api/cctv/run-now/${cam.id}`, {
        method: "POST",
        headers: token ? { "x-villa-token": token } : {},
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
      if (body.status === "ok") {
        toast("✓", "Checkpoint selesai", body.person_detected ? "Terdeteksi ada orang." : "Tidak terdeteksi orang di frame.", body.person_detected ? "sage" : "gold");
      } else {
        toast("⚠", "Checkpoint gagal", body.error || "Terjadi kesalahan.", "ruby");
      }
      loadLogs();
    } catch (e) {
      toast("⚠", "Gagal menjalankan checkpoint", e instanceof Error ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setRunningNow(null);
    }
  }

  function openReview(report: CctvDisciplinaryReport) {
    setReviewing(report);
    setReviewNote("");
  }

  async function submitReview(status: "confirmed" | "dismissed") {
    if (!reviewing) return;
    setReviewSaving(true);
    try {
      await api.patch("/admin/cctv/disciplinary-reports", { id: reviewing.id, status, review_note: reviewNote.trim() || null });
      toast("✓", status === "confirmed" ? "Laporan dikonfirmasi" : "Laporan ditolak", "", "sage");
      setReviewing(null);
      loadReports();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
    } finally {
      setReviewSaving(false);
    }
  }

  function closeWatch() {
    playerRef.current?.stop();
    playerRef.current = null;
    setWatching(null);
    setWatchError(null);
  }

  async function openWatch(cam: CctvCamera) {
    setWatching(cam);
    setWatchError(null);
    setWatchLoading(true);
  }

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;

    async function start() {
      try {
        const token = getToken();
        const res = await fetch("/api/cctv/token", {
          headers: token ? { "x-villa-token": token } : {},
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
        if (cancelled) return;

        const { EZUIKitPlayer } = await import("ezuikit-js");
        if (cancelled) return;

        const cam = watching!;
        // open.ezviz.com, not open.ys7.com -- confirmed against the owner's own
        // account "Address test" tool in the EZVIZ console, which generated
        // ezopen://open.ezviz.com/{serial}/{channel}.hd.live for this exact device.
        const url = cam.ezviz_verification_code
          ? `ezopen://${cam.ezviz_verification_code}@open.ezviz.com/${cam.ezviz_serial}/${cam.ezviz_channel_no}.live`
          : `ezopen://open.ezviz.com/${cam.ezviz_serial}/${cam.ezviz_channel_no}.live`;

        const player = new EZUIKitPlayer({
          id: "cctv-player-container",
          accessToken: body.accessToken,
          url,
          template: "security",
          width: 800,
          height: 480,
          env: { domain: body.domain },
        });
        playerRef.current = player as unknown as { stop: () => void };
      } catch (e) {
        if (!cancelled) setWatchError(e instanceof Error ? e.message : "Gagal memulai live-view");
      } finally {
        if (!cancelled) setWatchLoading(false);
      }
    }
    start();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching?.id]);

  return (
    <AdminShell pageTitle="CCTV" pageSub="Live-view kamera EZVIZ + checkpoint AI">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Daftarkan kamera EZVIZ di sini (serial number & channel bisa dilihat di aplikasi EZVIZ), lalu klik <b>Tonton</b> untuk live-view langsung dari
        interface villa. Kamera dengan <b>zona</b> terisi (Satpam/Resepsionis) otomatis dicek AI tiap 2 jam untuk mencatat kehadiran — hasilnya
        dirangkum jadi laporan bulanan di bawah, yang perlu ditinjau admin sebelum resmi. Halaman ini hanya bisa diakses admin.
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Kamera Terdaftar"
          action={
            <button
              onClick={openAdd}
              className="text-[10.5px] font-semibold text-gold-500 border border-gold-500/25 rounded px-3 py-1.5 shrink-0"
            >
              + Tambah Kamera
            </button>
          }
        />
        {loading ? (
          <Loading />
        ) : cameras.length === 0 ? (
          <Loading label="Belum ada kamera terdaftar" />
        ) : (
          cameras.map((cam) => (
            <div key={cam.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-ink/80 font-medium truncate">{cam.nama}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {cam.deskripsi || "tanpa deskripsi"} · serial {cam.ezviz_serial} · channel {cam.ezviz_channel_no}
                  {cam.zona ? ` · checkpoint tiap ${cam.checkpoint_interval_minutes} menit` : ""}
                </div>
              </div>
              {cam.zona && <Badge tone="pending">{ZONA_LABEL[cam.zona] || cam.zona}</Badge>}
              <Badge tone={cam.is_active ? "ok" : "pending"}>{cam.is_active ? "aktif" : "nonaktif"}</Badge>
              <button onClick={() => openWatch(cam)} className="text-[10px] text-gold-500 hover:opacity-80 px-2 py-1 border border-gold-500/30 rounded shrink-0">
                Tonton
              </button>
              {cam.zona && (
                <button
                  onClick={() => runNow(cam)}
                  disabled={runningNow === cam.id}
                  className="text-[10px] text-ink/50 px-2 py-1 border border-ink/10 rounded shrink-0 disabled:opacity-40"
                >
                  {runningNow === cam.id ? "Menjalankan…" : "Run Now"}
                </button>
              )}
              <button onClick={() => toggleActive(cam)} className="text-[10px] text-ink/40 px-2 py-1 border border-ink/10 rounded shrink-0">
                {cam.is_active ? "Nonaktifkan" : "Aktifkan"}
              </button>
              <button onClick={() => openEdit(cam)} className="text-[10px] text-ink/40 px-2 py-1 border border-ink/10 rounded shrink-0">
                Edit
              </button>
              <button onClick={() => deleteCamera(cam)} className="text-[10px] text-ruby-400 px-2 py-1 border border-ruby-500/20 rounded shrink-0">
                Hapus
              </button>
            </div>
          ))
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader title="Laporan Indisipliner" subtitle="Rangkuman bulanan checkpoint AI — perlu ditinjau admin sebelum resmi" />
        {reportsLoading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <Loading label="Belum ada laporan" />
        ) : (
          reports.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-ink/80 font-medium truncate">
                  {r.cctv_cameras?.nama || cameraName(r.camera_id)} · {r.period_start.slice(0, 7)}
                </div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  Hadir {r.total_present}/{r.total_checkpoints} checkpoint · Tidak terdeteksi {r.total_absent}x
                  {r.reviewed_at ? ` · ditinjau ${formatDateTime(r.reviewed_at)}` : ""}
                </div>
                {r.review_note && <div className="text-[10px] text-ink/40 mt-1 italic">"{r.review_note}"</div>}
              </div>
              <Badge tone={r.status === "confirmed" ? "danger" : r.status === "dismissed" ? "ok" : "pending"}>
                {r.status === "pending_review" ? "perlu ditinjau" : r.status === "confirmed" ? "dikonfirmasi" : "ditolak"}
              </Badge>
              {r.status === "pending_review" && (
                <button onClick={() => openReview(r)} className="text-[10px] text-gold-500 px-2 py-1 border border-gold-500/30 rounded shrink-0">
                  Tinjau
                </button>
              )}
            </div>
          ))
        )}
      </Card>

      <Card>
        <CardHeader title="Log Checkpoint" subtitle="100 hasil checkpoint AI terakhir" />
        {logsLoading ? (
          <Loading />
        ) : logs.length === 0 ? (
          <Loading label="Belum ada log checkpoint" />
        ) : (
          logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] text-ink/70 truncate">
                  {cameraName(l.camera_id)} · {formatDateTime(l.captured_at)}
                </div>
                {l.ai_summary && <div className="text-[10px] text-ink/30 mt-0.5 truncate">{l.ai_summary}</div>}
                {l.error_detail && <div className="text-[10px] text-ruby-400 mt-0.5 truncate">{l.error_detail}</div>}
              </div>
              <Badge tone={l.status !== "ok" ? "danger" : l.person_detected ? "ok" : "pending"}>
                {l.status !== "ok" ? "gagal" : l.person_detected ? "ada orang" : "kosong"}
              </Badge>
            </div>
          ))
        )}
      </Card>

      <Modal
        open={formOpen}
        title={form.id ? "Edit Kamera" : "Tambah Kamera"}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Btn onClick={() => setFormOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={saveCamera}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Btn>
          </>
        }
      >
        <Field label="Nama Kamera">
          <input className={inputCls} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="mis. Kamera Lobby" />
        </Field>
        <Field label="Deskripsi / Lokasi (opsional)">
          <input className={inputCls} value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} placeholder="mis. Pintu gerbang depan" />
        </Field>
        <Field label="EZVIZ Serial Number">
          <input className={inputCls} value={form.ezviz_serial} onChange={(e) => setForm({ ...form, ezviz_serial: e.target.value })} placeholder="mis. DS1234567" />
        </Field>
        <Field label="EZVIZ Channel No">
          <input type="number" className={inputCls} value={form.ezviz_channel_no} onChange={(e) => setForm({ ...form, ezviz_channel_no: e.target.value })} />
        </Field>
        <Field label="EZVIZ Verification Code (jika video terenkripsi)">
          <input
            className={inputCls}
            value={form.ezviz_verification_code}
            onChange={(e) => setForm({ ...form, ezviz_verification_code: e.target.value })}
            placeholder="tertulis di stiker kamera"
          />
        </Field>
        <Field label="Zona Checkpoint AI (opsional)">
          <select className={inputCls} value={form.zona} onChange={(e) => setForm({ ...form, zona: e.target.value })}>
            <option value="">Tidak ikut checkpoint AI (live-view saja)</option>
            <option value="satpam">Satpam</option>
            <option value="resepsionis">Resepsionis</option>
          </select>
        </Field>
        {form.zona && (
          <Field label="Interval Checkpoint (menit)">
            <input
              type="number"
              className={inputCls}
              value={form.checkpoint_interval_minutes}
              onChange={(e) => setForm({ ...form, checkpoint_interval_minutes: e.target.value })}
            />
            <div className="text-[10px] text-ink/30 mt-1">Catatan: cron berjalan tiap 2 jam — angka ini untuk referensi, bukan penjadwalan per-kamera.</div>
          </Field>
        )}
      </Modal>

      <Modal
        open={watching !== null}
        title={`Live-view — ${watching?.nama || ""}`}
        onClose={closeWatch}
        wide
        footer={
          <Btn variant="primary" onClick={closeWatch}>
            Tutup
          </Btn>
        }
      >
        {watchLoading && <div className="text-center py-10 text-[11px] text-ink/30">Menghubungkan ke kamera…</div>}
        {watchError && (
          <div className="text-center py-10 text-[11px] text-ruby-400 leading-relaxed px-4">
            Gagal live-view: {watchError}
            <br />
            <span className="text-ink/30">Cek serial/channel/verification code, dan pastikan EZVIZ_APP_KEY/EZVIZ_APP_SECRET sudah diset di Vercel.</span>
          </div>
        )}
        <div id="cctv-player-container" className={watchLoading || watchError ? "hidden" : ""} />
      </Modal>

      <Modal
        open={reviewing !== null}
        title={`Tinjau Laporan — ${reviewing?.cctv_cameras?.nama || ""}`}
        onClose={() => setReviewing(null)}
        footer={
          <>
            <Btn onClick={() => submitReview("dismissed")}>{reviewSaving ? "Menyimpan…" : "Tolak"}</Btn>
            <Btn variant="primary" onClick={() => submitReview("confirmed")}>
              {reviewSaving ? "Menyimpan…" : "Konfirmasi"}
            </Btn>
          </>
        }
      >
        {reviewing && (
          <>
            <div className="text-[11px] text-ink/50 leading-relaxed mb-3">
              Periode {reviewing.period_start.slice(0, 7)} · hadir {reviewing.total_present}/{reviewing.total_checkpoints} checkpoint · tidak terdeteksi{" "}
              {reviewing.total_absent}x. AI hanya mencatat fakta visual (ada/tidak orang di frame) — keputusan disipliner tetap di tangan admin.
            </div>
            {reviewing.absence_details.length > 0 && (
              <div className="mb-3 max-h-40 overflow-y-auto border border-ink/10 rounded p-2 space-y-1.5">
                {reviewing.absence_details.map((d, i) => (
                  <div key={i} className="text-[10.5px] text-ink/50">
                    {formatDateTime(d.captured_at)} — {d.ai_summary || "tidak ada deskripsi"}
                  </div>
                ))}
              </div>
            )}
            <Field label="Catatan (opsional)">
              <input className={inputCls} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="mis. sudah dikonfirmasi ke yang bersangkutan" />
            </Field>
          </>
        )}
      </Modal>
    </AdminShell>
  );
}
