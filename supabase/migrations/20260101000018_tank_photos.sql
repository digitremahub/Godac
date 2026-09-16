-- GODAC V2 — tank totalizer photos, split out of the ticket OCR
-- pipeline entirely. Fuel ticket photos still go through Mindee OCR
-- and land in the "Revue OCR" queue (fuel_entries.status
-- awaiting_validation/ocr_failed); a photo of a tank's totalizer
-- display is a different thing — no OCR extraction is attempted, it
-- just needs a human (the service's manager-like users, or
-- direction) to read the value off the photo and record it. Keeping
-- these in their own table means "Revue OCR" never has to distinguish
-- what kind of photo it's looking at — it only ever sees tickets.

create type tank_photo_status as enum ('pending_review', 'reviewed');

create table tank_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  tank_id uuid not null references tanks (id) on delete cascade,
  submitted_by uuid not null references users (id) on delete cascade,
  photo_path text not null,
  totalizer_reading numeric(12, 2),
  note text,
  status tank_photo_status not null default 'pending_review',
  reviewed_by uuid references users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index tank_photos_tank_idx on tank_photos (tank_id, created_at);
create index tank_photos_organization_id_idx on tank_photos (organization_id);

alter table tank_photos enable row level security;

create policy "tank_photos: read within org"
  on tank_photos for select
  using (organization_id = public.current_organization_id());

create policy "tank_photos: any member submits own"
  on tank_photos for insert
  with check (organization_id = public.current_organization_id() and submitted_by = public.current_app_user_id());

-- Reviewing/correcting a submission (filling in the read totalizer
-- value, adding a note, marking it reviewed) is scoped like every
-- other tank write — manager-like within their service, or direction.
-- This never touches tanks.current_totalizer_index itself: that
-- column stays the totalizer-gap trusted anchor, only ever advanced
-- by a trusted fuel entry (see app/api/admin/tanks/[id]/route.ts).
create policy "tank_photos: manager-like reviews within service"
  on tank_photos for update
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (select 1 from tanks t where t.id = tank_photos.tank_id and t.service_id = any (public.current_user_service_ids()))
      )
    )
  );

-- Photos are stored at `<organization_id>/<tank_id>/<filename>`, same
-- tenant-isolation-by-path convention as every other bucket.
insert into storage.buckets (id, name, public)
values ('tank-photos', 'tank-photos', false)
on conflict (id) do nothing;

create policy "tank-photos: read within org"
  on storage.objects for select
  using (
    bucket_id = 'tank-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "tank-photos: any member uploads within org"
  on storage.objects for insert
  with check (
    bucket_id = 'tank-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
