-- Phase 1 (§6.1 of the revenue-engine program): DB-level double-booking
-- protection for `bookings`.
--
-- NOT YET APPLIED to the live project. This file is written for review.
-- Apply only after explicit owner sign-off, via:
--   Supabase MCP apply_migration (project svcmybsziaelwwdrnzcv)
-- immediately preceded by a fresh run of the read-only conflict scan in
-- docs/revenue-engine/PHASE0-BASELINE.md's changelog (0 conflicts found
-- at 2026-09-04; re-check before applying if time has passed and real
-- booking volume exists by then).
--
-- Schema assumptions verified directly against the live table (read-only
-- information_schema query, 2026-09-04): bookings.unit_id is uuid NOT
-- NULL, bookings.tgl_checkin is date NOT NULL, bookings.tgl_checkout is
-- date NULLable, bookings.status is text NULLable (default 'terjadwal').
--
-- Semantics match the application-level check already in villa-api's
-- datesOverlap()/findConflicts(): two bookings for the same unit conflict
-- if their [checkin, checkout) ranges overlap, treating a null checkout
-- as open-ended ("infinity"). Only 'terjadwal' and 'checkin' are
-- considered active — 'batal' (cancelled) and 'checkout' (completed)
-- bookings are explicitly excluded via the WHERE clause, so a cancelled
-- booking can never block a new one for the same dates.

create extension if not exists btree_gist;

alter table public.bookings
  add constraint bookings_no_overlap_active
  exclude using gist (
    unit_id with =,
    daterange(tgl_checkin, coalesce(tgl_checkout, 'infinity'::date), '[)') with &&
  )
  where (status in ('terjadwal', 'checkin'));

-- Rollback (for reference, not run automatically):
--   alter table public.bookings drop constraint bookings_no_overlap_active;
--
-- Note: this constraint is a second, DB-enforced layer on top of the
-- existing application-level check in villa-api's POST /bookings (which
-- stays in place for its user-friendly 409 error message — this
-- constraint is the backstop against the race condition the
-- application-level check alone cannot close, per the program's Phase 1
-- gap analysis). A request that races past the application check and
-- hits this constraint will get a raw Postgres unique-violation-style
-- error (SQLSTATE 23P01, exclusion_violation) from villa-api's insert —
-- see supabase/functions/villa-api/phase1-draft/CHANGES.md for the
-- corresponding villa-api change that catches this and returns a clean
-- HTTP 409 instead of a raw DB error.
