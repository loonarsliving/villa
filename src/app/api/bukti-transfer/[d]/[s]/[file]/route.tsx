import { ImageResponse } from "next/og";
import { bacaIsiBukti } from "@/lib/buktiTransfer";
import { TARGET_OPEX_PCT, namaBulan, nomorBukti, rupiah, tanggalPanjang, type IsiBukti } from "@/lib/buktiTransferData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gambar bukti transfer dividen versi Loonars. Publik (WhaCenter harus bisa
 * mengunduhnya tanpa sesi), tapi isinya hanya dari URL yang ditandatangani
 * mesin -- lihat src/lib/buktiTransfer.ts. URL-nya berakhiran .png
 * (segmen [file]) karena WhaCenter mengenali jenis lampiran dari URL. Tanpa tanda tangan yang sah: 404.
 */

const W = 1080;
const H = 1960;
const C = { brown: "#3e2c26", brown2: "#5a4239", gold: "#b08d57", cream: "#f7f1e8", line: "#e6dccd", muted: "#8a7a70", card: "#fffdf9", green: "#2f7d55", bg: "#efe6d8" };

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" | "italic" };
let fontCache: Promise<Font[]> | null = null;

/** TTF dari Google Fonts (tanpa User-Agent Google menjawab dengan TTF, yang bisa dibaca Satori). Gagal = huruf bawaan. */
async function muatFont(family: string, spec: string, name: string, weight: 400 | 600, style: "normal" | "italic"): Promise<Font | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:${spec}`, { signal: AbortSignal.timeout(5000) })).text();
    const url = css.match(/src: url\((.+?)\)/)?.[1];
    if (!url) return null;
    return { name, data: await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer(), weight, style };
  } catch {
    return null;
  }
}

function fonts(): Promise<Font[]> {
  fontCache ??= Promise.all([
    muatFont("Inter", "wght@400", "Inter", 400, "normal"),
    muatFont("Inter", "wght@600", "Inter", 600, "normal"),
    muatFont("Cormorant+Garamond", "wght@600", "Cormorant", 600, "normal"),
    muatFont("Cormorant+Garamond", "ital,wght@1,500", "Cormorant", 400, "italic"),
  ]).then((f) => {
    const ok = f.filter((x): x is Font => !!x);
    if (ok.length < 4) fontCache = null; // coba lagi di permintaan berikutnya
    return ok;
  });
  return fontCache;
}

function Baris({ k, v, sub, tebal }: { k: string; v: string; sub?: string; tebal?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: tebal ? "none" : `1px dashed ${C.line}`, fontSize: tebal ? 21 : 19 }}>
      <div style={{ display: "flex", flexDirection: "column", maxWidth: 600 }}>
        <span style={{ color: tebal ? C.brown : C.brown2, fontWeight: tebal ? 600 : 400 }}>{k}</span>
        {sub ? <span style={{ fontSize: 15, color: C.muted, marginTop: 4 }}>{sub}</span> : null}
      </div>
      <span style={{ fontWeight: 600, color: C.brown }}>{v}</span>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", borderBottom: `1px dashed ${C.line}`, fontSize: 20 }}>
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}

function Bukti({ isi, logo }: { isi: IsiBukti; logo: string }) {
  const r = isi.r;
  const bulan = namaBulan(isi.periode);
  const namaBulanSaja = bulan.split(" ")[0];
  const nUnit = isi.units.length;
  const keterangan = isi.tetap ? "Pemasukan tetap" : `${nUnit > 1 ? `${nUnit} unit × ${rupiah(isi.per_unit)} · ` : ""}Bagi hasil & jaminan minimal`;
  return (
    <div style={{ width: W, height: H, display: "flex", background: C.bg, padding: 56, fontFamily: "Inter", color: C.brown }}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", background: C.card, borderRadius: 28, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.brown, padding: "44px 56px 38px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={107} height={120} alt="" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 15, letterSpacing: 4, color: C.gold, fontWeight: 600 }}>BUKTI TRANSFER</span>
            <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 46, color: C.cream, marginTop: 8 }}>Bagi Hasil Investor</span>
            <span style={{ fontSize: 16, color: "#cdbfae", marginTop: 10 }}>No. {nomorBukti(isi)}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", padding: "30px 56px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", width: 60, height: 60, borderRadius: 30, background: C.green, alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 32, fontWeight: 600 }}>✓</div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 18 }}>
            <span style={{ fontSize: 24, fontWeight: 600 }}>Transfer Berhasil</span>
            <span style={{ fontSize: 17, color: C.muted, marginTop: 4 }}>{tanggalPanjang(isi.tgl)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "38px 56px 32px", background: C.cream }}>
          <span style={{ fontSize: 16, letterSpacing: 3, color: C.muted }}>JUMLAH DITERIMA</span>
          <div style={{ display: "flex", alignItems: "baseline", marginTop: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 40, color: C.brown2, marginRight: 12 }}>Rp</span>
            <span style={{ fontWeight: 600, fontSize: 80, letterSpacing: -2 }}>{Math.round(isi.jumlah).toLocaleString("id-ID")}</span>
          </div>
          <span style={{ fontSize: 18, color: C.brown2, marginTop: 2 }}>{`${keterangan} · Periode ${bulan}`}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "16px 56px 8px" }}>
          <Detail k="Penerima" v={isi.nama} />
          <Detail k="Bank Tujuan" v={isi.bank ?? "—"} />
          <Detail k="No. Rekening" v={isi.rek4 ? `•••• ${isi.rek4}` : "—"} />
          {nUnit ? <Detail k="Unit" v={isi.units.join(" & ")} /> : null}
          <Detail k="Dari" v="PT Maha Karya Haluoleo" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", margin: "10px 56px 0", border: `1px solid ${C.line}`, borderRadius: 18, padding: "6px 32px 14px", background: "#fffaf2" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "18px 0 12px", borderBottom: `2px solid ${C.gold}` }}>
            <span style={{ fontFamily: "Cormorant", fontWeight: 600, fontSize: 32 }}>{`Ringkasan Villa ${bulan}`}</span>
            <span style={{ fontSize: 15, color: C.muted }}>{`periode 1–${isi.hari} ${namaBulanSaja}`}</span>
          </div>
          <Baris k="Pendapatan villa" sub={`${r.malam_terisi} malam terisi`} v={rupiah(r.pendapatan)} tebal />
          <span style={{ fontSize: 14, letterSpacing: 3, color: C.gold, fontWeight: 600, padding: "16px 0 2px" }}>BIAYA OPERASIONAL (OPEX)</span>
          <Baris k="Biaya per malam terisi" sub={`listrik kamar, laundry, amenities, internet, listrik resepsionis, Cloudbeds · ${r.malam_terisi} × ${rupiah(r.cogs_per_malam)}`} v={rupiah(r.biaya_per_malam)} />
          <Baris k={`Gaji staf 1–${isi.hari} ${namaBulanSaja}`} sub={`${r.staf_orang} orang: ${r.staf}`} v={rupiah(r.gaji)} />
          <Baris k="Total biaya operasional (aktual)" sub={`${r.opex_pct.toLocaleString("id-ID")}% dari pendapatan villa`} v={rupiah(r.opex_total)} tebal />
          <span style={{ fontSize: 14, letterSpacing: 3, color: C.gold, fontWeight: 600, padding: "14px 0 2px" }}>KOMITMEN LOONARS</span>
          <Baris k="Target OPEX maksimal" sub={`${TARGET_OPEX_PCT}% dari pendapatan villa`} v={rupiah(r.target_opex)} />
          {r.kelebihan_opex > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", background: C.green, color: "#fff", borderRadius: 10, padding: "16px 18px", margin: "10px 0 6px", fontSize: 21, fontWeight: 600 }}>
              <span>Kelebihan OPEX ditanggung Loonars</span>
              <span>{rupiah(r.kelebihan_opex)}</span>
            </div>
          ) : null}
          <div style={{ display: "flex", background: "#f3ead9", borderRadius: 12, padding: "16px 20px", marginTop: 6, fontSize: 17, lineHeight: 1.5 }}>
            {r.kelebihan_opex > 0
              ? `Semua angka di atas adalah angka sebenarnya. Bulan ini OPEX melebihi target ${TARGET_OPEX_PCT}%, dan kelebihannya sebesar ${rupiah(r.kelebihan_opex)} ditanggung sepenuhnya oleh Loonars sebagai pengelola, tidak dibebankan kepada investor.`
              : `Semua angka di atas adalah angka sebenarnya. Bulan ini OPEX berada dalam target ${TARGET_OPEX_PCT}%. Bila suatu saat melebihi target, kelebihannya ditanggung sepenuhnya oleh Loonars sebagai pengelola.`}
          </div>
        </div>

        <div style={{ display: "flex", margin: "24px 56px 0", padding: "24px 30px", borderLeft: `4px solid ${C.gold}`, background: C.cream, fontFamily: "Cormorant", fontStyle: "italic", fontSize: 27, color: C.brown2 }}>
          Terima kasih atas kepercayaan Bapak/Ibu sebagai bagian dari keluarga Loonars.
        </div>

        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", justifyContent: "space-between", background: C.brown, color: "#d9cbb8", padding: "24px 56px", fontSize: 15 }}>
          <span style={{ color: C.gold, fontWeight: 600, letterSpacing: 4 }}>LOONARS · EXCELLENT LIVING</span>
          <span>Dokumen ini diterbitkan oleh PT Maha Karya Haluoleo</span>
        </div>
      </div>
    </div>
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ d: string; s: string; file: string }> }) {
  const url = new URL(request.url);
  const { d, s } = await params;
  const isi = bacaIsiBukti(d, s);
  if (!isi) return new Response("Not found", { status: 404 });
  return new ImageResponse(<Bukti isi={isi} logo={`${url.origin}/branding/logo-loonars-cream.png`} />, {
    width: W,
    height: H,
    fonts: await fonts(),
    headers: { "Cache-Control": "private, max-age=86400" },
  });
}
