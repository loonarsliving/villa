import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ambilGambarChat } from "@/lib/chatGambar";
import { JENIS_PER_EXT, bagianGambarChatSah } from "@/lib/chatGambarFormat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Melayani gambar yang dikirim staf ke tamu (src/lib/chatGambar.ts). Tanpa
 * login: WhaCenter yang mengunduhnya untuk dikirim ke WhatsApp tamu, sama
 * seperti tautan bertanda tangan -- yang menjaga adalah nama file UUID acak,
 * dan hanya folder chat/ yang bisa dibuka.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string; file: string }> }) {
  const { conversationId, file } = await params;
  if (!bagianGambarChatSah(conversationId, file)) return new NextResponse("Not found", { status: 404 });

  const gambar = await ambilGambarChat(supabaseAdmin(), conversationId, file.toLowerCase());
  if (!gambar) return new NextResponse("Not found", { status: 404 });

  const ext = file.split(".").pop()!.toLowerCase();
  return new NextResponse(gambar, {
    headers: {
      "Content-Type": JENIS_PER_EXT[ext],
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
