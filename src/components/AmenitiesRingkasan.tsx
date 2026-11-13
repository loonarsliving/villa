import { Card, CardHeader, CardBody } from "@/components/Card";
import type { AmenityItem, AmenityKitItem, AmenityRingkasan } from "@/lib/types";

/**
 * Ringkasan pemakaian amenities per malam: kamar terisi malam ini x Kit
 * Standar, dan perkiraan stock cukup untuk berapa malam lagi. Stock dipotong
 * otomatis oleh villa-api /cron/amenities-malam (23.30 WIB).
 */
export function hitungPerkiraan(items: AmenityItem[], kit: AmenityKitItem[], kamarTerisi: number) {
  return kit.map((k) => {
    const item = items.find((it) => it.id === k.amenity_id);
    const perMalam = k.qty * kamarTerisi;
    const stock = item?.stock ?? 0;
    return {
      id: k.id,
      nama: item?.nama ?? k.amenities?.nama ?? "—",
      satuan: item?.satuan ?? k.amenities?.satuan ?? "pcs",
      perMalam,
      cukupMalam: perMalam > 0 ? Math.floor(stock / perMalam) : null,
    };
  });
}

/** Riwayat: pemakaian (qty positif) tampil "-n", restock (qty negatif) tampil "+n". */
export function tampilQty(qty: number) {
  return qty < 0 ? `+${-qty}` : `-${qty}`;
}

export function RingkasanMalam({
  ringkasan,
  items,
  kit,
}: {
  ringkasan: AmenityRingkasan | null;
  items: AmenityItem[];
  kit: AmenityKitItem[];
}) {
  if (!ringkasan) return null;
  const baris = hitungPerkiraan(items, kit, ringkasan.kamar_terisi);
  const sudah = ringkasan.kamar_terisi > 0 && ringkasan.sudah_dipotong >= ringkasan.kamar_terisi;
  return (
    <Card className="mb-3.5">
      <CardHeader
        title="Pemakaian Malam Ini"
        subtitle={`${ringkasan.kamar_terisi} kamar terisi · ${sudah ? "sudah dipotong" : "dipotong otomatis 23.30 WIB"}`}
      />
      <CardBody>
        {kit.length === 0 ? (
          <div className="text-[11px] text-ruby-400">Kit Standar belum diatur — stock tidak akan berkurang otomatis.</div>
        ) : (
          baris.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 text-xs py-1">
              <span className="text-ink/80">{b.nama}</span>
              <span className="text-ink/60 text-right">
                {b.perMalam} {b.satuan} / malam
                {b.cukupMalam !== null && (
                  <span className={b.cukupMalam <= 3 ? " text-ruby-400 font-semibold" : ""}> · cukup ±{b.cukupMalam} malam</span>
                )}
              </span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
