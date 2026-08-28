import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isStaffToken } from "@/lib/villaApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://svcmybsziaelwwdrnzcv.supabase.co";
const BUCKET = "guest-documents";

/**
 * Uploads a guest's KTP photo (captured client-side during check-in) to a
 * private Supabase Storage bucket -- never a public URL, KTP photos are
 * sensitive PII. Returns only the storage path; the booking row stores
 * that path (villa-api v21), not the image itself.
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-villa-token") ?? "";
  if (!token || !(await isStaffToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const dataUrl: string | undefined = body?.dataUrl;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "dataUrl (foto KTP) wajib diisi" }, { status: 400 });
  }

  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: "Format foto tidak dikenali" }, { status: 400 });
  }
  const [, ext, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Foto terlalu besar (maks 8MB)" }, { status: 400 });
  }

  const path = `ktp/${crypto.randomUUID()}.${ext}`;
  const supabase = createClient(SUPABASE_URL, serviceRoleKey);
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: `image/${ext}`,
    upsert: false,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ path });
}
