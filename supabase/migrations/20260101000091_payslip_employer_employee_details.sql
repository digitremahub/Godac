-- Fiche employeur et fiche employé complètes pour le bulletin de paie
-- indicatif (lib/payslips/generate-pdf.tsx) — jusqu'ici seuls siret/
-- legal_address existaient, l'encadré employeur restait quasi vide dès
-- qu'une organisation n'avait saisi ni l'un ni l'autre. Reste un
-- document indicatif (voir le disclaimer du PDF), juste avec une
-- identité légale complète des deux côtés.

alter table public.organizations
  add column if not exists legal_form text,
  add column if not exists ape_code text,
  add column if not exists convention_collective text,
  add column if not exists urssaf_number text;

alter table public.employee_files
  add column if not exists matricule text,
  add column if not exists social_security_number text,
  add column if not exists classification text;
