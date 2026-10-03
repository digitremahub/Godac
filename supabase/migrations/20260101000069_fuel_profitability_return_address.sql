-- GODAC V2 — pour calculer la rentabilité carburant, il faut pouvoir
-- distinguer un retour de tournée au dépôt (le trajet habituel,
-- utilisé comme référence) d'un retour direct au domicile du
-- chauffeur (qui modifie la distance réellement parcourue, sans que
-- cela passe par une anomalie). Le kilométrage réel (odomètre) reste
-- la source de vérité pour le L/100km (lib/business/consumption.ts,
-- inchangé) — ce qui est ajouté ici sert à estimer la part de
-- distance attribuable à ce choix, pas à la remplacer.
create type tour_return_type as enum ('depot', 'domicile');

alter table users add column address text;
alter table users add column address_lat numeric(9, 6);
alter table users add column address_lng numeric(9, 6);

alter table organizations add column depot_address text;
alter table organizations add column depot_lat numeric(9, 6);
alter table organizations add column depot_lng numeric(9, 6);

alter table planning_entries add column return_type tour_return_type;
