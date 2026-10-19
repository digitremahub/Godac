-- Compteurs de colis réellement récupérés / déposés.
-- Idempotent : peut être rejoué si l'une des colonnes existe déjà.
ALTER TABLE public.delivery_stops
  ADD COLUMN IF NOT EXISTS packages_picked_up integer;

ALTER TABLE public.delivery_stops
  ADD COLUMN IF NOT EXISTS packages_delivered integer;

ALTER TABLE public.delivery_stops
  DROP CONSTRAINT IF EXISTS delivery_stops_packages_picked_up_check;

ALTER TABLE public.delivery_stops
  ADD CONSTRAINT delivery_stops_packages_picked_up_check
  CHECK (packages_picked_up IS NULL OR (packages_picked_up >= 0 AND packages_picked_up <= 500));

ALTER TABLE public.delivery_stops
  DROP CONSTRAINT IF EXISTS delivery_stops_packages_delivered_check;

ALTER TABLE public.delivery_stops
  ADD CONSTRAINT delivery_stops_packages_delivered_check
  CHECK (packages_delivered IS NULL OR (packages_delivered >= 0 AND packages_delivered <= 500));
