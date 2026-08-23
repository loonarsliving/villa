import { api } from "./api";

export async function loadQrisImage(): Promise<string | null> {
  const res = await api.get<{ data_url: string | null }>("/walkin-qris");
  return res?.data_url ?? null;
}

export async function saveQrisImage(dataUrl: string) {
  await api.post("/walkin-qris", { data_url: dataUrl });
}

export async function clearQrisImage() {
  await api.post("/walkin-qris", { data_url: null });
}
