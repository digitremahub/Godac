-- Grille de prix rendue cohérente (abonnements mensuels inchangés, sauf
-- demandes d'entretien +10 %). Les organisations existantes gardent leurs
-- prix (organization_modules).
--  1. Tranches de véhicules sans chevauchement : une flotte = une formule.
--  2. Mise en service ramenée à environ 1 à 2 mois d'abonnement (au lieu de
--     10 à 18), payable en 3 mensualités sans frais en Starter.
--  3. Pas de frais de mise en service pour activer un module, sauf la paie
--     (paramétrage des profils de paie et reprise des cumuls).
--  4. Notifications push incluses partout (indispensables à l'app chauffeur).

alter table plans add column if not exists setup_installments smallint not null default 1
  check (setup_installments between 1 and 12);

update plans set vehicle_min = 1,  vehicle_max = 5,   setup_price = 290,  setup_installments = 1 where id = 'essentiel';
update plans set vehicle_min = 6,  vehicle_max = 20,  setup_price = 600,  setup_installments = 3 where id = 'starter';
update plans set vehicle_min = 21, vehicle_max = 60,  setup_price = 990,  setup_installments = 1 where id = 'pro';
update plans set vehicle_min = 61, vehicle_max = 150, setup_price = 1490, setup_installments = 1 where id = 'business';

update module_plan_prices set setup_price = 0 where module_key <> 'payslips';
update module_plan_prices set setup_price = 290 where module_key = 'payslips';

update module_plan_prices set monthly_price = 0, included = true where module_key = 'push_notifications';
update modules set included_from_plan = 'essentiel', base_price = 0 where key = 'push_notifications';

update module_plan_prices set monthly_price = round(monthly_price * 1.10) where module_key = 'maintenance_requests' and not included;
update modules set base_price = round(base_price * 1.10) where key = 'maintenance_requests';
