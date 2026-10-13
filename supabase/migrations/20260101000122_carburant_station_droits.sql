-- Audit carburant, partie qui remplace des éléments existants :
-- 1. Achats en station : un plein n'est plus rattaché de force à une cuve
--    (tank_id facultatif ; totaliseur exigé seulement pour un plein cuve).
-- 2. Pleins : le chauffeur complète et valide son ticket lu par OCR, mais ne
--    peut plus modifier un plein déjà enregistré (avant : modifiable à vie,
--    et la validation de son propre ticket échouait).
-- 3. Lignes d'export TICPE lisibles par la direction et le comptable seulement.

alter table fuel_entries alter column tank_id drop not null;
alter table fuel_entries drop constraint fuel_entries_trusted_requires_figures;
alter table fuel_entries add constraint fuel_entries_trusted_requires_figures check (
  status not in ('manual', 'validated')
  or (liters is not null and unit_price is not null and (tank_id is null or totalizer_after is not null))
);

drop policy "fuel_entries: update own unvalidated or manager scope" on fuel_entries;
create policy "fuel_entries: update own pending or manager scope"
  on fuel_entries for update
  using (
    organization_id = public.current_organization_id()
    and (
      (driver_id = public.current_app_user_id() and status in ('pending_ocr', 'awaiting_validation', 'ocr_failed'))
      or public.is_direction()
      or (public.is_manager_like() and exists (
        select 1 from vehicles v where v.id = fuel_entries.vehicle_id and v.service_id = any (public.current_user_service_ids())
      ))
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or public.is_direction()
      or (public.is_manager_like() and exists (
        select 1 from vehicles v where v.id = fuel_entries.vehicle_id and v.service_id = any (public.current_user_service_ids())
      ))
    )
  );

drop policy "ticpe_export_lines: read within org" on ticpe_export_lines;
create policy "ticpe_export_lines: comptable/direction read"
  on ticpe_export_lines for select
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );
