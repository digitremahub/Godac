-- Mode simple de la tournée colis et contacts du client.
--   delivery_runs.mode_simple : la tournée n'a que « Livré » / « Non livré »
--     (ni lieu de dépôt, ni preuve, ni questions de ramasse ou de relais).
--     Choisi à la création, modifiable tant que la tournée n'est pas clôturée.
--   delivery_stops.contact_message / contact_phone : « Message envoyé » et
--     « Eu au téléphone » cochés par le chauffeur ; contact_at : dernière coche.
-- Additive ; le code reste tolérant tant qu'elle n'est pas appliquée.
alter table public.delivery_runs add column if not exists mode_simple boolean not null default false;
alter table public.delivery_stops add column if not exists contact_message boolean not null default false;
alter table public.delivery_stops add column if not exists contact_phone boolean not null default false;
alter table public.delivery_stops add column if not exists contact_at timestamptz;

-- Journal d'arrêt : nouveau type « contact_recorded » (même liste que la migration 20261019000004, plus ce type).
alter table public.delivery_stop_events drop constraint if exists delivery_stop_events_event_type_check;
alter table public.delivery_stop_events
  add constraint delivery_stop_events_event_type_check check (event_type in (
    'stop_created', 'status_changed', 'delivered', 'failed', 'reopened',
    'reordered', 'list_changed', 'pickup_count_recorded', 'delivery_count_recorded',
    'sms_prepared', 'sms_confirmed_sent', 'call_started', 'call_confirmed', 'note',
    'contact_recorded'
  ));

notify pgrst, 'reload schema';
