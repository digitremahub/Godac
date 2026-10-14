-- Module « Véhicules loués (loueurs) » : deux nouveaux types d'alerte.
-- Fichier dédié : une valeur d'enum ajoutée ne peut pas être utilisée
-- dans la même transaction (même convention que 024, 039, 042…).
--   rental_request  : action d'un loueur/prestataire sur une demande
--                     d'entretien transmise (accepte, propose un créneau,
--                     commente, termine).
--   rental_contract : fin de contrat de location proche, forfait
--                     kilométrique bientôt dépassé.
alter type alert_type add value if not exists 'rental_request';
alter type alert_type add value if not exists 'rental_contract';
