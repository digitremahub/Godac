-- Paie : arrêts de travail, maintien de salaire, subrogation et sortie
-- des salariés (lib/paie/arrets.ts, lib/paie/sortie.ts).
--
-- Migration ADDITIVE : tables et colonnes créées si absentes, aucune
-- donnée modifiée ni supprimée, aucune policy retirée. L'application
-- tolère l'absence de cette migration (arrêts saisis sur le bulletin
-- seulement, maintien légal, pas de sortie enregistrée).
--
-- Lectorat, comme pour la paie : direction et comptable lisent et
-- écrivent ; le salarié lit les siens.

-- 1. Arrêts de travail et congés sans solde -------------------------------
create table if not exists public.work_stoppages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  stoppage_type text not null
    constraint work_stoppages_type_check check (stoppage_type in ('maladie', 'at_mp', 'trajet', 'maternite', 'paternite', 'sans_solde')),
  start_date date not null,
  end_date date not null,
  -- Prolongation : date de début de l'arrêt initial (carences non réappliquées).
  extension_of date,
  -- IJSS (relevé CPAM), si connues : montants journaliers et jours du mois.
  daily_ijss_gross numeric(8, 2) constraint work_stoppages_ijss_gross_check check (daily_ijss_gross is null or daily_ijss_gross >= 0),
  daily_ijss_net numeric(8, 2) constraint work_stoppages_ijss_net_check check (daily_ijss_net is null or daily_ijss_net >= 0),
  ijss_days numeric(5, 1) constraint work_stoppages_ijss_days_check check (ijss_days is null or ijss_days >= 0),
  -- Maintien saisi à la main (remplace le calcul).
  manual_maintenance numeric(10, 2) constraint work_stoppages_manual_check check (manual_maintenance is null or manual_maintenance >= 0),
  notes text constraint work_stoppages_notes_check check (notes is null or char_length(notes) <= 500),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_stoppages_dates_check check (end_date >= start_date)
);
create index if not exists work_stoppages_user_period_idx on public.work_stoppages (user_id, start_date, end_date);
create index if not exists work_stoppages_org_idx on public.work_stoppages (organization_id);

alter table public.work_stoppages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: read own, direction or comptable') then
    create policy "work_stoppages: read own, direction or comptable" on public.work_stoppages
      for select using (
        organization_id = public.current_organization_id()
        and (user_id = public.current_app_user_id() or public.is_direction() or public.current_role() = 'comptable')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_stoppages' and policyname = 'work_stoppages: direction or comptable writes') then
    create policy "work_stoppages: direction or comptable writes" on public.work_stoppages
      for all
      using (organization_id = public.current_organization_id() and (public.is_direction() or public.current_role() = 'comptable'))
      with check (organization_id = public.current_organization_id() and (public.is_direction() or public.current_role() = 'comptable'));
  end if;
end $$;

-- 2. Sorties des salariés ---------------------------------------------------
create table if not exists public.employee_exits (
  user_id uuid primary key references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  exit_date date not null,
  reason text not null
    constraint employee_exits_reason_check check (reason in ('licenciement', 'licenciement_faute_grave', 'rupture_conventionnelle', 'demission', 'fin_cdd', 'retraite', 'autre')),
  -- Préavis : effectué, payé (indemnité compensatrice), dispensé non payé, sans objet.
  notice_type text not null default 'sans'
    constraint employee_exits_notice_check check (notice_type in ('effectue', 'paye', 'non_paye', 'sans')),
  notice_days numeric(5, 1) constraint employee_exits_notice_days_check check (notice_days is null or notice_days >= 0),
  notice_amount numeric(10, 2) constraint employee_exits_notice_amount_check check (notice_amount is null or notice_amount >= 0),
  -- Indemnité convenue (rupture conventionnelle) ou supra-légale (licenciement).
  severance_amount numeric(12, 2) constraint employee_exits_severance_check check (severance_amount is null or severance_amount >= 0),
  -- Emplois occupés (certificat de travail), un par ligne.
  jobs_held text constraint employee_exits_jobs_check check (jobs_held is null or char_length(jobs_held) <= 1000),
  notes text constraint employee_exits_notes_check check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_exits_org_idx on public.employee_exits (organization_id);

alter table public.employee_exits enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_exits' and policyname = 'employee_exits: read own, direction or comptable') then
    create policy "employee_exits: read own, direction or comptable" on public.employee_exits
      for select using (
        organization_id = public.current_organization_id()
        and (user_id = public.current_app_user_id() or public.is_direction() or public.current_role() = 'comptable')
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_exits' and policyname = 'employee_exits: direction or comptable writes') then
    create policy "employee_exits: direction or comptable writes" on public.employee_exits
      for all
      using (organization_id = public.current_organization_id() and (public.is_direction() or public.current_role() = 'comptable'))
      with check (organization_id = public.current_organization_id() and (public.is_direction() or public.current_role() = 'comptable'));
  end if;
end $$;

-- 3. Réglages : maintien de salaire et subrogation -----------------------------
--    Valeurs légales par défaut (art. D1226-1 s. du code du travail) ;
--    les valeurs de la convention collective (IDCC 16) sont à vérifier
--    par le comptable et à saisir dans Équipe › Paie › Réglages.
alter table public.payroll_settings
  add column if not exists sick_pay_min_seniority_months integer default 12
    constraint payroll_settings_sick_seniority_check check (sick_pay_min_seniority_months is null or sick_pay_min_seniority_months between 0 and 120),
  add column if not exists sick_pay_waiting_days integer default 7
    constraint payroll_settings_sick_waiting_check check (sick_pay_waiting_days is null or sick_pay_waiting_days between 0 and 30),
  add column if not exists sick_pay_waiting_days_at integer default 0
    constraint payroll_settings_sick_waiting_at_check check (sick_pay_waiting_days_at is null or sick_pay_waiting_days_at between 0 and 30),
  add column if not exists sick_pay_rate_1 numeric(5, 2) default 90
    constraint payroll_settings_sick_rate_1_check check (sick_pay_rate_1 is null or sick_pay_rate_1 between 0 and 100),
  add column if not exists sick_pay_rate_2 numeric(5, 2) default 66.66
    constraint payroll_settings_sick_rate_2_check check (sick_pay_rate_2 is null or sick_pay_rate_2 between 0 and 100),
  add column if not exists sick_pay_base_days integer default 30
    constraint payroll_settings_sick_base_check check (sick_pay_base_days is null or sick_pay_base_days between 0 and 365),
  add column if not exists sick_pay_step_days integer default 10
    constraint payroll_settings_sick_step_check check (sick_pay_step_days is null or sick_pay_step_days between 0 and 365),
  add column if not exists sick_pay_step_years integer default 5
    constraint payroll_settings_sick_step_years_check check (sick_pay_step_years is null or sick_pay_step_years between 1 and 50),
  add column if not exists sick_pay_max_days integer default 90
    constraint payroll_settings_sick_max_check check (sick_pay_max_days is null or sick_pay_max_days between 0 and 365),
  add column if not exists subrogation_enabled boolean not null default false;
