import { describe, expect, it } from "vitest";
import { bacaNominal, kodePengajuan, labelPeriode, namaBiaya, rekapPerPeriode, type PengajuanBiaya } from "./pengajuanBiaya";

function p(over: Partial<PengajuanBiaya>): PengajuanBiaya {
  return {
    id: Math.random().toString(),
    nomor: 1,
    kategori: "laundry",
    kategori_nama: null,
    jenis: "permintaan_dana",
    periode: "2026-11",
    nominal: 100000,
    keterangan: "x",
    penerima_nama: null,
    penerima_bank: null,
    penerima_rekening: null,
    status: "diajukan",
    diajukan_lewat: "dashboard",
    diajukan_oleh_nama: "Rebecca",
    diputus_oleh_nama: null,
    diputus_at: null,
    catatan_finance: null,
    alasan_tolak: null,
    tanggal_transfer: null,
    ditransfer_oleh_nama: null,
    ditransfer_at: null,
    alasan_batal: null,
    created_at: "2026-11-01T00:00:00Z",
    nota_url: null,
    bukti_bayar_url: null,
    bukti_transfer_url: null,
    riwayat: [],
    ...over,
  };
}

describe("namaBiaya", () => {
  it("memakai nama tulisan manager untuk lain-lain", () => {
    expect(namaBiaya({ kategori: "lain_lain", kategori_nama: "Gas elpiji" })).toBe("Gas elpiji");
    expect(namaBiaya({ kategori: "netflix", kategori_nama: null })).toBe("Netflix");
  });
});

describe("rekapPerPeriode", () => {
  it("menjumlah per bulan, memisahkan ditransfer dan menunggu, mengabaikan tolak/batal", () => {
    const r = rekapPerPeriode([
      p({ nominal: 350000, status: "ditransfer" }),
      p({ nominal: 150000, status: "disetujui" }),
      p({ kategori: "netflix", nominal: 186000, status: "ditransfer" }),
      p({ kategori: "lain_lain", kategori_nama: "Gas elpiji", nominal: 50000, status: "diajukan" }),
      p({ nominal: 999999, status: "ditolak" }),
      p({ nominal: 888888, status: "dibatalkan" }),
      p({ periode: "2026-10", nominal: 70000, status: "ditransfer" }),
    ]);
    expect(r.map((x) => x.periode)).toEqual(["2026-11", "2026-10"]);
    expect(r[0].ditransfer).toBe(536000);
    expect(r[0].menunggu).toBe(200000);
    expect(r[0].perBiaya).toEqual([
      { nama: "Laundry", ditransfer: 350000, menunggu: 150000 },
      { nama: "Netflix", ditransfer: 186000, menunggu: 0 },
      { nama: "Gas elpiji", ditransfer: 0, menunggu: 50000 },
    ]);
    expect(r[1].ditransfer).toBe(70000);
  });

  it("kosong bila tidak ada data", () => {
    expect(rekapPerPeriode([])).toEqual([]);
  });
});

describe("format", () => {
  it("kode, label periode, nominal", () => {
    expect(kodePengajuan(7)).toBe("PB-0007");
    expect(labelPeriode("2026-11")).toBe("November 2026");
    expect(bacaNominal("Rp 350.000")).toBe(350000);
    expect(bacaNominal("0")).toBeNull();
    expect(bacaNominal("")).toBeNull();
  });
});
