const QRIS_IMAGE_KEY = "villa_qris_image";

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
