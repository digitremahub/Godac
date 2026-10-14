-- Tournée colis : poids des colis d'un arrêt (en kg), lu sur l'étiquette
-- (photo ou code scanné), saisi ou corrigé par le chauffeur, additionné
-- quand plusieurs colis rejoignent le même arrêt. Totalisé par tournée et
-- par liste dans l'application. null = poids inconnu.
alter table delivery_stops add column if not exists weight_kg numeric(9, 3);
alter table delivery_stops drop constraint if exists delivery_stops_weight_kg_check;
alter table delivery_stops add constraint delivery_stops_weight_kg_check check (weight_kg is null or (weight_kg > 0 and weight_kg <= 10000));
