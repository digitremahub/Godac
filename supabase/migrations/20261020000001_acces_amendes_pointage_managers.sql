-- Réorganisation, lot 1 : décisions client Q2, Q3, Q4, Q6 (19/10/2026).
-- Migration ADDITIVE : aucune suppression de policy, de trigger ni de
-- donnée. Rejouable sans effet (policies créées seulement si absentes).
--
-- Q2 — Amendes : les managers (manager, manager_chauffeur) gèrent les
--      amendes des véhicules de LEUR service ; la direction toutes ; le
--      comptable lit (policy existante « fines: read within org »).
--      Avant : « fines: manager-like write » laissait un manager écrire
--      sur TOUTES les amendes de l'organisation.
alter policy "fines: manager-like write" on public.fines
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (
          select 1 from public.vehicles v
          where v.id = fines.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (
          select 1 from public.vehicles v
          where v.id = fines.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  );

-- Q3 — Pointage : vue d'équipe pour les managers, limitée aux membres de
--      leur(s) service(s). S'ajoute à « time_clock: read own or direction ».
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'time_clock_entries'
      and policyname = 'time_clock: manager reads service'
  ) then
    create policy "time_clock: manager reads service" on public.time_clock_entries
      for select
      using (
        organization_id = public.current_organization_id()
        and public.is_manager_like()
        and exists (
          select 1 from public.user_services us
          where us.user_id = time_clock_entries.user_id
            and us.service_id = any (public.current_user_service_ids())
        )
      );
  end if;
end
$$;

-- Q4 — Calendrier des congés pour les managers : rien à ajouter en base.
--      « leave: chauffeur reads own, manager reads service » limite déjà
--      la lecture des demandes au service du manager ; l'application
--      ouvre la page /leaves/planning à l'encadrement.
--
-- Q6 — Liste des utilisateurs pour les managers : « users: read within
--      org » autorise déjà la lecture ; l'application limite l'affichage
--      au service du manager, en lecture seule. La gestion reste à la
--      direction (« users: direction manages members »).
