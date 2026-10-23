-- Départ et arrivée de l'optimisation de l'ordre de passage, choisis par le
-- chauffeur dans « Optimiser l'ordre » (Tournée colis) :
--   optim_depart  : { "mode": "depot" | "position" | "arret" | "adresse", "arret_id"?, "label"?, "lat"?, "lng"? }
--   optim_arrivee : { "mode": "depot" | "meme" | "arret" | "adresse" | "libre", "arret_id"?, "label"?, "lat"?, "lng"? }
-- Un arrêt choisi comme départ est le 1er de la tournée, comme arrivée le
-- dernier (épingle 📌). Null : comportement historique (départ au dépôt,
-- retour selon return_to_start). Additive ; le code reste tolérant tant
-- qu'elle n'est pas appliquée (mémoire de l'appareil).
alter table delivery_runs add column if not exists optim_depart jsonb;
alter table delivery_runs add column if not exists optim_arrivee jsonb;
