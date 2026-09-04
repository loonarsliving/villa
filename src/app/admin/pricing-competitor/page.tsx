"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../_shell";
import { getToken } from "@/lib/api";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody, Loading, Empty, Badge } from "@/components/Card";
import { Modal, Field, inputCls, Btn } from "@/components/Modal";

/**
 * Revenue Engine extension (owner request 2026-09-04): admin page to
 * manage the two new inputs the deterministic cron
 * (/api/cron/generate-pricing-recommendations) reads for weekend/high-
 * season pricing:
 *  - High season periods (date ranges + suggested %) -- fully manual.
 *  - Competitor rates -- manual entry, or AI research via Gemini's Google
 *    Search grounding (Mkhsistem bridge). AI results land here with
 *    source="ai_research" for review/delete, same "human reviews AI
 *    output" pattern as the pricing-recommendations page's AI Insight.
 */

interface RoomType {
  id: string;
  code: string;
  name: string;
}

interface HighSeasonPeriod {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  suggested_adjustment_pct: number;
  active: boolean;
}

interface CompetitorRate {
  id: string;
  room_type_id: string | null;
  location_label: string;
  competitor_name: string;
  competitor_type: "hotel" | "villa" | "other";
  price: number;
  source: "manual" | "ai_research";
  source_note: string | null;
  observed_at: string;
  villa_room_types?: { code: string; name: string } | null;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return { "Content-Type": "application/json", ...(token ? { "x-villa-token": token } : {}) };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export default function PricingCompetitorPage() {
  const [periods, setPeriods] = useState<HighSeasonPeriod[] | null>(null);
  const [rates, setRates] = useState<CompetitorRate[] | null>(null);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodModal, setPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState({ label: "", start_date: "", end_date: "", suggested_adjustment_pct: "15" });
  const [savingPeriod, setSavingPeriod] = useState(false);

  const [rateModal, setRateModal] = useState(false);
  const [rateForm, setRateForm] = useState({ room_type_id: "", location_label: "", competitor_name: "", competitor_type: "hotel", price: "" });
  const [savingRate, setSavingRate] = useState(false);

  const [researchModal, setResearchModal] = useState(false);
  const [researchForm, setResearchForm] = useState({ room_type_id: "", location_label: "" });
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      apiFetch<HighSeasonPeriod[]>("/api/admin/high-season-periods").catch(() => []),
      apiFetch<CompetitorRate[]>("/api/admin/competitor-rates").catch(() => []),
      fetch("/api/admin/pricing-calendar", { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => (d.room_types ?? []).map((rt: { room_type_id: string; code: string; name: string }) => ({ id: rt.room_type_id, code: rt.code, name: rt.name })))
        .catch(() => []),
    ])
      .then(([p, r, rt]) => {
        setPeriods(p);
        setRates(r);
        setRoomTypes(rt);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function submitPeriod() {
    setSavingPeriod(true);
    try {
      await apiFetch("/api/admin/high-season-periods", {
        method: "POST",
        body: JSON.stringify({
          label: periodForm.label,
          start_date: periodForm.start_date,
          end_date: periodForm.end_date,
          suggested_adjustment_pct: Number(periodForm.suggested_adjustment_pct) / 100,
        }),
      });
      setPeriodModal(false);
      setPeriodForm({ label: "", start_date: "", end_date: "", suggested_adjustment_pct: "15" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSavingPeriod(false);
    }
  }

  async function togglePeriod(p: HighSeasonPeriod) {
    await apiFetch("/api/admin/high-season-periods", { method: "PATCH", body: JSON.stringify({ id: p.id, active: !p.active }) });
    load();
  }
  async function deletePeriod(id: string) {
    if (!confirm("Hapus periode high season ini?")) return;
    await apiFetch(`/api/admin/high-season-periods?id=${id}`, { method: "DELETE" });
    load();
  }

  async function submitRate() {
    setSavingRate(true);
    try {
      await apiFetch("/api/admin/competitor-rates", {
        method: "POST",
        body: JSON.stringify({
          room_type_id: rateForm.room_type_id || null,
          location_label: rateForm.location_label,
          competitor_name: rateForm.competitor_name,
          competitor_type: rateForm.competitor_type,
          price: Number(rateForm.price),
        }),
      });
      setRateModal(false);
      setRateForm({ room_type_id: "", location_label: "", competitor_name: "", competitor_type: "hotel", price: "" });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSavingRate(false);
    }
  }
  async function deleteRate(id: string) {
    if (!confirm("Hapus data kompetitor ini?")) return;
    await apiFetch(`/api/admin/competitor-rates?id=${id}`, { method: "DELETE" });
    load();
  }

  async function submitResearch() {
    setResearching(true);
    setResearchError(null);
    try {
      await apiFetch("/api/admin/competitor-rates/research", {
        method: "POST",
        body: JSON.stringify({ room_type_id: researchForm.room_type_id, location_label: researchForm.location_label }),
      });
      setResearchModal(false);
      load();
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : "Riset gagal");
    } finally {
      setResearching(false);
    }
  }

  return (
    <AdminShell pageTitle="High Season & Kompetitor" pageSub="Input untuk Revenue Engine — weekend +Rp100.000 otomatis, high season & harga kompetitor diatur di sini">
      {loading && <Loading />}

      {!loading && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Periode High Season"
              subtitle="Rentang tanggal yang jadi acuan cron rekomendasi harga"
              action={<Btn variant="primary" onClick={() => setPeriodModal(true)}>+ Tambah</Btn>}
            />
            <CardBody>
              {(!periods || periods.length === 0) && <Empty label="Belum ada periode high season." />}
              {periods && periods.length > 0 && (
                <div className="space-y-2">
                  {periods.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 text-[12px] border-b border-ink/[0.05] pb-2 last:border-0">
                      <div>
                        <div className="font-medium text-ink">{p.label}</div>
                        <div className="text-ink/40 text-[10.5px]">
                          {fmtDate(p.start_date)} – {fmtDate(p.end_date)} · target +{Math.round(p.suggested_adjustment_pct * 1000) / 10}%
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone={p.active ? "ok" : "pending"}>{p.active ? "Aktif" : "Nonaktif"}</Badge>
                        <button className="text-[10.5px] text-ink/40 underline" onClick={() => togglePeriod(p)}>
                          {p.active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                        <button className="text-[10.5px] text-ruby-400 underline" onClick={() => deletePeriod(p.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Harga Kompetitor Sekitar"
              subtitle="Dipakai sebagai batas bawah rekomendasi saat high season"
              action={
                <div className="flex gap-2">
                  <Btn onClick={() => setResearchModal(true)}>✨ Riset via AI</Btn>
                  <Btn variant="primary" onClick={() => setRateModal(true)}>+ Manual</Btn>
                </div>
              }
            />
            <CardBody>
              {(!rates || rates.length === 0) && <Empty label="Belum ada data harga kompetitor." />}
              {rates && rates.length > 0 && (
                <div className="space-y-2">
                  {rates.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 text-[12px] border-b border-ink/[0.05] pb-2 last:border-0">
                      <div className="min-w-0">
                        <div className="font-medium text-ink truncate">
                          {r.competitor_name} <span className="text-ink/30 font-normal">· {r.competitor_type}</span>
                        </div>
                        <div className="text-ink/40 text-[10.5px] truncate">
                          {r.location_label} · {r.villa_room_types?.name ?? "semua tipe"} · diamati {fmtDate(r.observed_at)}
                          {r.source_note ? ` · ${r.source_note}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="font-serif text-ink">{fmtCurrency(r.price)}</div>
                        <Badge tone={r.source === "ai_research" ? "pending" : "ok"}>{r.source === "ai_research" ? "AI" : "Manual"}</Badge>
                        <button className="text-[10.5px] text-ruby-400 underline" onClick={() => deleteRate(r.id)}>
                          Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <Modal
        open={periodModal}
        title="Tambah Periode High Season"
        onClose={() => setPeriodModal(false)}
        footer={
          <>
            <Btn onClick={() => setPeriodModal(false)}>Batal</Btn>
            <Btn variant="primary" onClick={submitPeriod}>
              {savingPeriod ? "Menyimpan…" : "Simpan"}
            </Btn>
          </>
        }
      >
        <Field label="Nama periode">
          <input className={inputCls} value={periodForm.label} onChange={(e) => setPeriodForm({ ...periodForm, label: e.target.value })} placeholder="mis. Libur Natal & Tahun Baru" />
        </Field>
        <Field label="Tanggal mulai">
          <input type="date" className={inputCls} value={periodForm.start_date} onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })} />
        </Field>
        <Field label="Tanggal selesai">
          <input type="date" className={inputCls} value={periodForm.end_date} onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })} />
        </Field>
        <Field label="Target kenaikan (%)">
          <input type="number" className={inputCls} value={periodForm.suggested_adjustment_pct} onChange={(e) => setPeriodForm({ ...periodForm, suggested_adjustment_pct: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={rateModal}
        title="Tambah Harga Kompetitor (Manual)"
        onClose={() => setRateModal(false)}
        footer={
          <>
            <Btn onClick={() => setRateModal(false)}>Batal</Btn>
            <Btn variant="primary" onClick={submitRate}>
              {savingRate ? "Menyimpan…" : "Simpan"}
            </Btn>
          </>
        }
      >
        <Field label="Tipe unit kami (opsional)">
          <select className={inputCls} value={rateForm.room_type_id} onChange={(e) => setRateForm({ ...rateForm, room_type_id: e.target.value })}>
            <option value="">Semua tipe</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lokasi">
          <input className={inputCls} value={rateForm.location_label} onChange={(e) => setRateForm({ ...rateForm, location_label: e.target.value })} placeholder="mis. Cariu, Bogor" />
        </Field>
        <Field label="Nama hotel/villa">
          <input className={inputCls} value={rateForm.competitor_name} onChange={(e) => setRateForm({ ...rateForm, competitor_name: e.target.value })} />
        </Field>
        <Field label="Tipe">
          <select className={inputCls} value={rateForm.competitor_type} onChange={(e) => setRateForm({ ...rateForm, competitor_type: e.target.value })}>
            <option value="hotel">Hotel</option>
            <option value="villa">Villa</option>
            <option value="other">Lainnya</option>
          </select>
        </Field>
        <Field label="Harga per malam (Rp)">
          <input type="number" className={inputCls} value={rateForm.price} onChange={(e) => setRateForm({ ...rateForm, price: e.target.value })} />
        </Field>
      </Modal>

      <Modal
        open={researchModal}
        title="Riset Harga Kompetitor via AI"
        onClose={() => setResearchModal(false)}
        footer={
          <>
            <Btn onClick={() => setResearchModal(false)}>Batal</Btn>
            <Btn variant="primary" onClick={submitResearch}>
              {researching ? "Meriset…" : "Mulai Riset"}
            </Btn>
          </>
        }
      >
        <div className="text-[11px] text-ink/50 mb-4">
          AI (Gemini) akan mencari lewat Google hotel/villa nyata di sekitar lokasi yang Anda masukkan, dan melaporkan harga publik yang ditemukan.
          Hasil akan masuk sebagai data "AI" di daftar — tetap perlu Anda review, bisa dihapus kalau tidak relevan.
        </div>
        <Field label="Tipe unit kami">
          <select className={inputCls} value={researchForm.room_type_id} onChange={(e) => setResearchForm({ ...researchForm, room_type_id: e.target.value })}>
            <option value="">Pilih tipe unit…</option>
            {roomTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lokasi villa (untuk riset)">
          <input className={inputCls} value={researchForm.location_label} onChange={(e) => setResearchForm({ ...researchForm, location_label: e.target.value })} placeholder="mis. Cariu, Bogor" />
        </Field>
        {researchError && <div className="text-[11px] text-ruby-400">{researchError}</div>}
      </Modal>
    </AdminShell>
  );
}
