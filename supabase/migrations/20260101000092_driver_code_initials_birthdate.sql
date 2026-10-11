-- Le code de secours (users.driver_code, voir 20260101000056) était
-- jusqu'ici purement aléatoire (6 chiffres) — demandé à la place sous
-- la forme "initiales + mois/année de naissance" (ex: FT11/88), bien
-- plus facile à retenir/dicter à la pompe qu'une suite de chiffres
-- arbitraire. La date de naissance n'étant saisie nulle part, elle
-- rejoint le dossier RH (employee_files, direction-only) aux côtés du
-- matricule/n° sécu déjà ajoutés — le code n'est recalculé qu'une fois
-- la date de naissance renseignée (voir app/api/admin/users/[id]),
-- les comptes sans date de naissance gardent leur code aléatoire
-- existant/initial (le trigger assign_driver_code de 20260101000056
-- reste inchangé, toujours nécessaire pour qu'un tout nouveau compte
-- ait un code utilisable immédiatement).
alter table public.employee_files
  add column if not exists birth_date date;
