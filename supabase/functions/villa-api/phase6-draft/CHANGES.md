# Phase 6 draft changes to `villa-api` (v26 → proposed v27)

**Status: DRAFT.** Adds two new endpoints only — everything else in v26
is untouched. No existing endpoint's behavior changes.

## New: `GET /admin/pricing-recommendations`

Admin-only. Lists rows from `villa_pricing_recommendations`, joined with
`villa_room_types(code, name)` for display. Optional `?status=` filter
(`pending_review`/`approved`/`rejected`/`executed`/`expired`).

```ts
if(path==='/admin/pricing-recommendations' && m==='GET'){
  const status = url.searchParams.get('status');
  let q = supabase.from('villa_pricing_recommendations')
    .select('*, villa_room_types(code,name)')
    .order('target_date', {ascending:true});
  if(status) q = q.eq('status', status);
  const {data,error} = await q;
  if(error) return err(error.message);
  return json(data);
}
```

## New: `PATCH /admin/pricing-recommendations`

Admin-only. `{id, status: 'approved'|'rejected', review_note?}`.

- **`rejected`**: just marks the row rejected with `reviewed_by`/
  `reviewed_at`/`review_note`. No side effect.
- **`approved`**: marks the row `executed` (there is no intermediate
  "approved but not yet executed" state in this round — see the scope
  note below) and writes the approved rate into `villa_rates` for that
  `(room_type_id, target_date)`, `source:'rule_engine'`,
  `updated_by:session.email`, `reason:review_note`. `villa_rates`'
  existing history trigger (from Phase 3) automatically logs this to
  `villa_rate_history` — nothing new needed for that.

```ts
if(path==='/admin/pricing-recommendations' && m==='PATCH'){
  const b = await req.json();
  if(!b.id || !b.status) return err('id dan status wajib diisi');
  if(!['approved','rejected'].includes(b.status)) return err('status tidak valid (harus approved atau rejected)');

  const {data:rec, error:recErr} = await supabase.from('villa_pricing_recommendations')
    .select('*').eq('id', b.id).single();
  if(recErr || !rec) return err('Rekomendasi tidak ditemukan', 404);
  if(rec.status !== 'pending_review') return err('Rekomendasi ini sudah direview', 409);

  if(b.status === 'rejected'){
    const {data,error} = await supabase.from('villa_pricing_recommendations').update({
      status:'rejected', reviewed_by:session.email, reviewed_at:new Date().toISOString(), review_note:b.review_note??null,
    }).eq('id', b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  // approved -> write to villa_rates (our own internal calendar-rate
  // table), then mark this recommendation executed. Deliberately does
  // NOT touch units.tarif_harian (the flat rate POST /bookings uses
  // today) -- wiring date-aware villa_rates into actual booking-time
  // pricing is a separate, not-yet-built increment (see CHANGES.md
  // "Scope note" below). This step only records the approved rate as
  // the official planned rate for that date.
  const {error: rateErr} = await supabase.from('villa_rates').upsert({
    room_type_id: rec.room_type_id, rate_plan_id: null, date: rec.target_date,
    rate: rec.recommended_rate, source: 'rule_engine', reason: b.review_note ?? null, updated_by: session.email,
  }, {onConflict: 'room_type_id,rate_plan_id,date'});
  if(rateErr) return err(rateErr.message);

  const {data,error} = await supabase.from('villa_pricing_recommendations').update({
    status:'executed', reviewed_by:session.email, reviewed_at:new Date().toISOString(),
    review_note:b.review_note??null, executed_at:new Date().toISOString(),
  }).eq('id', b.id).select().single();
  if(error) return err(error.message);
  return json(data);
}
```

## Scope note — villa_rates is not yet wired into live booking pricing

Approving a recommendation records the new rate in `villa_rates` (with
full history), but **`POST /bookings` still prices off
`units.tarif_harian` only** (the flat per-unit rate set in Phase 3).
This is a deliberate scope boundary for this round: auto-wiring an
unattended rule engine's approved output straight into what a guest
actually gets charged, without a separate explicit decision to do so,
is exactly the kind of quiet-but-real financial change the program's
own safety rules warn against. Making `POST /bookings` check
`villa_rates` for the specific stay date first (falling back to
`tarif_harian` when no date-specific rate exists) is real, scoped,
buildable work — flagged as the next concrete step, not done silently
here.

## Everything else

Every other endpoint in v26 is byte-for-byte unchanged.
