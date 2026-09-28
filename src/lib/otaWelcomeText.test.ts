import { describe, expect, it } from "vitest";
import { bahasaDariNomor, rapikanNama, teksSambutan } from "./otaWelcomeText";

describe("bahasaDariNomor", () => {
  it("nomor Indonesia -> id, lainnya -> en", () => {
    expect(bahasaDariNomor("6281234567890")).toBe("id");
    expect(bahasaDariNomor("081234567890")).toBe("id");
    expect(bahasaDariNomor("+61 412 345 678")).toBe("en");
    expect(bahasaDariNomor("14155550123")).toBe("en");
  });
});

describe("rapikanNama", () => {
  it("huruf kapital semua jadi Title Case (kasus nyata Agoda)", () => {
    expect(rapikanNama("MUHAMMAD DAFFA FAUZAN")).toBe("Muhammad Daffa Fauzan");
  });
  it("nama yang sudah benar dibiarkan", () => {
    expect(rapikanNama("Tubagus Sulton Haqiqi")).toBe("Tubagus Sulton Haqiqi");
    expect(rapikanNama("McDonald")).toBe("McDonald");
  });
  it("spasi berlebih dirapikan, kosong tetap kosong", () => {
    expect(rapikanNama("  lydia   irene ")).toBe("Lydia Irene");
    expect(rapikanNama("   ")).toBe("");
  });
});

describe("teksSambutan", () => {
  it("bahasa Indonesia sesuai teks yang disetujui owner", () => {
    expect(teksSambutan({ nama: "Sari Nurani", sumber: "agoda", checkin: "2026-10-05", checkout: "2026-10-07", bahasa: "id" })).toBe(
      "Halo Kak Sari Nurani 👋\n\n" +
        "Terima kasih telah memilih Loonars Private Living Yogyakarta sebagai tempat berlibur Kakak. " +
        "Booking Kakak melalui Agoda untuk 5 Okt – 7 Okt 2026 sudah kami terima.\n\n" +
        "Kalau ada pertanyaan sebelum kedatangan, silakan balas pesan ini. " +
        "Tim Hospitality Management kami siap membantu. Sampai jumpa di Loonars! 🌿",
    );
  });
  it("bahasa Inggris untuk tamu luar negeri", () => {
    const t = teksSambutan({ nama: "John", sumber: "airbnb", checkin: "2026-12-30", checkout: "2027-01-02", bahasa: "en" });
    expect(t.startsWith("Hi John 👋")).toBe(true);
    expect(t).toContain("your Airbnb booking for 30 Dec – 2 Jan 2027");
  });
  it("tanggal tidak bergeser zona waktu (tanggal kalender, bukan jam)", () => {
    expect(teksSambutan({ nama: "A", sumber: "agoda", checkin: "2026-10-01", checkout: "2026-10-02", bahasa: "id" })).toContain("1 Okt – 2 Okt 2026");
  });
  it("tanpa tautan, nomor rekening, atau tawaran (aturan Airbnb)", () => {
    for (const bahasa of ["id", "en"] as const) {
      const t = teksSambutan({ nama: "A", sumber: "airbnb", checkin: "2026-10-01", checkout: "2026-10-02", bahasa });
      expect(t).not.toMatch(/https?:|www\.|rekening|transfer|diskon|promo|discount/i);
    }
  });
  it("nama platform benar untuk OTA yang diperluas 2026-09-28 (banyak koneksi Cloudbeds owner)", () => {
    expect(teksSambutan({ nama: "A", sumber: "booking.com", checkin: "2026-10-01", checkout: "2026-10-02", bahasa: "id" })).toContain(
      "melalui Booking.com untuk",
    );
    expect(teksSambutan({ nama: "A", sumber: "traveloka", checkin: "2026-10-01", checkout: "2026-10-02", bahasa: "id" })).toContain(
      "melalui Traveloka untuk",
    );
    expect(teksSambutan({ nama: "A", sumber: "tiket", checkin: "2026-10-01", checkout: "2026-10-02", bahasa: "id" })).toContain(
      "melalui Tiket.com untuk",
    );
  });
});
