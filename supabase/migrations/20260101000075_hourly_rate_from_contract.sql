-- GODAC V2 — un taux horaire saisi à la main dérive (augmentation,
-- avenant...) sans qu'on pense à le remettre à jour. users.hourly_rate
-- (ajouté il y a quelques minutes, jamais encore utilisé en
-- production) est remplacée par les données du contrat lui-même :
-- salaire mensuel brut/net + heures contractuelles mensuelles — le
-- taux horaire s'en déduit à chaque calcul (voir
-- lib/business/payroll.ts), jamais stocké figé.
--
-- Le DROP COLUMN hourly_rate lui-même est dans la migration suivante
-- (20260101000076) — appliqué séparément car un DROP demande une
-- confirmation destructrice à part sur ce projet.
alter table users add column monthly_gross_salary numeric(8, 2);
alter table users add column monthly_net_salary numeric(8, 2);
-- 151.67h = mensualisation standard d'un 35h (35×52/12) ; le secteur
-- transport routier applique souvent des heures d'équivalence
-- différentes selon la convention collective — direction ajuste au
-- cas par cas à la lecture du contrat, voir /payroll.
alter table users add column contractual_monthly_hours numeric(6, 2) not null default 151.67;
