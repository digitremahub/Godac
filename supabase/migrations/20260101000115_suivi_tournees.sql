-- Suivi des tournées colis en cours (direction / exploitation).
-- Seule la DERNIÈRE position du chauffeur est conservée, uniquement
-- pendant la tournée en cours ; elle est effacée à la clôture (et la
-- tournée entière est purgée 30 jours après). Aucun historique de trajet.
alter table delivery_runs
  add column if not exists started_at timestamptz,
  add column if not exists last_lat numeric(9, 6),
  add column if not exists last_lng numeric(9, 6),
  add column if not exists last_position_at timestamptz;
create index if not exists delivery_runs_org_status_idx on delivery_runs (organization_id, status);
