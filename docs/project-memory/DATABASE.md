# DATABASE.md

No secrets, keys, or credentials are recorded in this file — names/structure only.

## Supabase project
- Project URL: `https://svcmybsziaelwwdrnzcv.supabase.co` (hardcoded in `src/lib/api.ts` and `src/app/api/webhooks/cloudbeds/route.ts`). This URL string reveals the project ref (`svcmybsziaelwwdrnzcv`) only — not a secret by itself, but treat as an identifier, not a credential.
- **No `supabase/` directory exists in this repository** — there are no migration files (`supabase/migrations/*.sql`), no `config.toml`, and no Edge Function source checked in. All schema knowledge below is *inferred* from TypeScript types and the one Route Handler that writes to Postgres directly. UNKNOWN — NEEDS CONFIRMATION for everything below unless stated otherwise.

## Tables referenced directly in code (ground truth: `src/app/api/webhooks/cloudbeds/route.ts`)
These four tables are proven to exist because the webhook route performs live queries/writes against them via the Supabase JS client:
- `cloudbeds_room_mapping` — columns used: `cloudbeds_room_id`, `unit_id`, and a `units(nomor)` relationship (foreign key/join to a `units` table).
- `guests` — columns used: `nama`, `hp`; returns `id`.
- `bookings` — columns used/written: `unit_id`, `unit_nomor`, `guest_id`, `guest_nama`, `tipe`, `sumber`, `tgl_checkin`, `tgl_checkout`, `tarif`, `total_bayar`, `status`, `cloudbeds_reservation_id` (has an `onConflict` upsert constraint on `cloudbeds_reservation_id`, implying a unique index/constraint on that column).
- `notifications` — columns used: `unit_id`, `target_role`, `tipe`, `judul`, `pesan`, `ref_id`.
- `cloudbeds_events_log` — columns used: `reservation_id`, `event_type`, `payload` (jsonb), `matched`, `error`.

## Tables/entities inferred only from `src/lib/types.ts` (NOT verified against live schema — UNKNOWN — NEEDS CONFIRMATION)
- `units` — id, nomor, blok (A/B/C), status (available/occupied/checkout/dirty/maintenance), owner_id, owner_nama, owner_hp, catatan.
- `bookings` (fuller shape than webhook usage) — id, unit_id, unit_nomor, guest_nama, guest_hp, tipe (harian/bulanan), status (terjadwal/checkin/checkout/batal), sumber, tgl_checkin, tgl_checkout, tarif, total_bayar, created_at, pin_kode.
- `transactions` — id, unit_id, booking_id, tipe (income/opex/transfer_owner/jaminan), kategori, deskripsi, jumlah, periode_bulan, created_at.
- `notifications` (fuller shape) — id, unit_id, target_role (all/owner/receptionist), tipe, judul, pesan, is_read_owner, is_read_staff, is_read_admin, created_at.
- `housekeeping_tasks` (name inferred) — id, unit_id, unit_nomor, tugas, status (pending/done), tgl.
- villa users table (name UNKNOWN, possibly `villa_users` or `users`) — id, nama, email, role, unit_id, unit_nomor, hp, is_active, must_change_password, last_login, created_at.
- investor profile table (name UNKNOWN) — id, unit_id, unit_nomor, user_id, nama, hp, created_at, joined to `units(nomor, blok)`.
- staff table (name UNKNOWN, possibly `staff`) — id, nama, role (security/cleaning_service/guest_greeter), hp, is_active.
- WA log table (name UNKNOWN, possibly `wa_log`) — id, phone, template_type, message, status, created_at.
- `cloudbeds_room_mapping` (fuller shape) — id, cloudbeds_room_id, cloudbeds_room_name, unit_id, joined to `units(nomor, blok)`.
- `cloudbeds_events_log` (fuller shape) — id, reservation_id, event_type, matched, created_at.
- An `IntegrationSetting` type exists (`key`, `updated_at`, `updated_by`, `value`) but commit `2ddcff5` ("Move Cloudbeds webhook to Vercel, remove DB-backed integration settings") indicates this DB-backed settings pattern was actively removed — the type may be vestigial. UNKNOWN — NEEDS CONFIRMATION whether any such table still exists/is used.

## Relationships (inferred)
`units 1—N bookings`, `units 1—N transactions`, `units 1—1 cloudbeds_room_mapping` (per mapping row), `units 1—N notifications`, `bookings 1—1 guests` (via `guest_id`), `units 1—1 investor profile` (per the `InvestorProfile` type's `unit_id`/`user_id`).

## RLS / RPC / functions / triggers / views / storage / migrations
**None of these are visible from this repository.** All would live in the Supabase project itself and/or inside the unaudited `villa-api` Edge Function. UNKNOWN — NEEDS CONFIRMATION for: Row Level Security policy definitions, any RPC/Postgres functions, triggers, views, and Supabase Storage bucket usage. No evidence of Supabase Storage usage (no `.storage.from(...)` calls) was found anywhere in this repo.

## Direct DB access pattern
Only the Cloudbeds webhook route touches Postgres directly (via `@supabase/supabase-js` with the service-role key, which bypasses RLS). All other reads/writes go through `villa-api`, whose internal Supabase client configuration (anon vs service role, RLS-respecting or not) is unknown from this repo.
