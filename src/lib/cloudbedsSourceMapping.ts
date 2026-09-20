/**
 * Maps Cloudbeds' free-text sourceName (e.g. "Airbnb", "Booking.com (Channel
 * Collect)", "Agoda") to one of bookings.sumber's fixed allowed values
 * (bookings_sumber_check) -- added 2026-09-10 so investor reports can show
 * real per-OTA commission cuts instead of a single flat "cloudbeds" bucket.
 * Falls back to 'cloudbeds' (still a valid value) for anything unrecognized,
 * e.g. Cloudbeds' own booking engine or a channel we don't have a distinct
 * bookings.sumber value for -- never guesses a value the CHECK constraint
 * doesn't already allow.
 *
 * Single source of truth for BOTH the inbound webhook
 * (src/app/api/webhooks/cloudbeds/route.ts) and the periodic reservation
 * sync (src/lib/cloudbedsReservationSync.ts). Until 2026-09-20 only the
 * webhook used this mapping -- but the webhook has never once fired
 * (cloudbeds_events_log stayed empty), so every real reservation actually
 * reached this system through the sync, which hardcoded sumber:'cloudbeds'
 * and never called this function at all. Every OTA-sourced booking was
 * therefore misclassified as a flat "cloudbeds" bucket in Finance/OTA
 * reporting (normalizedChannel('cloudbeds') = 'UNKNOWN') even though
 * Cloudbeds was sending the real source name the whole time.
 *
 * 'traveloka' and 'google' added 2026-09-20 after the owner shared
 * Cloudbeds' live Distribution > Channels screen showing both as
 * actually-enabled channels (bookings_sumber_check previously didn't
 * even allow those values). Google Hotel Search is a metasearch
 * referral, not a money-collecting OTA -- a guest who clicks through
 * from Google still pays the property directly (or via whichever
 * booking engine handles the click-through), so it's classified as
 * DIRECT in normalizedChannel(), not as its own OTA settlement bucket.
 */
export function mapSourceNameToSumber(sourceName: string | null | undefined): string {
  const s = (sourceName ?? "").toLowerCase();
  if (s.includes("airbnb")) return "airbnb";
  if (s.includes("booking.com") || s.includes("booking dot com")) return "booking.com";
  if (s.includes("agoda")) return "agoda";
  if (s.includes("traveloka")) return "traveloka";
  if (s.includes("google")) return "google";
  if (s.includes("tiket")) return "tiket";
  if (s.includes("whatsapp")) return "whatsapp";
  return "cloudbeds";
}
