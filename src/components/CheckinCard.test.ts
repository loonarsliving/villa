import { describe, it, expect } from "vitest";
import { nomorHpTamuValid } from "./CheckinCard";

describe("nomorHpTamuValid (kolom Nomor WhatsApp di kartu check-in)", () => {
  it("menerima nomor Indonesia dan luar negeri", () => {
    expect(nomorHpTamuValid("081234567890")).toBe(true);
    expect(nomorHpTamuValid("+62 812-3456-7890")).toBe(true);
    expect(nomorHpTamuValid("+44 7700 900123")).toBe(true);
  });
  it("menolak kosong, terlalu pendek, atau berisi huruf", () => {
    expect(nomorHpTamuValid("")).toBe(false);
    expect(nomorHpTamuValid("   ")).toBe(false);
    expect(nomorHpTamuValid("0812")).toBe(false);
    expect(nomorHpTamuValid("08123abc890")).toBe(false);
    expect(nomorHpTamuValid("1234567890123456")).toBe(false);
  });
});
