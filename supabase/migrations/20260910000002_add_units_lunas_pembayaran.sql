-- Tracks whether a unit's purchase payment has been fully settled
-- ("lunas"), added 2026-09-10 (owner request) to gate dividend eligibility
-- messaging/reporting -- separate from Loonars' own unit-purchase sales
-- system (loonars_unit_purchases), which has no confirmed link to villa's
-- own units/investor accounts. Defaults true (paid) since only a known
-- few units are currently unpaid; those are marked false explicitly below.
alter table units add column if not exists lunas_pembayaran boolean not null default true;

update units set lunas_pembayaran = false where nomor in ('C1', 'B4', 'A3', 'A1', 'C4');
