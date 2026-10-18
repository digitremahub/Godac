-- Chauffeur habituel par tournée + contrôles de couverture du planning.
alter table public.tour_routes
  add column if not exists default_driver_id uuid references public.users(id) on delete set null;

create index if not exists tour_routes_default_driver_idx
  on public.tour_routes(default_driver_id);

comment on column public.tour_routes.default_driver_id is
  'Chauffeur habituel proposé lors de la préparation du planning; doit être vérifié selon les congés approuvés.';

notify pgrst, 'reload schema';
