"use client";

import { useEffect, useState } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Loading } from "@/components/Card";
import type { Unit } from "@/lib/types";

const statusColor: Record<string, string> = {
  available: "border-sage-500/30",
  occupied: "bg-base-700 border-gold-500/25",
  checkout: "bg-gold-500/10 border-gold-500/40 border-dashed",
  dirty: "border-dashed border-white/15",
  maintenance: "bg-ruby-500/10 border-ruby-500/30",
};
const numColor: Record<string, string> = {
  available: "text-sage-400",
  occupied: "text-gold-500",
  checkout: "text-gold-500",
  dirty: "text-white/30",
  maintenance: "text-ruby-400",
};
const statusLabel: Record<string, string> = {
  available: "Tersedia",
  occupied: "Terisi",
  checkout: "Checkout",
  dirty: "Kotor",
  maintenance: "Maintenance",
};

export default function SiteplanPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api.get<Unit[]>("/units").then((u) => {
      setUnits(u || []);
      setLoading(false);
    });
  }, []);

  const bloks = ["A", "B", "C"] as const;
  const counts: Record<string, number> = { A: 5, B: 4, C: 4 };

  return (
    <FrontDeskShell pageTitle="Siteplan Villa" pageSub="13 unit · Blok A, B, C">
      {loading ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          {bloks.map((blok) => {
            const blokUnits = units.filter((u) => u.blok === blok);
            const terisi = blokUnits.filter((u) => u.status === "occupied").length;
            return (
              <div key={blok} className="bg-base-800 border border-white/[0.08] rounded-md overflow-hidden">
                <div className="px-4 py-2.5 bg-gold-500/10 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="font-serif text-base font-light text-gold-500 tracking-wide">Blok {blok}</div>
                  <div className="text-[9.5px] text-white/30">{counts[blok]} unit · {terisi} terisi</div>
                </div>
                <div className="flex gap-2 flex-wrap p-4">
                  {blokUnits.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => toast("◈", `Unit ${u.nomor}`, `${statusLabel[u.status]} · ${u.owner_nama || "Belum ada pemilik"}`, "gold")}
                      className={`bg-base-900 border rounded p-3.5 min-w-[88px] text-center hover:border-gold-500 transition-colors ${statusColor[u.status]}`}
                    >
                      <div className={`font-serif text-xl font-light ${numColor[u.status]}`}>{u.nomor}</div>
                      <div className="text-[9px] text-white/30 mt-1">{statusLabel[u.status]}</div>
                      {u.owner_nama && <div className="text-[8.5px] text-white/30 mt-1 truncate max-w-[80px]">{u.owner_nama}</div>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FrontDeskShell>
  );
}
