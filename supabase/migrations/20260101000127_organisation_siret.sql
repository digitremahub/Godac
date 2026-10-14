-- Identité légale lue depuis le SIRET (API publique recherche-entreprises,
-- lib/organization/recherche-entreprises.ts) et conventions collectives
-- déclarées, d'où GODAC déduit ses règles de paie (lib/organization/idcc.ts :
-- IDCC 16 → règles du transport routier de lib/paie).
--
-- siret / legal_address existent déjà en production (fiche employeur du
-- bulletin, voir 20260101000091) : `if not exists` les garantit sur une
-- base neuve sans toucher aux valeurs saisies. Le code NAF reste dans
-- ape_code, la convention en clair dans convention_collective.
--
-- Migration non destructive : ajouts de colonnes uniquement.

alter table organizations
  add column if not exists siret text,
  add column if not exists legal_address text,
  add column if not exists siren text,
  add column if not exists legal_name text,
  add column if not exists naf_label text,
  add column if not exists idcc text[] not null default '{}',
  add column if not exists effectif_tranche text,
  add column if not exists company_created_on date,
  -- Dernière lecture réussie du répertoire SIRENE (null = saisie manuelle).
  add column if not exists siret_checked_at timestamptz;
