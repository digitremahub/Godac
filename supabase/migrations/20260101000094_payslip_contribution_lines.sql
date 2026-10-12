-- GODAC V2 — détail des cotisations sur le bulletin de paie. Jusqu'ici
-- une seule ligne "Cotisations sociales (estimation globale)" (brut -
-- net, voir lib/payslips/generate-pdf.tsx) : ça ne ressemble pas à un
-- vrai bulletin, qui détaille chaque cotisation (URSSAF, retraite,
-- prévoyance...) avec son propre taux.
--
-- Les taux sont saisis une fois par la direction (ou copiés depuis le
-- logiciel de l'expert-comptable) et appliqués au brut de chaque
-- bulletin généré — GODAC ne les invente ni ne les devine. La
-- responsabilité de leur exactitude reste côté direction/expert-
-- comptable, comme déjà écrit dans le disclaimer du PDF.
--
-- Org-scoped (pas par salarié) : une organisation applique la même
-- grille de cotisations à tous ses bulletins, modulo la convention
-- collective déjà affichée séparément.
create table payslip_contribution_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  label text not null,
  salarial_rate numeric(5, 2) not null default 0,
  patronal_rate numeric(5, 2) not null default 0,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index payslip_contribution_lines_organization_id_idx on payslip_contribution_lines (organization_id);

alter table payslip_contribution_lines enable row level security;

-- Même lectorat que les autres données de paie (user_contracts,
-- ticpe_exports) : comptable et direction, jamais un manager ou un
-- chauffeur. Écriture direction uniquement — la grille de cotisations
-- n'est pas un réglage que le comptable modifie lui-même ici.
create policy "payslip_contribution_lines: comptable and direction read"
  on payslip_contribution_lines for select
  using (
    organization_id = public.current_organization_id()
    and public.current_role() in ('comptable', 'direction')
  );

create policy "payslip_contribution_lines: direction manages"
  on payslip_contribution_lines for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());
