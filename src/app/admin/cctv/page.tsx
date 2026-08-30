"use client";

import { useEffect, useRef, useState } from "react";
import { AdminShell } from "../_shell";
import { api, ApiError, getToken } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";
import type { CctvCamera } from "@/lib/types";

const emptyForm = {
  id: "",
  nama: "",
  deskripsi: "",
  ezviz_serial: "",
  ezviz_channel_no: "1",
  ezviz_verification_code: "",
};

export default function AdminCctvPage() {
  const toast = useToast();
  const [cameras, setCameras] = useState<CctvCamera[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [watching, setWatching] = useState<CctvCamera | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const playerRef = useRef<{ stop: () => void } | null>(null);

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

  useEffect(() => {
    load();
  }, []);

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
        const url = cam.ezviz_verification_code
          ? `ezopen://${cam.ezviz_verification_code}@open.ys7.com/${cam.ezviz_serial}/${cam.ezviz_channel_no}.live`
          : `ezopen://open.ys7.com/${cam.ezviz_serial}/${cam.ezviz_channel_no}.live`;

        const player = new EZUIKitPlayer({
          id: "cctv-player-container",
          accessToken: body.accessToken,
          url,
          template: "security",
          width: 640,
          height: 400,
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
    <AdminShell pageTitle="CCTV" pageSub="Live-view kamera EZVIZ">
      <div className="bg-gold-500/10 border-l-2 border-gold-500 rounded-r p-3.5 text-[11px] text-ink/50 leading-relaxed mb-3.5">
        Daftarkan kamera EZVIZ di sini (serial number & channel bisa dilihat di aplikasi EZVIZ), lalu klik <b>Tonton</b> untuk live-view langsung dari
        interface villa. Halaman ini hanya bisa diakses admin.
      </div>

      <Card>
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
            <div key={cam.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-ink/80 font-medium truncate">{cam.nama}</div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {cam.deskripsi || "tanpa deskripsi"} · serial {cam.ezviz_serial} · channel {cam.ezviz_channel_no}
                </div>
              </div>
              <Badge tone={cam.is_active ? "ok" : "pending"}>{cam.is_active ? "aktif" : "nonaktif"}</Badge>
              <button onClick={() => openWatch(cam)} className="text-[10px] text-gold-500 hover:opacity-80 px-2 py-1 border border-gold-500/30 rounded shrink-0">
                Tonton
              </button>
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
      </Modal>

      <Modal
        open={watching !== null}
        title={`Live-view — ${watching?.nama || ""}`}
        onClose={closeWatch}
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
    </AdminShell>
  );
}
