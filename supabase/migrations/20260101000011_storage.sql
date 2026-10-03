-- GODAC V2 — Supabase Storage bucket for fuel ticket photos (Module 3).
-- Objects are stored at `<organization_id>/<fuel_entry_id>/<filename>`
-- so the RLS policy can enforce tenant isolation purely from the
-- object path, mirroring every other table.

insert into storage.buckets (id, name, public)
values ('fuel-tickets', 'fuel-tickets', false)
on conflict (id) do nothing;

create policy "fuel-tickets: read within org"
  on storage.objects for select
  using (
    bucket_id = 'fuel-tickets'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "fuel-tickets: upload within org"
  on storage.objects for insert
  with check (
    bucket_id = 'fuel-tickets'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "fuel-tickets: manager-like can delete within org"
  on storage.objects for delete
  using (
    bucket_id = 'fuel-tickets'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_manager_like()
  );
