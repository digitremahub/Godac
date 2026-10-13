-- App Livreur : grille validée par François (remplace 116 et 118).
-- 1–20 : 29 € · 21–50 : 59 € · 51–99 : 99 € · 100 et plus : 129 € + 1 € par
-- chauffeur au-delà de 100.
delete from module_user_tiers where module_key = 'route_optimizer';
insert into module_user_tiers (module_key, min_users, max_users, monthly_price, extra_per_user) values
  ('route_optimizer', 1, 20, 29, 0),
  ('route_optimizer', 21, 50, 59, 0),
  ('route_optimizer', 51, 99, 99, 0),
  ('route_optimizer', 100, null, 129, 1);
