-- Plusieurs tournées colis par jour et par chauffeur (matin / après-midi,
-- deux camions…) : on retire l'unicité (chauffeur, jour) et chaque
-- tournée porte un nom.
alter table delivery_runs drop constraint if exists delivery_runs_driver_id_run_date_key;
alter table delivery_runs add column if not exists name text;
create index if not exists delivery_runs_driver_date_idx on delivery_runs (driver_id, run_date);
