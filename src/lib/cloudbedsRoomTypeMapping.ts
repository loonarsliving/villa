import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared by cloudbedsRateSync.ts (pull) and aiDynamicPricingRun.ts (push):
 * derives which Cloudbeds room-type ID corresponds to which villa
 * room_type_id, from cloudbeds_room_mapping's own room IDs
 * ("<cloudbedsRoomTypeId>-<index>") and whichever room_type_id the
 * mapped units already carry (Phase 3) -- never hardcoded.
 */
export function cloudbedsRoomTypeIdOf(cloudbedsRoomId: string): string {
  return cloudbedsRoomId.replace(/-\d+$/, "");
}

export interface RoomTypeGroups {
  villaRoomTypeIdByCloudbedsRoomType: Map<string, string>;
  inconsistentGroups: string[];
}

export async function resolveCloudbedsRoomTypeGroups(supabase: SupabaseClient): Promise<RoomTypeGroups> {
  const { data: mappings } = await supabase.from("cloudbeds_room_mapping").select("cloudbeds_room_id, unit_id");
  const { data: units } = await supabase.from("units").select("id, room_type_id");
  const unitById = new Map<string, { room_type_id: string | null }>((units ?? []).map((u: { id: string; room_type_id: string | null }) => [u.id, u]));

  const villaRoomTypeIdByCloudbedsRoomType = new Map<string, string>();
  const inconsistentGroups: string[] = [];
  for (const m of (mappings ?? []) as Array<{ cloudbeds_room_id: string; unit_id: string }>) {
    const cbRoomTypeId = cloudbedsRoomTypeIdOf(String(m.cloudbeds_room_id));
    const unit = unitById.get(m.unit_id);
    if (!unit?.room_type_id) continue;
    const existing = villaRoomTypeIdByCloudbedsRoomType.get(cbRoomTypeId);
    if (existing && existing !== unit.room_type_id) {
      if (!inconsistentGroups.includes(cbRoomTypeId)) inconsistentGroups.push(cbRoomTypeId);
      continue;
    }
    villaRoomTypeIdByCloudbedsRoomType.set(cbRoomTypeId, unit.room_type_id);
  }
  return { villaRoomTypeIdByCloudbedsRoomType, inconsistentGroups };
}
