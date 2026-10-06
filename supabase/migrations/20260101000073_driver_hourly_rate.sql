-- GODAC V2 — taux horaire par chauffeur, saisi/ajusté au cas par cas
-- par la direction (lecture du contrat), pour estimer le salaire à
-- partir des heures travaillées (voir /payroll). Pas de valeur par
-- défaut : tant qu'il n'est pas renseigné, le calcul de salaire reste
-- affiché comme indisponible plutôt que de deviner un taux.
alter table users add column hourly_rate numeric(6,2);
