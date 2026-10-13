-- Moteur de paie (lib/paie) : réglages de paie de l'entreprise, profil
-- de paie de chaque salarié, et détail calculé de chaque bulletin.
--
-- Les taux légaux (SMIC, PMSS, cotisations…) ne sont PAS ici : ils sont
-- versionnés dans le code (lib/paie/parametres.ts), identiques pour
-- toutes les entreprises. Ici ne vit que ce qui varie d'une entreprise
-- ou d'un salarié à l'autre. Même lectorat que le reste de la paie :
-- la direction gère, le salarié lit son propre profil.

create table payroll_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  headcount integer not null default 1 check (headcount >= 1),
  -- Taux AT/MP notifié par la CARSAT, en %.
  accident_rate numeric(5, 2) not null default 0,
  -- Versement mobilité (dépend de la commune), en %, à partir de 11 salariés.
  mobility_rate numeric(5, 2) not null default 0,
  -- Prévoyance conventionnelle (ex. CARCEPT Prévoyance), en % de la tranche 1.
  prevoyance_salarial_rate numeric(5, 3) not null default 0,
  prevoyance_patronal_rate numeric(5, 3) not null default 0,
  -- Complémentaire santé obligatoire, forfaits mensuels.
  mutuelle_salarial_amount numeric(8, 2) not null default 0,
  mutuelle_patronal_amount numeric(8, 2) not null default 0,
  -- Frais de déplacement conventionnels (montants unitaires).
  meal_allowance numeric(6, 2),
  single_meal_allowance numeric(6, 2),
  snack_allowance numeric(6, 2),
  overnight_allowance numeric(6, 2),
  updated_at timestamptz not null default now()
);

create table payroll_profiles (
  user_id uuid primary key references users (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  regime text not null default 'courte_distance' check (regime in ('grand_routier', 'courte_distance', 'sedentaire')),
  is_cadre boolean not null default false,
  -- Coefficient conventionnel (ex. 138M), affiché sur le bulletin.
  coefficient text,
  hourly_rate numeric(7, 4),
  contractual_hours numeric(6, 2) not null default 151.67,
  -- Taux personnalisé du prélèvement à la source ; null = taux neutre.
  pas_rate numeric(5, 2),
  updated_at timestamptz not null default now()
);
create index payroll_profiles_org_idx on payroll_profiles (organization_id);

-- Détail figé de chaque bulletin calculé par le moteur : lignes,
-- totaux, variables saisies. Sert aux cumuls de l'année et à
-- régénérer le PDF à l'identique.
alter table payslips
  add column if not exists details jsonb,
  add column if not exists variables jsonb,
  add column if not exists employer_cost numeric(10, 2),
  add column if not exists net_taxable numeric(10, 2),
  add column if not exists pas_amount numeric(10, 2),
  add column if not exists overtime_exempt numeric(10, 2);

alter table payroll_settings enable row level security;
alter table payroll_profiles enable row level security;

create policy "payroll_settings: direction"
  on payroll_settings for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());

create policy "payroll_profiles: read own or direction"
  on payroll_profiles for select
  using (
    organization_id = public.current_organization_id()
    and (user_id = public.current_app_user_id() or public.is_direction())
  );
create policy "payroll_profiles: direction writes"
  on payroll_profiles for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());
