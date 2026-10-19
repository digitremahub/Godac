-- Autorise jusqu'à trois photos de preuve par arrêt, sans perdre
-- la photo historique déjà stockée dans proof_photo_path.
alter table public.delivery_stops
  add column if not exists proof_photo_paths text[] not null default '{}';

update public.delivery_stops
set proof_photo_paths = array[proof_photo_path]
where proof_photo_path is not null
  and cardinality(proof_photo_paths) = 0;

alter table public.delivery_stops
  drop constraint if exists delivery_stops_proof_photo_paths_max_three;

alter table public.delivery_stops
  add constraint delivery_stops_proof_photo_paths_max_three
  check (cardinality(proof_photo_paths) <= 3);

notify pgrst, 'reload schema';
