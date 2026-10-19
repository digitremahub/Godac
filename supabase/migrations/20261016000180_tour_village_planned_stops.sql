-- Planned collection and relay addresses configured on each village route.
-- Keep pickup_addresses for backwards compatibility with existing route sheets.
alter table public.tour_route_villages
  add column if not exists planned_stops jsonb not null default '[]'::jsonb;

comment on column public.tour_route_villages.planned_stops is
  'Addresses copied to the driver run: [{"type":"ramasse"|"point_relais","address":"..."}]';
