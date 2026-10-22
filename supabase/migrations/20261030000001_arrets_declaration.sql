-- Arrêts de travail déclarés par le salarié (Mon espace › Mes demandes ›
-- Arrêts) et vérifiés par l'encadrement (Équipe › Congés & absences ›
-- Arrêts de travail). Étend public.work_stoppages
-- (20261026000002_paie_arrets_sorties.sql), aujourd'hui saisie par la
-- paie seule.
--
-- Cycle : le salarié déclare (photo des volets 2 et 3 de l'avis, jamais
-- le volet 1 qui porte les éléments médicaux) → statut « recu » ;
-- l'encadrement ou la paie valide ou refuse (motif). Un arrêt non refusé
-- entre dans la préparation du bulletin (lib/paie/donnees.ts) et
-- neutralise les heures attendues des jours d'arrêt. Les lignes
-- existantes (saisies par la paie) restent « valide ».
--
-- Aucune donnée médicale n'est stockée : type d'arrêt, dates,
-- prolongation et photos des volets employeur seulement.
--
-- Notifications (encadrement à la déclaration, salarié à la décision) :
-- faites par l'API (app/api/arrets), pas par un trigger.
--
-- ADDITIF : aucun drop (ni policy, ni trigger, ni colonne), rejouable.
-- L'application tolère l'absence de cette migration (déclaration
-- salarié indisponible, saisie paie inchangée).

-- 0. Type d'alerte (utilisé seulement par l'API, jamais dans cette migration).
alter type public.alert_type add value if not exists 'work_stoppage';

