-- Fiches Tournée colis par affectation (lib/colis/fiches-affectation.ts).
--
-- Jusqu'ici : une seule fiche ouverte par chauffeur et par jour regroupant
-- toutes ses tournées planifiées. Désormais, par défaut, une fiche par
-- affectation (« séparée ») ; exceptionnellement, l'encadrement relie une
-- affectation à la fiche ouverte du chauffeur (« reliée »).
--
-- - planning_entries.delivery_run_id : la fiche colis qui porte cette
--   affectation (séparée : une entrée ; reliée : plusieurs). Une entrée
--   portée par une fiche n'est jamais rechargée sur une autre.
-- - delivery_runs.fiche_planifiee : fiche créée pour une affectation
--   (planning_entry_id = son entrée d'origine). Les fiches « libres »
--   (créées par le chauffeur sans planning) restent limitées à une ouverte
--   par chauffeur et par jour (double clic), les fiches planifiées non.
--
-- Migration additive. Le code tolère son absence (ancien fonctionnement).

set local lock_timeout = '10s';

alter table public.planning_entries
  add column if not exists delivery_run_id uuid references public.delivery_runs(id) on delete set null;

create index if not exists planning_entries_delivery_run_id_idx
  on public.planning_entries (delivery_run_id)
  where delivery_run_id is not null;

alter table public.delivery_runs
  add column if not exists fiche_planifiee boolean not null default false;

-- Reprise de l'existant : la fiche ouverte du jour (une au plus, ancien
-- index) porte les affectations du jour qu'elle a chargées, c'est-à-dire
-- celles inscrites après la dernière fiche clôturée du même jour.
update public.planning_entries pe
set delivery_run_id = dr.id
from public.delivery_runs dr
where pe.delivery_run_id is null
  and pe.driver_id = dr.driver_id
  and pe.organization_id = dr.organization_id
  and dr.status <> 'done'
  and dr.fiche_planifiee = false
  and pe.status in ('planned', 'in_progress')
  and pe.tour_number is not null
  and (pe.start_at at time zone 'Europe/Paris')::date = dr.run_date
  and not exists (
    select 1
    from public.delivery_runs d2
    where d2.organization_id = dr.organization_id
      and d2.driver_id = dr.driver_id
      and d2.run_date = dr.run_date
      and d2.status = 'done'
      and d2.created_at >= pe.created_at
  );

-- Une seule fiche libre ouverte par chauffeur et par jour.
create unique index if not exists delivery_runs_driver_open_day_libre_uidx
  on public.delivery_runs (organization_id, driver_id, run_date)
  where status <> 'done' and fiche_planifiee = false;

-- Remplacé par l'index ci-dessus : plusieurs fiches planifiées ouvertes le
-- même jour sont désormais permises (une par affectation).
drop index if exists public.delivery_runs_driver_open_day_uidx;

notify pgrst, 'reload schema';
