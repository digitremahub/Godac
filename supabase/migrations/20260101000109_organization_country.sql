-- Pays de l'entreprise : règles légales appliquées dans GODAC
-- (protection des données, temps de conduite, paie, identifiants,
-- modules propres au droit français) — voir lib/pays/pays.ts.
alter table organizations
  add column if not exists country text not null default 'FR'
  check (country in ('FR', 'BE', 'LU', 'CH', 'DE', 'ES', 'IT', 'PT', 'NL', 'GB', 'MA', 'TN', 'DZ'));
