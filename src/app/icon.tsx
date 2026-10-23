import { ImageResponse } from "next/og";

/**
 * Ikon aplikasi dibuat dari kode (tanpa file gambar biner di repo): monogram
 * "L" emas di atas hijau sage. Dipakai favicon, manifest (/icon/192,
 * /icon/512), dan notifikasi push (public/sw.js).
 */
export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> | string }) {
  const size = Number(await id) || 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#456147",
          color: "#d9b876",
          fontSize: size * 0.62,
          fontWeight: 700,
          fontFamily: "serif",
        }}
      >
        L
      </div>
    ),
    { width: size, height: size },
  );
}
