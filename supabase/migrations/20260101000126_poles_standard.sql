-- Pôles standard pour toutes les entreprises (lib/organization/poles.ts).
--
-- services.pole : chaque service appartient à un pôle. Les services
-- existants sont des services transport (dépôt, tournées, chauffeurs)
-- et restent dans « Exploitation » (valeur par défaut). Les pôles
-- bureau (direction, administratif, secrétariat, comptabilité, RH,
-- atelier, commercial, QSE) reçoivent chacun un service créé d'office,
-- renommable mais non supprimable (contrôle dans
-- app/api/admin/services/[id]) : les gens des bureaux y sont rattachés
-- par user_services, comme les chauffeurs à leur service.
--
-- planning_entries.kind : 'tournee' (toutes les lignes existantes) ou
-- 'presence' — horaires de présence d'une personne d'un pôle bureau,
-- sans véhicule ni tournée (status = 'presence', hors du cycle
-- planned → in_progress → done des tournées).
--
-- Migration non destructive : ajouts de colonnes, d'index, d'une
-- fonction, et insertion des services manquants.

alter table services
  add column if not exists pole text not null default 'exploitation'
  check (pole in ('exploitation', 'direction', 'administratif', 'secretariat', 'comptabilite', 'rh', 'atelier', 'commercial', 'qualite'));

create index if not exists services_organization_pole_idx on services (organization_id, pole);

alter table planning_entries
  add column if not exists kind text not null default 'tournee'
  check (kind in ('tournee', 'presence'));

-- Crée les services des pôles bureau absents d'une organisation.
-- Idempotente : un pôle qui a déjà un service n'en reçoit pas d'autre.
-- Si un service transport porte déjà le nom du pôle (ex. un service
-- « Direction » créé avant les pôles), le service du pôle prend le nom
-- « <pôle> (pôle) » plutôt que de heurter unique (organization_id, name).
-- Security invoker : appelée par la route d'onboarding avec la clé
-- service (api/onboarding/create-organization) et par cette migration.
create or replace function public.seed_standard_poles(p_organization_id uuid)
returns void
language sql
set search_path = public
as $$
  with poles (pole, label) as (
    values
      ('direction', 'Direction'),
      ('administratif', 'Administratif'),
      ('secretariat', 'Secrétariat'),
      ('comptabilite', 'Comptabilité'),
      ('rh', 'Ressources humaines'),
      ('atelier', 'Atelier / maintenance'),
      ('commercial', 'Commercial'),
      ('qualite', 'Qualité, sécurité, environnement')
  ),
  manquants as (
    select p.pole, p.label
    from poles p
    where not exists (
      select 1 from services s where s.organization_id = p_organization_id and s.pole = p.pole
    )
  )
  insert into services (organization_id, name, pole)
  select
    p_organization_id,
    case
      when exists (select 1 from services s where s.organization_id = p_organization_id and s.name = m.label)
        then m.label || ' (pôle)'
      else m.label
    end,
    m.pole
  from manquants m
  on conflict (organization_id, name) do nothing;
$$;

revoke execute on function public.seed_standard_poles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_poles(uuid) to service_role;

-- Entreprises existantes.
select public.seed_standard_poles(id) from organizations;
