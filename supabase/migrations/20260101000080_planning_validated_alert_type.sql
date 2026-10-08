-- "Valider et envoyer" (app/api/planning/validate/route.ts) inserts
-- alerts with type 'planning_validated', but that value was never
-- added to the enum — every validation attempt failed with
-- "invalid input value for enum alert_type".
alter type alert_type add value 'planning_validated';
