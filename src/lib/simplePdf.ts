/**
 * Penulis PDF teks satu halaman (A4) tanpa pustaka tambahan.
 *
 * Dipakai untuk unduhan Laporan Bulanan investor. Sengaja minimal: hanya
 * teks Helvetica/Helvetica-Bold dan garis horizontal -- cukup untuk tabel
 * angka, dan tidak menambah dependensi ke bundle hanya demi satu tombol.
 *
 * Karakter di luar Latin-1 (mis. em dash, emoji) diganti agar setiap
 * karakter tetap satu byte; offset xref dihitung dari panjang string, jadi
 * aturan "satu karakter = satu byte" WAJIB terjaga.
 */

export type PdfItem =
  | { kind: "text"; x: number; y: number; text: string; size?: number; bold?: boolean; align?: "left" | "right" }
  | { kind: "line"; x1: number; x2: number; y: number; width?: number };

export const A4_WIDTH = 595;
export const A4_HEIGHT = 842;

const REPLACEMENTS: Record<string, string> = {
  "—": "-",
  "–": "-",
  "−": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
  " ": " ",
};

/** Latin-1 aman untuk WinAnsiEncoding; selain itu diganti atau dibuang. */
export function toPdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else if (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e) out += ch;
    else if (ch.charCodeAt(0) >= 0xa0 && ch.charCodeAt(0) <= 0xff && ch.length === 1) out += ch;
    else out += "?";
  }
  return out;
}

function escapePdfString(text: string): string {
  return toPdfSafe(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Perkiraan lebar teks Helvetica untuk rata kanan. Tidak perlu presisi
 * metrik font penuh: angka dan titik ribuan Helvetica semuanya 556/1000 dan
 * 278/1000, yang dipakai untuk kolom nominal.
 */
function approxWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") units += 556;
    else if (ch === "." || ch === "," || ch === " ") units += 278;
    else if (ch === "-") units += 333;
    else if (ch >= "A" && ch <= "Z") units += bold ? 722 : 667;
    else units += bold ? 556 : 500;
  }
  return (units / 1000) * size;
}

export function buildPdf(items: PdfItem[]): Uint8Array {
  const ops: string[] = [];
  for (const it of items) {
    if (it.kind === "line") {
      ops.push(`${it.width ?? 0.5} w ${it.x1} ${it.y} m ${it.x2} ${it.y} l S`);
      continue;
    }
    const size = it.size ?? 10;
    const safe = toPdfSafe(it.text);
    const x = it.align === "right" ? it.x - approxWidth(safe, size, !!it.bold) : it.x;
    ops.push(`BT /${it.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${it.y} Td (${escapePdfString(safe)}) Tj ET`);
  }
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
