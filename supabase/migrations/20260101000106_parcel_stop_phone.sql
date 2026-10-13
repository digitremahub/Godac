-- Téléphone du destinataire sur chaque arrêt de tournée colis : lu sur
-- l'étiquette, importé ou saisi, pour que le chauffeur appelle le client
-- d'un geste depuis l'application. Même durée de conservation que
-- l'adresse (purge 30 jours après la tournée, lib/retention/purge.ts).
alter table delivery_stops add column if not exists phone text;
