"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminShell } from "../../admin/_shell";
import { FrontDeskShell } from "../_shell";
import { ApiError, localApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Loading, Badge } from "@/components/Card";
import { StatCard } from "@/components/StatCard";
import type { WaConversationMessageRow, WaConversationRow, WaStatusTamu } from "@/lib/types";

/**
 * Chat WhatsApp dua-arah untuk resepsionis (persetujuan owner 2026-09-27).
 *
 * Sebelum ini, pesan bebas dari tamu ke nomor WA villa yang bukan perintah
 * baku (LUNAS/PROMO/dll.) dibuang begitu saja oleh /api/wa/webhook -- tidak
 * pernah tersimpan di mana pun. Halaman ini yang pertama menampilkannya.
 *
 * Sumbernya nomor WA villa sendiri (WhaCenter, lihat src/lib/whacenter.ts) --
 * mencakup calon tamu yang bertanya soal sewa (belum tercocokkan ke booking
 * mana pun, ditandai "Prospek") dan tamu yang sudah/sedang menginap
 * (ditandai "Menginap"/"Selesai" begitu nomornya cocok dengan booking).
 * Bukan integrasi baru -- pengiriman baru masih lewat sendWhatsAppText yang
 * sudah ada, cuma sekarang dua arahnya tersimpan dan bisa dibalas dari sini.
 */

const statusLabel: Record<WaStatusTamu, string> = { prospek: "Prospek", menginap: "Menginap", selesai: "Selesai" };
const statusTone: Record<WaStatusTamu, "ok" | "pending" | "danger"> = { prospek: "pending", menginap: "ok", selesai: "danger" };

const POLL_MS = 8000;

function formatPhoneDisplay(phone: string): string {
  return phone.startsWith("62") ? `+${phone}` : phone;
}

