-- Tournée colis : clôture d'un arrêt dans n'importe quel ordre, en
-- livraison ou en échec avec motif (lib/colis/cloture.ts). Le motif est
-- effacé quand le chauffeur annule la clôture (arrêt remis à faire).
alter table delivery_stops add column if not exists failure_reason text;
alter table delivery_stops drop constraint if exists delivery_stops_failure_reason_check;
alter table delivery_stops
  add constraint delivery_stops_failure_reason_check
  check (failure_reason is null or failure_reason in ('absent', 'adresse_introuvable', 'acces_impossible', 'ferme', 'refuse', 'rien_a_ramasser', 'autre'));
