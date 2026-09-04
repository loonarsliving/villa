# Phase 1 changes to `villa-api` (v25 → v26)

**Status: DEPLOYED 2026-09-04 (owner-approved).** This is now the historical
record of what changed and why — the code itself has been merged into
`supabase/functions/villa-api/index.ts` (the live snapshot), and the
`index.ts` draft that used to live in this directory has been removed to
avoid two copies drifting apart. Both migrations below were applied
first, then this function was deployed as v26 and verified via
`get_edge_function` to match exactly. What follows was written before
deploy — kept as-is: (1) the two migrations in
`supabase/migrations/2026090400000{1,2}_*.sql` applied first, (2) explicit
owner sign-off, (3) re-running `npm test`/`tsc` equivalents for this
function (see "Testing" below), (4) deploy via `deploy_edge_function`,
(5) immediately re-fetch and diff to confirm the deployed artifact
matches this reviewed source, (6) fold the deployed result back into
`supabase/functions/villa-api/index.ts` as the new v26 snapshot, per the
process in that file's own README.

This document describes every change against v25 function-by-function.
**Every endpoint not listed below is byte-for-byte unchanged.**

---

## 1. `verifyToken` — constant-time signature comparison

**Why**: v25 compares the HMAC signature with plain `!==`, not
constant-time (Finding from the villa-api source audit). The frontend's
own Cloudbeds webhook route already uses `timingSafeEqual` — this brings
`villa-api` in line with that.

```ts
import { timingSafeEqual } from 'node:crypto'; // Deno's Node-compat layer

async function verifyToken(token){
  const parts = token.split('.');
  if(parts.length!==2) return null;
  const [body,sig] = parts;
  const expected = await hmac(body);
  const expectedBytes = new TextEncoder().encode(expected);
  const sigBytes = new TextEncoder().encode(sig);
  if(expectedBytes.length !== sigBytes.length) return null;
  if(!timingSafeEqual(expectedBytes, sigBytes)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if(!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
```

No behavior change for any legitimate caller — only the comparison
mechanics change.

## 2. `requireAuth` — live role/active-state revalidation

