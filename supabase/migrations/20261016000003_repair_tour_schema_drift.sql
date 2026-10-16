-- Repair schema drift found in production while loading tour villages and adding relay stops.
-- Safe to re-run: all additions are guarded and the constraint is recreated idempotently.

alter table public.tour_route_villages
  add column if not exists pickup_addresses jsonb not null default '[]'::jsonb;

alter table public.tour_route_villages
  add column if not exists planned_stops jsonb not null default '[]'::jsonb;

alter table public.delivery_stops
  add column if not exists kind text not null default 'livraison';

alter table public.delivery_stops
  add column if not exists exceptional_pickup boolean not null default false;

alter table public.delivery_stops
  drop constraint if exists delivery_stops_kind_check;

alter table public.delivery_stops
  add constraint delivery_stops_kind_check
  check (kind in ('livraison', 'ramasse', 'point_relais'));

notify pgrst, 'reload schema';
