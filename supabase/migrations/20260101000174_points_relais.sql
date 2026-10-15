-- Catégorie d'arrêt « point relais » pour les dépôts groupés de plusieurs colis.
-- Les valeurs historiques restent inchangées.
alter table delivery_stops drop constraint if exists delivery_stops_kind_check;
alter table delivery_stops add constraint delivery_stops_kind_check
  check (kind in ('livraison', 'ramasse', 'point_relais'));
