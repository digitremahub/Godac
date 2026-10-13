-- Audit carburant (TICPE) :
-- 1. Les lignes d'un export ne pouvaient pas être insérées (RLS sans
--    policy INSERT) : l'export échouait dès qu'il contenait un véhicule.
-- 2. Le PDF / l'Excel régénérés après correction ne pouvaient pas
--    remplacer le fichier existant (pas de policy UPDATE sur le bucket).
-- 3. Le total d'un export n'était pas recalculable après correction
--    (pas de policy UPDATE sur ticpe_exports).
-- (La restriction de lecture des lignes à direction/comptable est dans la
--  migration 122, qui remplace des policies existantes.)

create policy "ticpe_export_lines: comptable/direction insert"
  on ticpe_export_lines for insert
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );

create policy "ticpe: comptable and direction update"
  on ticpe_exports for update
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );

create policy "ticpe-exports: comptable/direction update within org"
  on storage.objects for update
  using (
    bucket_id = 'ticpe-exports'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.current_role() in ('comptable', 'direction')
  )
  with check (
    bucket_id = 'ticpe-exports'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.current_role() in ('comptable', 'direction')
  );
