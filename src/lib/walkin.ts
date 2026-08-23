import type { WalkinPayment } from "./types";

const PAYMENTS_KEY = "villa_walkin_payments";
const QRIS_IMAGE_KEY = "villa_qris_image";

export function loadWalkinPayments(): WalkinPayment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PAYMENTS_KEY);
    return raw ? (JSON.parse(raw) as WalkinPayment[]) : [];
  } catch {
    return [];
  }
}

export function saveWalkinPayments(rows: WalkinPayment[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(rows));
}

export function loadQrisImage(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(QRIS_IMAGE_KEY);
}

export function saveQrisImage(dataUrl: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(QRIS_IMAGE_KEY, dataUrl);
}

export function clearQrisImage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(QRIS_IMAGE_KEY);
}

export function newWalkinId(): string {
  return `wk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
