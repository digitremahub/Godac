-- TICPE — lot 6 : documents. L'export existant (ticpe_exports /
-- ticpe_export_lines) évolue au lieu d'être doublé :
--   document_type  'periode' (récapitulatif 3310-TIC, défaut : les
--                  exports déjà générés le restent), 'era' (état
--                  récapitulatif annuel), 'dossier' (archive ZIP de
--                  contrôle : file_path = le .zip) ;
--   total_refund   montant de remboursement calculé ;
--   details        récapitulatif par activité / zone / taux (jsonb).
-- Lignes : montant de remboursement et litres au-delà du plafond.
-- Anciennes lignes : NULL (affichées comme avant).
--
-- ADDITIF : add column if not exists seulement.

alter table public.ticpe_exports add column if not exists document_type text not null default 'periode'
  check (document_type in ('periode', 'era', 'dossier'));
alter table public.ticpe_exports add column if not exists total_refund numeric(12, 2);
alter table public.ticpe_exports add column if not exists details jsonb;

alter table public.ticpe_export_lines add column if not exists refund_amount numeric(12, 2);
alter table public.ticpe_export_lines add column if not exists liters_over_cap numeric(12, 2);
