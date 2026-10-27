-- Planning de la semaine suivante généré automatiquement le jeudi, à confirmer
-- avant le vendredi 17 h (heure de Paris), puis envoyé aux chauffeurs.
--
-- 1. planning_semaines_auto : UNE ligne par organisation, service et semaine
--    (lundi, jour de Paris). Elle bloque une seconde génération, retient le
--    suivi (première modification manuelle, confirmation, publication, rappel)
--    et le résumé chiffré montré à l'encadrement. Lecture : l'encadrement
--    (le manager pour ses services seulement). Écriture : le client service
--    role côté serveur (cron, routes), aucune policy d'écriture.
-- 2. planning_semaine_masquee() + lecture de planning_entries : tant qu'une
--    semaine suivie n'est pas publiée (publie_at nul), le chauffeur ne voit
--    PAS ses lignes (jusqu'ici la RLS lui montrait toute ligne portant son
--    identifiant, publiée ou non). Les autres rôles lisent comme avant.
--
-- ADDITIF et rejouable (create if not exists, create or replace, alter policy),
-- sans suppression de donnée ni de policy. NON appliquée à la création : sans
-- elle le cron saute la génération avec un message (le code tolère l'absence
-- de la table) et la lecture des chauffeurs reste inchangée.

set local lock_timeout = '10s';

-- ── 1. Suivi des semaines générées ────────────────────────────────────
create table if not exists public.planning_semaines_auto (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  -- Lundi de la semaine générée (jour de Paris).
  semaine_debut date not null constraint planning_semaines_auto_lundi_check check (extract(isodow from semaine_debut) = 1),
  genere_at timestamptz not null default now(),
  genere_par text not null default 'auto' constraint planning_semaines_auto_genere_par_check check (genere_par in ('auto')),
  -- Première modification manuelle après la génération (jamais remis à nul).
  modifie_at timestamptz,
  confirme_at timestamptz,
  confirme_par uuid references public.users (id) on delete set null,
  publie_at timestamptz,
  publie_mode text constraint planning_semaines_auto_publie_mode_check check (publie_mode is null or publie_mode in ('auto', 'manuel')),
  -- Rappel « modifié mais pas envoyé » déjà adressé à l'encadrement (une seule fois).
  rappel_envoye_at timestamptz,
  -- Compteurs et liste des cases à remplacer (noms, jamais de motif médical).
  resume jsonb not null default '{}'::jsonb,
  unique (organization_id, service_id, semaine_debut)
);

create index if not exists planning_semaines_auto_attente_idx
  on public.planning_semaines_auto (organization_id, semaine_debut)
  where publie_at is null;

alter table public.planning_semaines_auto enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planning_semaines_auto' and policyname = 'planning_semaines_auto: encadrement read') then
    create policy "planning_semaines_auto: encadrement read" on public.planning_semaines_auto
      for select using (
        organization_id = public.current_organization_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      );
  end if;
end $$;

-- ── 2. Semaine générée et pas encore publiée : invisible du chauffeur ─
-- security definer : le chauffeur n'a aucun droit de lecture sur la table de
-- suivi, la fonction répond seulement oui / non.
create or replace function public.planning_semaine_masquee(p_organization uuid, p_service uuid, p_start timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.planning_semaines_auto s
    where s.organization_id = p_organization
      and s.service_id = p_service
      and s.semaine_debut = (date_trunc('week', p_start at time zone 'Europe/Paris'))::date
      and s.publie_at is null
  );
$$;

grant execute on function public.planning_semaine_masquee(uuid, uuid, timestamptz) to authenticated;

-- Lecture du planning : même règle qu'en 20261027000002, sauf la branche
-- « ses propres lignes » du chauffeur, qui exclut les semaines non publiées.
alter policy "planning: read within org" on public.planning_entries
  using (
    organization_id = public.current_organization_id()
    and (
      (driver_id = public.current_app_user_id() and not public.planning_semaine_masquee(organization_id, service_id, start_at))
      or public.current_role() in ('comptable', 'direction')
      or public.est_encadrement_org()
      or (public.is_manager_like() and service_id = any (public.current_user_service_ids()))
    )
  );

notify pgrst, 'reload schema';
