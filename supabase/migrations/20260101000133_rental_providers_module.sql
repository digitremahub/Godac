-- Module « Véhicules loués (loueurs) » au catalogue.
-- Même logique tarifaire que Lavage : à la carte sur Essentiel/Starter
-- (19 €/mois + 190 € de mise en service, règle « mensuel × 10 »),
-- inclus sans supplément à partir de Pro. Ajustable dans
-- module_plan_prices sans changement de code.

insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('rental_providers', 'Véhicules loués (loueurs)', 'Véhicules en location, LLD ou crédit-bail : loueurs et garages prestataires, demandes d''entretien transmises au loueur après validation du responsable, réponse du prestataire par lien sécurisé, alertes fin de contrat et forfait kilométrique.', 'v2', false, 19, 'pro', 33)
on conflict (key) do nothing;

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
select
  'rental_providers',
  p.id,
  case when p.id in ('pro', 'business') then 0 else 19 end,
  case when p.id in ('pro', 'business') then 0 else 190 end,
  p.id in ('pro', 'business')
from plans p
on conflict do nothing;
