-- GODAC V2 — attach the supplier invoice to a tank delivery
-- ("approvisionnement"), downloadable later. tank_deliveries had no
-- update policy at all before this (only select/insert), so attaching
-- an invoice after the fact — the common case, since the paper
-- invoice usually arrives after the truck does — needs one.
alter table tank_deliveries add column invoice_path text;

create policy "tank_deliveries: manager-like update scoped to service"
  on tank_deliveries for update
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (select 1 from tanks t where t.id = tank_deliveries.tank_id and t.service_id = any (public.current_user_service_ids()))
      )
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (select 1 from tanks t where t.id = tank_deliveries.tank_id and t.service_id = any (public.current_user_service_ids()))
      )
    )
  );

-- Same tenant-isolation-by-path convention as tank-photos/tour-photos.
insert into storage.buckets (id, name, public)
values ('tank-invoices', 'tank-invoices', false)
on conflict (id) do nothing;

create policy "tank-invoices: read within org"
  on storage.objects for select
  using (
    bucket_id = 'tank-invoices'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "tank-invoices: manager-like uploads within org"
  on storage.objects for insert
  with check (
    bucket_id = 'tank-invoices'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (public.is_direction() or public.is_manager_like())
  );
