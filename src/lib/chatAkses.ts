import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { propertiPeminta } from "@/lib/villaApiAuth";

/**
 * Chat WA per properti (satu nomor WA untuk PL & EL, owner 2026-11-04):
 * percakapan hanya boleh dibuka/dibalas oleh pengguna properti yang sama.
 * Kembalikan respons 404 kalau tidak boleh, null kalau boleh.
 */
export async function tolakJikaBedaProperti(request: Request, token: string, conversationId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin().from("wa_conversations").select("property_kode").eq("id", conversationId).maybeSingle();
  if (!data || String(data.property_kode ?? "PL") !== propertiPeminta(request, token)) {
    return NextResponse.json({ error: "Percakapan tidak ditemukan" }, { status: 404 });
  }
  return null;
}
