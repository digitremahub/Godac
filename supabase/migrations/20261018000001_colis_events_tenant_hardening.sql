-- Renforce l'isolation multi-tenant du journal des arrêts.
-- Les événements ne peuvent être créés que pour un arrêt et une tournée
-- appartenant à la même organisation que l'utilisateur connecté.
drop policy if exists delivery_stop_events_insert_org on public.delivery_stop_events;
create policy delivery_stop_events_insert_org on public.delivery_stop_events
  for insert
  with check (
    organization_id = (select organization_id from public.users where id = auth.uid())
    and (actor_id is null or actor_id = auth.uid())
    and exists (
      select 1
      from public.delivery_runs r
      where r.id = run_id
        and r.organization_id = delivery_stop_events.organization_id
    )
    and exists (
      select 1
      from public.delivery_stops s
      where s.id = stop_id
        and s.run_id = delivery_stop_events.run_id
        and s.organization_id = delivery_stop_events.organization_id
    )
  );

-- Les modèles de ramasse restent privés au chauffeur, mais un responsable
-- de la même organisation peut les lire/maintenir pour préparer les tournées.
drop policy if exists driver_pickup_templates_select_own on public.driver_pickup_templates;
create policy driver_pickup_templates_select_org on public.driver_pickup_templates
  for select using (
    organization_id = (select organization_id from public.users where id = auth.uid())
  );

drop policy if exists driver_pickup_templates_insert_own on public.driver_pickup_templates;
create policy driver_pickup_templates_insert_org on public.driver_pickup_templates
  for insert with check (
    organization_id = (select organization_id from public.users where id = auth.uid())
    and exists (select 1 from public.users u where u.id = driver_id and u.organization_id = driver_pickup_templates.organization_id)
  );

drop policy if exists driver_pickup_templates_update_own on public.driver_pickup_templates;
create policy driver_pickup_templates_update_org on public.driver_pickup_templates
  for update using (
    organization_id = (select organization_id from public.users where id = auth.uid())
  ) with check (
    organization_id = (select organization_id from public.users where id = auth.uid())
    and exists (select 1 from public.users u where u.id = driver_id and u.organization_id = organization_id)
  );

drop policy if exists driver_pickup_templates_delete_own on public.driver_pickup_templates;
create policy driver_pickup_templates_delete_org on public.driver_pickup_templates
  for delete using (
    organization_id = (select organization_id from public.users where id = auth.uid())
  );
