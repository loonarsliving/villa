"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "../_shell";
import { useAuth } from "@/lib/auth";
import { CCTV_ALLOWED_USER_ID } from "@/lib/cctvConstants";
import { cctvApi } from "@/lib/cctvApi";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import { useToast } from "@/lib/toast";
import type { CctvCamera, CctvCheckpointLog } from "@/lib/types";

const zonaLabel: Record<CctvCamera["zona"], string> = {
  security: "Keamanan",
  front_desk: "Resepsionis",
  housekeeping: "Cleaning Service",
};

const statusTone: Record<CctvCheckpointLog["status"], "ok" | "pending" | "danger"> = {
  ok: "ok",
  capture_failed: "danger",
  ai_failed: "danger",
};

const emptyForm = {
  id: "",
  nama: "",
  zona: "security" as CctvCamera["zona"],
  deskripsi_titik: "",
  ezviz_serial: "",
  ezviz_channel_no: 1,
  ezviz_verification_code: "",
  checkpoint_interval_minutes: 120,
};

export default function AdminCctvPage() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [cameras, setCameras] = useState<CctvCamera[]>([]);
  const [logs, setLogs] = useState<CctvCheckpointLog[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ready && user && user.id !== CCTV_ALLOWED_USER_ID) {
      router.replace("/admin");
    }
  }, [ready, user, router]);

  const authorized = ready && user?.id === CCTV_ALLOWED_USER_ID;

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    try {
      const [c, l] = await Promise.all([
        cctvApi.get<CctvCamera[]>("/cameras", user.id),
        cctvApi.get<CctvCheckpointLog[]>(`/logs${selectedCamera ? `?camera_id=${selectedCamera}` : ""}`, user.id),
      ]);
      setCameras(c || []);
      setLogs(l || []);
    } catch {
      toast("⚠", "Gagal memuat", "Tidak bisa mengambil data AI CCTV", "ruby");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authorized) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, selectedCamera]);

  function openAdd() {
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(cam: CctvCamera) {
    setForm({
      id: cam.id,
      nama: cam.nama,
      zona: cam.zona,
      deskripsi_titik: cam.deskripsi_titik || "",
      ezviz_serial: cam.ezviz_serial || "",
      ezviz_channel_no: cam.ezviz_channel_no,
      ezviz_verification_code: cam.ezviz_verification_code || "",
      checkpoint_interval_minutes: cam.checkpoint_interval_minutes,
    });
    setModalOpen(true);
  }

  async function saveCamera() {
    if (!user || !form.nama.trim()) return;
    setSaving(true);
    try {
      if (form.id) {
        await cctvApi.patch("/cameras", user.id, form);
      } else {
        await cctvApi.post("/cameras", user.id, form);
      }
      toast("✓", "Tersimpan", `Kamera "${form.nama}" tersimpan`, "sage");
      setModalOpen(false);
      loadAll();
    } catch {
      toast("⚠", "Gagal", "Tidak bisa menyimpan kamera", "ruby");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cam: CctvCamera) {
    if (!user) return;
    try {
      await cctvApi.patch("/cameras", user.id, { id: cam.id, is_active: !cam.is_active });
      loadAll();
    } catch {
      toast("⚠", "Gagal", "Tidak bisa mengubah status kamera", "ruby");
    }
  }

  async function runNow(cam: CctvCamera) {
    if (!user) return;
    setRunningId(cam.id);
    try {
      const result = await cctvApi.post<{ status: string }>(`/run-now/${cam.id}`, user.id);
      if (result.status === "ok") {
        toast("✓", "Checkpoint selesai", `${cam.nama}: berhasil`, "sage");
      } else {
        toast("⚠", "Checkpoint gagal", `${cam.nama}: ${result.status}`, "ruby");
      }
      loadAll();
    } catch {
      toast("⚠", "Gagal", "Checkpoint tidak bisa dijalankan", "ruby");
    } finally {
      setRunningId(null);
    }
  }

  if (!ready || !authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white/30 text-xs tracking-wide">Memuat...</div>
    );
  }

  const cameraById = new Map(cameras.map((c) => [c.id, c]));

  return (
    <AdminShell pageTitle="AI CCTV" pageSub="Checkpoint keamanan, resepsionis & cleaning service">
      <div className="grid gap-5">
        <Card>
          <CardHeader
            title="Kamera Terdaftar"
            subtitle="Snapshot EZVIZ berkala dianalisis Gemini Vision untuk mendeteksi kehadiran orang di titik/zona"
            action={<Btn variant="primary" onClick={openAdd}>+ Tambah Kamera</Btn>}
          />
          {loading ? (
            <Loading />
          ) : cameras.length === 0 ? (
            <Empty label="Belum ada kamera terdaftar" />
          ) : (
            cameras.map((cam) => (
              <div key={cam.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-white/[0.05] last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white font-medium truncate">{cam.nama}</div>
                  <div className="text-[10px] text-white/30 mt-0.5">
                    {zonaLabel[cam.zona]} · {cam.deskripsi_titik || "tanpa deskripsi"} ·{" "}
                    {cam.ezviz_serial ? `serial ${cam.ezviz_serial}` : "belum diisi serial EZVIZ"} · tiap{" "}
                    {cam.checkpoint_interval_minutes} menit
                  </div>
                </div>
                <Badge tone={cam.is_active ? "ok" : "pending"}>{cam.is_active ? "aktif" : "nonaktif"}</Badge>
                <button
                  onClick={() => runNow(cam)}
                  disabled={runningId === cam.id}
                  className="text-[10px] text-gold-500 hover:opacity-80 px-2 py-1 border border-gold-500/30 rounded shrink-0 disabled:opacity-40"
                >
                  {runningId === cam.id ? "Menjalankan…" : "Jalankan sekarang"}
                </button>
                <button onClick={() => toggleActive(cam)} className="text-[10px] text-white/40 hover:text-white/70 px-2 py-1 border border-white/10 rounded shrink-0">
                  {cam.is_active ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button onClick={() => openEdit(cam)} className="text-[10px] text-white/40 hover:text-white/70 px-2 py-1 border border-white/10 rounded shrink-0">
                  Edit
                </button>
              </div>
            ))
          )}
        </Card>

        <Card>
          <CardHeader
            title="Log Checkpoint"
            subtitle="Riwayat snapshot & hasil deteksi kehadiran"
            action={
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="bg-base-800 border border-white/10 rounded text-[11px] text-white/70 px-2 py-1.5"
              >
                <option value="">Semua kamera</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nama}
                  </option>
                ))}
              </select>
            }
          />
          {loading ? (
            <Loading />
          ) : logs.length === 0 ? (
            <Empty label="Belum ada log checkpoint" />
          ) : (
            logs.map((log) => {
              const cam = cameraById.get(log.camera_id);
              return (
                <div key={log.id} className="flex items-start gap-3 px-4 sm:px-5 py-2.5 border-b border-white/[0.05] last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white/80 truncate">
                      {cam?.nama || "kamera terhapus"} · {cam ? zonaLabel[cam.zona] : "—"}
                    </div>
                    <div className="text-[10px] text-white/40 mt-0.5">
                      {log.status === "ok"
                        ? log.ai_summary || (log.person_detected ? "Ada orang terdeteksi" : "Tidak ada orang terdeteksi")
                        : log.error_detail || "Gagal"}
                    </div>
                    <div className="text-[9.5px] text-white/25 mt-0.5">
                      {fmtDate(log.captured_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {log.status === "ok" && (
                    <Badge tone={log.person_detected ? "ok" : "pending"}>{log.person_detected ? "ada orang" : "kosong"}</Badge>
                  )}
                  <Badge tone={statusTone[log.status]}>{log.status}</Badge>
                </div>
              );
            })
          )}
        </Card>
      </div>

      <Modal
        open={modalOpen}
        title={form.id ? "Edit Kamera" : "Tambah Kamera"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Btn onClick={() => setModalOpen(false)}>Batal</Btn>
            <Btn variant="primary" onClick={saveCamera}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Btn>
          </>
        }
      >
        <Field label="Nama Kamera">
          <input className={inputCls} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="mis. Kamera Lobby" />
        </Field>
        <Field label="Zona / Tujuan Pemantauan">
          <select
            className={inputCls}
            value={form.zona}
            onChange={(e) => setForm({ ...form, zona: e.target.value as CctvCamera["zona"] })}
          >
            <option value="security">Keamanan (patroli titik)</option>
            <option value="front_desk">Resepsionis (kehadiran di meja depan)</option>
            <option value="housekeeping">Cleaning Service (kunjungan kamar)</option>
          </select>
        </Field>
        <Field label="Deskripsi Titik">
          <input
            className={inputCls}
            value={form.deskripsi_titik}
            onChange={(e) => setForm({ ...form, deskripsi_titik: e.target.value })}
            placeholder="mis. Pintu gerbang belakang / Kamar A-3"
          />
        </Field>
        <Field label="EZVIZ Serial Number">
          <input className={inputCls} value={form.ezviz_serial} onChange={(e) => setForm({ ...form, ezviz_serial: e.target.value })} placeholder="mis. DS1234567" />
        </Field>
        <Field label="EZVIZ Channel No">
          <input
            type="number"
            className={inputCls}
            value={form.ezviz_channel_no}
            onChange={(e) => setForm({ ...form, ezviz_channel_no: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="EZVIZ Verification Code (jika video terenkripsi)">
          <input
            className={inputCls}
            value={form.ezviz_verification_code}
            onChange={(e) => setForm({ ...form, ezviz_verification_code: e.target.value })}
            placeholder="tertulis di stiker kamera"
          />
        </Field>
        <Field label="Interval Checkpoint (menit)">
          <input
            type="number"
            className={inputCls}
            value={form.checkpoint_interval_minutes}
            onChange={(e) => setForm({ ...form, checkpoint_interval_minutes: Number(e.target.value) || 120 })}
          />
        </Field>
      </Modal>
    </AdminShell>
  );
}
