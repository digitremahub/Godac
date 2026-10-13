-- Retour à la grille de référence (Notion « Tarification GODAC ») pour
-- les mises en service : règle « mensuel × 10 = mise en service ».
-- Starter : 4 490 € payables en 12 mensualités sans frais.
-- Conservés de la migration 111 : tranches de véhicules sans
-- chevauchement, notifications push incluses, demandes d'entretien +10 %.

update plans set setup_price = 1490,  setup_installments = 1  where id = 'essentiel';
update plans set setup_price = 4490,  setup_installments = 12 where id = 'starter';
update plans set setup_price = 7490,  setup_installments = 1  where id = 'pro';
update plans set setup_price = 11490, setup_installments = 1  where id = 'business';

update module_plan_prices m set setup_price = v.setup
from (values
  ('employee_files', 'essentiel', 290), ('employee_files', 'starter', 290), ('employee_files', 'pro', 390), ('employee_files', 'business', 590),
  ('payslips', 'essentiel', 350), ('payslips', 'starter', 350), ('payslips', 'pro', 450), ('payslips', 'business', 450),
  ('maintenance_requests', 'essentiel', 870), ('maintenance_requests', 'starter', 870), ('maintenance_requests', 'pro', 1310), ('maintenance_requests', 'business', 1960),
  ('messenger', 'essentiel', 190), ('messenger', 'starter', 190), ('messenger', 'pro', 290), ('messenger', 'business', 290),
  ('bi_reporting', 'essentiel', 390), ('bi_reporting', 'starter', 390), ('bi_reporting', 'pro', 590), ('bi_reporting', 'business', 590),
  ('time_clock', 'essentiel', 190), ('time_clock', 'starter', 190), ('time_clock', 'pro', 290), ('time_clock', 'business', 290),
  ('ticpe_export', 'essentiel', 990), ('ticpe_export', 'starter', 990), ('ticpe_export', 'pro', 1490), ('ticpe_export', 'business', 2490),
  ('washes', 'essentiel', 149), ('washes', 'starter', 149),
  ('assistant', 'essentiel', 499), ('assistant', 'starter', 499), ('assistant', 'pro', 499), ('assistant', 'business', 699),
  ('fines', 'essentiel', 699), ('fines', 'starter', 699), ('fines', 'pro', 1050), ('fines', 'business', 1590)
) as v(module_key, plan_id, setup)
where m.module_key = v.module_key and m.plan_id::text = v.plan_id;
