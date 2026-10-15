-- Ramasses planifiées par la direction sur chaque village de la fiche tournée.
alter table public.tour_route_villages
  add column if not exists pickup_addresses text[] not null default '{}';

comment on column public.tour_route_villages.pickup_addresses is
  'Adresses de ramasse prévues par la direction pour ce village, une adresse par entrée.';
