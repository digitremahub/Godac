-- Couleurs de l'entreprise (Administration › Organisation) : couleur
-- principale, secondaire / d'alerte et du menu, au format
-- {"principale":"#RRGGBB","secondaire":"#RRGGBB","menu":"#RRGGBB"}.
-- null = couleurs GODAC d'origine. Écriture par la direction seulement :
-- policy existante « org: direction can update their own org »
-- (20260101000009_rls_policies.sql) + contrôle dans
-- app/api/admin/organization/route.ts. Lecture : tous les membres
-- (policy « org: members can read their own org »).
alter table public.organizations
  add column if not exists brand_colors jsonb;

alter table public.organizations
  add constraint organizations_brand_colors_format check (
    brand_colors is null
    or (
      jsonb_typeof(brand_colors) = 'object'
      and coalesce(brand_colors->>'principale', '') ~ '^#[0-9A-Fa-f]{6}$'
      and coalesce(brand_colors->>'secondaire', '') ~ '^#[0-9A-Fa-f]{6}$'
      and coalesce(brand_colors->>'menu', '') ~ '^#[0-9A-Fa-f]{6}$'
    )
  );

comment on column public.organizations.brand_colors is
  'Couleurs de l''interface choisies par la direction (principale, secondaire, menu, #RRGGBB). null = couleurs GODAC.';
