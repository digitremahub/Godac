-- Historique des tournées colis : service figé sur la tournée (celui du
-- planning du chauffeur ce jour-là, sinon son service), pour filtrer sur
-- ce qu'il était ce jour-là et non sur l'affectation actuelle.
alter table delivery_runs add column if not exists service_id uuid references services (id) on delete set null;
create index if not exists delivery_runs_service_idx on delivery_runs (service_id, run_date);

-- Tournées existantes : service du planning du chauffeur ce jour-là.
update delivery_runs r
set service_id = (
  select p.service_id from planning_entries p
  where p.driver_id = r.driver_id
    and (p.start_at at time zone 'Europe/Paris')::date = r.run_date
  order by p.start_at
  limit 1
)
where r.service_id is null;
