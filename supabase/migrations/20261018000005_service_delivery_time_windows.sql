-- Créneaux de livraison configurables par service GODAC.
alter table public.services
  add column if not exists delivery_time_windows jsonb not null
  default '[{"label":"8 h – 11 h","start":"08:00","end":"11:00"},{"label":"10 h – 13 h","start":"10:00","end":"13:00"},{"label":"12 h – 15 h","start":"12:00","end":"15:00"},{"label":"14 h – 17 h","start":"14:00","end":"17:00"}]'::jsonb;

comment on column public.services.delivery_time_windows is
  'Créneaux de livraison proposés dans GODAC pour ce service : [{label,start,end}].';
