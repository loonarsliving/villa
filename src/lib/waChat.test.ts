import { describe, expect, it } from "vitest";
import { akhiranNomor, cukupUntukMenebakBahasa, dariTombolWebsite, menyebutSewaVilla, pilihBookingTerbaik, teksSapaanPertama } from "./waChat";

describe("cukupUntukMenebakBahasa", () => {
  it("jawaban pendek tidak dipakai menebak bahasa (tamu Indonesia yang menjawab 'ok')", () => {
    expect(cukupUntukMenebakBahasa("ok")).toBe(false);
    expect(cukupUntukMenebakBahasa("oke kak")).toBe(false);
    expect(cukupUntukMenebakBahasa("👍🙏")).toBe(false);
    expect(cukupUntukMenebakBahasa("thanks!")).toBe(false);
  });
  it("kalimat biasa cukup", () => {
    expect(cukupUntukMenebakBahasa("Is the pool heated?")).toBe(true);
    expect(cukupUntukMenebakBahasa("Apakah kolamnya air hangat?")).toBe(true);
  });
  it("huruf non-Latin jelas bahasanya walau pendek", () => {
    expect(cukupUntukMenebakBahasa("你好")).toBe(true);
    expect(cukupUntukMenebakBahasa("こんにちは")).toBe(true);
    expect(cukupUntukMenebakBahasa("안녕하세요")).toBe(true);
    expect(cukupUntukMenebakBahasa("مرحبا")).toBe(true);
  });
});

