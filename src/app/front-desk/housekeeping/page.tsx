"use client";

import { useEffect, useState } from "react";
import { FrontDeskShell } from "../_shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { todayISO } from "@/lib/format";
import { Card, CardHeader, Loading } from "@/components/Card";
import type { HousekeepingTask } from "@/lib/types";

export default function HousekeepingPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<HousekeepingTask[]>(`/housekeeping?tgl=${todayISO()}`).then((t) => {
      setTasks(t || []);
      setLoading(false);
    });
  }, []);

  async function toggle(task: HousekeepingTask) {
    if (task.status === "done") return;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: "done" } : t)));
    await api.patch("/housekeeping/done", { task_id: task.id, unit_id: task.unit_id || null, done_by: user?.nama || "Staff" });
    toast("🧹", "Selesai", `${task.unit_nomor || "Area umum"} — bersih.`, "sage");
  }

  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <FrontDeskShell pageTitle="Housekeeping" pageSub="Checklist hari ini">
      <Card>
        <CardHeader title="Housekeeping" subtitle="Checklist hari ini" action={<div className="text-[11px] text-ink/30 shrink-0">{done} / {tasks.length} selesai</div>} />
        {loading ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <Loading label="Tidak ada tugas hari ini" />
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => toggle(t)}
              className="flex items-center gap-2.5 px-4 sm:px-5 py-2.5 border-b border-ink/[0.05] last:border-0 cursor-pointer hover:bg-base-800"
            >
              <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] ${t.status === "done" ? "bg-sage-500 border-sage-500 text-ink" : "border-ink/15"}`}>
                {t.status === "done" ? "✓" : ""}
              </div>
              <div className={`text-[11.5px] flex-1 ${t.status === "done" ? "line-through text-ink/30" : "text-ink/50"}`}>
                {t.jenis === "amenities" && <span className="mr-1">🧴</span>}
                {t.tugas}
              </div>
              <div className="text-[9.5px] text-ink/30 shrink-0">{t.unit_nomor || "Area umum"}</div>
            </div>
          ))
        )}
      </Card>
    </FrontDeskShell>
  );
}
