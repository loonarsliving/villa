/** Label 10 poin checklist; kuncinya harus sama dengan CHECKLIST_KAMAR di villa-api. */
export const LABEL_CHECKLIST: Record<string, string> = {
  kebersihan: "Kebersihan kamar",
  bathroom: "Bathroom",
  linen: "Linen",
  gorden: "Gorden",
  ac: "AC",
  tv: "TV",
  kolam: "Kebersihan kolam",
  air_bersih: "Air bersih",
  pembuangan_air: "Pembuangan air",
  lampu: "Lampu",
};

export function tambahHari(tanggal: string, n: number): string {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
