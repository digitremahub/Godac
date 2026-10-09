-- The pointeuse is deliberately NOT wired into payroll/hours yet (see
-- app/(dashboard)/time-clock) — this is purely so a badge can be
-- cross-checked against where it was actually pressed: arrivée/retour
-- dépôt vs départ/retour domicile, compared to organizations.depot_lat/
-- lng and users.address_lat/lng (lib/time-clock/classify-location.ts).
alter table time_clock_entries
  add column clock_in_lat numeric(9,6),
  add column clock_in_lng numeric(9,6),
  add column clock_out_lat numeric(9,6),
  add column clock_out_lng numeric(9,6);
