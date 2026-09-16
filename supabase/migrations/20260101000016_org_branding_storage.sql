-- GODAC V2 — Storage bucket for organization logos (self-service
-- branding, see organizations.logo_url / .accent_color added in
-- migration 15). Public bucket — a company logo isn't sensitive and
-- needs to render without a signed URL (sidebar, future public-facing
-- pages) — but writes stay scoped to the org's own folder and to
-- `direction`, same tenant-isolation-by-path convention as every
-- other bucket (`<organization_id>/logo.<ext>`).

insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

create policy "org-logos: public read"
  on storage.objects for select
  using (bucket_id = 'org-logos');

create policy "org-logos: direction manages own org folder"
  on storage.objects for all
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  )
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and public.is_direction()
  );
