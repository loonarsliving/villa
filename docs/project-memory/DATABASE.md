# DATABASE.md

No secrets, keys, or credentials are recorded in this file — names/structure only.

## Supabase project
- Project URL: `https://svcmybsziaelwwdrnzcv.supabase.co` (hardcoded in `src/lib/api.ts` and `src/app/api/webhooks/cloudbeds/route.ts`). Project ref `svcmybsziaelwwdrnzcv`, name `loonars-private-living`.
- **Confirmed (2026-08-23, via direct Supabase MCP access to this project): this is a large Supabase project shared with "MK Connect" (`mkhsistem` repo, an internal HR/ops/CRM/finance/AI system for PT Maha Karya Haluoleo) and several other business lines** (finance/`mkh-properti` sync tables, construction, CRM, "istri" personal-finance app, KontenAI, FRIDAY holding architecture, etc.) — over 150 tables total in `public`, the great majority unrelated to villa. `mkhsistem`'s own README documents this explicitly and renamed its `notifications` table to `mkc_notifications` to avoid colliding with villa's pre-existing `notifications` table.
- **`villa-api` source resolved:** it is NOT in this repo, NOT in `mkhsistem`, and NOT in any other repo found. It lives only as a deployed Supabase Edge Function (slug `villa-api`, `verify_jwt: false`, custom HMAC session-token auth via `x-villa-token`) — readable/deployable directly via Supabase MCP tools (`get_edge_function`/`deploy_edge_function`) once connected to this project. `mkhsistem` has bridge routes (`app/api/villa/deploy`, `app/api/villa/secrets`) that deploy to/configure it via the Supabase Management API on villa's behalf (worked around a stuck MCP approval gate) — those bridges do not store villa-api's source, they just relay a deploy payload.
- `supabase/` still does not exist as a directory in *this* repo — no migration files or Edge Function source are checked into git here. Schema/endpoint changes made via Supabase MCP (see below) are applied directly to the live project and are not currently mirrored into this repo as migration files.

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
Confirmed 2026-08-23 via direct Supabase MCP access: every villa table has RLS enabled (`rls_enabled: true`), and `villa-api` uses the service-role key (bypasses RLS) for all reads/writes — RLS is defense-in-depth against direct anon/authenticated PostgREST access, not the enforcement layer (that's `villa-api`'s own token/role checks). RPC functions confirmed in use by `villa-api`: `villa_login`, `villa_set_password`, `villa_create_user`. Storage bucket usage: none observed in `villa-api`'s source.
- **Project-wide advisory (unrelated to villa, surfaced for awareness):** at last check, 2 tables in this shared project had RLS fully disabled (`istri_daily_tips`, `contractor_fund_request_pending`) — anon-key-readable/writable. Not villa's tables; flagged to the project owner, not remediated from this session.

## `walkin_payments` (added 2026-08-23 — Payment Gateway module)
Isolated table for the admin-only walk-in cafe/spa cashier module (`/admin/payment-gateway`): `id, guest_nama, guest_hp, kategori (cafe|spa|lainnya), deskripsi, jumlah, status (pending|lunas|batal), created_by, created_at, paid_at`. RLS enabled, no policies (service-role/`villa-api`-only access, same pattern as `sync_config`/`automation_config`). **Deliberately not fed into `transactions`/`computeReport`** — that stream drives the investor 70/30 revenue-sharing split for villa rental income, and cafe/spa walk-in income is a separate business line not covered by that split. `GET /report` (villa-api v15+) does separately surface a read-only `walkin_income: {cafe, spa, lainnya, total}` breakdown for the requested `periode`, computed by `computeWalkinIncome()` — shown to investors purely for transparency (not summed into `gross_revenue`/`net`/`owner_amount`), per explicit instruction that investors should be able to see this since the owner intends for its net income to eventually be shared too (the actual split logic for it is not implemented).

## `walkin_qris` setting (added 2026-08-23)
The static QRIS image for the walk-in cashier is stored as a row in the existing `integration_settings` table (`key='walkin_qris'`, `value={data_url: "data:image/...;base64,..."}`), read/written via the existing `GET/POST /admin/settings` endpoints — not a new table, and no longer in browser localStorage. Client-side upload is capped at 1.5MB before base64 encoding to keep the JSON payload/jsonb column reasonable.

## Direct DB access pattern
Only the Cloudbeds webhook route (in this repo) touches Postgres directly (via `@supabase/supabase-js` with the service-role key, which bypasses RLS). All other reads/writes go through `villa-api`, which also uses the service-role key (confirmed above).
