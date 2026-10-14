-- Alerte « consommation » : 80 % puis 100 % du volume mensuel inclus
-- d'une fonction payante atteints (lib/usage/consommer.ts). Migration
-- séparée : une valeur d'enum ajoutée ne peut pas servir dans la même
-- transaction.
alter type alert_type add value if not exists 'usage_quota';
