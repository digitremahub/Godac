-- Paniers repas et primes varient d'un mois sur l'autre et n'ont pas
-- leur place sur user_contracts (le salaire de base, lui, est stable).
-- Saisis au moment de générer la fiche (voir /payroll), stockés ici
-- pour l'audit — gross_amount/net_amount restent le total réellement
-- versé (contrat + prime + panier), ces deux colonnes gardent le
-- détail de ce qui s'y ajoute.
alter table payslips add column meal_vouchers_amount numeric(10, 2) not null default 0;
alter table payslips add column bonus_amount numeric(10, 2) not null default 0;
