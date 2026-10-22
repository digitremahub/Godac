-- TICPE — lots 2 et 3 : éligibilité datée des véhicules, carte grise,
-- zone des cuves, justificatif des pleins.
--
-- vehicles :
--   ticpe_categorie           activité du véhicule (null = catégorie par
--                             défaut de l'organisation ; 'exclu' = écarté
--                             à la main) ;
--   pays_immatriculation      code pays ISO (null = France) : seuls les
--                             véhicules immatriculés dans l'UE sont éligibles ;
--   ticpe_location_demandeur  véhicule loué : qui demande le remboursement
--                             (null = réglage de l'organisation) ;
--   flotte_entree_le / flotte_sortie_le : période dans la flotte ;
--   cg_*                      champs lus sur la carte grise (OCR) puis
--                             confirmés par une personne (cg_confirmee_le).
-- tanks.ticpe_zone : zone des pleins faits à la cuve (Corse ou métropole).
-- fuel_entries.ticpe_justificatif / _ref : justificatif conservé quand il
--   n'y a pas de photo de ticket (relevé de carte carburant, facture).
--
-- ADDITIF : add column if not exists seulement. Les droits d'écriture
-- sont ceux, inchangés, des tables vehicles, tanks et fuel_entries.

alter table public.vehicles add column if not exists ticpe_categorie text
  check (ticpe_categorie is null or ticpe_categorie in ('trm', 'trv', 'taxi', 'exclu'));
alter table public.vehicles add column if not exists pays_immatriculation text
  check (pays_immatriculation is null or pays_immatriculation ~ '^[A-Z]{2}$');
alter table public.vehicles add column if not exists ticpe_location_demandeur text
  check (ticpe_location_demandeur is null or ticpe_location_demandeur in ('nous', 'loueur'));
alter table public.vehicles add column if not exists flotte_entree_le date;
alter table public.vehicles add column if not exists flotte_sortie_le date;
alter table public.vehicles add column if not exists cg_genre text;
alter table public.vehicles add column if not exists cg_energie text;
alter table public.vehicles add column if not exists cg_premiere_immat date;
alter table public.vehicles add column if not exists cg_confirmee_le timestamptz;
alter table public.vehicles add column if not exists cg_confirmee_par uuid references public.users (id) on delete set null;

comment on column public.vehicles.ticpe_categorie is 'TICPE : trm / trv / taxi / exclu ; null = catégorie par défaut de l''organisation (ticpe_settings).';
comment on column public.vehicles.cg_confirmee_le is 'Carte grise lue (OCR) et confirmée par une personne : PTAC (F.2), genre (J.1), énergie (P.3), 1re immatriculation (B).';

alter table public.tanks add column if not exists ticpe_zone text not null default 'metropole'
  check (ticpe_zone in ('metropole', 'corse'));

alter table public.fuel_entries add column if not exists ticpe_justificatif text
  check (ticpe_justificatif is null or ticpe_justificatif in ('ticket', 'facture', 'releve_carte', 'livraison_cuve'));
alter table public.fuel_entries add column if not exists ticpe_justificatif_ref text;