**Why**: v25 trusts the token's embedded `role`/`unit_id` for the full
7-day TTL with no re-check against the live `villa_users` row. A
deactivated or demoted user keeps their old access until the token
naturally expires (Finding from the villa-api source audit — explicitly
called out in the program's §44 as something to fix).

```ts
async function requireAuth(req){
  const token = req.headers.get('x-villa-token');
  if(!token) return null;
  const payload = await verifyToken(token);
  if(!payload) return null;

  // Live revalidation: a deactivated or role-changed user loses/regains
  // access on their very next request, not after the token's 7-day TTL.
  // Costs one extra indexed lookup per authenticated request -- accepted
  // tradeoff at this property's scale (13 units); revisit if/when
  // request volume ever makes this a real bottleneck (see PHASE0
  // baseline's performance notes).
  const {data:u} = await supabase.from('villa_users')
    .select('role,is_active,unit_id,unit_nomor')
    .eq('id', payload.uid)
    .maybeSingle();
  if(!u || !u.is_active) return null;

  return {...payload, role:u.role, unit_id:u.unit_id, unit_nomor:u.unit_nomor};
}
```

**Behavior change, intentional and in-scope for Phase 1**: a token issued
before a user was deactivated/demoted now stops working (or starts
reflecting the new role) on the very next request, instead of up to 7
days later. Every currently-valid session for an *active, unchanged*
user behaves identically to before.

## 3. `POST /bookings` — server-side price + date validation

**Why**: v25 trusts `b.tarif`/`b.total_bayar` from the client verbatim.
For any booking created through this endpoint (walk-in / direct — this
endpoint is never called for Cloudbeds-sourced bookings, which the
Cloudbeds webhook writes directly to `bookings`), the price should come
from the unit's own rate, not from whatever the client sends.

```ts
function isValidDateStr(s){
  if(typeof s !== 'string') return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

// inside POST /bookings, after the existing !b.unit_id||!b.tgl_checkin check:
if(!isValidDateStr(b.tgl_checkin)) return err('tgl_checkin tidak valid');
if(b.tgl_checkout != null && !isValidDateStr(b.tgl_checkout)) return err('tgl_checkout tidak valid');
if(!['harian','bulanan'].includes(b.tipe)) return err('tipe tidak valid');

// existing conflict check unchanged, then:

const {data:unit, error:unitErr} = await supabase.from('units')
  .select('tarif_harian,tarif_bulanan').eq('id', b.unit_id).single();
if(unitErr || !unit) return err('Unit tidak ditemukan');

let computedTarif;
if(b.tipe === 'bulanan'){
  computedTarif = Number(unit.tarif_bulanan ?? 0);
} else {
  const nights = b.tgl_checkout
    ? Math.max(1, Math.round((new Date(b.tgl_checkout).getTime() - new Date(b.tgl_checkin).getTime()) / 86400000))
    : 1;
  computedTarif = Number(unit.tarif_harian ?? 0) * nights;
}
if(computedTarif <= 0) return err('Tarif unit belum diatur — hubungi admin', 409);

// server-computed price is the source of truth for a NEW booking;
// the client-supplied tarif/total_bayar (if any) is informational only
// and is never written to the row.
```

...then the `insert` uses `tarif: computedTarif, total_bayar: computedTarif`
instead of `b.tarif`/`b.total_bayar`.

Exclusion-constraint violation handling (works together with migration
`20260904000001`):

```ts
if(error){
  if(error.code === '23P01') { // exclusion_violation
    return err('Unit sudah dibooking untuk tanggal yang bentrok', 409);
  }
  return err(error.message);
}
```

**Behavior change, intentional**: a client-supplied `tarif`/`total_bayar`
on `POST /bookings` is now ignored for price purposes (it was already
presented as read-only in the Payment Gateway UI per the existing
frontend, so no legitimate caller currently sends a different number —
see FEATURES.md's 2026-08-27 "Villa tarif auto-locked" entry). A unit
with no `tarif_harian`/`tarif_bulanan` configured now fails the booking
with a clear 409 instead of silently recording a zero-value transaction.
**Existing rows are never rewritten** — this only affects bookings
created after deployment.

## 4. `POST /checkin` — now calls `villa_commit_checkin`

```ts
if(path==='/checkin' && m==='POST'){
  if(!isStaff) return forbidden();
  const b=await req.json();
  if(!b.booking_id) return err('booking_id wajib diisi');

  const {data, error} = await supabase.rpc('villa_commit_checkin', {
    p_booking_id: b.booking_id,
    p_checkin_by: b.checkin_by ?? session.email ?? session.uid,
    p_ktp_photo_path: b.ktp_photo_path ?? null,
    p_signature_data_url: b.signature_data_url ?? null,
  });
  if(error){
    if(error.message?.includes('already_checked_in')) return err('Booking ini sudah check-in', 409);
    if(error.message?.includes('booking_not_found')) return err('Booking tidak ditemukan', 404);
    if(error.message?.includes('invalid_booking_status')) return err('Booking tidak dalam status yang bisa di-checkin', 409);
    if(error.message?.includes('booking_missing_total_bayar')) return err('Booking ini belum punya nominal pembayaran — tidak bisa check-in', 409);
    return err(error.message, 500);
  }

  // Financial commit already succeeded at this point (atomic in the RPC).
  // Everything below is best-effort and must never undo the check-in.
  await notif(data.unit_id,'all','checkin',`Check-in — Unit ${data.unit_nomor}`,`${data.guest_nama} · ${b.tipe ?? ''}`,b.booking_id);

  let guestPhone = b.guest_hp ?? null;
  if(!guestPhone && data.guest_id){
    const {data:g} = await supabase.from('guests').select('hp').eq('id',data.guest_id).single();
    guestPhone = g?.hp ?? null;
  }
  await sendWa(guestPhone,
    `Halo ${data.guest_nama}, selamat datang di Loonars Private Living Unit ${data.unit_nomor}!\nKode PIN pintu Anda: *${data.pin_kode}*\nMohon jaga kerahasiaan kode ini selama menginap. Terima kasih.`,
    {booking_id:b.booking_id, unit_id:data.unit_id, template_type:'pin_checkin'});

  return json({success:true, pin_kode:data.pin_kode});
}
```

**Behavior change, intentional**: a second check-in attempt on an
already-checked-in booking now returns a clean `409 "Booking ini sudah
check-in"` instead of silently re-running (and, in v25, silently
re-recording a second income transaction — this was a real double-count
risk in v25 that this closes). A partial failure (e.g. the transaction
insert failing) can no longer happen — it's one atomic operation now.

## 5. `POST /checkout` — now calls `villa_commit_checkout`

```ts
if(path==='/checkout' && m==='POST'){
  if(!isStaff) return forbidden();
  const b=await req.json();
  if(!b.booking_id) return err('booking_id wajib diisi');

  const {data, error} = await supabase.rpc('villa_commit_checkout', {
    p_booking_id: b.booking_id,
    p_checkout_by: b.checkout_by ?? session.email ?? session.uid,
    p_kondisi: b.kondisi ?? null,
  });
  if(error){
    if(error.message?.includes('already_checked_out')) return err('Booking ini sudah checkout', 409);
    if(error.message?.includes('booking_not_found')) return err('Booking tidak ditemukan', 404);
    if(error.message?.includes('invalid_booking_status')) return err('Booking belum check-in, tidak bisa checkout', 409);
    return err(error.message, 500);
  }

  await notif(data.unit_id,'all','checkout',`Checkout — Unit ${data.unit_nomor}`,`${data.guest_nama} sudah checkout. Housekeeping dijadwalkan.`,b.booking_id);
  return json({success:true});
}
```

**Behavior change, intentional**: same double-action protection as
check-in — a duplicate checkout call now returns a clean 409 instead of
silently re-running.

## 6. `POST /admin/users`, `PATCH /admin/users` — minimum password length

**Why**: v25 required a minimum length for a user changing their own
password (`/me/password`, `length<6`) but had no minimum at all for an
admin creating a new user or resetting someone else's password —
inconsistent, and a real gap for an internal admin tool that can be used
to set another person's initial credential.

```ts
// POST /admin/users, after the existing required-fields check:
if(String(b.password).length < 8) return err('Password minimal 8 karakter');

// PATCH /admin/users, inside the `if(b.new_password)` branch:
if(String(b.new_password).length < 8) return err('Password minimal 8 karakter');
```

**Behavior change, minor**: an admin can no longer create a user or reset
a password with fewer than 8 characters. Does not affect any existing
user's already-set password. Not part of the original Phase 1 mandate's
explicit list but included here as a small, low-risk consistency fix
alongside the auth-hardening work — flagged explicitly rather than
silently bundled, per the program's "no undocumented change" rule.

## 7. Everything else

`/login`, `/me/*`, `/bridge/occupancy`, `/cron/*`, `/walkin-*`,
`/amenities*`, `/admin/*`, `/wa/send`, `/units`, `/summary`,
`GET /bookings`, `/availability`, `PATCH /bookings`, `/housekeeping*`,
`/notifications*`, `/transactions`, `/opex`, `/report` — **unchanged**
from v25. In particular, `computeReport()`, `computeDividendList()`, and
every constant in the frozen financial baseline
(`docs/revenue-engine/PHASE0-BASELINE.md` §2) are untouched by this
draft.

## Testing before deploy

- `datesOverlap`/date-validation logic: unit tests to be added under
  `tests/villa-api/` (Deno-runnable, mirroring the logic above — since
  `villa-api` isn't part of the Next.js `vitest` project, see
  Phase 0's `tsconfig.json` exclusion).
- Manual verification checklist before deploy: valid booking creation
  (walk-in, both `harian`/`bulanan`), booking with no unit rate
  configured (expect 409), overlapping booking (expect 409 from the app
  check, then from the DB constraint if the app check is bypassed),
  check-in happy path, duplicate check-in attempt (expect 409, no double
  transaction), checkout happy path, duplicate checkout attempt (expect
  409), deactivating a test user and confirming their existing token
  stops working immediately.
- Confirm the two migrations are applied and show up in `list_migrations`
  before deploying this function version — the RPC calls will 500 if the
  functions don't exist yet.