-- 1. Colonnes -----------------------------------------------------------------
alter table public.work_stoppages
  add column if not exists status text not null default 'valide',
  add column if not exists document_paths text[] not null default '{}',
  add column if not exists service_id uuid references public.services (id) on delete set null,
  add column if not exists declared_by uuid references public.users (id) on delete set null,
  add column if not exists validated_by uuid references public.users (id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists refusal_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_stoppages_status_check') then
    alter table public.work_stoppages
      add constraint work_stoppages_status_check check (status in ('recu', 'valide', 'refuse'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_stoppages_refusal_check') then
    alter table public.work_stoppages
      add constraint work_stoppages_refusal_check check (refusal_reason is null or char_length(refusal_reason) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_stoppages_documents_check') then
    alter table public.work_stoppages
      add constraint work_stoppages_documents_check check (coalesce(array_length(document_paths, 1), 0) <= 6);
  end if;
end $$;

create index if not exists work_stoppages_org_status_idx on public.work_stoppages (organization_id, status);
create index if not exists work_stoppages_service_idx on public.work_stoppages (service_id);

-- Lignes déjà saisies par la paie : service du salarié (lecture manager).
update public.work_stoppages ws
   set service_id = (select us.service_id from public.user_services us where us.user_id = ws.user_id order by us.service_id limit 1)
 where ws.service_id is null;

-- 2. Policies -------------------------------------------------------------------
-- Inchangées : « work_stoppages: read own, direction or comptable » (le
-- salarié lit les siens) et « work_stoppages: direction or comptable
-- writes » (la paie lit et écrit tout).
do $$
begin
  -- Le salarié déclare son propre arrêt : statut « recu », sans champ de
  -- paie (IJSS, maintien) ni décision, dans l'un de ses services.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: salarié déclare le sien') then
    create policy "work_stoppages: salarié déclare le sien" on public.work_stoppages
      for insert with check (
        organization_id = public.current_organization_id()
        and user_id = public.current_app_user_id()
        and declared_by = public.current_app_user_id()
        and status = 'recu'
        and stoppage_type <> 'sans_solde'
        and validated_by is null and validated_at is null and refusal_reason is null
        and daily_ijss_gross is null and daily_ijss_net is null and ijss_days is null and manual_maintenance is null
        and (service_id is null or service_id = any (public.current_user_service_ids()))
      );
  end if;

  -- Encadrement : direction et exploitation sur toute l'organisation,
  -- manager sur ses services. Jamais sur son propre arrêt (pas
  -- d'auto-validation).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: encadrement lit') then
    create policy "work_stoppages: encadrement lit" on public.work_stoppages
      for select using (
        organization_id = public.current_organization_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: encadrement saisit') then
    create policy "work_stoppages: encadrement saisit" on public.work_stoppages
      for insert with check (
        organization_id = public.current_organization_id()
        and user_id <> public.current_app_user_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: encadrement met à jour') then
    create policy "work_stoppages: encadrement met à jour" on public.work_stoppages
      for update
      using (
        organization_id = public.current_organization_id()
        and user_id <> public.current_app_user_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      )
      with check (
        organization_id = public.current_organization_id()
        and user_id <> public.current_app_user_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      );
  end if;
end $$;

-- 3. Garde : les champs de paie (IJSS, maintien) restent à la paie ---------
-- Manager et exploitation valident, refusent, corrigent les dates ; ils
-- ne touchent jamais aux montants (exploitation : jamais la paie).
create or replace function public.work_stoppages_guard_paie()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if not public.ecriture_utilisateur() or public.is_direction() or public.current_role()::text = 'comptable' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.daily_ijss_gross is not null or new.daily_ijss_net is not null or new.ijss_days is not null or new.manual_maintenance is not null then
      raise exception 'Les montants d''IJSS et de maintien sont saisis par la paie.' using errcode = '42501';
    end if;
  elsif new.daily_ijss_gross is distinct from old.daily_ijss_gross
     or new.daily_ijss_net is distinct from old.daily_ijss_net
     or new.ijss_days is distinct from old.ijss_days
     or new.manual_maintenance is distinct from old.manual_maintenance then
    raise exception 'Les montants d''IJSS et de maintien sont saisis par la paie.' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'work_stoppages_guard_paie' and tgrelid = 'public.work_stoppages'::regclass) then
    create trigger work_stoppages_guard_paie
      before insert or update on public.work_stoppages
      for each row execute function public.work_stoppages_guard_paie();
  end if;
end $$;

-- 4. Avis d'arrêt (volets employeur) : bucket privé --------------------------
--    Chemin : <organisation>/<salarié>/<fichier>.
insert into storage.buckets (id, name, public)
values ('work-stoppage-docs', 'work-stoppage-docs', false)
on conflict (id) do nothing;

do $$
begin
  -- Lecture : le salarié (son dossier), la direction, l'exploitation et
  -- le comptable (toute l'organisation), le manager (salariés de ses services).
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work-stoppage-docs: lecture') then
    create policy "work-stoppage-docs: lecture" on storage.objects
      for select using (
        bucket_id = 'work-stoppage-docs'
        and (storage.foldername(name))[1] = public.current_organization_id()::text
        and (
          (storage.foldername(name))[2] = public.current_app_user_id()::text
          or public.est_encadrement_org()
          or public.current_role()::text = 'comptable'
          or (
            public.is_manager_like()
            and exists (
              select 1 from public.user_services us
              where us.user_id::text = (storage.foldername(name))[2]
                and us.service_id = any (public.current_user_service_ids())
            )
          )
        )
      );
  end if;
  -- Dépôt : le salarié dans son dossier ; l'encadrement (saisie pour un
  -- salarié) dans l'organisation. Pas de modification ni de suppression
  -- depuis un client.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work-stoppage-docs: dépôt') then
    create policy "work-stoppage-docs: dépôt" on storage.objects
      for insert with check (
        bucket_id = 'work-stoppage-docs'
        and (storage.foldername(name))[1] = public.current_organization_id()::text
        and ((storage.foldername(name))[2] = public.current_app_user_id()::text or public.is_manager_like())
      );
  end if;
end $$;

-- 5. Lecture automatique de l'avis (OCR) : compteur de consommation ----------
--    Dates, type et prolongation seulement (lib/ocr/avis-arret.ts).
insert into public.usage_prices (feature, label, unit_label, unit_price_eur, sort_order) values
  ('ocr_arret', 'Lecture des avis d''arrêt de travail', 'avis', 0.05, 13)
on conflict (feature) do nothing;

insert into public.usage_quotas (plan_id, feature, included_per_month, daily_cap)
select q.plan_id::plan_tier, 'ocr_arret', q.inclus, greatest(20, ceil(q.inclus * 10 / 30.0)::integer)
from (values ('essentiel', 20), ('starter', 50), ('pro', 150), ('business', 400)) as q (plan_id, inclus)
on conflict (plan_id, feature) do nothing;

-- 6. Heures du bulletin (lib/paie/heures.ts) ---------------------------------
-- 6a. Heure de début PRÉVUE d'une affectation : start_at est remplacé par
--     l'heure du bouton Départ au démarrage de la tournée ; le début
--     prévu est conservé ici (début de journée d'un chauffeur sans
--     pointage d'arrivée : picking au dépôt avant le départ).
alter table public.planning_entries add column if not exists planned_start_at timestamptz;

update public.planning_entries set planned_start_at = start_at
 where planned_start_at is null and status = 'planned';

create or replace function public.planning_entries_debut_prevu()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status = 'planned' then
    -- Tant que l'affectation est prévue, le début prévu suit le planning.
    new.planned_start_at := new.start_at;
  elsif tg_op = 'UPDATE' and old.status = 'planned' and new.planned_start_at is null then
    new.planned_start_at := old.start_at;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'planning_entries_debut_prevu' and tgrelid = 'public.planning_entries'::regclass) then
    create trigger planning_entries_debut_prevu
      before insert or update on public.planning_entries
      for each row execute function public.planning_entries_debut_prevu();
  end if;
end $$;

-- 6b. Le comptable lit les pointages (préparation des bulletins).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_clock_entries' and policyname = 'time_clock: comptable reads') then
    create policy "time_clock: comptable reads" on public.time_clock_entries
      for select using (organization_id = public.current_organization_id() and public.current_role()::text = 'comptable');
  end if;
end $$;

-- 6c. Source des heures du bulletin (Équipe › Paie › Réglages) :
--     'regle' (défaut : pointage, sinon planning prévu / retour de
--     tournée), 'badge' (pointage seul), 'tournees' (départ → retour).
alter table public.payroll_settings add column if not exists hours_source text not null default 'regle';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payroll_settings_hours_source_check') then
    alter table public.payroll_settings
      add constraint payroll_settings_hours_source_check check (hours_source in ('regle', 'badge', 'tournees'));
  end if;
end $$;
