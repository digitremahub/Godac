-- Contestations clients : le chauffeur attributaire signale la suite
-- donnée de son côté (« traitée » : problème réglé ; « rendue » : colis
-- remis au client ou rendu au dépôt). L'encadrement garde la clôture.
alter table public.customer_disputes
  add column if not exists driver_outcome text check (driver_outcome in ('traitee', 'rendue')),
  add column if not exists driver_outcome_at timestamptz;

comment on column public.customer_disputes.driver_outcome is 'Suite signalée par le chauffeur : traitee (réglée) ou rendue (colis remis au client ou rendu au dépôt).';
