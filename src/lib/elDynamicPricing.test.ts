import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { polaHarian } from "./elDynamicPricing";

describe("polaHarian (harga dasar EL dari Cloudbeds)", () => {
  it("harga paling sering per hari dalam minggu; tanggal khusus tidak jadi dasar", () => {
    const rates: { date: string; rate: number }[] = [];
    // 4 minggu mulai Rabu 4 Nov 2026: weekday 300rb, Jumat 350rb, Sabtu 400rb, Minggu 320rb.
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 10, 4 + i));
      const hari = d.getUTCDay();
      const rate = hari === 5 ? 350000 : hari === 6 ? 400000 : hari === 0 ? 320000 : 300000;
      rates.push({ date: d.toISOString().slice(0, 10), rate });
    }
    rates[10] = { ...rates[10], rate: 999000 }; // satu tanggal khusus
    const pola = polaHarian(rates);
    expect(pola).toEqual({ min: 320000, sen: 300000, sel: 300000, rab: 300000, kam: 300000, jum: 350000, sab: 400000 });
  });
});
