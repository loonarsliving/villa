"use client";

import { useEffect, useMemo, useState } from "react";
import { ManagerShell } from "../_shell";
import { localApi } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Card, CardHeader, Loading, Empty, Badge } from "@/components/Card";
import { Btn } from "@/components/Modal";

interface KamarEl {
  id: string;
  nomor: string;
  status: "available" | "occupied" | "dirty" | "maintenance";
  catatan: string | null;
  diblokir_cloudbeds: boolean;
  el_room_types: { nama: string; sort_order: number } | null;
}

const LABEL: Record<KamarEl["status"], string> = { available: "Dibuka", occupied: "Terisi", dirty: "Kotor", maintenance: "Ditutup" };
const TONE: Record<KamarEl["status"], "ok" | "pending" | "danger"> = { available: "ok", occupied: "pending", dirty: "pending", maintenance: "danger" };

/**
 * Manager villa membuka/menutup kamar Loonars Excellent Living. Owner
 * 2026-11-03: semua kamar EL ditutup (maintenance) sampai diaktifkan dari
 * halaman manager villa.
 */
export default function ManagerKamarElPage() {
  const toast = useToast();
  const [kamar, setKamar] = useState<KamarEl[] | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    localApi<KamarEl[]>("/api/manager/el-kamar").then(setKamar).catch((e) => {
      setKamar([]);
      toast("⚠", "Gagal memuat", e instanceof Error ? e.message : String(e), "ruby");
    });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const perTipe = useMemo(() => {
    const m = new Map<string, KamarEl[]>();
    for (const k of kamar ?? []) {
      const t = k.el_room_types?.nama ?? "Lainnya";
      m.set(t, [...(m.get(t) ?? []), k]);
    }
    return [...m.entries()];
  }, [kamar]);

  async function ubah(ids: string[], aktif: boolean) {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await localApi<{ diubah: number; dilewati: string[] }>("/api/manager/el-kamar", { method: "PATCH", body: JSON.stringify({ ids, aktif }) });
      toast("✓", aktif ? "Kamar dibuka" : "Kamar ditutup", `${r.diubah} kamar diubah${r.dilewati.length ? `, ${r.dilewati.length} dilewati` : ""}.`, "sage");
      load();
    } catch (e) {
      toast("⚠", "Gagal", e instanceof Error ? e.message : String(e), "ruby");
    } finally {
      setBusy(false);
    }
  }

  const bisaDibuka = (k: KamarEl) => k.status === "maintenance" && !k.diblokir_cloudbeds;

  return (
    <ManagerShell pageTitle="Kamar Excellent Living" pageSub="Buka atau tutup kamar EL untuk dijual">
      <div className="mb-5 rounded-xl px-4 py-3 text-[12px] bg-gold-500/10 text-gold-700">
        Kamar yang <b>Ditutup</b> tidak bisa dipesan di front desk EL dan tidak tampil tersedia di website. Kamar baru dari Cloudbeds otomatis masuk sebagai Ditutup.
        Kamar bertanda <b>diblokir di Cloudbeds</b> baru bisa dibuka setelah blokirnya dibuka di Cloudbeds.
      </div>
      {!kamar ? (
        <Loading />
      ) : kamar.length === 0 ? (
        <Empty label="Belum ada kamar Excellent Living" />
      ) : (
        perTipe.map(([tipe, list]) => (
          <Card key={tipe} className="mb-5">
            <CardHeader
              title={tipe}
              subtitle={`${list.filter((k) => k.status !== "maintenance").length} dari ${list.length} kamar dibuka`}
              action={
                <span className="flex gap-2">
                  <Btn disabled={busy || !list.some(bisaDibuka)} onClick={() => ubah(list.filter(bisaDibuka).map((k) => k.id), true)}>Buka semua</Btn>
                  <Btn disabled={busy || !list.some((k) => k.status === "available")} onClick={() => ubah(list.filter((k) => k.status === "available").map((k) => k.id), false)}>Tutup semua</Btn>
                </span>
              }
            />
            <div className="divide-y divide-ink/[0.05]">
              {list.map((k) => (
                <div key={k.id} className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[12px]">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{k.nomor}</span>
                    <Badge tone={TONE[k.status]}>{LABEL[k.status]}</Badge>
                    {k.diblokir_cloudbeds && <span className="text-[11px] text-ruby-500">diblokir di Cloudbeds</span>}
                  </span>
                  {k.status === "maintenance" ? (
                    <Btn variant="primary" disabled={busy || !bisaDibuka(k)} onClick={() => ubah([k.id], true)}>Buka</Btn>
                  ) : k.status === "available" ? (
                    <Btn disabled={busy} onClick={() => ubah([k.id], false)}>Tutup</Btn>
                  ) : (
                    <span className="text-[11px] text-ink/40">sedang {LABEL[k.status].toLowerCase()}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </ManagerShell>
  );
}
