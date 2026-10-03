-- GODAC V2 — Lot 4: full "signalement" (Demandes d'Entretien).
--
-- The free-text `type` column stays exactly as it is — old entries
-- remain readable as-is — this adds a new structured `category`
-- column alongside it for the fixed list the driver now picks from;
-- the API mirrors a French label into `type` for whichever row this
-- is so every existing display (MaintenanceRequestsList,
-- InterventionsPanel, the vehicle fiche) keeps working unchanged.
create type intervention_category as enum ('mechanical', 'bodywork', 'tires', 'maintenance', 'other');

alter table vehicle_interventions add column category intervention_category;
alter table vehicle_interventions add column appointment_needed boolean not null default false;
-- Up to 4 photos for a driver-filed signalement. Distinct from the
-- single `photo_path` column Lot 3 added for a tour's auto-created
-- signalement (one optional photo, different flow) — kept separate
-- rather than reusing/renaming that column, since "never modify an
-- existing migration" rules out folding the two together now.
alter table vehicle_interventions add column photo_paths text[] not null default '{}';

-- Accident banner on the signalement form: the number to call right
-- away, editable in Admin > Organisation. No number set = no banner.
alter table organizations add column emergency_phone text;

-- Same tenant-isolation-by-path convention as tour-photos/tank-photos.
insert into storage.buckets (id, name, public)
values ('intervention-photos', 'intervention-photos', false)
on conflict (id) do nothing;

create policy "intervention-photos: read within org"
  on storage.objects for select
  using (
    bucket_id = 'intervention-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "intervention-photos: any member uploads within org"
  on storage.objects for insert
  with check (
    bucket_id = 'intervention-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
