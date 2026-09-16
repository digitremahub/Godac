-- Local dev seed only — mirrors the V1 pilot client (Sud Express 66,
-- Perpignan, flotte mixte ~61 véhicules) at a small scale so the app
-- has something to render against `supabase db reset`.
-- Never run against a production project.

insert into organizations (id, clerk_org_id, name, plan, ocr_enabled, subscription_status)
values ('00000000-0000-0000-0000-000000000001', 'org_dev_seed', 'Sud Express 66 (démo)', 'pro', true, 'trialing');

insert into services (id, organization_id, name, code)
values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Perpignan - Dépôt', 'PPN'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Longue distance', 'LD');

insert into tanks (id, organization_id, service_id, name, fuel_type, capacity_liters, current_totalizer_index)
values
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Cuve Gasoil A', 'diesel', 15000, 128450.00),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Cuve AdBlue', 'adblue', 3000, 8120.00);

insert into vehicles (id, organization_id, service_id, registration, type, tank_capacity_liters, status)
values
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'AB-123-CD', 'PL', 400, 'active'),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'EF-456-GH', 'SPL', 600, 'active'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'IJ-789-KL', 'VL', 60, 'active');
