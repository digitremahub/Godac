-- GODAC V2 — Storage bucket for generated TICPE export files (Module 7).
-- Same per-org path convention as fuel-tickets:
-- `<organization_id>/<export_id>.xlsx`.

insert into storage.buckets (id, name, public)
values ('ticpe-exports', 'ticpe-exports', false)
on conflict (id) do nothing;

create policy "ticpe-exports: comptable/direction read within org"
  on storage.objects for select
  using (
    bucket_id = 'ticpe-exports'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.current_role() in ('comptable', 'direction')
  );

create policy "ticpe-exports: comptable/direction write within org"
  on storage.objects for insert
  with check (
    bucket_id = 'ticpe-exports'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.current_role() in ('comptable', 'direction')
  );
