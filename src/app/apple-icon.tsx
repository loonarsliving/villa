import { ImageResponse } from "next/og";

/** Ikon layar utama iPhone (180×180) -- sama dengan src/app/icon.tsx. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 112,
          fontWeight: 700,
          fontFamily: "serif",
        }}
      >
        L
      </div>
    ),
    size,
  );
}
