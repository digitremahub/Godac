-- Nombre de colis effectivement déposés au point relais (distinct du nombre attendu).
ALTER TABLE public.delivery_stops
  ADD COLUMN IF NOT EXISTS packages_delivered integer;

ALTER TABLE public.delivery_stops
  DROP CONSTRAINT IF EXISTS delivery_stops_packages_delivered_check;

ALTER TABLE public.delivery_stops
  ADD CONSTRAINT delivery_stops_packages_delivered_check
  CHECK (packages_delivered IS NULL OR (packages_delivered >= 0 AND packages_delivered <= 500));
