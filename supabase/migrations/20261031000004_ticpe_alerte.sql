-- TICPE — type d'alerte des rappels (échéance de dépôt, ERA de janvier).
-- Seul dans sa migration : une valeur d'enum ajoutée ne peut pas servir
-- dans la même transaction (cf. 20260101000024 et suivantes).
alter type alert_type add value if not exists 'ticpe_rappel';
