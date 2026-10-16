-- Affectation explicite renfort sur la fiche chauffeur.
-- Par défaut, un chauffeur suit strictement son planning et ne choisit pas une autre tournée.
alter table public.users
  add column if not exists is_renfort boolean not null default false;

comment on column public.users.is_renfort is
  'Autorise le chauffeur à sélectionner une tournée de renfort compatible avec ses services et les villages attribués.';
