-- Modèle de paie par défaut des entreprises de transport (IDCC 16),
-- repris de bulletins réels (taux et structure seulement, aucune donnée
-- personnelle) — voir lib/paie/parametres.ts › MODELE_TRANSPORT et le
-- test lib/paie/__tests__/bulletin-reference.test.ts.
--
-- Migration ADDITIVE : colonnes ajoutées si absentes, aucune donnée
-- modifiée ni supprimée. L'application tolère leur absence.

-- 1. Réglages de l'entreprise ---------------------------------------------
--    Cotisations conventionnelles de branche (0,025 % + 0,525 % du brut) ;
--    complémentaire santé au forfait en % du PMSS (2,01 % + 2,01 %),
--    qui remplace les montants mutuelle_* quand elle est renseignée ;
--    DFS « Abattement 17 % » des conducteurs : affichée pour mémoire,
--    appliquée aux bases seulement si dfs_enabled.
alter table public.payroll_settings
  add column if not exists ccn_salarial_rate numeric(6, 3) default 0.025,
  add column if not exists ccn_patronal_rate numeric(6, 3) default 0.525,
  add column if not exists health_pmss_salarial_rate numeric(6, 3),
  add column if not exists health_pmss_patronal_rate numeric(6, 3),
  add column if not exists dfs_rate numeric(5, 2) default 17,
  add column if not exists dfs_enabled boolean not null default false;

-- 2. Profil de paie du salarié --------------------------------------------
--    Groupe conventionnel (ex. 03 bis), taux du panier propre au salarié
--    (null = réglage de l'entreprise), solde de congés de reprise (N-1, N,
--    à la date du dernier bulletin connu) : point de départ des compteurs
--    de congés (lib/paie/conges.ts) affichés au salarié et sur le bulletin.
alter table public.payroll_profiles
  add column if not exists job_group text
    constraint payroll_profiles_job_group_check check (job_group is null or char_length(job_group) <= 20),
  add column if not exists meal_rate numeric(6, 2)
    constraint payroll_profiles_meal_rate_check check (meal_rate is null or meal_rate >= 0),
  add column if not exists leave_balance_n1 numeric(5, 2)
    constraint payroll_profiles_leave_balance_n1_check check (leave_balance_n1 is null or leave_balance_n1 >= 0),
  add column if not exists leave_balance_n numeric(5, 2)
    constraint payroll_profiles_leave_balance_n_check check (leave_balance_n is null or leave_balance_n >= 0),
  add column if not exists leave_balance_date date;
