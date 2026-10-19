-- Tournée colis : points relais (migration additive).
--
-- 1. Type d'arrêt « point_relais » : commerce partenaire (Relais Colis,
--    Pickup, Mondial Relay, Chronopost…) où le chauffeur dépose plusieurs
--    colis et reprend éventuellement des retours. Nom du relais dans
--    relay_name ; ses horaires viennent de l'annuaire des adresses pro
--    (delivery_address_hours, même adresse normalisée), comme toute adresse.
alter table delivery_stops drop constraint if exists delivery_stops_kind_check;
alter table delivery_stops add constraint delivery_stops_kind_check check (kind in ('livraison', 'ramasse', 'point_relais'));

-- Nom du relais : celui de l'arrêt « point relais », ou, pour une
-- livraison remise au point relais (client absent), le nom ou l'adresse
-- du relais saisi par le chauffeur.
alter table delivery_stops add column if not exists relay_name text;
alter table delivery_stops drop constraint if exists delivery_stops_relay_name_check;
alter table delivery_stops add constraint delivery_stops_relay_name_check check (relay_name is null or char_length(relay_name) <= 200);

-- Retours repris au relais : colonne existante packages_picked_up
-- (20261018000007_delivery_stop_package_counts.sql), rien à ajouter.

-- 2. Mode de remise « point_relais » : dépôt au relais (arrêt point relais)
--    ou livraison au relais en cas d'absence. Preuve : photo ou code /
--    bordereau du relais scanné (proof_code).
alter table delivery_stops drop constraint if exists delivery_stops_delivered_place_check;
alter table delivery_stops
  add constraint delivery_stops_delivered_place_check
  check (delivered_place in ('main_propre', 'boite_aux_lettres', 'jardin', 'voisin', 'autre', 'qr_code', 'point_relais'));

-- 3. Motif d'échec propre au relais : relais complet ou qui refuse les colis.
alter table delivery_stops drop constraint if exists delivery_stops_failure_reason_check;
alter table delivery_stops
  add constraint delivery_stops_failure_reason_check
  check (failure_reason is null or failure_reason in ('absent', 'adresse_introuvable', 'acces_impossible', 'ferme', 'refuse', 'rien_a_ramasser', 'relais_complet', 'autre'));
