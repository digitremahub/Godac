-- Tournée colis : tournée globale par villages, adresses pro et horaires
-- trouvés sur internet, confirmation du lancement, protection des tournées
-- clôturées. Migration additive : colonnes nullables (ou avec défaut),
-- contraintes recréées (drop constraint if exists + add constraint),
-- fonction et déclencheur. Aucune donnée supprimée.

-- 1. Une liste par village de la tournée du planning (tour_route_villages),
--    plus une liste « Hors tournée » pour les adresses hors de ces villages.
alter table delivery_lists add column if not exists village_id uuid references tour_route_villages (id) on delete set null;
alter table delivery_lists add column if not exists is_hors_tournee boolean not null default false;
create index if not exists delivery_lists_village_idx on delivery_lists (village_id) where village_id is not null;

comment on column delivery_lists.village_id is
  'Village de la tournée du planning servi par cette liste ; les adresses y sont rangées par commune ou par proximité (lib/colis/villages.ts)';
comment on column delivery_lists.is_hors_tournee is
  'Liste « Hors tournée » : adresses dont la commune ne correspond à aucun village de la tournée';

-- 2. Annuaire des horaires : origine de la fiche. « manuel » = saisie par un
--    chauffeur ou l'encadrement (jamais écrasée par une recherche) ;
--    « openstreetmap » / « google » = trouvée automatiquement, à vérifier.
alter table delivery_address_hours add column if not exists source text not null default 'manuel';
alter table delivery_address_hours add column if not exists source_ref text;
alter table delivery_address_hours add column if not exists found_at timestamptz;
alter table delivery_address_hours drop constraint if exists delivery_address_hours_source_check;
alter table delivery_address_hours
  add constraint delivery_address_hours_source_check
  check (source in ('manuel', 'openstreetmap', 'google'));
alter table delivery_address_hours drop constraint if exists delivery_address_hours_source_ref_check;
alter table delivery_address_hours
  add constraint delivery_address_hours_source_ref_check
  check (source_ref is null or char_length(source_ref) <= 300);

-- 3. Arrêt : professionnel détecté (nom de l'entreprise / du commerce) et
--    date de la dernière recherche d'horaires (pour ne pas la refaire).
alter table delivery_stops add column if not exists business_name text;
alter table delivery_stops drop constraint if exists delivery_stops_business_name_check;
alter table delivery_stops add constraint delivery_stops_business_name_check check (business_name is null or char_length(business_name) <= 200);
alter table delivery_stops add column if not exists hours_lookup_at timestamptz;

-- 4. Lancement confirmé par le chauffeur : tournée, véhicule, service et
--    villages pris (identifiants tour_route_villages).
alter table delivery_runs add column if not exists launch_confirmed_at timestamptz;
alter table delivery_runs add column if not exists launch_village_ids uuid[] not null default '{}';
alter table delivery_runs add column if not exists route_id uuid references tour_routes (id) on delete set null;

-- 5. Une tournée clôturée est conservée dans l'historique de livraison :
--    seul un compte direction peut la supprimer (l'API la journalise dans
--    audit_log). Les traitements serveur (clé service, purge de rétention,
--    suppression d'entreprise) n'ont pas d'utilisateur : ils ne sont pas
--    concernés.
create or replace function public.delivery_runs_protect_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'done' and auth.uid() is not null and not public.is_direction() then
    raise exception 'Une tournée clôturée ne peut être supprimée que par la direction.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists delivery_runs_protect_done on delivery_runs;
create trigger delivery_runs_protect_done
  before delete on delivery_runs
  for each row execute function public.delivery_runs_protect_done();

notify pgrst, 'reload schema';