describe("teksSapaanPertama", () => {
  it("menyapa dengan nama WhatsApp dan menyerahkan ke Hospitality Management", () => {
    const t = teksSapaanPertama("Avi Perdana");
    expect(t.startsWith("Halo Kak Avi Perdana,")).toBe(true);
    expect(t).toContain("Loonars Private Living Yogyakarta");
    expect(t).toContain("tim Hospitality Management");
  });
  it("tidak bertanya dan tidak menawarkan apa pun (permintaan owner)", () => {
    const t = teksSapaanPertama("Avi");
    expect(t).not.toContain("?");
    expect(t.toLowerCase()).not.toMatch(/nomor|skincare|beauty|pilih|\[/);
  });
  it("tanpa nama, atau nama aneh yang terlalu panjang, cukup 'Halo Kak,'", () => {
    expect(teksSapaanPertama(undefined).startsWith("Halo Kak,")).toBe(true);
    expect(teksSapaanPertama("   ").startsWith("Halo Kak,")).toBe(true);
    expect(teksSapaanPertama("x".repeat(41)).startsWith("Halo Kak,")).toBe(true);
  });
});

describe("dariTombolWebsite", () => {
  it("teks tombol Private Living di loonars.id dikenali", () => {
    expect(dariTombolWebsite("Halo, saya ingin tanya soal menginap di Loonars Private Living Yogyakarta")).toBe(true);
    expect(dariTombolWebsite("Halo, saya ada pertanyaan soal menginap di Loonars Living Yogyakarta")).toBe(true);
  });
  it("teks tombol booking dan 'sudah terlanjur membayar' di formulir booking dikenali", () => {
    expect(dariTombolWebsite("Halo Loonars Private Living! Saya baru saja booking:\nUnit: A2")).toBe(true);
    expect(dariTombolWebsite("Halo Loonars Private Living, saya sudah terlanjur membayar booking yang waktunya habis.")).toBe(true);
  });
  it("obrolan kerja karyawan yang menyebut 'menginap' atau 'Private Living' TIDAK dianggap dari website", () => {
    expect(dariTombolWebsite("Tamu yang menginap di A2 komplain AC")).toBe(false);
    expect(dariTombolWebsite("Harga Loonars Private Living akhir pekan dinaikkan ya")).toBe(false);
    expect(dariTombolWebsite("Halo, saya tertarik Loonars Excellent Living")).toBe(false);
  });
});

describe("akhiranNomor", () => {
  it("9 digit terakhir, sama untuk format 0 dan 62 (aturan Mkhsistem)", () => {
    expect(akhiranNomor("081400441872")).toBe(akhiranNomor("6281400441872"));
    expect(akhiranNomor("+62 814-0044-1872")).toBe("400441872");
  });
});

describe("menyebutSewaVilla", () => {
  it("teks otomatis tombol Private Living di loonars.id lolos", () => {
    expect(menyebutSewaVilla("Halo, saya ingin tanya soal booking Loonars Private Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo, saya ada pertanyaan soal menginap di Loonars Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo, saya ingin booking Loonars Private Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo Loonars Private Living! Saya baru saja booking:\nUnit: A2")).toBe(true);
  });
  it("dua pilihan tombol WhatsApp loonars.id (WaPilihan): hanya 'Tanya menginap' yang lolos", () => {
    expect(menyebutSewaVilla("Halo, saya ingin tanya soal menginap di Loonars Private Living Yogyakarta")).toBe(true);
    expect(menyebutSewaVilla("Halo, saya tertarik membeli villa Loonars")).toBe(false);
    expect(menyebutSewaVilla("Halo, saya ingin tanya produk Loonars Beauty")).toBe(false);
  });
  it("pertanyaan menginap yang diketik sendiri lolos", () => {
    expect(menyebutSewaVilla("kak mau nginep tgl 5-7 bisa?")).toBe(true);
    expect(menyebutSewaVilla("harga per malam berapa ya")).toBe(true);
    expect(menyebutSewaVilla("Mau sewa villa buat staycation")).toBe(true);
  });
  it("produk properti yang dijual TIDAK lolos walau menyebut villa/living/booking", () => {
    expect(menyebutSewaVilla("Halo, saya tertarik Loonars Excellent Living")).toBe(false);
    expect(menyebutSewaVilla("Halo, saya ingin info Loonars Excellent Living")).toBe(false);
    expect(menyebutSewaVilla("Rumah tipe villa masih ada? booking fee berapa?")).toBe(false);
    expect(menyebutSewaVilla("Halo, saya ingin tahu lebih lanjut tentang produk Loonars")).toBe(false);
  });
  it("chat bisnis nyata ke 0822 (27 Sep) TIDAK lolos", () => {
    expect(menyebutSewaVilla("HT 35 Y, 35 kva yanmar engine")).toBe(false);
    expect(menyebutSewaVilla("Nanti kabarin aja yah pak")).toBe(false);
    expect(menyebutSewaVilla("Semalam saya sudah transfer ke kontraktor")).toBe(false);
  });
  it("sapaan kosong seperti 'Halo' tidak cukup", () => {
    expect(menyebutSewaVilla("Halooo")).toBe(false);
  });
});

describe("pilihBookingTerbaik", () => {
  it("check-in aktif menang atas segalanya -> Menginap", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "checkout" },
      { id: "b2", status: "checkin" },
      { id: "b3", status: "terjadwal" },
    ]);
    expect(r).toEqual({ bookingId: "b2", statusTamu: "menginap" });
  });

  it("tanpa check-in aktif, booking terjadwal jadi acuan -> Prospek", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "checkout" },
      { id: "b3", status: "terjadwal" },
    ]);
    expect(r).toEqual({ bookingId: "b3", statusTamu: "prospek" });
  });

  it("hanya ada riwayat checkout -> Selesai", () => {
    const r = pilihBookingTerbaik([{ id: "b1", status: "checkout" }]);
    expect(r).toEqual({ bookingId: "b1", statusTamu: "selesai" });
  });

  it("tidak ada booking sama sekali -> Prospek tanpa booking", () => {
    expect(pilihBookingTerbaik([])).toEqual({ bookingId: null, statusTamu: "prospek" });
  });

  it("mengambil yang PALING DEPAN di antara status yang sama (pemanggil sudah mengurutkan created_at menurun)", () => {
    const r = pilihBookingTerbaik([
      { id: "checkin-terbaru", status: "checkin" },
      { id: "checkin-lama", status: "checkin" },
    ]);
    expect(r.bookingId).toBe("checkin-terbaru");
  });

  it("status lain (mis. batal, menunggu_pembayaran) tidak pernah dipilih", () => {
    const r = pilihBookingTerbaik([
      { id: "b1", status: "batal" },
      { id: "b2", status: "menunggu_pembayaran" },
    ]);
    expect(r).toEqual({ bookingId: null, statusTamu: "prospek" });
  });
});
