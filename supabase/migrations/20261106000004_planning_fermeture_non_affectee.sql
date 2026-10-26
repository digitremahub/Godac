-- Planning : fermer une tournée NON AFFECTÉE (sans chauffeur) un jour donné.
--
-- Une tournée du modèle que l'exploitation sait ne pas devoir rouler ce
-- jour-là (jour férié, pas de volume, tournée supprimée) se ferme sans
-- chauffeur : c'est une ligne planning_entries avec driver_id NULL (la
-- colonne l'autorise déjà, comme les affectations « à remplacer ») et
-- tour_open = false (migration 20261105000002). Pas de nouvelle table : la
-- RLS de planning_entries (encadrement du service, direction et
-- exploitation) s'applique telle quelle à la lecture, à la fermeture et à la
-- réouverture (suppression de la ligne vide).
--
-- Cette migration est ADDITIVE et rejouable ; NON appliquée à la création.
-- Elle ne fait qu'indexer ces fermetures (lecture de la couverture, du cron
-- de surveillance et de « À traiter ») et rappelle la dépendance : sans
-- planning_entries.tour_open, l'API de fermeture répond 503 et l'écran
-- continue de fonctionner comme avant.

set local lock_timeout = '10s';

-- Dépendance (idempotente) : colonnes de la migration 20261105000002.
alter table public.planning_entries
  add column if not exists tour_open boolean not null default true,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.users (id) on delete set null;

create index if not exists planning_entries_fermees_sans_chauffeur_idx
  on public.planning_entries (organization_id, service_id, start_at)
  where tour_open = false and driver_id is null;
