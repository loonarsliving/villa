import { api } from "./api";
import type { IntegrationSetting } from "./types";

const QRIS_SETTING_KEY = "walkin_qris";

export async function loadQrisImage(): Promise<string | null> {
  const rows = await api.get<IntegrationSetting[]>("/admin/settings");
  const row = rows.find((r) => r.key === QRIS_SETTING_KEY);
  const dataUrl = (row?.value as { data_url?: string } | undefined)?.data_url;
  return dataUrl || null;
}

export async function saveQrisImage(dataUrl: string) {
  await api.post("/admin/settings", { key: QRIS_SETTING_KEY, value: { data_url: dataUrl } });
}

export async function clearQrisImage() {
  await api.post("/admin/settings", { key: QRIS_SETTING_KEY, value: { data_url: null } });
}
