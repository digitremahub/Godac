-- Type d'alerte « sécurité » (code PIN bloqué, etc.), dans son propre fichier :
-- une valeur d'enum ajoutée ne peut pas servir dans la même transaction.
alter type alert_type add value if not exists 'security';
