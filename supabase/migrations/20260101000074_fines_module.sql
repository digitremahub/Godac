-- GODAC V2 — câble enfin la table `fines` (créée dès
-- 20260101000005_planning_rh.sql, jamais exposée en UI) : photo du PV
-- jointe (OCR best-effort, voir lib/ocr/fine.ts) et suivi de la
-- notification envoyée au chauffeur une fois le rattachement confirmé
-- (app/(dashboard)/fines).
alter table fines add column photo_path text;
alter table fines add column notified_at timestamptz;

-- Même convention par dossier d'organisation que tour-photos/tank-photos.
insert into storage.buckets (id, name, public)
values ('fine-photos', 'fine-photos', false)
on conflict (id) do nothing;

create policy "fine-photos: read within org"
  on storage.objects for select
  using (
    bucket_id = 'fine-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "fine-photos: manager-like uploads within org"
  on storage.objects for insert
  with check (
    bucket_id = 'fine-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('fines', 'Amendes', 'Suivi des amendes par véhicule, rattachement suggéré au chauffeur via le planning (confirmation manuelle), notification.', 'v2', false, 19, null, 30);

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
select 'fines', p.id, 19, 0, false
from plans p;
