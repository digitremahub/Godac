-- GODAC V2 — driver-submitted start/end-of-day tour reports.
--
-- planning_entries already had exactly the right shape for this
-- (tour_number, driver_id, vehicle_id, start_at, end_at) but existed
-- purely as schema — nothing ever wrote to it, and its RLS only let
-- manager-like/direction write (a pre-assigned-by-a-manager model).
-- This flips the actual flow around to match how it's used in
-- practice: the driver scans the vehicle, opens a tour with a
-- departure photo + odometer reading, and closes it out the same way
-- at day's end — extending the table rather than adding a parallel
-- one, since a "tour" is the same concept either way.
alter table planning_entries add column start_km numeric(10, 1);
alter table planning_entries add column end_km numeric(10, 1);
alter table planning_entries add column start_photo_path text;
alter table planning_entries add column end_photo_path text;
alter table planning_entries add column notes text;

-- Additive alongside the existing "manager-like writes scoped to
-- service" policy: a driver can also open and close their own tour.
create policy "planning: driver opens own tour"
  on planning_entries for insert
  with check (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id());

create policy "planning: driver closes own tour"
  on planning_entries for update
  using (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id())
  with check (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id());

-- Same tenant-isolation-by-path convention as tank-photos/org-logos.
insert into storage.buckets (id, name, public)
values ('tour-photos', 'tour-photos', false)
on conflict (id) do nothing;

create policy "tour-photos: read within org"
  on storage.objects for select
  using (
    bucket_id = 'tour-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "tour-photos: any member uploads within org"
  on storage.objects for insert
  with check (
    bucket_id = 'tour-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
