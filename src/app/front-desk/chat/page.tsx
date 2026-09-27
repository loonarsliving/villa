"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AdminShell } from "../../admin/_shell";
import { FrontDeskShell } from "../_shell";
import { ApiError, localApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import { fmtDateTime, initials } from "@/lib/format";
import { jamSingkat, kunciHari, labelHari, waktuDaftar } from "@/lib/chatFormat";
import { Loading } from "@/components/Card";
import type { WaConversationMessageRow, WaConversationRow, WaStatusTamu } from "@/lib/types";

/**
 * Chat WhatsApp dua-arah untuk resepsionis (persetujuan owner 2026-09-27).
 *
 * Sumbernya nomor utama 082228885223 (diteruskan Mkhsistem ke /api/wa/mirror,
 * disaring hanya tamu dan penanya soal menginap) -- calon tamu ditandai
 * "Prospek", tamu yang sudah/sedang menginap "Menginap"/"Selesai" begitu
 * nomornya cocok dengan booking. Balasan keluar dari nomor yang sama lewat
 * Mkhsistem (src/lib/mkhsistemWa.ts), yang makan beberapa detik -- karena itu
 * balasan langsung tampil sebagai "Mengirim…" dan dikirim di belakang.
 *
 * Tata letak mengikuti WhatsApp: di HP dan tablet daftar percakapan dan isi
 * percakapan tampil bergantian (di HP isi percakapan menutupi seluruh layar;
 * tombol kembali HP/tablet ikut menutupnya). Mulai 1024px keduanya berdampingan
 * setinggi layar -- di tablet tegak, dua kolom di samping menu terlalu sempit.
 */

const statusLabel: Record<WaStatusTamu, string> = { prospek: "Prospek", menginap: "Menginap", selesai: "Selesai" };
const statusChip: Record<WaStatusTamu, string> = {
  prospek: "bg-azure-500/10 text-azure-600",
  menginap: "bg-sage-500/15 text-sage-600",
  selesai: "bg-ink/[0.06] text-ink/50",
};

const POLL_MS = 8000;

type Filter = "semua" | "belum" | "menginap" | "prospek" | "selesai";

interface PesanTertunda {
  tempId: string;
  conversationId: string;
  isi: string;
  status: "mengirim" | "terkirim" | "gagal";
}

function formatPhoneDisplay(phone: string): string {
  return phone.startsWith("62") ? `+${phone}` : phone;
}

function namaPercakapan(c: WaConversationRow): string {
  return c.guests?.nama || c.nama_tampilan || formatPhoneDisplay(c.phone);
}

/** HP: isi percakapan menutupi seluruh layar. */
function layarKecil(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

/** HP dan tablet: daftar dan isi percakapan tampil bergantian (dua kolom baru mulai 1024px). */
function satuPanel(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
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
  const [pending, setPending] = useState<PesanTertunda[]>([]);
  const [filter, setFilter] = useState<Filter>("semua");
  const [cari, setCari] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  // Pengiriman dirantai satu per satu: urutan ke tamu tetap sama dengan urutan diketik.
  const antreanKirim = useRef<Promise<void>>(Promise.resolve());
  // Di layar sentuh, Enter = baris baru (seperti WhatsApp di HP); kirim lewat tombol.
  const layarSentuh = useRef(false);
  // Percakapan yang dibuka di HP menambah satu langkah riwayat, supaya tombol kembali HP menutupnya.
  const riwayatDitambah = useRef(false);

  useEffect(() => {
    layarSentuh.current = window.matchMedia("(pointer: coarse)").matches;
    const onPop = () => {
      if (riwayatDitambah.current) {
        riwayatDitambah.current = false;
        setActiveId(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  // `diam`: pembaruan berkala di latar belakang -- tanpa "Memuat…" (yang
  // mengosongkan percakapan sesaat tiap 8 detik) dan tanpa toast galat.
  const loadMessages = useCallback((id: string, diam = false) => {
    if (!diam) setLoadingMessages(true);
    localApi<WaConversationMessageRow[]>(`/api/chat/conversations/${id}/messages`)
      .then((rows) => {
        // Jawaban untuk percakapan yang sudah ditinggalkan tidak boleh menimpa yang sedang dibuka.
        if (activeIdRef.current !== id) return;
        const baru = rows || [];
        setMessages((prev) =>
          prev.length === baru.length && prev[prev.length - 1]?.id === baru[baru.length - 1]?.id ? prev : baru,
        );
        // Gelembung sementara dilepas hanya setelah pesannya benar-benar ada di riwayat server,
        // di render yang sama -- jadi tidak ada kedipan hilang-muncul, termasuk saat jawaban
        // polling lama (dimulai sebelum pesan tersimpan) datang belakangan.
        setPending((prev) => {
          const sisa = prev.filter(
            (p) => !(p.conversationId === id && p.status === "terkirim" && baru.some((m) => m.arah === "keluar" && m.isi === p.isi)),
          );
          return sisa.length === prev.length ? prev : sisa;
        });
        setConversations((prev) =>
          prev.some((c) => c.id === id && c.unread_count > 0) ? prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)) : prev,
        );
      })
      .catch((e) => {
        if (!diam) toast("⚠", "Gagal memuat percakapan", e instanceof ApiError ? e.message : "Terjadi kesalahan.", "ruby");
      })
      .finally(() => {
        if (!diam) setLoadingMessages(false);
      });
  }, [toast]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return;
    setMessages([]);
    loadMessages(activeId);
    const id = setInterval(() => loadMessages(activeId, true), POLL_MS);
    return () => clearInterval(id);
  }, [activeId, loadMessages]);

  // Isi percakapan di HP menutupi layar -- halaman di belakangnya jangan ikut tergulir.
  useEffect(() => {
    if (!activeId || !layarKecil()) return;
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = semula;
    };
  }, [activeId]);

  // Gulir hanya kotak percakapan (bukan seluruh halaman), dan hanya saat ada pesan baru.
  const lastMessageId = messages[messages.length - 1]?.id;
  const pendingAktif = pending.filter((p) => p.conversationId === activeId);
  useEffect(() => {
    const el = threadRef.current;
    if (el && (lastMessageId || pendingAktif.length)) el.scrollTop = el.scrollHeight;
  }, [lastMessageId, pendingAktif.length, loadingMessages]);

  // Kolom ketik ikut tinggi isinya, sampai kira-kira lima baris.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft, activeId]);

  function bukaPercakapan(id: string) {
    if (id === activeId) return;
    if (satuPanel() && !riwayatDitambah.current) {
      window.history.pushState({ chat: id }, "");
      riwayatDitambah.current = true;
    }
    setActiveId(id);
  }

  function tutupPercakapan() {
    if (riwayatDitambah.current) {
      window.history.back();
    } else {
      setActiveId(null);
    }
  }

  // Pesan langsung tampil sebagai "Mengirim…"; pengirimannya (villa -> Mkhsistem -> WhatsApp)
  // berjalan di belakang supaya resepsionis tidak menunggu beberapa detik setiap kali mengirim.
  function kirim(p: PesanTertunda) {
    const ubah = (status: PesanTertunda["status"]) =>
      setPending((prev) => prev.map((x) => (x.tempId === p.tempId ? { ...x, status } : x)));
    antreanKirim.current = antreanKirim.current.then(async () => {
      try {
        await localApi(`/api/chat/conversations/${p.conversationId}/reply`, {
          method: "POST",
          body: JSON.stringify({ message: p.isi, staffName: user?.nama }),
        });
        ubah("terkirim");
        if (activeIdRef.current === p.conversationId) loadMessages(p.conversationId, true);
        loadConversations();
      } catch (e) {
        ubah("gagal");
        toast("⚠", "Gagal Mengirim", e instanceof ApiError ? e.message : "Pesan tidak terkirim ke WhatsApp.", "ruby");
      }
    });
  }

  function kirimBalasan() {
    const isi = draft.trim();
    if (!activeId || !isi) return;
    const p: PesanTertunda = { tempId: `tmp-${Date.now()}-${Math.random()}`, conversationId: activeId, isi, status: "mengirim" };
    setPending((prev) => [...prev, p]);
    setDraft("");
    inputRef.current?.focus();
    kirim(p);
  }

  function kirimUlang(p: PesanTertunda) {
    setPending((prev) => prev.map((x) => (x.tempId === p.tempId ? { ...x, status: "mengirim" } : x)));
    kirim({ ...p, status: "mengirim" });
  }

  const Shell = user?.role === "admin" ? AdminShell : FrontDeskShell;

  if (!user) {
    return (
      <Shell pageTitle="Chat">
        <Loading />
      </Shell>
    );
  }

  const jumlah: Record<Filter, number> = {
    semua: conversations.length,
    belum: conversations.filter((c) => c.unread_count > 0).length,
    menginap: conversations.filter((c) => c.status_tamu === "menginap").length,
    prospek: conversations.filter((c) => c.status_tamu === "prospek").length,
    selesai: conversations.filter((c) => c.status_tamu === "selesai").length,
  };
  const filterList: { key: Filter; label: string }[] = [
    { key: "semua", label: "Semua" },
    { key: "belum", label: "Belum dibaca" },
    { key: "menginap", label: "Menginap" },
    { key: "prospek", label: "Prospek" },
    { key: "selesai", label: "Selesai" },
  ];
  const kataCari = cari.trim().toLowerCase();
  const angkaCari = kataCari.replace(/\D/g, "");
  const tampil = conversations.filter((c) => {
    if (filter === "belum" && c.unread_count === 0) return false;
    if ((filter === "menginap" || filter === "prospek" || filter === "selesai") && c.status_tamu !== filter) return false;
    if (!kataCari) return true;
    return namaPercakapan(c).toLowerCase().includes(kataCari) || (angkaCari.length >= 3 && c.phone.includes(angkaCari.replace(/^0/, "")));
  });
  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <Shell pageTitle="Chat" pageSub="WhatsApp 0822-2888-5223 — tamu & penanya menginap">
      <div className="md:flex md:flex-col lg:grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] md:h-[calc(100dvh-6.75rem)] lg:h-[calc(100dvh-7rem)] md:bg-base-900 md:border md:border-ink/[0.06] md:rounded-2xl md:shadow-sm md:overflow-hidden">
        {/* ── Daftar percakapan ── */}
        <section className={`${active ? "hidden lg:flex" : "flex"} flex-col min-h-0 md:flex-1 lg:border-r lg:border-ink/[0.06]`}>
          <div className="md:px-4 md:pt-4 pb-3 space-y-3 md:border-b md:border-ink/[0.06]">
            <input
              type="search"
              inputMode="search"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari nama atau nomor…"
              className="w-full h-11 px-4 rounded-xl border border-ink/10 bg-base-900 md:bg-base-800/60 text-base md:text-sm text-ink placeholder:text-ink/35 outline-none focus:border-gold-500 transition-colors"
            />
            <div className="-mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto no-scrollbar">
              {filterList.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-medium border transition-colors ${
                    filter === f.key ? "bg-ink text-white border-ink" : "bg-base-900 text-ink/70 border-ink/10 hover:border-ink/25"
                  }`}
                >
                  {f.label}
                  {jumlah[f.key] > 0 && (
                    <span
                      className={`ml-1.5 inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded-full text-[11px] ${
                        f.key === "belum" ? "bg-ruby-500 text-white" : filter === f.key ? "bg-white/20" : "bg-ink/[0.06]"
                      }`}
                    >
                      {jumlah[f.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-base-900 overflow-hidden rounded-2xl border border-ink/[0.06] md:overflow-y-auto md:rounded-none md:border-0">
            {loadingList ? (
              <Loading />
            ) : tampil.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-ink/40">
                {conversations.length === 0 ? "Belum ada pesan masuk." : "Tidak ada percakapan yang cocok."}
              </div>
            ) : (
              tampil.map((c) => {
                const nama = namaPercakapan(c);
                const aktif = activeId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => bukaPercakapan(c.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-ink/[0.05] last:border-0 transition-colors active:bg-ink/[0.05] ${
                      aktif ? "bg-gold-500/[0.08]" : "hover:bg-ink/[0.03]"
                    }`}
                  >
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-semibold shrink-0 ${
                        c.status_tamu === "menginap" ? "bg-sage-500/15 text-sage-600" : "bg-gold-500/15 text-gold-600"
                      }`}
                    >
                      {initials(nama)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <div className={`flex-1 truncate text-[15px] md:text-sm ${c.unread_count > 0 ? "font-semibold text-ink" : "font-medium text-ink/85"}`}>
                          {nama}
                        </div>
                        <div className={`shrink-0 text-[11px] ${c.unread_count > 0 ? "text-ruby-500 font-semibold" : "text-ink/40"}`}>
                          {waktuDaftar(c.last_message_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className={`flex-1 truncate text-[13px] ${c.unread_count > 0 ? "text-ink/75" : "text-ink/45"}`}>
                          {c.last_message_preview || "—"}
                        </div>
                        {c.unread_count > 0 ? (
                          <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-ruby-500 text-white text-[11px] font-semibold flex items-center justify-center">
                            {c.unread_count}
                          </span>
                        ) : (
                          // Hanya tamu yang sedang menginap diberi label -- sisanya terlihat dari warna
                          // avatar dan filter, dan pratinjau pesan di HP butuh tempat.
                          c.status_tamu === "menginap" && (
                            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${statusChip.menginap}`}>
                              {c.bookings ? `Menginap · ${c.bookings.unit_nomor}` : "Menginap"}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* ── Isi percakapan: layar penuh di HP, panel kanan dari tablet ke atas ── */}
        <section
          className={`${
            active ? "fixed inset-0 z-50 flex md:static md:z-auto md:flex-1" : "hidden lg:flex"
          } flex-col min-h-0 bg-canvas md:bg-base-800/40`}
        >
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-ink/40">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm">Pilih percakapan untuk mulai membalas.</div>
              <div className="text-xs mt-1">Semua jam dalam WIB.</div>
            </div>
          ) : (
            <>
              <header className="shrink-0 flex items-center gap-3 px-2 lg:px-5 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:py-3 bg-base-900 border-b border-ink/[0.06]">
                <button
                  type="button"
                  onClick={tutupPercakapan}
                  aria-label="Kembali ke daftar percakapan"
                  className="lg:hidden w-11 h-11 flex items-center justify-center rounded-full text-2xl text-ink/70 active:bg-ink/[0.06]"
                >
                  ‹
                </button>
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                    active.status_tamu === "menginap" ? "bg-sage-500/15 text-sage-600" : "bg-gold-500/15 text-gold-600"
                  }`}
                >
                  {initials(namaPercakapan(active))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-ink truncate">{namaPercakapan(active)}</div>
                  <div className="text-xs text-ink/50 truncate">
                    <span className="sm:hidden">{statusLabel[active.status_tamu]} · </span>
                    {formatPhoneDisplay(active.phone)}
                    {active.bookings ? ` · Unit ${active.bookings.unit_nomor}` : ""}
                  </div>
                </div>
                <span className={`hidden sm:inline-block shrink-0 mr-2 lg:mr-0 px-2.5 py-1 rounded-full text-xs font-medium ${statusChip[active.status_tamu]}`}>
                  {statusLabel[active.status_tamu]}
                </span>
              </header>

              <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 md:px-6 py-4 space-y-2">
                {loadingMessages ? (
                  <Loading />
                ) : messages.length === 0 && pendingAktif.length === 0 ? (
                  <div className="py-12 text-center text-sm text-ink/40">Belum ada pesan.</div>
                ) : (
                  <>
                    {messages.map((m, i) => {
                      const hariBaru = i === 0 || kunciHari(messages[i - 1].created_at) !== kunciHari(m.created_at);
                      const keluar = m.arah === "keluar";
                      return (
                        <Fragment key={m.id}>
                          {hariBaru && (
                            <div className="flex justify-center py-2">
                              <span className="px-3 py-1 rounded-full bg-base-900 border border-ink/[0.06] text-[11px] font-medium text-ink/50 shadow-sm">
                                {labelHari(m.created_at)}
                              </span>
                            </div>
                          )}
                          <div className={`flex ${keluar ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-3.5 py-2 text-[15px] md:text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm ${
                                keluar ? "bg-gold-500/20 text-ink rounded-br-md" : "bg-base-900 text-ink rounded-bl-md"
                              }`}
                            >
                              {m.media_url && (
                                <a
                                  href={m.media_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 mb-1 py-1 text-sm font-medium text-gold-600 underline underline-offset-2"
                                >
                                  📎 Buka lampiran
                                </a>
                              )}
                              {m.isi || (m.media_url ? "" : "—")}
                              <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-ink/45" title={fmtDateTime(m.created_at)}>
                                {m.is_perintah_otomatis && <span>otomatis ·</span>}
                                {m.dibalas_oleh && <span className="truncate max-w-[120px]">{m.dibalas_oleh} ·</span>}
                                <span>{jamSingkat(m.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}
                    {pendingAktif.map((p) => (
                      <div key={p.tempId} className="flex justify-end">
                        <div
                          className={`max-w-[85%] md:max-w-[70%] rounded-2xl rounded-br-md px-3.5 py-2 text-[15px] md:text-[14px] leading-snug whitespace-pre-wrap break-words shadow-sm bg-gold-500/20 text-ink ${
                            p.status === "gagal" ? "ring-2 ring-ruby-500/60" : ""
                          }`}
                        >
                          {p.isi}
                          <div className="mt-1 flex items-center justify-end gap-2 text-[11px]">
                            {p.status === "gagal" ? (
                              <>
                                <span className="text-ruby-500 font-medium">Gagal terkirim</span>
                                <button
                                  type="button"
                                  onClick={() => kirimUlang(p)}
                                  className="px-2.5 py-1 rounded-full bg-ruby-500 text-white font-semibold"
                                >
                                  Kirim ulang
                                </button>
                              </>
                            ) : (
                              <span className="text-ink/45">{p.status === "terkirim" ? "Terkirim" : "Mengirim…"}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="shrink-0 flex items-end gap-2 px-3 lg:px-5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 bg-base-900 border-t border-ink/[0.06]">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !layarSentuh.current && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      kirimBalasan();
                    }
                  }}
                  placeholder="Tulis balasan…"
                  aria-label="Tulis balasan"
                  className="flex-1 resize-none min-h-[44px] max-h-[132px] py-2.5 px-4 rounded-3xl border border-ink/10 bg-base-800/60 text-base md:text-sm leading-6 text-ink placeholder:text-ink/35 outline-none focus:border-gold-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={kirimBalasan}
                  disabled={!draft.trim()}
                  aria-label="Kirim"
                  className="shrink-0 w-11 h-11 rounded-full bg-gold-500 text-white text-lg flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
                >
                  ➤
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}