export default function ChatPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [conversations, setConversations] = useState<WaConversationRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaConversationMessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(() => {
    localApi<WaConversationRow[]>("/api/chat/conversations")
      .then((rows) => setConversations(rows || []))
      .catch((e) => {
        // Polling diam-diam saja untuk kegagalan berulang -- toast tiap 8
        // detik saat jaringan sedang bermasalah lebih mengganggu daripada
        // membantu. Kegagalan pertama tetap dilaporkan.
        if (loadingList) toast("⚠", "Gagal memuat chat", e instanceof ApiError ? e.message : "Periksa koneksi.", "ruby");
      })
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    loadConversations();
    const id = setInterval(loadConversations, POLL_MS);
    return () => clearInterval(id);
  }, [user, loadConversations]);

  const loadMessages = useCallback((id: string) => {
    setLoadingMessages(true);
    localApi<WaConversationMessageRow[]>(`/api/chat/conversations/${id}/messages`)
      .then((rows) => {
        setMessages(rows || []);
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      })
      .catch((e) => toast("⚠", "Gagal memuat percakapan", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby"))
      .finally(() => setLoadingMessages(false));
  }, [toast]);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId);
    const id = setInterval(() => loadMessages(activeId), POLL_MS);
    return () => clearInterval(id);
  }, [activeId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function kirimBalasan() {
    if (!activeId || !draft.trim() || sending) return;
    setSending(true);
    const isi = draft.trim();
    try {
      await localApi(`/api/chat/conversations/${activeId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: isi, staffName: user?.nama }),
      });
      setDraft("");
      loadMessages(activeId);
      loadConversations();
    } catch (e) {
      toast("⚠", "Gagal Mengirim", e instanceof ApiError ? e.message : "Pesan tidak terkirim ke WhatsApp.", "ruby");
    } finally {
      setSending(false);
    }
  }

  const Shell = user?.role === "admin" ? AdminShell : FrontDeskShell;

  if (!user) {
    return (
      <Shell pageTitle="Chat">
        <Loading />
      </Shell>
    );
  }

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
  const totalMenginap = conversations.filter((c) => c.status_tamu === "menginap").length;
  const totalProspek = conversations.filter((c) => c.status_tamu === "prospek").length;
  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <Shell pageTitle="Chat" pageSub="WhatsApp villa — dua arah, prospek & tamu menginap">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Belum Dibaca" value={String(totalUnread)} accent={totalUnread ? "gold" : "neutral"} icon="✉" />
        <StatCard label="Sedang Menginap" value={String(totalMenginap)} accent="sage" icon="🏡" />
        <StatCard label="Prospek / Pertanyaan Sewa" value={String(totalProspek)} accent="azure" icon="💬" />
        <StatCard label="Total Percakapan" value={String(conversations.length)} accent="neutral" icon="◈" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4" style={{ minHeight: 520 }}>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Percakapan" subtitle={`${conversations.length} nomor`} />
            <div className="max-h-[560px] overflow-y-auto">
              {loadingList ? (
                <Loading />
              ) : conversations.length === 0 ? (
                <Loading label="Belum ada pesan masuk" />
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-ink/[0.05] last:border-0 hover:bg-ink/[0.03] transition ${
                      activeId === c.id ? "bg-gold-500/[0.06]" : ""
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gold-500/10 flex items-center justify-center text-sm shrink-0">
                      {c.status_tamu === "menginap" ? "🏡" : "💬"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-xs font-medium text-ink/80 truncate">
                          {c.guests?.nama || c.nama_tampilan || formatPhoneDisplay(c.phone)}
                        </div>
                        {c.unread_count > 0 && (
                          <span className="shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-ruby-500 text-white text-[9px] font-semibold flex items-center justify-center">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-ink/30 mt-0.5 truncate">{c.last_message_preview || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9px] text-ink/20">{fmtDateTime(c.last_message_at)}</div>
                      <Badge tone={statusTone[c.status_tamu]}>
                        {c.bookings ? `${statusLabel[c.status_tamu]} · Unit ${c.bookings.unit_nomor}` : statusLabel[c.status_tamu]}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="flex flex-col h-full">
            {!active ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <Loading label="Pilih percakapan di sebelah kiri" />
              </div>
            ) : (
              <>
                <CardHeader
                  title={active.guests?.nama || active.nama_tampilan || formatPhoneDisplay(active.phone)}
                  subtitle={`${formatPhoneDisplay(active.phone)}${active.bookings ? ` · Unit ${active.bookings.unit_nomor}` : ""}`}
                  action={<Badge tone={statusTone[active.status_tamu]}>{statusLabel[active.status_tamu]}</Badge>}
                />
                <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-2.5" style={{ maxHeight: 440 }}>
                  {loadingMessages ? (
                    <Loading />
                  ) : messages.length === 0 ? (
                    <Loading label="Belum ada pesan" />
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={`flex ${m.arah === "keluar" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-lg px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words ${
                            m.arah === "keluar" ? "bg-gold-500/15 text-ink" : "bg-base-800 text-ink/80"
                          }`}
                        >
                          {m.media_url && (
                            <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="block text-gold-500 text-[10px] mb-1">
                              📎 Lampiran
                            </a>
                          )}
                          {m.isi || (m.media_url ? "" : "—")}
                          <div className="text-[9px] text-ink/30 mt-1 flex items-center gap-1.5">
                            {fmtDateTime(m.created_at)}
                            {m.is_perintah_otomatis && <span>· otomatis sistem</span>}
                            {m.dibalas_oleh && <span>· {m.dibalas_oleh}</span>}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="px-4 sm:px-5 py-3 border-t border-ink/[0.05] flex gap-2">
                  <input
                    className="flex-1 py-2.5 px-3 rounded-lg border border-ink/10 bg-base-800/60 text-[12px] text-ink outline-none focus:border-gold-500 transition-colors"
                    placeholder="Tulis balasan…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        kirimBalasan();
                      }
                    }}
                  />
                  <button
                    onClick={kirimBalasan}
                    disabled={sending || !draft.trim()}
                    className="px-4 py-2.5 rounded-lg bg-gold-500 text-base-950 text-[11.5px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sending ? "Mengirim…" : "Kirim"}
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
