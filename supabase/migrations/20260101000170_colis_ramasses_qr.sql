-- Tournée colis : ramasses et livraison avec QR code.
--
-- 1. Type d'arrêt : « livraison » (par défaut, y compris pour l'import, le
--    scan et la lecture d'étiquette) ou « ramasse » (enlèvement de colis
--    chez un expéditeur), marqué par le chauffeur à la création / édition
--    et signalé par une encoche dorée dans la liste des arrêts.
alter table delivery_stops add column if not exists kind text not null default 'livraison';
alter table delivery_stops drop constraint if exists delivery_stops_kind_check;
alter table delivery_stops add constraint delivery_stops_kind_check check (kind in ('livraison', 'ramasse'));

-- 2. Nouveau mode de remise « qr_code » : le chauffeur scanne le QR code
--    (ou le code de retrait) présenté par le destinataire ; la valeur lue
--    est conservée comme preuve dans proof_code. Même durée de conservation
--    que la photo de livraison (effacée avec la tournée, lib/retention/purge.ts).
alter table delivery_stops add column if not exists proof_code text;
alter table delivery_stops drop constraint if exists delivery_stops_proof_code_check;
alter table delivery_stops add constraint delivery_stops_proof_code_check check (proof_code is null or char_length(proof_code) <= 500);

-- Contrainte créée en ligne par 20260101000107_delivery_proof.sql (nom
-- attribué par Postgres) : étendue au mode « qr_code ».
alter table delivery_stops drop constraint if exists delivery_stops_delivered_place_check;
alter table delivery_stops
  add constraint delivery_stops_delivered_place_check check (delivered_place in ('main_propre', 'boite_aux_lettres', 'jardin', 'voisin', 'autre', 'qr_code'));
