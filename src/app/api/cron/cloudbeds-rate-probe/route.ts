import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { getCloudbedsBaseRateId, getCloudbedsRoomTypeRate } from "@/lib/cloudbedsApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY diagnostic (2026-09-11). Cloudbeds' putRate keeps answering
 * "Parameter endDate should be greater than startDate" even with a
 * correct exclusive endDate, which means it is not parsing our array
 * encoding at all -- and the exact form-encoding contract for a nested
 * `rates[].interval[]` body is not in the OpenAPI spec we have.
 *
 * Rather than guess against live OTA prices, this probes ONE far-future
 * date with each candidate encoding and returns Cloudbeds' raw answer
 * plus a read-back of the surrounding days, so the real contract is
 * established from evidence. Delete once pushCloudbedsRate is fixed.
 */
export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const roomTypeId = searchParams.get("roomTypeID") ?? "270500726767808"; // standard
  const date = searchParams.get("date") ?? "2027-03-02";
  const nextDate = searchParams.get("endDate") ?? "2027-03-03";
  const rate = searchParams.get("rate") ?? "612345";
  const mode = searchParams.get("mode") ?? "nested";

  const apiKey = (process.env.CLOUDBEDS_API_KEY ?? "").trim();
  if (!apiKey) return NextResponse.json({ error: "CLOUDBEDS_API_KEY missing" }, { status: 503 });

  const rateId = await getCloudbedsBaseRateId(roomTypeId, date);
  if (!rateId) return NextResponse.json({ error: "no base rateID" }, { status: 409 });

  const form = new URLSearchParams();
  if (mode === "nested") {
    form.set("rates[0][rateID]", rateId);
    form.set("rates[0][interval][0][startDate]", date);
    form.set("rates[0][interval][0][endDate]", nextDate);
    form.set("rates[0][interval][0][rate]", rate);
  } else if (mode === "toplevel") {
    form.set("startDate", date);
    form.set("endDate", nextDate);
    form.set("rates[0][rateID]", rateId);
    form.set("rates[0][rate]", rate);
  } else if (mode === "json") {
    form.set("rates", JSON.stringify([{ rateID: rateId, interval: [{ startDate: date, endDate: nextDate, rate: Number(rate) }] }]));
  } else if (mode === "jsonflat") {
    form.set("startDate", date);
    form.set("endDate", nextDate);
    form.set("rates", JSON.stringify([{ rateID: rateId, rate: Number(rate) }]));
  }

  const res = await fetch("https://api.cloudbeds.com/api/v1.2/putRate", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const raw = await res.text();

  await new Promise((r) => setTimeout(r, 5000));
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 2);
  const to = new Date(`${nextDate}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);
  const readBack = await getCloudbedsRoomTypeRate(roomTypeId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));

  return NextResponse.json({ mode, rateId, sent: form.toString(), status: res.status, raw: raw.slice(0, 800), readBack });
}
